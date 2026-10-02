// red_objetos.js — la red propia: aprende objetos por ejemplos, sin API de nadie.
//
// Portada de class24 de MIIA (miia_cognitive/class24.cpp): inDim → 64 (relu) → salida.
// Tres cosas que allá costaron semanas y acá son reglas desde el primer día:
//
//   1 · LA DIMENSIÓN SE FIJA AL CONSTRUIR y va en la clave ("fuente|dim"). Un
//       vector de otra dimensión se RECHAZA. class24 v2.2 se re-inicializaba cada
//       vez que cambiaba la dimensión y se borraba sola varias veces por minuto.
//   2 · NORMALIZACIÓN POR FEATURE. Sin eso, las dims de magnitud grande dominan el
//       gradiente y la que importa queda como la entrada más débil.
//   3 · SIN ETIQUETA REAL NO SE ENTRENA. El modoEMA de class24 entrenaba contra su
//       propia salida y la contraía a una constante.
//
// Lo que cambia respecto de class24:
//   · La salida es softmax sobre N clases, no un sigmoid. Las clases se agregan en
//     caliente, y agregar una NO toca lo que ya estaba aprendido.
//   · Los ejemplos son pocos (decenas por objeto, no 19.000 por día), así que se
//     guardan y se repasan en cada entrenamiento. Con un solo paso por ejemplo,
//     que es lo que hace class24, acá no alcanzaría.
//
// ⚠️ Lo que esta red NO hace: no localiza el objeto ni reconoce cosas que nadie le
// enseñó. Clasifica lo que está en el centro de la imagen entre las clases que
// conoce. Y como softmax reparte el 100 % entre lo conocido, hay que enseñarle una
// clase «nada» (la mesa vacía, la pared) para que tenga cómo decir «no veo nada».

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const H_UNITS  = 64;
const LR       = 0.01;
const EPOCAS   = 40;
const MEMORIA_POR_CLASE = 60;   // tope por clase; se descarta el ejemplo más viejo
const SD_MIN   = 1e-3;          // piso: evita dividir por ~0 (igual que RunningNorm)
const CLAMP    = 5.0;
const VERSION  = 1;

export const CLASE_NADA = 'nada';

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng, sd) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function nombreDeClase(nombre) {
  return String(nombre ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 16);
}

export class RedObjetos {
  constructor(inDim, fuente = 'rasgos', semilla = 24) {
    if (!Number.isInteger(inDim) || inDim < 1) throw new Error(`inDim inválido: ${inDim}`);
    this.inDim   = inDim;
    this.fuente  = fuente;
    this.semilla = semilla;
    this.clases  = [];
    this.memoria = [];                       // por clase: ejemplos CRUDOS, sin normalizar
    this.W1 = new Float64Array(inDim * H_UNITS);
    this.b1 = new Float64Array(H_UNITS);
    this.W2 = [];                            // por clase: Float64Array(H_UNITS)
    this.b2 = [];
    this.media = new Float64Array(inDim);
    this.sd    = new Float64Array(inDim).fill(1);
    this.entrenamientos = 0;

    const rng = mulberry32(semilla);
    const s1 = Math.sqrt(2 / inDim);
    for (let k = 0; k < this.W1.length; k++) this.W1[k] = normal(rng, s1);
  }

  get clave() { return `${this.fuente}|${this.inDim}`; }

  // Con menos de dos clases no hay nada que distinguir: softmax daría 100 % siempre.
  get lista() { return this.clases.length >= 2; }

  dimOk(x) {
    if (x && x.length === this.inDim) return true;
    console.warn(`[red ${this.clave}] ⚠️ llegó dim=${x?.length} — descartado ` +
                 `(NO se re-inicializa: eso borraría el aprendizaje)`);
    return false;
  }

  _normalizar(x) {
    const out = new Float64Array(this.inDim);
    for (let i = 0; i < this.inDim; i++) {
      const z = (x[i] - this.media[i]) / this.sd[i];
      out[i] = z > CLAMP ? CLAMP : z < -CLAMP ? -CLAMP : z;
    }
    return out;
  }

