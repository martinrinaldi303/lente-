// clip.js — comparar lo que se ve con NOMBRES escritos, no con fotos.
//
// Las redes de las gafas sólo conocen las clases con las que se entrenaron: de una lata
// de desodorante dicen «celular» o, desde la decimocuarta pasada, «no lo conozco». CLIP
// (OpenAI, 2021, licencia MIT; ONNX de Xenova/clip-vit-base-patch32) se entrenó con 400
// millones de fotos con su texto: convierte una imagen y una frase en vectores del mismo
// espacio, y cuanto más se parecen, más probable es que la frase describa la foto. Así
// se compara el recuadro contra «a photo of a spray can» sin haber visto nunca una lata.
//
// Para qué se usa (ver sesion.js y PLAN.md, «Decimoquinta pasada»):
//   · Tercera opinión: si la red dice «celular» y CLIP, mirando lo mismo, dice con
//     claridad otra cosa, no se nombra.
//   · Nombrar lo que la red no conoce, si el nombre está en el vocabulario
//     (src/vocabulario_clip.js) o el usuario lo sumó escribiéndolo.
//
// Corre entero en esta máquina (onnxruntime-node): ~50 ms por recorte. Sólo en inglés:
// cada nombre lleva su traducción. Nunca se usa para describir personas: el vocabulario
// no tiene nada sobre gente y la sesión no lo llama si hay una persona en la mirada.
//
// Modelos en modelos/clip-b32/ (bajados el 3-oct-2026): vision_model_quantized.onnx
// (89 MB, sha256 583fd111…9839299), text_model_quantized.onnx (64,5 MB, sha256
// 73baab85…d08e5c3a), vocab.json y merges.txt.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aTamano } from './imagen.js';

export const DIR_CLIP = join(dirname(dirname(fileURLToPath(import.meta.url))), 'modelos', 'clip-b32');
const LADO = 224;
const MEDIA = [0.48145466, 0.4578275, 0.40821073];
const DESVIO = [0.26862954, 0.26130258, 0.27577711];
const INICIO = 49406, FIN = 49407, LARGO_MAXIMO = 77;
// Varias frases por nombre, promediadas: rinde mejor que una sola, y «borrosa» o «de
// cerca» es lo que ve una webcam.
export const PLANTILLAS = ['a photo of a {}.', 'a close-up photo of a {}.', 'a blurry photo of a {}.', 'a photo of the {}, taken indoors.'];

// ── El tokenizador de CLIP (BPE por bytes), el mismo del repo original ─────────
function bytesAUnicode() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const m = new Map();
  bs.forEach((b, i) => m.set(b, String.fromCharCode(cs[i])));
  return m;
}

export class Tokenizador {
  constructor(vocab, merges) {
    this.vocab = vocab;
    this.rangos = new Map();
    merges.split('\n').slice(1).filter(Boolean).slice(0, 49152 - 256 - 2).forEach((l, i) => this.rangos.set(l, i));
    this.bytes = bytesAUnicode();
    this.cache = new Map();
    this.patron = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu;
  }

  static cargar(dir = DIR_CLIP) {
    return new Tokenizador(JSON.parse(readFileSync(join(dir, 'vocab.json'), 'utf8')), readFileSync(join(dir, 'merges.txt'), 'utf8'));
  }

  bpe(palabra) {
    if (this.cache.has(palabra)) return this.cache.get(palabra);
    let partes = [...palabra.slice(0, -1), palabra.at(-1) + '</w>'];
    while (partes.length > 1) {
      let mejor = null, rango = Infinity;
      for (let i = 0; i < partes.length - 1; i++) {
        const r = this.rangos.get(`${partes[i]} ${partes[i + 1]}`);
        if (r !== undefined && r < rango) { rango = r; mejor = i; }
      }
      if (mejor === null) break;
      const [a, b] = [partes[mejor], partes[mejor + 1]], juntas = [];
      for (let i = 0; i < partes.length; i++) {
        if (i < partes.length - 1 && partes[i] === a && partes[i + 1] === b) { juntas.push(a + b); i++; }
        else juntas.push(partes[i]);
      }
      partes = juntas;
    }
    this.cache.set(palabra, partes);
    return partes;
  }

  codificar(texto) {
    const limpio = String(texto).replace(/\s+/g, ' ').trim().toLowerCase();
    const ids = [INICIO];
    for (const m of limpio.matchAll(this.patron)) {
      const palabra = [...Buffer.from(m[0], 'utf8')].map(b => this.bytes.get(b)).join('');
      for (const p of this.bpe(palabra)) { const id = this.vocab[p]; if (id !== undefined) ids.push(id); }
    }
    return [...ids.slice(0, LARGO_MAXIMO - 1), FIN];
  }
}

