// red_general.js — usa en el cerebro las redes que entrenó cpp/entrenar.cpp.
//
// Acá sólo hay inferencia: la misma cuenta que Red::forward en cpp/redes.hpp, en
// el mismo orden, para que el cerebro opine lo mismo que midió el entrenador
// (pruebas/red_general.test.js compara las dos predicción por predicción).
//
// No reemplaza a red_objetos.js. Son dos cosas distintas:
//   red_objetos  → TUS objetos, enseñados en el momento con 12 cuadros.
//   red_general  → categorías de una base pública, entrenadas una vez y medidas.

import { readFileSync } from 'node:fs';

const CLAMP = 5.0;

export class RedGeneral {
  constructor(o) {
    this.fuente  = o.fuente;
    this.inDim   = o.inDim;
    this.clases  = o.clases;
    this.media   = Float64Array.from(o.media);
    this.sd      = Float64Array.from(o.sd);
    this.redes   = o.redes.map(r => ({
      nombre: r.nombre, tam: r.tam,
      W: r.W.map(w => Float64Array.from(w)), b: r.b.map(b => Float64Array.from(b)),
    }));
    this.medicion = o.medicion;
  }

  // null si el archivo no existe o es de otro extractor: nunca se usa a medias.
  static cargar(ruta, inDim, fuente) {
    let o;
    try { o = JSON.parse(readFileSync(ruta, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[red general] no se pudo leer ${ruta}: ${e.message}`);
      return null;
    }
    const formaOk = o?.version === 1 && o.inDim === inDim && o.fuente === fuente &&
      o.media?.length === inDim && o.sd?.length === inDim && Array.isArray(o.clases) &&
      Array.isArray(o.redes) && o.redes.length > 0 && o.redes.every(r =>
        r.tam?.[0] === inDim && r.tam.at(-1) === o.clases.length &&
        r.W?.length === r.tam.length - 1 && r.b?.length === r.tam.length - 1 &&
        r.W.every((w, c) => w.length === r.tam[c] * r.tam[c + 1]) &&
        r.b.every((b, c) => b.length === r.tam[c + 1]));
    if (!formaOk) {
      console.warn(`[red general] ${ruta} es de otra forma (se esperaba ${fuente}|${inDim}): no se usa`);
      return null;
    }
    return new RedGeneral(o);
  }

  _forward(red, xn) {
    let a = xn;
    const capas = red.tam.length - 1;
    for (let c = 0; c < capas; c++) {
      const entradas = red.tam[c], salidas = red.tam[c + 1], ultima = c + 1 === capas;
      const W = red.W[c], sig = new Float64Array(salidas);
      for (let o = 0; o < salidas; o++) {
        let z = red.b[c][o];
        const base = o * entradas;
        for (let i = 0; i < entradas; i++) z += W[base + i] * a[i];
        sig[o] = ultima || z > 0 ? z : 0;
      }
      a = sig;
    }
    let max = -Infinity, suma = 0;
    for (const v of a) if (v > max) max = v;
    for (let c = 0; c < a.length; c++) { a[c] = Math.exp(a[c] - max); suma += a[c]; }
    for (let c = 0; c < a.length; c++) a[c] /= suma;
    return a;
  }

  predecir(x) {
    const voto = this.probabilidades(x);
    if (!voto) return null;
    let mejor = 0;
    for (let c = 1; c < voto.length; c++) if (voto[c] > voto[mejor]) mejor = c;
    return { indice: mejor, nombre: this.clases[mejor], confianza: voto[mejor] };
  }

  // Voto parejo entre las redes, igual que el entrenador. Una probabilidad por clase.
  probabilidades(x) {
    if (!x || x.length !== this.inDim) return null;
    const xn = new Float64Array(this.inDim);
    for (let i = 0; i < this.inDim; i++) {
      const z = (x[i] - this.media[i]) / this.sd[i];
      xn[i] = z > CLAMP ? CLAMP : z < -CLAMP ? -CLAMP : z;
    }
    const voto = new Float64Array(this.clases.length);
    for (const red of this.redes) {
      const p = this._forward(red, xn);
      for (let c = 0; c < voto.length; c++) voto[c] += p[c] / this.redes.length;
    }
    return voto;
  }
}
