// medir.js — dimensiones y peso de un objeto a partir de la imagen.
//
// Una cámara sola NO da medidas reales: un objeto chico y cerca ocupa los mismos
// píxeles que uno grande y lejos. Hace falta saber la DISTANCIA, y hay dos formas
// baratas de tenerla:
//
//   a) un sensor de distancia en las gafas (VL53L1X, láser, ~5 USD), o
//   b) una referencia de tamaño conocido en la misma imagen (una tarjeta SUBE o
//      de crédito mide 85,6 mm de ancho).
//
// Con la distancia, es el modelo de cámara estenopeica:
//
//     tamaño real = tamaño en píxeles × distancia / focal en píxeles
//
// El PESO no se puede medir con una cámara. Lo que sale de acá es una ESTIMACIÓN:
// volumen de una forma simple × densidad del material × cuánto del volumen está
// lleno. Sirve para «pesa unos 200 g», no para una balanza.

const RAD = Math.PI / 180;

// Focal en píxeles a partir del campo de visión horizontal de la lente.
export function focalDesdeFov(anchoImagenPx, fovHorizontalGrados) {
  return (anchoImagenPx / 2) / Math.tan(fovHorizontalGrados * RAD / 2);
}

// Calibración: poner un objeto de tamaño conocido a una distancia conocida.
// Es más confiable que el FOV que declara el fabricante de la lente.
export function calibrarFocal(tamPx, tamRealMm, distanciaMm) {
  return tamPx * distanciaMm / tamRealMm;
}

export function tamanoRealMm(tamPx, distanciaMm, focalPx) {
  return tamPx * distanciaMm / focalPx;
}

// Camino (b): la distancia sale de la referencia de tamaño conocido.
export function distanciaPorReferenciaMm(tamPxRef, tamRealRefMm, focalPx) {
  return tamRealRefMm * focalPx / tamPxRef;
}

// g/cm³. Valores típicos; la madera y los plásticos varían bastante.
export const DENSIDAD = {
  acero: 7.85, hierro: 7.87, aluminio: 2.70, cobre: 8.96, bronce: 8.5,
  vidrio: 2.5, agua: 1.0, madera: 0.6, mdf: 0.75,
  abs: 1.05, pla: 1.24, pvc: 1.4, goma: 1.2, carton: 0.7,
};

export function volumenCm3({ forma, anchoMm, altoMm, fondoMm, diametroMm }) {
  const cm = mm => mm / 10;
  switch (forma) {
    case 'caja':     return cm(anchoMm) * cm(altoMm) * cm(fondoMm);
    case 'cilindro': return Math.PI * (cm(diametroMm) / 2) ** 2 * cm(altoMm);
    case 'esfera':   return 4 / 3 * Math.PI * (cm(diametroMm) / 2) ** 3;
    default: throw new Error(`forma desconocida: ${forma}`);
  }
}

// `relleno` es la fracción del volumen que es material: 1 para un bloque macizo,
// ~0.15 para una pieza impresa en 3D, ~0.05 para una caja de cartón vacía.
export function pesoEstimadoG({ material, relleno = 1, ...forma }) {
  const densidad = DENSIDAD[material];
  if (densidad === undefined) throw new Error(`material desconocido: ${material}`);
  return volumenCm3(forma) * densidad * relleno;
}

// ── Vehículos: distancia, velocidad y tiempo ───────────────────────────────
//
// Sin sensor, la distancia a un vehículo sale de su TAMAÑO APARENTE: se sabe
// cuánto mide de verdad (más o menos) y cuántos píxeles ocupa. Es el método de las
// miras con retícula. Dos cosas que hay que saber antes de creerle:
//
//   · Hace falta el ALTO EN PÍXELES del vehículo, y eso lo da un detector (una red
//     que marca el recuadro de cada objeto). Las redes de las gafas hoy clasifican
//     lo que hay en el recuadro del centro; no miden cuánto ocupa. Hasta que haya
//     detector, estas funciones no tienen quién las llame.
//   · El alto real varía (un auto mide entre 1,4 y 1,9 m). El error de la distancia
//     es por lo menos ese: ±15 %. La velocidad, que sale de restar dos distancias,
//     es peor: sirve para «viene rápido», no para un radar de tránsito.
//
// Para medir velocidad de verdad lo que corresponde es un radar Doppler (módulos
// de 24 GHz como el CDM324, de unos 6 USD): mide la velocidad directamente.