  _forward(xn) {
    const h = new Float64Array(H_UNITS);
    for (let j = 0; j < H_UNITS; j++) h[j] = this.b1[j];
    for (let i = 0; i < this.inDim; i++) {
      const xi = xn[i];
      if (xi === 0) continue;
      const fila = i * H_UNITS;
      for (let j = 0; j < H_UNITS; j++) h[j] += this.W1[fila + j] * xi;
    }
    for (let j = 0; j < H_UNITS; j++) if (h[j] < 0) h[j] = 0;

    const n = this.clases.length;
    const p = new Float64Array(n);
    let max = -Infinity;
    for (let c = 0; c < n; c++) {
      let z = this.b2[c];
      const w = this.W2[c];
      for (let j = 0; j < H_UNITS; j++) z += w[j] * h[j];
      p[c] = z;
      if (z > max) max = z;
    }
    let suma = 0;
    for (let c = 0; c < n; c++) { p[c] = Math.exp(p[c] - max); suma += p[c]; }
    for (let c = 0; c < n; c++) p[c] /= suma;
    return { h, p };
  }

  // Guarda un ejemplo etiquetado. No entrena: eso lo hace entrenar(), una vez,
  // cuando terminó de llegar la tanda.
  agregarEjemplo(nombre, x) {
    const clase = nombreDeClase(nombre);
    if (!clase || !this.dimOk(x)) return false;
    let c = this.clases.indexOf(clase);
    if (c < 0) {
      c = this.clases.length;
      // Semilla distinta por clase, y la neurona nueva arranca chica: no pisa la
      // opinión de las que ya estaban entrenadas.
      const rng = mulberry32(this.semilla + 1000 * (c + 1));
      const w = new Float64Array(H_UNITS);
      for (let j = 0; j < H_UNITS; j++) w[j] = normal(rng, 0.01);
      this.clases.push(clase);
      this.W2.push(w);
      this.b2.push(0);
      this.memoria.push([]);
    }
    const mem = this.memoria[c];
    mem.push(Array.from(x));
    while (mem.length > MEMORIA_POR_CLASE) mem.shift();
    return true;
  }

  olvidar(nombre) {
    const c = this.clases.indexOf(nombreDeClase(nombre));
    if (c < 0) return false;
    for (const arr of [this.clases, this.W2, this.b2, this.memoria]) arr.splice(c, 1);
    return true;
  }

  // Repasa TODA la memoria. Devuelve la pérdida media de la última época.
  entrenar(epocas = EPOCAS) {
    const ejemplos = [];
    this.memoria.forEach((mem, c) => mem.forEach(x => ejemplos.push({ x, c })));
    if (!ejemplos.length) return null;

    // La normalización sale de la memoria entera, no de una media móvil: con tan
    // pocos ejemplos, el RunningNorm de MIIA no saldría nunca del warmup de 200.
    const n = ejemplos.length;
    this.media.fill(0);
    for (const e of ejemplos) for (let i = 0; i < this.inDim; i++) this.media[i] += e.x[i] / n;
    const varianza = new Float64Array(this.inDim);
    for (const e of ejemplos) for (let i = 0; i < this.inDim; i++) {
      const d = e.x[i] - this.media[i];
      varianza[i] += d * d / n;
    }
    for (let i = 0; i < this.inDim; i++) this.sd[i] = Math.max(SD_MIN, Math.sqrt(varianza[i]));
    for (const e of ejemplos) e.xn = this._normalizar(e.x);

    const rng = mulberry32(this.semilla + 7 * (++this.entrenamientos));
    const nClases = this.clases.length;
    const dh = new Float64Array(H_UNITS);
    let perdida = 0;
    for (let ep = 0; ep < epocas; ep++) {
      for (let k = ejemplos.length - 1; k > 0; k--) {      // barajar
        const r = Math.floor(rng() * (k + 1));
        [ejemplos[k], ejemplos[r]] = [ejemplos[r], ejemplos[k]];
      }
      perdida = 0;
      for (const { xn, c: etiqueta } of ejemplos) {
        const { h, p } = this._forward(xn);
        perdida += -Math.log(Math.max(p[etiqueta], 1e-12));
        dh.fill(0);
        for (let c = 0; c < nClases; c++) {
          const dz = p[c] - (c === etiqueta ? 1 : 0);
          const w = this.W2[c];
          for (let j = 0; j < H_UNITS; j++) {
            dh[j] += dz * w[j];
            w[j]  -= LR * dz * h[j];
          }
          this.b2[c] -= LR * dz;
        }
        for (let j = 0; j < H_UNITS; j++) if (h[j] <= 0) dh[j] = 0;
        for (let i = 0; i < this.inDim; i++) {
          const xi = xn[i];
          if (xi === 0) continue;
          const fila = i * H_UNITS;
          for (let j = 0; j < H_UNITS; j++) this.W1[fila + j] -= LR * dh[j] * xi;
        }
        for (let j = 0; j < H_UNITS; j++) this.b1[j] -= LR * dh[j];
      }
      perdida /= ejemplos.length;
    }
    return perdida;
  }

