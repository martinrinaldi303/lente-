// escena.js — varias cosas a la vez: qué hay en la imagen, de qué lado, a qué
// distancia aproximada, qué tiene cada persona y qué tan lejos está una cosa de otra.
//
// La pantalla de las gafas sigue nombrando UNA cosa por vez (principalDe, en
// seguimiento.js): Martín pidió el 2-oct-2026 que no «se vuelva loca» marcando todo,
// porque distrae y cansa la vista en la calle. La escena se muestra cuando se PIDE
// («¿qué hay?», «¿qué tiene en la mano?», el botón Escena) y en el panel de la PC.
//
// Las distancias son estimaciones, con «≈»: una cámara sola no mide profundidad. Salen
// del tamaño típico de cada cosa (una persona de pie mide 1,7 m, un celular 15 cm)
// y del tamaño del recuadro, como en medir.js. El error es de un 30 % o más, y un
// objeto cortado por el borde, o una persona que no se ve entera, no se mide.
//
// De una persona se dice «persona» y nada más: ni cómo es ni quién es. La única
// excepción es quien se cargó él mismo y le dio permiso a esta cuenta (src/caras.js):
// a ése se lo nombra.

import { definicionDe } from './fichas.js';
import { ALTO_TIPICO_M, LARGO_TIPICO_M, focalDesdeFovDiagonal } from './medir.js';

const CONFIANZA_ESCENA = 0.9;     // lo mismo que principalDe: por debajo, el detector se equivoca más de lo que acierta
const MAXIMO = 6;                 // más de seis cosas no se pueden decir ni leer de un vistazo
const PERSONA = 'persona';
const BORDE = 0.02;               // un recuadro a menos de 2 % del borde está cortado

// El tamaño típico de cada cosa está en medir.js (ALTO_TIPICO_M y LARGO_TIPICO_M).

const contiene = (c, p) => p.x >= c.x0 && p.x <= c.x0 + c.ancho && p.y >= c.y0 && p.y <= c.y0 + c.alto;
const area = (c) => c.ancho * c.alto;
function comun(a, b) {
  const w = Math.min(a.x0 + a.ancho, b.x0 + b.ancho) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y0 + a.alto, b.y0 + b.alto) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

// A qué distancia está, en metros, o null si no se puede estimar.
export function distanciaEstimadaM(nombre, caja, anchoImg, altoImg, focal) {
  const bx = BORDE * anchoImg, by = BORDE * altoImg;
  const cortado = caja.x0 <= bx || caja.y0 <= by || caja.x0 + caja.ancho >= anchoImg - bx || caja.y0 + caja.alto >= altoImg - by;
  if (cortado) return null;
  if (nombre === PERSONA) {
    // Entera y de pie: más alta que ancha (la misma regla que seguimiento.js).
    if (caja.alto < 1.5 * caja.ancho) return null;
    return ALTO_TIPICO_M.persona * focal / caja.alto;
  }
  if (ALTO_TIPICO_M[nombre] !== undefined) return ALTO_TIPICO_M[nombre] * focal / caja.alto;
  if (LARGO_TIPICO_M[nombre] !== undefined) return LARGO_TIPICO_M[nombre] * focal / Math.max(caja.ancho, caja.alto);
  return null;
}

// Los metros que se muestran: de a 10 cm hasta 2 m, de a medio metro hasta 10 m, y
// de a uno después. Con un error de 30 %, más precisión sería mentir.
export function metrosLegibles(m) {
  const r = m < 2 ? Math.round(m * 10) / 10 : m < 10 ? Math.round(m * 2) / 2 : Math.round(m);
  return String(r).replace('.', ',');
}

