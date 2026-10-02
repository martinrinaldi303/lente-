// imagen.js — recortar, achicar y espejar. Lo comparten todos los extractores.
//
// `img` es lo que devuelve jpeg-js: { width, height, data } con data en RGBA.

// El cuadrado del centro, que es lo que marca el recuadro punteado del emulador.
// EN VIVO se mira esto: el usuario pone el objeto ahí.
export function regionCentral(img, fraccion = 0.6) {
  const lado = Math.max(8, Math.floor(Math.min(img.width, img.height) * fraccion));
  return { x0: Math.floor((img.width - lado) / 2), y0: Math.floor((img.height - lado) / 2), ancho: lado, alto: lado };
}

// La imagen entera. AL ENTRENAR con una base pública se mira esto: en Caltech-256
// el objeto ya llena la foto, y recortarle el centro era quedarse con un pedazo.
// (La primera medición, 34,7 %, se hizo con ese error.)
export function regionCompleta(img) {
  return { x0: 0, y0: 0, ancho: img.width, alto: img.height };
}

// Achica la región a lado×lado promediando todos los píxeles que caen en cada
// celda. Devuelve RGB en 0..1, de a tres por píxel.
export function reducir(img, region, lado) {
  const { width, data } = img;
  const suma = new Float64Array(lado * lado * 3);
  const cuenta = new Uint32Array(lado * lado);
  const xDe = new Uint16Array(region.ancho);
  for (let x = 0; x < region.ancho; x++) xDe[x] = Math.min(lado - 1, Math.floor(x * lado / region.ancho));
  for (let y = 0; y < region.alto; y++) {
    const ty = Math.min(lado - 1, Math.floor(y * lado / region.alto));
    let k = ((region.y0 + y) * width + region.x0) * 4;
    for (let x = 0; x < region.ancho; x++, k += 4) {
      const t = ty * lado + xDe[x];
      suma[t * 3] += data[k]; suma[t * 3 + 1] += data[k + 1]; suma[t * 3 + 2] += data[k + 2];
      cuenta[t]++;
    }
  }
  const out = new Float32Array(lado * lado * 3);
  for (let t = 0; t < cuenta.length; t++) {
    if (cuenta[t]) for (let c = 0; c < 3; c++) out[t * 3 + c] = suma[t * 3 + c] / (cuenta[t] * 255);
  }
  // Una región más chica que el destino deja celdas sin píxeles: se copia la vecina.
  if (region.ancho < lado || region.alto < lado) {
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      const t = y * lado + x;
      if (cuenta[t]) continue;
      const sx = Math.min(region.ancho - 1, Math.floor(x * region.ancho / lado));
      const sy = Math.min(region.alto - 1, Math.floor(y * region.alto / lado));
      const k = ((region.y0 + sy) * width + region.x0 + sx) * 4;
      for (let c = 0; c < 3; c++) out[t * 3 + c] = data[k + c] / 255;
    }
  }
  return out;
}

