// seguimiento.js — de la lista de objetos del detector, cuál es EL objeto, y a qué
// distancia está, a qué velocidad viene y cuánto falta para que llegue.
//
// Dos partes:
//   principalDe()  elige un objeto entre todos los del cuadro.
//   Seguimiento    lo sigue cuadro a cuadro y mide.
//
// Las cuentas son las de src/medir.js. Lo que hay que saber antes de creerles:
//   · La distancia sale del ALTO del recuadro y de un alto «típico» (un auto: 1,5 m).
//     Los vehículos no miden todos lo mismo: el error es de al menos ±15 %.
//   · Si el recuadro toca el borde de arriba o de abajo, el objeto está cortado y el
//     alto es mentira: no se mide.
//   · La velocidad sale de cómo cambia la distancia. A dos cuadros por segundo y con
//     el recuadro temblando, es una estimación gruesa: sirve para «viene rápido».
//     Sólo es la componente hacia la cámara; lo que cruza de costado no cuenta.

import { ALTO_TIPICO_M, distanciaPorAltoM, focalDesdeFovDiagonal, tiempoDeLlegadaS } from './medir.js';
import { CLASE_NADA } from './red_objetos.js';

const PERSONA = 'persona';
// Cuánto creerle al detector, medido con herramientas/medir_confianza.js sobre 400
// fotos de validación de COCO (2-oct-2026): de lo que marca con confianza de 0,5 a
// 0,9 es cierto menos de 4 de cada 10; de 0,9 para arriba, 77 %. Y el objeto que
// elige principalDe(), uno por foto: con 0,6 opina en 376 fotos y acierta en 276;
// con 0,9 opina en 335 y acierta en 305. Más exigente acierta MÁS, no sólo se calla
// más: con el umbral viejo (0,6) una cosa dudosa le sacaba el lugar a una cierta.
const CONFIANZA_PRINCIPAL = 0.9;
const AREA_MINIMA_EN_MANO = 0.01;     // un objeto en la mano cuenta si ocupa el 1 % del cuadro o más
// La mirada: las gafas no tienen un sensor que mire el ojo, así que «lo que se mira»
// es el centro de la imagen (adonde apunta la cabeza) y un círculo alrededor, de
// este radio en fracción del lado menor. Lo que queda afuera no existe para la pantalla.
export const RADIO_DE_MIRADA = 0.22;

const contiene = (c, p) => p.x >= c.x0 && p.x <= c.x0 + c.ancho && p.y >= c.y0 && p.y <= c.y0 + c.alto;
const area = (c) => c.ancho * c.alto;
const seTocan = (a, b) => a.x0 <= b.x0 + b.ancho && b.x0 <= a.x0 + a.ancho && a.y0 <= b.y0 + b.alto && b.y0 <= a.y0 + a.alto;
// A cuántos píxeles del punto queda el recuadro: 0 si lo contiene.
const distancia = (c, p) => Math.hypot(Math.max(c.x0 - p.x, 0, p.x - c.x0 - c.ancho), Math.max(c.y0 - p.y, 0, p.y - c.y0 - c.alto));

// El objeto al que se le está prestando atención: UNO, y sólo si está en la mirada.
// La regla, en orden:
//   0 · Lo que no toca el círculo de la mirada, o es dudoso, no cuenta.
//   1 · Lo que contiene el centro. Si hay varios recuadros, el más chico: es el más
//       específico (la taza, no la mesa).
//   2 · Si lo del centro es una PERSONA y en la mirada hay además un objeto que la
//       toca (el celular que tiene en la mano, junto a la cara), gana el objeto: el
//       más cercano al centro. Con el umbral viejo, una cama del fondo o una oreja
//       tomada por cepillo le ganaban a la persona (captura de Martín, 2-oct-2026).
//   3 · Si nada contiene el centro, lo más cercano a él dentro del círculo.
// Un recuadro cuenta si el detector está seguro (confianza) o si las redes propias
// lo confirmaron mirando el recorte (`confirmado`, ver confirmar).
export function principalDe(detecciones, anchoImg, altoImg,
                            { confianza = CONFIANZA_PRINCIPAL, radio = RADIO_DE_MIRADA } = {}) {
  const medio = { x: anchoImg / 2, y: altoImg / 2 }, alcance = radio * Math.min(anchoImg, altoImg);
  const miradas = detecciones
    .filter(d => (d.confirmado || d.confianza >= confianza) && distancia(d.caja, medio) <= alcance)
    .sort((a, b) => distancia(a.caja, medio) - distancia(b.caja, medio) || area(a.caja) - area(b.caja));
  if (!miradas.length) return null;
  const enElCentro = miradas.filter(d => contiene(d.caja, medio));
  let elegido = enElCentro.find(d => d.nombre !== PERSONA) ?? enElCentro[0] ?? miradas[0];
  if (elegido.nombre === PERSONA) {
    const enLaMano = miradas.find(d => d.nombre !== PERSONA && seTocan(elegido.caja, d.caja) && area(d.caja) >= AREA_MINIMA_EN_MANO * anchoImg * altoImg);
    if (enLaMano) elegido = enLaMano;
  }
  return elegido;
}