// Alto típico en metros. Se usa el alto y no el largo porque cambia menos con el
// ángulo desde el que se mira.
export const ALTO_TIPICO_M = {
  auto: 1.5, moto: 1.2, bicicleta: 1.1, colectivo: 3.2, camion: 3.5, persona: 1.7,
};

export function distanciaPorAltoM(clase, altoPx, focalPx) {
  const alto = ALTO_TIPICO_M[clase];
  if (alto === undefined) throw new Error(`no hay alto típico para: ${clase}`);
  if (!(altoPx > 0) || !(focalPx > 0)) throw new Error('alto en píxeles y focal tienen que ser positivos');
  return alto * focalPx / altoPx;
}

// Velocidad de acercamiento entre dos lecturas, en km/h. Positiva si se acerca.
// Es sólo la componente hacia la cámara: lo que cruza de costado no cuenta.
export function velocidadKmh(distanciaAntesM, distanciaAhoraM, segundos) {
  if (!(segundos > 0)) throw new Error('el tiempo entre lecturas tiene que ser positivo');
  return (distanciaAntesM - distanciaAhoraM) / segundos * 3.6;
}

// Cuántos segundos faltan para que llegue, a la velocidad que trae. Infinity si
// está quieto o se aleja.
export function tiempoDeLlegadaS(distanciaM, velocidadKmhDeAcercamiento) {
  return velocidadKmhDeAcercamiento > 0 ? distanciaM / (velocidadKmhDeAcercamiento / 3.6) : Infinity;
}

// A qué distancia deja de poder medirse: cuando el vehículo ocupa menos de
// `minimoPx` de alto ya no hay con qué (con 640×480 y la Logi C270, un auto de
// 1,5 m baja de 20 px a los ~58 m).
export function alcanceM(clase, focalPx, minimoPx = 20) {
  return distanciaPorAltoM(clase, minimoPx, focalPx);
}

// Focal en píxeles a partir del campo de visión DIAGONAL, que es el que publican
// los fabricantes de webcams (la Logi C270: 55° según su hoja de datos; conviene
// calibrarla con calibrarFocal, que es más confiable).
export function focalDesdeFovDiagonal(anchoPx, altoPx, fovDiagonalGrados) {
  return Math.hypot(anchoPx, altoPx) / 2 / Math.tan(fovDiagonalGrados * RAD / 2);
}

// ── Objetos chicos: tamaño con el sensor láser ─────────────────────────────
//
// Con el VL53L1X en las gafas, la distancia la da el sensor y el tamaño en píxeles,
// el recuadro del detector. El sensor mide lo que tiene adelante, en un cono angosto
// (unos 27°) apuntado al centro: vale para el objeto que está en el medio de la
// mirada, no para uno del costado. Y mide hasta la cara de adelante del objeto.
//
// Error esperable: el del FOV de la cámara (calibrar con calibrarFocal), más lo que
// el recuadro del detector le sobra o le falta al objeto. Del orden de ±10 %.

export function tamanoDeCajaCm(caja, distanciaMm, focalPx) {
  return {
    anchoCm: tamanoRealMm(caja.ancho, distanciaMm, focalPx) / 10,
    altoCm:  tamanoRealMm(caja.alto, distanciaMm, focalPx) / 10,
  };
}

// «Mide ≈ 15 × 8 cm» o, de un metro para arriba, «Mide ≈ 1,2 × 0,8 m».
export function renglonDeTamano({ anchoCm, altoCm }) {
  if (Math.max(anchoCm, altoCm) >= 100) {
    const m = (cm) => (cm / 100).toFixed(1).replace('.', ',');
    return `Mide ≈ ${m(anchoCm)} × ${m(altoCm)} m`;
  }
  const cm = (v) => Math.max(1, Math.round(v));
  return `Mide ≈ ${cm(anchoCm)} × ${cm(altoCm)} cm`;
}
