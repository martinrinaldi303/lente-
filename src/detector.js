// detector.js — dónde está cada cosa en el cuadro, no sólo qué hay en el centro.
//
// Las redes de las gafas CLASIFICAN: dicen qué es lo que llena el recuadro. No
// sirven si el objeto está en un costado, lejos, o al lado de otro más grande (un
// celular en la mano, junto a la cara: ganaba «persona»). Un DETECTOR marca un
// recuadro por objeto, y con eso además se puede medir: cuántos píxeles ocupa.
//
// YOLOS-tiny (Hustvl, licencia Apache 2.0), en la conversión a ONNX del repo
// Xenova/yolos-tiny de Hugging Face. 6,5 millones de pesos, entrenado con COCO:
// 80 clases. Bajado el 2-oct-2026 a modelos/yolos-tiny/model_quantized.onnx
// (9,7 MB, sha256 82b5c1de…e86b6b). Corre entero en esta máquina.
//
// ⚠️ No es propio, igual que rasgos_dino.js. Y sólo conoce las 80 clases de COCO:
// un destornillador o una calculadora no los ve. Para eso siguen las redes propias.
//
// ⚠️ No corre en el ESP32: es para el cerebro.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escalar } from './imagen.js';

export const RUTA_MODELO = join(dirname(dirname(fileURLToPath(import.meta.url))), 'modelos', 'yolos-tiny', 'model_quantized.onnx');

// Los de preprocessor_config.json del modelo.
const MEDIA = [0.485, 0.456, 0.406];
const DESVIO = [0.229, 0.224, 0.225];
const PARCHE = 16;               // el lado tiene que ser múltiplo del parche del modelo

// Las 80 clases de COCO, en el orden de sus ids (1 a 90, con huecos), con el nombre
// que usan las gafas. Donde ya había una clase propia se usa EL MISMO nombre, así
// la ficha y las medidas se encuentran solas (celular, auto, pantalla…).
const NOMBRES = {
  1: 'persona', 2: 'bicicleta', 3: 'auto', 4: 'moto', 5: 'avion', 6: 'colectivo', 7: 'tren', 8: 'camion', 9: 'barco',
  10: 'semaforo', 11: 'hidrante', 13: 'cartel de pare', 14: 'parquimetro', 15: 'banco', 16: 'pajaro', 17: 'gato', 18: 'perro',
  19: 'caballo', 20: 'oveja', 21: 'vaca', 22: 'elefante', 23: 'oso', 24: 'cebra', 25: 'jirafa', 27: 'mochila', 28: 'paraguas',
  31: 'cartera', 32: 'corbata', 33: 'valija', 34: 'frisbee', 35: 'esquis', 36: 'snowboard', 37: 'pelota', 38: 'barrilete',
  39: 'bate', 40: 'guante', 41: 'skate', 42: 'tabla de surf', 43: 'raqueta', 44: 'botella', 46: 'copa', 47: 'taza',
  48: 'tenedor', 49: 'cuchillo', 50: 'cuchara', 51: 'bol', 52: 'banana', 53: 'manzana', 54: 'sandwich', 55: 'naranja',
  56: 'brocoli', 57: 'zanahoria', 58: 'pancho', 59: 'pizza', 60: 'dona', 61: 'torta', 62: 'silla', 63: 'sillon',
  64: 'planta', 65: 'cama', 67: 'mesa', 70: 'inodoro', 72: 'pantalla', 73: 'notebook', 74: 'mouse', 75: 'control remoto',
  76: 'teclado', 77: 'celular', 78: 'microondas', 79: 'horno', 80: 'tostadora', 81: 'pileta', 82: 'heladera', 84: 'libro',
  85: 'reloj', 86: 'florero', 87: 'tijera', 88: 'oso de peluche', 89: 'secador de pelo', 90: 'cepillo dental',
};
export const CLASES_DEL_DETECTOR = Object.values(NOMBRES);
export const NOMBRES_COCO = NOMBRES;     // id de categoría de COCO → nombre

// El tamaño al que se le pasa el cuadro: el lado menor a `ladoMenor`, la misma
// proporción, y los dos lados múltiplos de 16.
export function tamanoDeEntrada(ancho, alto, ladoMenor) {
  const escala = ladoMenor / Math.min(ancho, alto);
  const redondo = (v) => Math.max(PARCHE, Math.round(v * escala / PARCHE) * PARCHE);
  return { ancho: redondo(ancho), alto: redondo(alto) };
}

