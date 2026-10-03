// caras.js — reconocer a los AMIGOS QUE DIERON PERMISO. A nadie más.
//
// Martín pidió (3-oct-2026) decir «guardá a esta persona como Martín» y que después
// las gafas la reconozcan. Así no: eso sería cargar la cara de alguien sin que lo
// sepa. Lo que se armó es lo que eligió él entre las alternativas: la persona se
// carga ELLA MISMA, desde su cuenta, frente a la cámara de la PC, y elige qué cuentas
// la pueden reconocer (src/conocidos.js, publico/conocidos.html). Lo puede borrar
// cuando quiera, y se borra de verdad.
//
// Las reglas, a propósito redundantes:
//   1 · Una cara sólo se guarda desde la página «Personas conocidas», con la sesión
//       de su dueño, y con poses distintas (de frente, a un lado y al otro): hace
//       falta que la persona colabore. Las gafas no guardan caras: no hay mensaje
//       del WebSocket ni herramienta del LLM que lo haga.
//   2 · Las gafas comparan contra las caras de quienes le dieron permiso a ESA cuenta.
//       Sin cuenta, o sin permisos, el reconocedor ni se prende.
//   3 · De una cara desconocida no queda nada: los números se calculan en memoria,
//       se comparan y se tiran. No hay registro de «vi a Fulano»: la persona aceptó
//       que la reconozcan, no que la sigan.
//   4 · Ninguna cara viaja al LLM (identificar.js y leer.js siguen negándose).
//
// Modelos (OpenCV Zoo, bajados el 3-oct-2026 con permiso de Martín):
//   modelos/caras/face_detection_yunet_2023mar.onnx    YuNet, 232 KB, MIT: dónde hay
//       una cara y sus 5 puntos (ojos, nariz, comisuras).
//   modelos/caras/face_recognition_sface_2021dec.onnx  SFace, 38,7 MB, Apache 2.0: de
//       la cara alineada a 112×112, 128 números. Dos caras son la misma persona si
//       el coseno entre sus números es alto (OpenCV usa 0,363; acá, más exigente).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escalar } from './imagen.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const DIR_MODELOS = join(RAIZ, 'modelos', 'caras');
const YUNET = 'face_detection_yunet_2023mar.onnx';
const SFACE = 'face_recognition_sface_2021dec.onnx';
const LADO_YUNET = 640;                  // el modelo exportado tiene la entrada fija: 640×640
const PASOS = [8, 16, 32];
const LADO_SFACE = 112;
// Dónde quedan los ojos, la nariz y las comisuras en la cara alineada de 112×112:
// la plantilla de ArcFace, la misma que usa OpenCV para SFace.
const PLANTILLA = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

export const CONFIANZA_CARA = 0.85;      // por debajo, YuNet marca manchas
export const LADO_MINIMO_CARA = 36;      // px: una cara más chica no tiene detalle para reconocerla
// Coseno mínimo para decir un nombre. OpenCV publica 0,363 para «misma persona»;
// acá vale más callarse que nombrar a un desconocido. Medido el 3-oct-2026 en 145
// caras de Caltech «faces-easy» (fotos de frente, sin nombres): los pares se parten en
// dos montañas, casi todos los distintos debajo de 0,34 y los de la misma persona entre
// 0,7 y 0,98, con muy poco en el medio. 0,50 queda en el valle. SIN MEDIR con caras
// reales desde las gafas (más movidas y de costado): ahí la misma persona puede dar menos.
export const UMBRAL_MISMA_PERSONA = 0.5;

// ── YuNet: de las 12 salidas a las caras ─────────────────────────────────────
// `salidas` es { cls_8, obj_8, bbox_8, kps_8, … } con los .data de cada tensor.
// Devuelve [{ caja, puntos: [[x,y]×5], confianza }] en píxeles de la entrada de 640.
export function decodificarYunet(salidas, umbral = CONFIANZA_CARA) {
  const caras = [];
  for (const paso of PASOS) {
    const columnas = LADO_YUNET / paso, filas = LADO_YUNET / paso;
    const cls = salidas[`cls_${paso}`], obj = salidas[`obj_${paso}`], bbox = salidas[`bbox_${paso}`], kps = salidas[`kps_${paso}`];
    for (let f = 0; f < filas; f++)
      for (let c = 0; c < columnas; c++) {
        const i = f * columnas + c;
        const recortar = (v) => Math.min(1, Math.max(0, v));
        const confianza = Math.sqrt(recortar(cls[i]) * recortar(obj[i]));
        if (confianza < umbral) continue;
        const cx = (c + bbox[i * 4]) * paso, cy = (f + bbox[i * 4 + 1]) * paso;
        const w = Math.exp(bbox[i * 4 + 2]) * paso, h = Math.exp(bbox[i * 4 + 3]) * paso;
        const puntos = [];
        for (let n = 0; n < 5; n++) puntos.push([(kps[i * 10 + 2 * n] + c) * paso, (kps[i * 10 + 2 * n + 1] + f) * paso]);
        caras.push({ caja: { x0: cx - w / 2, y0: cy - h / 2, ancho: w, alto: h }, puntos, confianza });
      }
  }
  return suprimirRepetidas(caras);
}