  // null si no puede opinar (red sin dos clases, o vector de otra dimensión).
  predecir(x) {
    if (!this.lista || !this.dimOk(x)) return null;
    const { p } = this._forward(this._normalizar(x));
    let mejor = 0;
    for (let c = 1; c < p.length; c++) if (p[c] > p[mejor]) mejor = c;
    return { nombre: this.clases[mejor], confianza: p[mejor] };
  }

  resumen() {
    return this.clases.map((nombre, c) => ({ nombre, ejemplos: this.memoria[c].length }));
  }

  aJSON() {
    return {
      version: VERSION, fuente: this.fuente, inDim: this.inDim, H: H_UNITS,
      semilla: this.semilla, entrenamientos: this.entrenamientos,
      clases: this.clases, memoria: this.memoria,
      W1: Array.from(this.W1), b1: Array.from(this.b1),
      W2: this.W2.map(w => Array.from(w)), b2: this.b2,
      media: Array.from(this.media), sd: Array.from(this.sd),
    };
  }

  // Devuelve null si el archivo no es de ESTA red: otra versión, otra dimensión u
  // otra forma. Se descarta entero antes que usarlo a medias (igual que class23).
  static desdeJSON(o, inDim, fuente) {
    const formaOk = o && o.version === VERSION && o.inDim === inDim && o.fuente === fuente &&
      o.H === H_UNITS && o.W1?.length === inDim * H_UNITS && o.b1?.length === H_UNITS &&
      o.media?.length === inDim && o.sd?.length === inDim &&
      Array.isArray(o.clases) && o.W2?.length === o.clases.length &&
      o.b2?.length === o.clases.length && o.memoria?.length === o.clases.length &&
      o.W2.every(w => w.length === H_UNITS);
    if (!formaOk) return null;
    const red = new RedObjetos(inDim, fuente, o.semilla ?? 24);
    red.entrenamientos = o.entrenamientos ?? 0;
    red.clases  = o.clases.slice();
    red.memoria = o.memoria.map(m => m.map(x => x.slice()));
    red.W1.set(o.W1); red.b1.set(o.b1);
    red.W2 = o.W2.map(w => Float64Array.from(w));
    red.b2 = o.b2.slice();
    red.media.set(o.media); red.sd.set(o.sd);
    return red;
  }

  static archivo(dir, inDim, fuente) {
    return join(dir, `red_${fuente}_${inDim}.json`);
  }

  guardar(dir) {
    mkdirSync(dir, { recursive: true });
    const destino = RedObjetos.archivo(dir, this.inDim, this.fuente);
    writeFileSync(destino + '.tmp', JSON.stringify(this.aJSON()));
    renameSync(destino + '.tmp', destino);   // nunca queda un archivo a medio escribir
  }

  static cargar(dir, inDim, fuente) {
    try {
      const o = JSON.parse(readFileSync(RedObjetos.archivo(dir, inDim, fuente), 'utf8'));
      const red = RedObjetos.desdeJSON(o, inDim, fuente);
      if (red) return red;
      console.warn(`[red ${fuente}|${inDim}] el archivo guardado es de otra forma: se arranca de cero`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[red ${fuente}|${inDim}] no se pudo leer: ${e.message}`);
    }
    return new RedObjetos(inDim, fuente);
  }
}
