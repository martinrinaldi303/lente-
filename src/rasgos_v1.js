// rasgos_v1.js — el segundo extractor propio: más detalle de forma y color por zonas.
//
// Sigue sin usar ningún modelo bajado. Es el descriptor clásico de bordes
// orientados (HOG, Dalal y Triggs, 2005), el que se usaba para detectar peatones
// antes de las redes convolucionales:
//
//   · 900 dims de FORMA: la imagen a 60×60, celdas de 10 px (6×6), 9 orientaciones
//     con reparto entre las dos vecinas, y normalización por bloques de 2×2 celdas
//     que se solapan (5×5 bloques × 36).
//   · 160 dims de COLOR: el mismo histograma de 40 de rasgos_v0, pero uno por
//     cuadrante. v0 sabía «hay rojo»; éste sabe «hay rojo arriba a la izquierda».
//
// Qué arregla respecto de v0: v0 tomaba un píxel de cada tantos (acá se promedia),
// tenía 16 celdas (acá 36) y normalizaba cada celda sola, así que un borde fuerte
// en una celda no decía nada de las de al lado.
//
// Es OTRA fuente: `rasgos_v1|1060`. No reemplaza a v0; las redes de cada una
// votan juntas (src/conjunto.js).

import { COLOR_DIMS, reducir, regionCentral, sumarColor } from './imagen.js';

export const FUENTE = 'rasgos_v1';

const LADO = 60, CELDA = 10, CELDAS = LADO / CELDA;       // 6×6
const ORIENT = 9;
const BLOQUES = CELDAS - 1;                               // 5×5
const DIM_FORMA = BLOQUES * BLOQUES * 4 * ORIENT;         // 900
const CUADRANTES = 2;
const DIM_COLOR = CUADRANTES * CUADRANTES * COLOR_DIMS;   // 160
const RECORTE_HYS = 0.2;

export const DIM = DIM_FORMA + DIM_COLOR;                 // 1060

export function extraerRasgos(img, region = regionCentral(img)) {
  const rgb = reducir(img, region, LADO);
  const out = new Float32Array(DIM);

  const gris = new Float32Array(LADO * LADO);
  for (let t = 0; t < gris.length; t++) gris[t] = 0.299 * rgb[t * 3] + 0.587 * rgb[t * 3 + 1] + 0.114 * rgb[t * 3 + 2];

  // Histograma de orientaciones por celda. Cada borde reparte su fuerza entre las
  // dos orientaciones más cercanas: uno a 19° no salta de casillero si pasa a 21°.
  const celdas = new Float32Array(CELDAS * CELDAS * ORIENT);
  for (let y = 1; y < LADO - 1; y++) {
    for (let x = 1; x < LADO - 1; x++) {
      const gx = gris[y * LADO + x + 1] - gris[y * LADO + x - 1];
      const gy = gris[(y + 1) * LADO + x] - gris[(y - 1) * LADO + x];
      const mag = Math.hypot(gx, gy);
      if (mag === 0) continue;
      let ang = Math.atan2(gy, gx);
      if (ang < 0) ang += Math.PI;
      const pos = ang / Math.PI * ORIENT - 0.5;
      const b0 = Math.floor(pos), peso1 = pos - b0;
      const base = (Math.floor(y / CELDA) * CELDAS + Math.floor(x / CELDA)) * ORIENT;
      celdas[base + ((b0 + ORIENT) % ORIENT)] += mag * (1 - peso1);
      celdas[base + ((b0 + 1) % ORIENT)]      += mag * peso1;
    }
  }

  // Bloques de 2×2 celdas, normalizados juntos, con tope y segunda normalización
  // (L2-Hys): un reflejo muy fuerte no tapa al resto del bloque.
  let p = 0;
  for (let by = 0; by < BLOQUES; by++) {
    for (let bx = 0; bx < BLOQUES; bx++) {
      const inicio = p;
      for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const base = ((by + dy) * CELDAS + bx + dx) * ORIENT;
        for (let o = 0; o < ORIENT; o++) out[p++] = celdas[base + o];
      }
      for (let vuelta = 0; vuelta < 2; vuelta++) {
        let norma = 1e-4;
        for (let k = inicio; k < p; k++) norma += out[k] * out[k];
        norma = Math.sqrt(norma);
        for (let k = inicio; k < p; k++) out[k] = vuelta === 0 ? Math.min(out[k] / norma, RECORTE_HYS) : out[k] / norma;
      }
    }
  }

  const medio = LADO / CUADRANTES, porCuadrante = medio * medio;
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const t = (y * LADO + x) * 3;
      const q = Math.floor(y / medio) * CUADRANTES + Math.floor(x / medio);
      sumarColor(out, DIM_FORMA + q * COLOR_DIMS, rgb[t], rgb[t + 1], rgb[t + 2]);
    }
  }
  for (let k = DIM_FORMA; k < DIM; k++) out[k] = Math.sqrt(out[k] / porCuadrante);

  return out;
}
