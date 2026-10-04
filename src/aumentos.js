// aumentos.js — fotos arruinadas a propósito, para entrenar.
//
// La red general aprendió con fotos de catálogo: nítidas, bien iluminadas, con el objeto
// entero y derecho. Una webcam (o la cámara de las gafas, de 1024×768 y moviéndose con
// la cabeza) da otra cosa: poca luz con ruido, desenfoque, movimiento, compresión JPEG
// fuerte, el objeto cortado por el borde o torcido. Si la red nunca vio eso, lo confunde.
//
// Cada foto de ENTRENAMIENTO se agrega además arruinada de N formas (exportar_rasgos.js
// --aumentar N), dos defectos por vez elegidos al azar con una semilla que sale del
// nombre del archivo: la misma foto se arruina siempre igual, así la exportación se
// puede repetir. A la PRUEBA no se le agrega nada; aparte se arma una prueba arruinada
// (una versión por foto, con otra semilla) para medir si la red aguanta mejor.

import jpeg from 'jpeg-js';

// Un sorteo repetible (mulberry32) a partir de un texto.
export function azarDe(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const entre = (rng, a, b) => a + (b - a) * rng();
const limitar = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const nueva = (width, height) => ({ width, height, data: new Uint8Array(width * height * 4).fill(255) });

// Muestrea la imagen en (x, y) con interpolación bilineal (bordes: el píxel más cercano).
function muestra(img, x, y, c) {
  const { width, height, data } = img;
  const fx = Math.min(width - 1, Math.max(0, x)), fy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const wx = fx - x0, wy = fy - y0;
  return (data[(y0 * width + x0) * 4 + c] * (1 - wx) + data[(y0 * width + x1) * 4 + c] * wx) * (1 - wy)
       + (data[(y1 * width + x0) * 4 + c] * (1 - wx) + data[(y1 * width + x1) * 4 + c] * wx) * wy;
}

// ── Los defectos ───────────────────────────────────────────────────────────────
// Poca resolución o desenfoque: achicar mucho y volver a agrandar.
export function bajaResolucion(img, factor) {
  const w = Math.max(8, Math.round(img.width / factor)), h = Math.max(8, Math.round(img.height / factor));
  const chica = nueva(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++)
    chica.data[(y * w + x) * 4 + c] = muestra(img, (x + 0.5) * img.width / w - 0.5, (y + 0.5) * img.height / h - 0.5, c);
  const out = nueva(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) for (let c = 0; c < 3; c++)
    out.data[(y * img.width + x) * 4 + c] = muestra(chica, (x + 0.5) * w / img.width - 0.5, (y + 0.5) * h / img.height - 0.5, c);
  return out;
}

// Poca luz: más oscura (gamma), con el ruido del sensor y algo de tinte.
export function pocaLuz(img, rng) {
  const gamma = entre(rng, 1.4, 2.4), ruido = entre(rng, 4, 16), tinte = [entre(rng, 0.9, 1.1), 1, entre(rng, 0.85, 1.1)];
  const out = nueva(img.width, img.height);
  for (let k = 0; k < img.width * img.height; k++) {
    const r = (rng() + rng() + rng() - 1.5) * ruido;
    for (let c = 0; c < 3; c++) out.data[k * 4 + c] = limitar(255 * Math.pow(img.data[k * 4 + c] / 255, gamma) * tinte[c] + r);
  }
  return out;
}

// Luz de casa: cálida o fría, más o menos brillante y contrastada.
export function otraLuz(img, rng) {
  const brillo = entre(rng, -40, 30), contraste = entre(rng, 0.7, 1.2), calida = entre(rng, -0.12, 0.15);
  const factor = [1 + calida, 1, 1 - calida];
  const out = nueva(img.width, img.height);
  for (let k = 0; k < img.width * img.height; k++)
    for (let c = 0; c < 3; c++) out.data[k * 4 + c] = limitar(((img.data[k * 4 + c] - 128) * contraste + 128 + brillo) * factor[c]);
  return out;
}

// Movimiento: la cabeza se mueve mientras la cámara saca el cuadro.
export function movimiento(img, rng) {
  const largo = Math.max(2, Math.round(Math.max(img.width, img.height) * entre(rng, 0.015, 0.045)));
  const ang = entre(rng, 0, Math.PI), dx = Math.cos(ang), dy = Math.sin(ang);
  const out = nueva(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let t = 0; t < largo; t++) s += muestra(img, x + (t - largo / 2) * dx, y + (t - largo / 2) * dy, c);
    out.data[(y * img.width + x) * 4 + c] = s / largo;
  }
  return out;
}

// El objeto cortado o corrido: un pedazo de la foto (55 % a 85 % de cada lado).
export function recorte(img, rng) {
  const w = Math.max(8, Math.round(img.width * entre(rng, 0.55, 0.85))), h = Math.max(8, Math.round(img.height * entre(rng, 0.55, 0.85)));
  const x0 = Math.floor(rng() * (img.width - w + 1)), y0 = Math.floor(rng() * (img.height - h + 1));
  const out = nueva(w, h);
  for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return out;
}

// Torcida: girada hasta 25° (las gafas van en la cabeza, que no siempre está derecha).
// Lo que queda afuera se rellena con el borde.
export function torcida(img, rng) {
  const ang = entre(rng, -25, 25) * Math.PI / 180, cos = Math.cos(ang), sin = Math.sin(ang);
  const cx = img.width / 2, cy = img.height / 2, out = nueva(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const sx = cos * (x - cx) + sin * (y - cy) + cx, sy = -sin * (x - cx) + cos * (y - cy) + cy;
    for (let c = 0; c < 3; c++) out.data[(y * img.width + x) * 4 + c] = muestra(img, sx, sy, c);
  }
  return out;
}

// JPEG muy comprimido, como un cuadro que viaja por WiFi.
export function comprimida(img, rng) {
  const calidad = Math.round(entre(rng, 8, 30));
  return jpeg.decode(jpeg.encode({ width: img.width, height: img.height, data: img.data }, calidad).data, { useTArray: true });
}

const DEFECTOS = [
  (img, rng) => bajaResolucion(img, entre(rng, 2.5, 6)),
  pocaLuz, otraLuz, movimiento, recorte, torcida, comprimida,
];

// Antes de arruinar, la foto se lleva a un tamaño de trabajo: los defectos se piensan
// relativos a la foto, y las de COCO o de la cámara pueden ser enormes.
function aTrabajo(img, lado = 256) {
  const escala = lado / Math.max(img.width, img.height);
  if (escala >= 1) return img;
  const w = Math.max(8, Math.round(img.width * escala)), h = Math.max(8, Math.round(img.height * escala));
  const out = nueva(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++)
    out.data[(y * w + x) * 4 + c] = muestra(img, (x + 0.5) / escala - 0.5, (y + 0.5) / escala - 0.5, c);
  return out;
}

// La foto con `cuantos` defectos distintos, elegidos con `rng`.
export function arruinar(img, rng, cuantos = 2) {
  let out = aTrabajo(img);
  const elegidos = new Set();
  while (elegidos.size < Math.min(cuantos, DEFECTOS.length)) elegidos.add(Math.floor(rng() * DEFECTOS.length));
  for (const k of [...elegidos].sort((a, b) => a - b)) out = DEFECTOS[k](out, rng);
  return out;
}