// De las salidas crudas (100 candidatos) a la lista de objetos. Se separa de la
// red para poder probarla sin el modelo.
export function interpretar(logits, cajas, nClases, anchoImg, altoImg, umbral) {
  const n = cajas.length / 4, out = [];
  for (let q = 0; q < n; q++) {
    const base = q * nClases;
    let max = -Infinity;
    for (let c = 0; c < nClases; c++) if (logits[base + c] > max) max = logits[base + c];
    let suma = 0, mejor = 0, mejorP = 0;
    for (let c = 0; c < nClases; c++) suma += Math.exp(logits[base + c] - max);
    for (let c = 0; c < nClases - 1; c++) {             // la última clase es «no hay objeto»
      const prob = Math.exp(logits[base + c] - max) / suma;
      if (prob > mejorP) { mejorP = prob; mejor = c; }
    }
    if (mejorP < umbral || !NOMBRES[mejor]) continue;
    const [cx, cy, w, h] = [cajas[q * 4], cajas[q * 4 + 1], cajas[q * 4 + 2], cajas[q * 4 + 3]];
    const x0 = Math.max(0, (cx - w / 2) * anchoImg), y0 = Math.max(0, (cy - h / 2) * altoImg);
    const x1 = Math.min(anchoImg, (cx + w / 2) * anchoImg), y1 = Math.min(altoImg, (cy + h / 2) * altoImg);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    out.push({ nombre: NOMBRES[mejor], confianza: mejorP, caja: { x0, y0, ancho: x1 - x0, alto: y1 - y0 } });
  }
  return out.sort((a, b) => b.confianza - a.confianza);
}

// Devuelve el detector, o null si falta el modelo o onnxruntime-node.
// ── El zoom en la mirada ─────────────────────────────────────────────────────
// Martín pidió (3-oct-2026) que las gafas vean lo más lejos posible. YOLOS-tiny casi
// no encuentra lo que ocupa menos de ~48 px de alto, y achicar menos el cuadro rinde
// poco: con 480 de lado en vez de 384, de lo que mide 24-48 px encuentra 23 % en vez
// de 18 %, y tarda casi el doble (187 ms contra 101; 250 fotos de COCO a 640×480).
// Lo que sí rinde es mirar DOS veces: el cuadro entero, y el centro (la mitad del
// ancho y del alto, donde está la mirada) por separado, con todo su detalle. Medido
// en 206 fotos de COCO, para lo que cae en el centro, con el mismo costo por pasada:
//   alto en el cuadro entero     6-12 px   12-24 px   24-48 px   48+ px
//   sólo el cuadro entero           0 %       6 %       27 %      60 %
//   + zoom, cámara de más detalle  13 %      29 %       46 %      78 %
//   + zoom, la misma cámara         7 %      17 %       33 %      63 %
// Como el tamaño aparente baja con la distancia, es ver lo mismo hasta el doble de
// lejos, pero sólo en la mirada: el resto del cuadro sigue como antes.
const FRACCION_ZOOM = 0.5;

function recortar(img, r) {
  const data = new Uint8Array(r.ancho * r.alto * 4);
  for (let y = 0; y < r.alto; y++) data.set(img.data.subarray(((r.y0 + y) * img.width + r.x0) * 4, ((r.y0 + y) * img.width + r.x0 + r.ancho) * 4), y * r.ancho * 4);
  return { width: r.ancho, height: r.alto, data };
}

function iouCajas(a, b) {
  const w = Math.min(a.x0 + a.ancho, b.x0 + b.ancho) - Math.max(a.x0, b.x0), h = Math.min(a.y0 + a.alto, b.y0 + b.alto) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? (w * h) / (a.ancho * a.alto + b.ancho * b.alto - w * h) : 0;
}

// Lo del cuadro entero y lo del zoom, juntos y en píxeles del cuadro. Lo que el zoom ve
// cortado por el borde del recorte no se usa (está a medias: el cuadro entero lo ve
// mejor), y si los dos vieron la misma cosa queda la más segura.
// `entero`: lo que ya se detectó en el cuadro entero, si se tiene (no se repite la pasada).
export async function detectarConZoom(detector, img, { fraccion = FRACCION_ZOOM, entero = null } = {}) {
  entero ??= await detector.detectar(img);
  const r = { ancho: Math.round(img.width * fraccion), alto: Math.round(img.height * fraccion) };
  r.x0 = Math.round((img.width - r.ancho) / 2); r.y0 = Math.round((img.height - r.alto) / 2);
  const borde = 2;
  const delZoom = (await detector.detectar(recortar(img, r)))
    .filter(d => d.caja.x0 > borde && d.caja.y0 > borde && d.caja.x0 + d.caja.ancho < r.ancho - borde && d.caja.y0 + d.caja.alto < r.alto - borde)
    .map(d => ({ ...d, caja: { ...d.caja, x0: d.caja.x0 + r.x0, y0: d.caja.y0 + r.y0 }, zoom: true }));
  const todas = entero.slice();
  for (const d of delZoom) {
    const k = todas.findIndex(e => e.nombre === d.nombre && iouCajas(e.caja, d.caja) > 0.5);
    if (k < 0) todas.push(d);
    else if (d.confianza > todas[k].confianza) todas[k] = d;
  }
  return todas.sort((a, b) => b.confianza - a.confianza);
}

