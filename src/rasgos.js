// rasgos.js — de una imagen a un vector de 168 números, sin ningún modelo bajado.
//
// Es el equivalente de class10 en MIIA: convierte la entrada cruda en el vector
// que le llega a la red. Todo propio y a mano:
//
//   · 40 dims de COLOR: histograma de tono (12) × saturación (3), más 4 de grises.
//   · 128 dims de FORMA: orientación de los bordes (8) en una grilla de 4×4.
//
// Se mira sólo el CENTRO de la imagen (el 60 %), que es donde uno pone el objeto.
//
// ⚠️ El techo de esto: distingue bien un puñado de objetos de color y forma
// distintos, con luz parecida a la del día que se enseñaron. No distingue dos
// llaves casi iguales, ni reconoce un objeto visto desde un ángulo que nunca vio.
// El paso siguiente, cuando haga falta, es cambiar ESTE archivo por una red
// convolucional ya entrenada que entregue el vector; red_objetos.js no se toca,
// porque la dimensión va en la clave y un extractor nuevo es una red nueva.

export const FUENTE = 'rasgos_v0';
export const DIM    = 168;

import { regionCentral } from './imagen.js';

const LADO   = 64;      // la imagen se reduce a 64×64
const TONOS = 12, SATS = 3, GRISES = 4;
const GRILLA = 4, ORIENT = 8;
const DIM_COLOR = TONOS * SATS + GRISES;

// `img` es lo que devuelve jpeg-js: { width, height, data } con data en RGBA.
// `region` es qué parte se mira: en vivo, el centro; al entrenar, la foto entera.
export function extraerRasgos(img, region = regionCentral(img)) {
  const { width, data } = img;
  const { x0, y0, ancho, alto } = region;

  const out  = new Float32Array(DIM);
  const gris = new Float32Array(LADO * LADO);

  for (let y = 0; y < LADO; y++) {
    const sy = y0 + Math.floor((y + 0.5) * alto / LADO);
    for (let x = 0; x < LADO; x++) {
      const sx = x0 + Math.floor((x + 0.5) * ancho / LADO);
      const k = (sy * width + sx) * 4;
      const r = data[k] / 255, g = data[k + 1] / 255, b = data[k + 2] / 255;
      gris[y * LADO + x] = 0.299 * r + 0.587 * g + 0.114 * b;

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const d = max - min;
      const s = max === 0 ? 0 : d / max;
      if (s < 0.2 || max < 0.15) {
        out[TONOS * SATS + Math.min(GRISES - 1, Math.floor(max * GRISES))] += 1;
      } else {
        let h;
        if (max === r)      h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        const bt = Math.min(TONOS - 1, Math.floor(h / 6 * TONOS));
        const bs = Math.min(SATS - 1, Math.floor((s - 0.2) / 0.8 * SATS));
        out[bt * SATS + bs] += 1;
      }
    }
  }
  // Raíz del histograma normalizado: achica la ventaja del color dominante.
  for (let i = 0; i < DIM_COLOR; i++) out[i] = Math.sqrt(out[i] / (LADO * LADO));

  const celda = LADO / GRILLA;
  for (let y = 1; y < LADO - 1; y++) {
    for (let x = 1; x < LADO - 1; x++) {
      const gx = gris[y * LADO + x + 1] - gris[y * LADO + x - 1];
      const gy = gris[(y + 1) * LADO + x] - gris[(y - 1) * LADO + x];
      const mag = Math.hypot(gx, gy);
      if (mag < 0.02) continue;                    // ruido del JPEG
      let ang = Math.atan2(gy, gx);                // sin signo: un borde es un borde
      if (ang < 0) ang += Math.PI;
      const bo = Math.min(ORIENT - 1, Math.floor(ang / Math.PI * ORIENT));
      const cy = Math.floor(y / celda), cx = Math.floor(x / celda);
      out[DIM_COLOR + (cy * GRILLA + cx) * ORIENT + bo] += mag;
    }
  }
  for (let c = 0; c < GRILLA * GRILLA; c++) {
    const base = DIM_COLOR + c * ORIENT;
    let norma = 0;
    for (let o = 0; o < ORIENT; o++) norma += out[base + o] * out[base + o];
    norma = Math.sqrt(norma) + 1e-6;
    // Una celda lisa queda en cero en vez de amplificar su ruido a norma 1.
    const escala = norma < 0.5 ? 2 : 1 / norma;
    for (let o = 0; o < ORIENT; o++) out[base + o] *= escala;
  }
  return out;
}