export function normalizar(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
}
const punto = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Un cuadrado alrededor del recuadro (CLIP mira imágenes cuadradas: estirar un recuadro
// alto y finito lo deforma), sin salirse de la imagen.
export function cuadradoDe(caja, img) {
  const lado = Math.min(Math.max(caja.ancho, caja.alto), img.width, img.height);
  const cx = caja.x0 + caja.ancho / 2, cy = caja.y0 + caja.alto / 2;
  const x0 = Math.round(Math.min(Math.max(0, cx - lado / 2), img.width - lado));
  const y0 = Math.round(Math.min(Math.max(0, cy - lado / 2), img.height - lado));
  return { x0, y0, ancho: Math.round(lado), alto: Math.round(lado) };
}

// Devuelve CLIP, o null si faltan los modelos o onnxruntime-node.
export async function crearClip(dir = DIR_CLIP) {
  if (!['vision_model_quantized.onnx', 'text_model_quantized.onnx', 'vocab.json', 'merges.txt'].every(f => existsSync(join(dir, f)))) return null;
  let ort;
  try { ort = (await import('onnxruntime-node')).default; }
  catch { return null; }
  const vision = await ort.InferenceSession.create(join(dir, 'vision_model_quantized.onnx'));
  const texto = await ort.InferenceSession.create(join(dir, 'text_model_quantized.onnx'));
  const tok = Tokenizador.cargar(dir);

  const clip = {
    // El vector (normalizado) de una región de la imagen. Por defecto, un cuadrado alrededor.
    async imagen(img, region) {
      const rgb = aTamano(img, cuadradoDe(region ?? { x0: 0, y0: 0, ancho: img.width, alto: img.height }, img), LADO);
      const plano = new Float32Array(3 * LADO * LADO);
      for (let t = 0; t < LADO * LADO; t++) for (let c = 0; c < 3; c++) plano[c * LADO * LADO + t] = (rgb[t * 3 + c] - MEDIA[c]) / DESVIO[c];
      const r = await vision.run({ [vision.inputNames[0]]: new ort.Tensor('float32', plano, [1, 3, LADO, LADO]) });
      return normalizar(r[vision.outputNames[0]].data);
    },
    // El vector (normalizado) de una frase.
    async frase(t) {
      const ids = tok.codificar(t);
      const r = await texto.run({ [texto.inputNames[0]]: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) });
      return normalizar(r[texto.outputNames[0]].data);
    },
    // El vector de un nombre en inglés: el promedio de las PLANTILLAS.
    async nombre(en) {
      const suma = new Float32Array(512);
      for (const p of PLANTILLAS) { const v = await clip.frase(p.replace('{}', en)); for (let i = 0; i < 512; i++) suma[i] += v[i]; }
      return normalizar(suma);
    },
  };
  return clip;
}

// ── El vocabulario, ya convertido en vectores ───────────────────────────────────
// `entradas`: [{ es, en, clase? }]. `clase` es el nombre de la clase de la red o del
// detector que corresponde, si hay una (para comparar opiniones).
export class Vocabulario {
  constructor(entradas, vectores) {
    this.entradas = entradas;
    this.vectores = vectores;
  }

  static async armar(clip, entradas) {
    const vectores = [];
    for (const e of entradas) vectores.push(await clip.nombre(e.en));
    return new Vocabulario(entradas, vectores);
  }

  // Sumar un nombre (lo pide el usuario: «eso es un marcador», en inglés «marker»).
  async sumar(clip, entrada) {
    const ya = this.entradas.findIndex(e => e.es === entrada.es);
    const v = await clip.nombre(entrada.en);
    if (ya >= 0) { this.entradas[ya] = entrada; this.vectores[ya] = v; }
    else { this.entradas.push(entrada); this.vectores.push(v); }
  }

  // Los nombres que mejor describen el vector, con su probabilidad (softmax con la
  // temperatura de CLIP, ×100): [{ es, en, clase, p, s }]. Las frases de un mismo
  // nombre («taza»: mug y cup) suman su probabilidad.
  ranking(vector, cuantos = 5, filtro = null) {
    const puntajes = this.vectores.map((v, i) => (filtro && !filtro(this.entradas[i]) ? -Infinity : 100 * punto(vector, v)));
    const max = Math.max(...puntajes);
    const ex = puntajes.map(s => Math.exp(s - max)), suma = ex.reduce((a, b) => a + b, 0);
    const porNombre = new Map();
    puntajes.forEach((s, i) => {
      const e = this.entradas[i], p = ex[i] / suma, ya = porNombre.get(e.es);
      if (!ya) porNombre.set(e.es, { ...e, p, s: s / 100 });
      else { ya.p += p; if (s / 100 > ya.s) Object.assign(ya, { en: e.en, s: s / 100 }); }
    });
    return [...porNombre.values()].sort((a, b) => b.p - a.p).slice(0, cuantos);
  }

  // La probabilidad que le da CLIP a un nombre (sumando sus frases).
  probabilidadDe(ranking, es) { return ranking.find(r => r.es === es)?.p ?? 0; }

  // Una copia, para que lo que suma una cuenta no lo vean las demás.
  copia() { return new Vocabulario(this.entradas.map(e => ({ ...e })), this.vectores.slice()); }
}

// El vocabulario armado, con los vectores guardados en `archivo` para no recalcularlos
// en cada arranque (son ~1.700 frases: medio minuto). Si cambió la lista o las
// plantillas, se rehace.
export async function cargarVocabulario(clip, entradas, archivo) {
  const firma = createHash('sha1').update(JSON.stringify({ entradas, PLANTILLAS })).digest('hex');
  try {
    const j = JSON.parse(readFileSync(archivo, 'utf8'));
    if (j.firma === firma) return new Vocabulario(j.entradas, j.vectores.map(v => Float32Array.from(v)));
  } catch { /* no estaba o está roto: se rehace */ }
  const v = await Vocabulario.armar(clip, entradas);
  try { writeFileSync(archivo, JSON.stringify({ firma, entradas: v.entradas, vectores: v.vectores.map(x => Array.from(x, n => Number(n.toFixed(5)))) })); }
  catch { /* sin disco: se rehace la próxima */ }
  return v;
}