// ── D-FINE (3-oct-2026) ──────────────────────────────────────────────────────
// Un detector más nuevo con las MISMAS 80 clases de COCO (Peng y otros, 2024, licencia
// Apache 2.0; ONNX de onnx-community/dfine_s_coco-ONNX, 41,5 MB, sha256 cd8a49a9…f7238). Dos
// diferencias con YOLOS: mira el cuadro llevado a 640×640 (sin respetar la proporción,
// como en su entrenamiento) y da una probabilidad por clase con una sigmoide, sin la
// clase «no hay objeto». Su escala de confianza es otra: por eso cada detector trae su
// calibración (abajo). Las clases salen en el orden de los ids de COCO.
const IDS_COCO = Object.keys(NOMBRES).map(Number).sort((a, b) => a - b);
const LADO_DFINE = 640;
const sigmoide = (x) => 1 / (1 + Math.exp(-x));

export function interpretarDfine(logits, cajas, nClases, anchoImg, altoImg, umbral) {
  const n = cajas.length / 4, out = [];
  for (let q = 0; q < n; q++) {
    let max = -Infinity, mejor = 0;
    for (let c = 0; c < nClases; c++) if (logits[q * nClases + c] > max) { max = logits[q * nClases + c]; mejor = c; }
    const p = sigmoide(max), nombre = NOMBRES[IDS_COCO[mejor]];
    if (p < umbral || !nombre) continue;
    const [cx, cy, w, h] = [cajas[q * 4], cajas[q * 4 + 1], cajas[q * 4 + 2], cajas[q * 4 + 3]];
    const x0 = Math.max(0, (cx - w / 2) * anchoImg), y0 = Math.max(0, (cy - h / 2) * altoImg);
    const x1 = Math.min(anchoImg, (cx + w / 2) * anchoImg), y1 = Math.min(altoImg, (cy + h / 2) * altoImg);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    out.push({ nombre, confianza: p, caja: { x0, y0, ancho: x1 - x0, alto: y1 - y0 } });
  }
  return out.sort((a, b) => b.confianza - a.confianza);
}

// ── La calibración: un umbral por clase ──────────────────────────────────────
// Todo el cerebro usa la confianza del detector con un mismo significado: de 0,9 para
// arriba es «seguro» (la mirada, la escena, la memoria, el aviso de vehículos), de 0,5
// a 0,9 «dudoso». Eso se midió con YOLOS y con UN umbral para todas las clases, pero
// no se equivoca igual con una persona que con un celular, y D-FINE tiene otra escala.
// herramientas/calibrar_detector.js mide, con la mitad de las fotos de validación de
// COCO, desde qué puntaje cada clase acierta lo pedido, y lo deja en
// estado/umbrales_detector_<modelo>.json. Acá ese puntaje pasa a valer 0,9, y el resto
// se estira para que lo de antes siga queriendo decir lo mismo:
//   puntaje ≥ umbral → 0,9 a 1      puntaje < umbral → 0 a 0,9, en proporción
// El puntaje crudo queda en `puntaje`.
export const CONFIANZA_SEGURA = 0.9;
export function recalibrar(puntaje, umbral) {
  if (!(umbral > 0 && umbral < 1)) return puntaje;
  return puntaje >= umbral ? CONFIANZA_SEGURA + (1 - CONFIANZA_SEGURA) * (puntaje - umbral) / (1 - umbral)
                           : CONFIANZA_SEGURA * puntaje / umbral;
}

export function leerCalibracion(archivo) {
  try {
    const j = JSON.parse(readFileSync(archivo, 'utf8'));
    return Number.isFinite(j.global) ? { global: j.global, umbrales: j.umbrales ?? {}, precision: j.precision } : null;
  } catch { return null; }
}

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
// Los detectores que se pueden usar, del preferido al último. Se elige con DETECTOR=…
// en .env; si no, el primero que esté bajado. El orden sale de calibrar_detector.js
// (ver PLAN.md, «Decimoquinta pasada»).
export const MODELOS_DETECTOR = {
  'dfine-s': { nombre: 'D-FINE-S', tipo: 'dfine', ruta: join(RAIZ, 'modelos', 'dfine-s', 'model.onnx') },
  yolos:     { nombre: 'YOLOS-tiny', tipo: 'yolos', ruta: RUTA_MODELO },
};
// D-FINE-N (el chico, 15 MB) se probó y se descartó el 3-oct-2026: con ningún umbral lo que
// marca llega a ser cierto el 85 % de las veces en COCO.