// La escena del cuadro: { objetos, relaciones }.
//   objetos    → [{ id, nombre, confianza, caja, lado, metros, definicion }], hasta 6, del
//                centro hacia afuera. `nombre` lleva un número si se repite («persona 2»).
//   relaciones → [{ a, b, tipo: 'tiene' | 'distancia', metros?, texto }].
// `nombrar(caja)` da el nombre de una persona conocida (src/caras.js) o null.
export function describirEscena(detecciones, anchoImg, altoImg, { fovDiagonalGrados = 55, nombrar = () => null } = {}) {
  const focal = focalDesdeFovDiagonal(anchoImg, altoImg, fovDiagonalGrados);
  const medio = { x: anchoImg / 2, y: altoImg / 2 };
  const alCentro = (c) => Math.hypot(c.x0 + c.ancho / 2 - medio.x, c.y0 + c.alto / 2 - medio.y);
  // Lo seguro (o confirmado por las redes propias), sin repetidos: dos recuadros del
  // mismo nombre que se pisan más de la mitad son la misma cosa.
  const seguras = detecciones.filter(d => d.confirmado || d.confianza >= CONFIANZA_ESCENA)
    .sort((a, b) => b.confianza - a.confianza);
  const unicas = [];
  for (const d of seguras)
    if (!unicas.some(u => u.nombre === d.nombre && comun(u.caja, d.caja) > 0.5 * Math.min(area(u.caja), area(d.caja)))) unicas.push(d);
  const elegidas = unicas.sort((a, b) => alCentro(a.caja) - alCentro(b.caja)).slice(0, MAXIMO);

  const cuantos = new Map();
  const objetos = elegidas.map((d, id) => {
    const n = (cuantos.get(d.nombre) ?? 0) + 1;
    cuantos.set(d.nombre, n);
    const cx = d.caja.x0 + d.caja.ancho / 2;
    const metros = distanciaEstimadaM(d.nombre, d.caja, anchoImg, altoImg, focal);
    const conocida = d.nombre === PERSONA ? nombrar(d.caja) : null;
    return {
      id, nombre: conocida ?? (n > 1 ? `${d.nombre} ${n}` : d.nombre), clase: d.nombre, confianza: d.confianza, caja: d.caja,
      lado: cx < anchoImg / 3 ? 'izquierda' : cx > 2 * anchoImg / 3 ? 'derecha' : 'centro',
      metros, definicion: conocida ? 'Persona conocida' : definicionDe(d.nombre),
      // Dónde está en el espacio, para medir entre dos cosas: x a la derecha, y abajo, z adelante.
      punto: metros === null ? null : { x: (cx - medio.x) * metros / focal, y: (d.caja.y0 + d.caja.alto / 2 - medio.y) * metros / focal, z: metros },
    };
  });

  const relaciones = [];
  // Lo que tiene una persona: una cosa cuyo recuadro queda casi todo dentro del de
  // ella y no la tapa entera (un celular de cerca, contra la cámara, ocupa la mitad:
  // foto 332570 de COCO, 3-oct-2026). Si se conocen las dos distancias y difieren en
  // más de 70 cm, está detrás o delante, no en su mano.
  const tenidas = new Set();
  for (const p of objetos.filter(o => o.clase === PERSONA))
    for (const o of objetos.filter(o => o.clase !== PERSONA && !tenidas.has(o.id))) {
      const dentro = comun(p.caja, o.caja) >= 0.6 * area(o.caja) && area(o.caja) <= 0.6 * area(p.caja);
      const lejos = p.metros !== null && o.metros !== null && Math.abs(p.metros - o.metros) > 0.7;
      if (dentro && !lejos) { tenidas.add(o.id); relaciones.push({ a: p.id, b: o.id, tipo: 'tiene', texto: `${p.nombre} tiene ${o.nombre}` }); }
    }
  // Entre dos cosas con distancia conocida (y que no estén una en la mano de la otra).
  for (let i = 0; i < objetos.length; i++)
    for (let j = i + 1; j < objetos.length; j++) {
      const a = objetos[i], b = objetos[j];
      if (!a.punto || !b.punto || relaciones.some(r => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id))) continue;
      const m = Math.hypot(a.punto.x - b.punto.x, a.punto.y - b.punto.y, a.punto.z - b.punto.z);
      relaciones.push({ a: a.id, b: b.id, tipo: 'distancia', metros: m, texto: `${a.nombre}-${b.nombre} ≈${metrosLegibles(m)} m` });
    }
  return { objetos, relaciones };
}

// La escena para la pantalla de las gafas: páginas de hasta tres renglones de 21
// letras. Primero qué hay (con su distancia, si se sabe), después las relaciones,
// después qué es cada cosa.
const LADO_CORTO = { izquierda: ' izq.', derecha: ' der.', centro: '' };
export function paginasDeEscena({ objetos, relaciones }) {
  const deATres = (l) => { const out = []; for (let k = 0; k < l.length; k += 3) out.push(l.slice(k, k + 3)); return out; };
  if (!objetos.length) return [['No veo nada seguro', 'Acercate o apuntá', 'al centro']];
  const lineas = objetos.map(o => `${o.nombre}${o.metros !== null ? ` ≈${metrosLegibles(o.metros)}m` : ''}${LADO_CORTO[o.lado]}`);
  const definidos = objetos.filter(o => o.definicion).flatMap(o => [`${o.nombre}:`, o.definicion]);
  return [...deATres(lineas), ...deATres(relaciones.map(r => r.texto)), ...deATres(definidos)];
}

// La escena para el LLM: lo justo para contarla, sin cajas ni puntos.
export function escenaParaLlm({ objetos, relaciones }) {
  return {
    objetos: objetos.map(o => ({ nombre: o.nombre, lado: o.lado, confianza: Number(o.confianza.toFixed(2)),
                                 metros_aprox: o.metros === null ? null : Number(o.metros.toFixed(1)), que_es: o.definicion })),
    relaciones: relaciones.map(r => r.texto),
    nota: 'Las distancias son aproximadas (±30 %). Una persona con nombre le dio permiso a esta cuenta para que la reconozcan; de las demás decí sólo «una persona»: ni cómo es ni quién es.',
  };
}