function suprimirRepetidas(caras, umbralIou = 0.3) {
  const iou = (a, b) => {
    const w = Math.min(a.x0 + a.ancho, b.x0 + b.ancho) - Math.max(a.x0, b.x0), h = Math.min(a.y0 + a.alto, b.y0 + b.alto) - Math.max(a.y0, b.y0);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / (a.ancho * a.alto + b.ancho * b.alto - w * h);
  };
  const quedan = [];
  for (const c of caras.sort((a, b) => b.confianza - a.confianza))
    if (!quedan.some(q => iou(q.caja, c.caja) > umbralIou)) quedan.push(c);
  return quedan;
}

// ── Alinear: los 5 puntos de la cara sobre los de la plantilla ───────────────
// La semejanza (escala, giro y corrimiento) que mejor lleva `puntos` a la
// plantilla, por mínimos cuadrados. Devuelve [a, b, tx, ty]: u = a·x − b·y + tx,
// v = b·x + a·y + ty.
export function matrizDeAlineacion(puntos, destino = PLANTILLA) {
  const n = puntos.length;
  const ms = [0, 0], md = [0, 0];
  for (let k = 0; k < n; k++) { ms[0] += puntos[k][0] / n; ms[1] += puntos[k][1] / n; md[0] += destino[k][0] / n; md[1] += destino[k][1] / n; }
  let num1 = 0, num2 = 0, den = 0;
  for (let k = 0; k < n; k++) {
    const xs = puntos[k][0] - ms[0], ys = puntos[k][1] - ms[1], xd = destino[k][0] - md[0], yd = destino[k][1] - md[1];
    num1 += xs * xd + ys * yd; num2 += xs * yd - ys * xd; den += xs * xs + ys * ys;
  }
  const a = num1 / den, b = num2 / den;
  return [a, b, md[0] - (a * ms[0] - b * ms[1]), md[1] - (b * ms[0] + a * ms[1])];
}

// La cara alineada, 112×112 RGBA, con interpolación bilineal.
export function alinear(img, puntos) {
  const [a, b, tx, ty] = matrizDeAlineacion(puntos);
  const s2 = a * a + b * b, out = new Uint8Array(LADO_SFACE * LADO_SFACE * 4);
  for (let v = 0; v < LADO_SFACE; v++)
    for (let u = 0; u < LADO_SFACE; u++) {
      // La inversa de la semejanza: de la cara alineada a la foto.
      const du = u - tx, dv = v - ty;
      const x = (a * du + b * dv) / s2, y = (-b * du + a * dv) / s2;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = (v * LADO_SFACE + u) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const px = (xx, yy) => (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) ? 0 : img.data[(yy * img.width + xx) * 4 + ch];
        out[o + ch] = Math.round(px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy) + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy);
      }
      out[o + 3] = 255;
    }
  return { width: LADO_SFACE, height: LADO_SFACE, data: out };
}