// Los recuadros DUDOSOS que tocan la mirada: el detector vio que ahí hay algo, pero
// no llega al umbral. Son candidatos a una segunda opinión (ver confirmar).
// Devuelve hasta `maximo`, del más cercano al centro al más lejano. Los de «persona»
// no entran: una persona dudosa es un pedazo de persona.
export function dudosasDe(detecciones, anchoImg, altoImg,
                          { confianza = CONFIANZA_PRINCIPAL, radio = RADIO_DE_MIRADA, maximo = 2 } = {}) {
  const medio = { x: anchoImg / 2, y: altoImg / 2 }, alcance = radio * Math.min(anchoImg, altoImg);
  return detecciones
    .filter(d => d.nombre !== PERSONA && d.confianza < confianza && distancia(d.caja, medio) <= alcance &&
                 area(d.caja) >= AREA_MINIMA_EN_MANO * anchoImg * altoImg)
    .sort((a, b) => distancia(a.caja, medio) - distancia(b.caja, medio))
    .slice(0, maximo);
}

// La caja del detector, en enteros y sin salirse de la imagen.
export function cajaEntera(c, img) {
  const x0 = Math.max(0, Math.floor(c.x0)), y0 = Math.max(0, Math.floor(c.y0));
  return { x0, y0, ancho: Math.max(1, Math.min(img.width - x0, Math.round(c.ancho))), alto: Math.max(1, Math.min(img.height - y0, Math.round(c.alto))) };
}

// La segunda opinión: a las redes propias (`conjunto`) se les muestra el recorte de
// cada recuadro dudoso, y el recuadro vale sólo si ellas, por su cuenta, dicen LO
// MISMO que el detector. Dos que miran distinto y coinciden.
//
// Medido el 2-oct-2026 sobre 390 fotos de COCO con aparatos, 1.283 recuadros dudosos
// (cierto = hay un objeto anotado de esa clase en ese lugar):
//   · coinciden                               → cierto 191 de 287 (67 %); el detector
//     dudoso solo acierta menos de 4 de cada 10.
//   · el detector dice un aparato y las redes OTRO aparato → 15 de 47 (32 %).
//   · el detector dice otra cosa y las redes un aparato    → 9 de 158 (6 %).
// Por eso no alcanza con que las redes estén seguras: sólo conocen 67 clases, y de
// un recorte de algo que no conocen (una silla, un elefante) dicen con toda confianza
// «notebook» o «colectivo». Lo que no coincide se descarta, aunque a veces acierte:
// el celular de Martín visto de atrás, marcado «pantalla 67 %», las redes lo llamaron
// «celular 83 %», y tenían razón; pero esa regla, en general, acierta 1 de cada 3.
export async function confirmar(detecciones, img, conjunto, { confianzaRedes = 0.7, ...opciones } = {}) {
  const confirmadas = [];
  for (const d of dudosasDe(detecciones, img.width, img.height, opciones)) {
    const p = await conjunto.predecir(img, cajaEntera(d.caja, img));
    if (p && p.nombre === d.nombre && p.confianza >= confianzaRedes && p.nombre !== CLASE_NADA)
      confirmadas.push({ nombre: d.nombre, confianza: p.confianza, caja: d.caja, confirmado: true });
  }
  return confirmadas;
}

const VENTANA_S        = 3;      // la velocidad se saca de los últimos 3 segundos
const MUESTRAS_MINIMAS = 4;
const TRAMO_MINIMO_S   = 1.2;
const CORTE_S          = 2;      // más de 2 s sin verlo: es otro, se empieza de nuevo
// Si la distancia cambia más que esto de un cuadro al otro, es otro objeto. Con 1,6 se
// cortaba el seguimiento de un auto que viene rápido y ya está cerca: de 10 m a 5 m en
// medio segundo es el doble, y es el mismo auto.
const SALTO_MAXIMO     = 2.5;
const VELOCIDAD_MINIMA_KMH = 5;  // por debajo de esto es el temblor del recuadro
const BORDE_PX         = 3;
const BORDE_FRACCION   = 0.02;   // o el 2 % del alto del cuadro, lo que sea más
// Una persona entera y de pie es bastante más alta que ancha. Si el recuadro no lo
// es, es un busto o está sentada, y el «alto típico» de 1,7 m no vale: a Martín,
// sentado a medio metro de la cámara, le decía «A ≈ 3,5 m».
const PROPORCION_MINIMA = { persona: 1.5 };