// Devuelve el detector, o null si falta el modelo o onnxruntime-node.
//   modelo   una clave de MODELOS_DETECTOR (si no está bajado, se sigue con los demás)
//   ruta     un archivo puntual de YOLOS (para las pruebas)
//   calibrar false da el puntaje crudo (para calibrar)
//   ladoMenor (sólo YOLOS): 384 tarda ~115 ms por cuadro en el Ryzen 5 5600GT; 480, ~205 ms.
// D-FINE-S tarda ~140 ms por cuadro.
export async function crearDetector({ modelo = process.env.DETECTOR || null, ruta = null, ladoMenor = 384, calibrar = true,
                                      dirCalibracion = join(RAIZ, 'estado') } = {}) {
  const candidatos = ruta ? [['yolos', { ...MODELOS_DETECTOR.yolos, ruta }]]
    : Object.entries(MODELOS_DETECTOR).sort(([a], [b]) => (b === modelo) - (a === modelo));
  const elegido = candidatos.find(([, m]) => existsSync(m.ruta));
  if (!elegido) return null;
  const [clave, m] = elegido;
  let ort;
  try { ort = (await import('onnxruntime-node')).default; }
  catch { return null; }
  const sesion = await ort.InferenceSession.create(m.ruta);
  const entrada = sesion.inputNames[0];
  const calibracion = calibrar ? leerCalibracion(join(dirCalibracion, `umbrales_detector_${clave}.json`)) : null;
  // Lo que se le pide al modelo crudo: bastante abajo de cualquier umbral, para que lo
  // dudoso llegue (la segunda opinión de las redes lo necesita). Después de calibrar
  // queda lo que vale 0,5 o más, como siempre.
  const umbralCrudo = m.tipo === 'dfine' ? 0.1 : 0.5;
  const umbralDe = (nombre) => calibracion.umbrales[nombre] ?? calibracion.global;

  return {
    clave, nombre: m.nombre, calibrado: Boolean(calibracion),
    clases: CLASES_DEL_DETECTOR,
    // Los objetos del cuadro, del más seguro al menos: [{ nombre, confianza, puntaje, caja }].
    // La caja está en píxeles del cuadro ORIGINAL.
    async detectar(img) {
      let crudos;
      if (m.tipo === 'dfine') {
        const rgb = escalar(img, LADO_DFINE, LADO_DFINE), area = LADO_DFINE * LADO_DFINE;
        const plano = new Float32Array(3 * area);
        for (let t = 0; t < area; t++) for (let c = 0; c < 3; c++) plano[c * area + t] = rgb[t * 3 + c];
        const r = await sesion.run({ [entrada]: new ort.Tensor('float32', plano, [1, 3, LADO_DFINE, LADO_DFINE]) });
        crudos = interpretarDfine(r.logits.data, r.pred_boxes.data, r.logits.dims[2], img.width, img.height, umbralCrudo);
      } else {
        const { ancho, alto } = tamanoDeEntrada(img.width, img.height, ladoMenor);
        const rgb = escalar(img, ancho, alto);
        const plano = new Float32Array(3 * ancho * alto), area = ancho * alto;
        for (let t = 0; t < area; t++)
          for (let c = 0; c < 3; c++) plano[c * area + t] = (rgb[t * 3 + c] - MEDIA[c]) / DESVIO[c];
        const r = await sesion.run({ [entrada]: new ort.Tensor('float32', plano, [1, 3, alto, ancho]) });
        crudos = interpretar(r.logits.data, r.pred_boxes.data, r.logits.dims[2], img.width, img.height, umbralCrudo);
      }
      // Sin calibrar: el puntaje tal cual (D-FINE, desde 0,5, para no inundar).
      if (!calibracion) return calibrar && m.tipo === 'dfine' ? crudos.filter(d => d.confianza >= 0.5) : crudos;
      return crudos.map(d => ({ ...d, puntaje: d.confianza, confianza: recalibrar(d.confianza, umbralDe(d.nombre)) }))
        .filter(d => d.confianza >= 0.5).sort((a, b) => b.confianza - a.confianza);
    },
  };
}