export function similitud(a, b) {
  let p = 0, na = 0, nb = 0;
  for (let k = 0; k < a.length; k++) { p += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
  return p / Math.sqrt(na * nb || 1);
}

// Hacia dónde mira, por dónde cae la nariz entre los ojos: < −0,15 a un lado, > 0,15
// al otro. Para pedir poses distintas al cargar una cara (que la persona colabore).
export function poseDe(puntos) {
  const [ojoA, ojoB, nariz] = puntos;
  const medio = (ojoA[0] + ojoB[0]) / 2, entreOjos = Math.hypot(ojoB[0] - ojoA[0], ojoB[1] - ojoA[1]) || 1;
  const giro = (nariz[0] - medio) / entreOjos;
  return giro < -0.15 ? 'izquierda' : giro > 0.15 ? 'derecha' : 'frente';
}

// Los modelos. null si faltan los archivos o onnxruntime: las gafas andan igual, sin
// reconocer a nadie.
export async function crearCaras({ dir = DIR_MODELOS } = {}) {
  if (!existsSync(join(dir, YUNET)) || !existsSync(join(dir, SFACE))) return null;
  let ort;
  try { ort = (await import('onnxruntime-node')).default; } catch { return null; }
  const opciones = { logSeverityLevel: 3 };
  const yunet = await ort.InferenceSession.create(join(dir, YUNET), opciones);
  const sface = await ort.InferenceSession.create(join(dir, SFACE), opciones);

  return {
    // Las caras de una imagen RGBA (cualquier tamaño), en píxeles de ESA imagen.
    async detectar(img, { umbral = CONFIANZA_CARA } = {}) {
      const escala = Math.min(1, LADO_YUNET / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
      const rgb = escala === 1 ? null : escalar(img, w, h);
      // YuNet quiere BGR de 0 a 255, sin normalizar, y lo que sobra del 640×640, en negro.
      const plano = new Float32Array(3 * LADO_YUNET * LADO_YUNET), area = LADO_YUNET * LADO_YUNET;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const t = y * LADO_YUNET + x;
          const [r, g, b] = rgb ? [rgb[(y * w + x) * 3] * 255, rgb[(y * w + x) * 3 + 1] * 255, rgb[(y * w + x) * 3 + 2] * 255]
                                : [img.data[(y * img.width + x) * 4], img.data[(y * img.width + x) * 4 + 1], img.data[(y * img.width + x) * 4 + 2]];
          plano[t] = b; plano[area + t] = g; plano[2 * area + t] = r;
        }
      const r = await yunet.run({ input: new ort.Tensor('float32', plano, [1, 3, LADO_YUNET, LADO_YUNET]) });
      const salidas = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.data]));
      return decodificarYunet(salidas, umbral).map(c => ({
        confianza: c.confianza,
        caja: { x0: c.caja.x0 / escala, y0: c.caja.y0 / escala, ancho: c.caja.ancho / escala, alto: c.caja.alto / escala },
        puntos: c.puntos.map(([x, y]) => [x / escala, y / escala]),
      }));
    },

    // Los 128 números de una cara (ya detectada), normalizados a largo 1.
    async plantilla(img, cara) {
      const alineada = alinear(img, cara.puntos);
      // SFace quiere RGB de 0 a 255 (OpenCV le da vuelta el BGR con swapRB).
      const plano = new Float32Array(3 * LADO_SFACE * LADO_SFACE), area = LADO_SFACE * LADO_SFACE;
      for (let t = 0; t < area; t++) for (let ch = 0; ch < 3; ch++) plano[ch * area + t] = alineada.data[t * 4 + ch];
      const r = await sface.run({ data: new ort.Tensor('float32', plano, [1, 3, LADO_SFACE, LADO_SFACE]) });
      const v = Float32Array.from(r.fc1.data);
      const largo = Math.hypot(...v) || 1;
      return v.map(x => x / largo);
    },
  };
}

// ── En la sesión: a quién se parece cada cara, con memoria de unos cuadros ───
// `conocidos` es [{ id, nombre, plantillas: [Float32Array] }]: los que le dieron
// permiso a la cuenta. Un nombre se dice si la misma persona gana en 2 de los
// últimos 3 cuadros: un parecido de un cuadro solo no alcanza.
export class Reconocedor {
  constructor({ umbral = UMBRAL_MISMA_PERSONA, cuadros = 3, minimos = 2 } = {}) {
    this.umbral = umbral; this.cuadros = cuadros; this.minimos = minimos;
    this.conocidos = [];
    this.historial = [];
  }

  ponerConocidos(lista) { this.conocidos = lista ?? []; this.historial = []; }
  get activo() { return this.conocidos.length > 0; }

  // A quién se parece una plantilla: { id, nombre, similitud } o null.
  quienEs(plantilla) {
    let mejor = null;
    for (const p of this.conocidos)
      for (const q of p.plantillas) {
        const s = similitud(plantilla, q);
        if (s >= this.umbral && (!mejor || s > mejor.similitud)) mejor = { id: p.id, nombre: p.nombre, similitud: s };
      }
    return mejor;
  }

  // `caras` del cuadro, cada una con su plantilla. Devuelve las reconocidas en forma
  // estable: [{ id, nombre, caja, similitud }].
  agregar(caras) {
    const deEste = caras.map(c => ({ ...c, quien: this.quienEs(c.plantilla) })).filter(c => c.quien);
    this.historial.push(deEste);
    if (this.historial.length > this.cuadros) this.historial.shift();
    const veces = new Map();
    for (const cuadro of this.historial) for (const id of new Set(cuadro.map(c => c.quien.id))) veces.set(id, (veces.get(id) ?? 0) + 1);
    return deEste.filter(c => (veces.get(c.quien.id) ?? 0) >= this.minimos)
      .map(c => ({ id: c.quien.id, nombre: c.quien.nombre, similitud: c.quien.similitud, caja: c.caja }));
  }
}
