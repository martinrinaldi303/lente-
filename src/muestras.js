// muestras.js — fotos de TU cámara, con la etiqueta correcta, para entrenar y para medir.
//
// La red general aprendió con fotos de catálogo (Caltech) y de Flickr (COCO): objetos
// centrados, bien iluminados, de otra cámara. Con la webcam de Martín se equivocaba en
// cosas que en esas fotos casi no falla (una lata «celular», la caja negra de un
// procesador «notebook», la ropa «persona»). Lo que más mejora eso no son otras 10.000
// fotos de afuera: son unas decenas por clase de SU casa, con SU luz y SU cámara.
//
// Cada vez que en Visión se marca «Acertó» o «Se equivocó: era X», o se corrige un
// recuadro del detector, se guarda el recorte de lo que estaba en la mirada:
//
//   datos/propias/u<cuenta>/<clase>/<fecha>_<huella>.jpg        lo que ES
//   datos/propias/u<cuenta>/no_es/<clase>/<fecha>_<huella>.jpg  lo que NO es esa clase
//   datos/propias/indice.jsonl                                  un renglón por foto
//
// Una de cada TRES va al CONJUNTO DE PRUEBA fijo (por el nombre del archivo: cae siempre
// del mismo lado) y nunca se usa para entrenar. Con eso se mide cuánto acierta en tu casa
// (herramientas/medir_propias.js); las otras dos se suman al entrenamiento
// (exportar_rasgos.js --propias).
//
// Nunca personas: si lo que se marca es «persona», o hay una persona en la mirada, no se
// guarda ninguna foto (la prueba se anota igual, sin imagen). datos/ no va a git.

import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizarNombre } from './memoria.js';

export const DIR_PROPIAS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'datos', 'propias');
const UNA_DE_CADA_N_A_PRUEBA = 3;
const MARGEN = 0.08;          // el recorte lleva un poco de alrededor, como los de COCO
const LADO_MAXIMO = 512;      // más no hace falta: DINOv2 y CLIP miran a 224

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ¿Esta foto propia es de prueba? Por su ruta dentro de datos/propias (con «/»).
export const esDePrueba = (rutaRelativa) => fnv1a(rutaRelativa.split(sep).join('/').toLowerCase()) % UNA_DE_CADA_N_A_PRUEBA === 0;

// El nombre de la carpeta de una clase: sin tildes, en minúscula («Cámara» → «camara»),
// que es como se llaman las clases de la red general.
export const carpetaDe = (clase) => normalizarNombre(clase).replace(/ñ/g, 'n').replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40);

// El recorte de `caja` (o de la imagen entera) con margen, achicado y en JPEG.
export function recorteJpeg(img, caja = null, { margen = MARGEN, ladoMaximo = LADO_MAXIMO } = {}) {
  const c = caja ?? { x0: 0, y0: 0, ancho: img.width, alto: img.height };
  const mx = c.ancho * margen, my = c.alto * margen;
  const x0 = Math.max(0, Math.floor(c.x0 - mx)), y0 = Math.max(0, Math.floor(c.y0 - my));
  const x1 = Math.min(img.width, Math.ceil(c.x0 + c.ancho + mx)), y1 = Math.min(img.height, Math.ceil(c.y0 + c.alto + my));
  const escala = Math.min(1, ladoMaximo / Math.max(x1 - x0, y1 - y0));
  const w = Math.max(1, Math.round((x1 - x0) * escala)), h = Math.max(1, Math.round((y1 - y0) * escala));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + Math.min(x1 - x0 - 1, Math.floor(x / escala)), sy = y0 + Math.min(y1 - y0 - 1, Math.floor(y / escala));
    const k = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
    data[d] = img.data[k]; data[d + 1] = img.data[k + 1]; data[d + 2] = img.data[k + 2]; data[d + 3] = 255;
  }
  return jpeg.encode({ width: w, height: h, data }, 90).data;
}

export class Muestras {
  constructor({ dir = DIR_PROPIAS, reloj = Date.now } = {}) {
    this.dir = dir;
    this.reloj = reloj;
  }

  // Guarda un recorte. `clase`: lo que ES; con `noEs: true`, lo que NO es (una corrección).
  // `mostrado`: lo que decía la pantalla. Devuelve { archivo, prueba } o null si no se guardó.
  guardar({ usuarioId = 0, clase, mostrado = null, origen, jpeg: bytes, noEs = false }) {
    const carpeta = carpetaDe(clase);
    if (!carpeta || !bytes?.length || carpeta === 'persona' && !noEs) return null;
    const dir = join(this.dir, `u${usuarioId}`, ...(noEs ? ['no_es', carpeta] : [carpeta]));
    mkdirSync(dir, { recursive: true });
    const cuando = new Date(this.reloj());
    const nombre = `${cuando.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}_${createHash('sha1').update(bytes).digest('hex').slice(0, 8)}.jpg`;
    const archivo = join(dir, nombre);
    writeFileSync(archivo, bytes);
    const rel = relative(this.dir, archivo).split(sep).join('/');
    const prueba = esDePrueba(rel);
    appendFileSync(join(this.dir, 'indice.jsonl'), JSON.stringify({
      archivo: rel, clase: carpeta, no_es: noEs || undefined, mostrado: mostrado ?? undefined, origen, usuario_id: usuarioId,
      cuando: cuando.toISOString(), prueba,
    }) + '\n');
    return { archivo: rel, prueba };
  }

  // Todas las fotos propias: [{ archivo (relativo), ruta, usuario, clase, noEs, prueba }].
  listar() {
    if (!existsSync(this.dir)) return [];
    const out = [];
    for (const u of readdirSync(this.dir, { withFileTypes: true }).filter(d => d.isDirectory() && /^u\d+$/.test(d.name))) {
      const base = join(this.dir, u.name);
      const clases = (sub) => existsSync(sub) ? readdirSync(sub, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
      for (const clase of clases(base).filter(c => c !== 'no_es'))
        for (const f of readdirSync(join(base, clase)).filter(f => /\.jpe?g$/i.test(f))) out.push({ usuario: u.name, clase, noEs: false, rel: `${u.name}/${clase}/${f}` });
      for (const clase of clases(join(base, 'no_es')))
        for (const f of readdirSync(join(base, 'no_es', clase)).filter(f => /\.jpe?g$/i.test(f))) out.push({ usuario: u.name, clase, noEs: true, rel: `${u.name}/no_es/${clase}/${f}` });
    }
    return out.map(m => ({ ...m, archivo: m.rel, ruta: join(this.dir, m.rel), prueba: esDePrueba(m.rel) }));
  }

  // Lo que dice el índice de cada foto (qué mostraba la pantalla), por archivo.
  indice() {
    const m = new Map();
    try {
      for (const l of readFileSync(join(this.dir, 'indice.jsonl'), 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { const x = JSON.parse(l); m.set(x.archivo, x); } catch { /* renglón roto */ }
      }
    } catch { /* sin índice todavía */ }
    return m;
  }

  // Cuántas hay, por clase y lado, para mostrarlo en el panel (de una cuenta, o todas).
  resumen(usuarioId = null) {
    const porClase = {};
    for (const m of this.listar().filter(m => usuarioId === null || m.usuario === `u${usuarioId}`)) {
      const k = m.noEs ? `no es ${m.clase}` : m.clase;
      porClase[k] ??= { entrenamiento: 0, prueba: 0 };
      porClase[k][m.prueba ? 'prueba' : 'entrenamiento']++;
    }
    return porClase;
  }
}
