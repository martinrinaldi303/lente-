// alertas.js — avisar cuando un vehículo viene hacia el usuario y está por llegar.
//
// La pantalla atiende a lo que se MIRA (seguimiento.js), pero un auto que viene de
// costado es justo el que no se está mirando. Por eso esto mira el cuadro ENTERO: a
// cada clase de vehículo le sigue el recuadro más grande (el más cercano) con su
// propio Seguimiento, y avisa si alguno llega en menos de LLEGADA_S segundos.
//
// Lo que hay que saber antes de confiar en el aviso:
//   · Las cuentas son las de seguimiento.js: distancia por tamaño aparente (±15 %) y
//     velocidad por cómo cambia esa distancia. Sólo cuenta lo que viene HACIA la
//     cámara; un auto que cruza de costado sin acercarse no avisa.
//   · A 2 cuadros por segundo, la velocidad aparece recién después de ~1,5 s de ver
//     el vehículo. Un auto rápido y cerca puede llegar antes del aviso. Es una ayuda,
//     no un sistema de seguridad: no reemplaza mirar y escuchar.
//   · Dos autos a la vez se confunden: se sigue el más grande de cada clase.
//   · Sin probar con vehículos reales (3-oct-2026): sólo con recuadros simulados.

import { Seguimiento } from './seguimiento.js';

export const VEHICULOS = ['auto', 'moto', 'bicicleta', 'colectivo', 'camion'];
const CONFIANZA_MINIMA = 0.9;        // la misma que mide seguimiento.js: abajo de eso, 4 de cada 10 son ciertas
const LLEGADA_S = 4;
const VELOCIDAD_MINIMA_KMH = 8;      // un vehículo que se arrima despacio no es un peligro
const MS_ENTRE_AVISOS = 4000;        // el mismo vehículo no avisa a cada cuadro

export class Vigia {
  constructor({ fovDiagonalGrados = 55, llegadaS = LLEGADA_S } = {}) {
    this.fov = fovDiagonalGrados;
    this.llegadaS = llegadaS;
    this.seguimientos = new Map();   // clase → Seguimiento
    this.ultimoAviso = new Map();    // clase → ms
  }

  // Devuelve el aviso más urgente de este cuadro, o null:
  //   { objeto, distanciaM, velocidadKmh, llegadaS }
  agregar(detecciones, anchoImg, altoImg, tMs) {
    let urgente = null;
    for (const clase of VEHICULOS) {
      const candidatos = detecciones.filter(d => d.nombre === clase && d.confianza >= CONFIANZA_MINIMA);
      if (!candidatos.length) { this.seguimientos.get(clase)?.reiniciar(); continue; }
      const mayor = candidatos.reduce((a, b) => (b.caja.alto > a.caja.alto ? b : a));
      if (!this.seguimientos.has(clase)) this.seguimientos.set(clase, new Seguimiento({ fovDiagonalGrados: this.fov }));
      const m = this.seguimientos.get(clase).agregar(mayor, anchoImg, altoImg, tMs);
      if (!m || m.llegadaS === null || m.llegadaS >= this.llegadaS || m.velocidadKmh < VELOCIDAD_MINIMA_KMH) continue;
      if (tMs - (this.ultimoAviso.get(clase) ?? -Infinity) < MS_ENTRE_AVISOS) continue;
      if (!urgente || m.llegadaS < urgente.llegadaS) urgente = { objeto: clase, ...m };
    }
    if (urgente) this.ultimoAviso.set(urgente.objeto, tMs);
    return urgente;
  }
}

// Lo que se dibuja: corto, y el tiempo redondeado hacia abajo (mejor avisar de más).
export function renglonesDeAlerta(a) {
  const s = Math.max(1, Math.floor(a.llegadaS));
  return [`${a.objeto} se acerca`, `Llega en ≈ ${s} s`, 'Mirá y frená'];
}