export class Seguimiento {
  constructor({ fovDiagonalGrados = 55 } = {}) {
    this.fov = fovDiagonalGrados;
    this.nombre = null;
    this.muestras = [];          // { t (s), d (m) }
  }

  // Devuelve { distanciaM, velocidadKmh, llegadaS } o null si a ese objeto no se le
  // puede medir (no hay alto típico, está cortado por el borde, o no se ve entero).
  // velocidadKmh es null mientras no haya muestras suficientes, y 0 si está quieto.
  agregar(objeto, anchoImg, altoImg, tMs) {
    if (!objeto || ALTO_TIPICO_M[objeto.nombre] === undefined) { this.reiniciar(); return null; }
    const { caja } = objeto;
    const borde = Math.max(BORDE_PX, BORDE_FRACCION * altoImg);
    if (caja.y0 <= borde || caja.y0 + caja.alto >= altoImg - borde) return null;
    if (caja.alto < (PROPORCION_MINIMA[objeto.nombre] ?? 0) * caja.ancho) return null;

    const focal = focalDesdeFovDiagonal(anchoImg, altoImg, this.fov);
    const d = distanciaPorAltoM(objeto.nombre, caja.alto, focal), t = tMs / 1000;
    const ultima = this.muestras.at(-1);
    if (objeto.nombre !== this.nombre || !ultima || t - ultima.t > CORTE_S ||
        d / ultima.d > SALTO_MAXIMO || ultima.d / d > SALTO_MAXIMO) {
      this.nombre = objeto.nombre;
      this.muestras = [];
    }
    this.muestras.push({ t, d });
    while (this.muestras.length && t - this.muestras[0].t > VENTANA_S) this.muestras.shift();

    let velocidadKmh = null;
    const tramo = t - this.muestras[0].t;
    if (this.muestras.length >= MUESTRAS_MINIMAS && tramo >= TRAMO_MINIMO_S) {
      // Recta por mínimos cuadrados: aguanta mejor el temblor que restar dos lecturas.
      const n = this.muestras.length;
      const mt = this.muestras.reduce((s, m) => s + m.t, 0) / n, md = this.muestras.reduce((s, m) => s + m.d, 0) / n;
      let num = 0, den = 0;
      for (const m of this.muestras) { num += (m.t - mt) * (m.d - md); den += (m.t - mt) ** 2; }
      const acercamiento = -(num / den) * 3.6;                // positiva si se acerca
      velocidadKmh = Math.abs(acercamiento) < VELOCIDAD_MINIMA_KMH ? 0 : acercamiento;
    }
    // La distancia que se informa es el promedio de la ventana corta, no la última.
    const recientes = this.muestras.slice(-3);
    const distanciaM = recientes.reduce((s, m) => s + m.d, 0) / recientes.length;
    const llegadaS = velocidadKmh > 0 ? tiempoDeLlegadaS(distanciaM, velocidadKmh) : null;
    return { distanciaM, velocidadKmh, llegadaS };
  }

  reiniciar() { this.nombre = null; this.muestras = []; }
}

// Los metros que se muestran: de a medio metro hasta los 10 m y de a uno después. La
// cuenta tiene un error de ±15 %, y un número que baila en el último dígito a cada
// cuadro hace parpadear la pantalla sin decir nada nuevo.
export const metrosRedondos = (d) => d >= 10 ? Math.round(d) : Math.round(d * 2) / 2;
const PASO_KMH = 5;               // la velocidad, de a 5 km/h, por lo mismo

// Tres renglones de 21 letras para el HUD. «≈» porque nada de esto es exacto.
export function renglonesDeMedida(m) {
  if (!m) return [];
  const lineas = [`A ≈ ${String(metrosRedondos(m.distanciaM)).replace('.', ',')} m`];
  const kmh = Math.max(PASO_KMH, Math.round(Math.abs(m.velocidadKmh ?? 0) / PASO_KMH) * PASO_KMH);
  if (m.velocidadKmh === 0) lineas.push('Quieto');
  else if (m.velocidadKmh > 0) lineas.push(`Se acerca ≈ ${kmh} km/h`);
  else if (m.velocidadKmh < 0) lineas.push(`Se aleja ≈ ${kmh} km/h`);
  if (m.llegadaS !== null && m.llegadaS < 60) lineas.push(`Llega en ≈ ${m.llegadaS < 10 ? m.llegadaS.toFixed(1).replace('.', ',') : Math.round(m.llegadaS)} s`);
  return lineas;
}