// Lleva la región a lado×lado sea más grande o más chica. Para achicar promedia
// (reducir); para agrandar interpola entre los cuatro vecinos, que es lo que pasa
// en vivo: el recuadro de un cuadro de 320×240 mide 144 px y hay que llevarlo a 224.
export function aTamano(img, region, lado) {
  if (region.ancho >= lado && region.alto >= lado) return reducir(img, region, lado);
  const { width, data } = img;
  const out = new Float32Array(lado * lado * 3);
  for (let y = 0; y < lado; y++) {
    const fy = Math.min(region.alto - 1, Math.max(0, (y + 0.5) * region.alto / lado - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(region.alto - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < lado; x++) {
      const fx = Math.min(region.ancho - 1, Math.max(0, (x + 0.5) * region.ancho / lado - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(region.ancho - 1, x0 + 1), wx = fx - x0;
      const k00 = ((region.y0 + y0) * width + region.x0 + x0) * 4, k01 = ((region.y0 + y0) * width + region.x0 + x1) * 4;
      const k10 = ((region.y0 + y1) * width + region.x0 + x0) * 4, k11 = ((region.y0 + y1) * width + region.x0 + x1) * 4;
      const t = (y * lado + x) * 3;
      for (let c = 0; c < 3; c++) {
        const arriba = data[k00 + c] * (1 - wx) + data[k01 + c] * wx;
        const abajo  = data[k10 + c] * (1 - wx) + data[k11 + c] * wx;
        out[t + c] = (arriba * (1 - wy) + abajo * wy) / 255;
      }
    }
  }
  return out;
}

// La misma imagen como en un espejo. Una taza con el asa a la izquierda sigue
// siendo una taza: sirve para duplicar los ejemplos de entrenamiento.
export function espejar(img) {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * width + x) * 4, b = (y * width + (width - 1 - x)) * 4;
      out[b] = data[a]; out[b + 1] = data[a + 1]; out[b + 2] = data[a + 2]; out[b + 3] = data[a + 3];
    }
  }
  return { width, height, data: out };
}

// Tono (12) × saturación (3) más 4 de grises = 40. Suma 1 en `out[base..base+40)`.
export const COLOR_DIMS = 40;
const TONOS = 12, SATS = 3, GRISES = 4;

export function sumarColor(out, base, r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (s < 0.2 || max < 0.15) {
    out[base + TONOS * SATS + Math.min(GRISES - 1, Math.floor(max * GRISES))] += 1;
    return;
  }
  let h;
  if (max === r)      h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  const bt = Math.min(TONOS - 1, Math.floor(h / 6 * TONOS));
  const bs = Math.min(SATS - 1, Math.floor((s - 0.2) / 0.8 * SATS));
  out[base + bt * SATS + bs] += 1;
}

// El color que más se repite en el medio de la región, con nombre. Es una
// característica MEDIDA de lo que se tiene delante, no un dato del tipo de objeto.
// Mira sólo la mitad central del recuadro, para que el fondo pese menos. Devuelve
// null si ningún color llega a un tercio de los píxeles.
export const COLORES = ['negro', 'gris', 'blanco', 'rojo', 'marrón', 'naranja', 'amarillo', 'verde', 'celeste', 'azul', 'violeta', 'rosa'];

export function nombreDeColor(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (max < 0.2) return 'negro';
  if (s < 0.18) return max > 0.8 ? 'blanco' : max < 0.35 ? 'negro' : 'gris';
  let h;
  if (max === r)      h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  h *= 60;
  if (h < 15 || h >= 345) return 'rojo';
  if (h < 45)  return max < 0.6 ? 'marrón' : 'naranja';
  if (h < 70)  return 'amarillo';
  if (h < 165) return 'verde';
  if (h < 200) return 'celeste';
  if (h < 260) return 'azul';
  if (h < 300) return 'violeta';
  return 'rosa';
}

export function colorDominante(img, region) {
  const medio = {
    x0: region.x0 + Math.floor(region.ancho / 4), y0: region.y0 + Math.floor(region.alto / 4),
    ancho: Math.max(1, Math.floor(region.ancho / 2)), alto: Math.max(1, Math.floor(region.alto / 2)),
  };
  const LADO = 16;
  const rgb = aTamano(img, medio, LADO);
  const cuenta = new Map();
  for (let t = 0; t < LADO * LADO; t++) {
    const n = nombreDeColor(rgb[t * 3], rgb[t * 3 + 1], rgb[t * 3 + 2]);
    cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
  }
  let mejor = null, veces = 0;
  for (const [n, c] of cuenta) if (c > veces) { mejor = n; veces = c; }
  return veces >= LADO * LADO / 3 ? mejor : null;
}

// Lleva la imagen ENTERA a ancho×alto, sin recortar (se deforma si la proporción
// cambia). Devuelve RGB en 0..1. Es para el detector, que mira todo el cuadro.
export function escalar(img, anchoDest, altoDest) {
  const { width, height, data } = img;
  const out = new Float32Array(anchoDest * altoDest * 3);
  for (let y = 0; y < altoDest; y++) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * height / altoDest - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < anchoDest; x++) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * width / anchoDest - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1), wx = fx - x0;
      const k00 = (y0 * width + x0) * 4, k01 = (y0 * width + x1) * 4, k10 = (y1 * width + x0) * 4, k11 = (y1 * width + x1) * 4;
      const t = (y * anchoDest + x) * 3;
      for (let c = 0; c < 3; c++) {
        const arriba = data[k00 + c] * (1 - wx) + data[k01 + c] * wx;
        const abajo  = data[k10 + c] * (1 - wx) + data[k11 + c] * wx;
        out[t + c] = (arriba * (1 - wy) + abajo * wy) / 255;
      }
    }
  }
  return out;
}
