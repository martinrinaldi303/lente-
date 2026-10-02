// cola_acotada.js — cola FIFO con tope duro.
//
// Copiada de MIIA (scripts/cola_acotada.js, 1-oct-2026), donde tapó la fuga de
// class30: una cola sin tope que recibía 16.000 mensajes por día y soltaba 960.
// Acá el caso es el mismo en chico: la cámara manda cuadros más rápido de lo que
// el cerebro los procesa, y lo que sirve es el cuadro MÁS NUEVO. Se descarta lo
// más viejo.

export function encolarAcotado(cola, item, max) {
  cola.push(item);
  let descartados = 0;
  while (cola.length > max) {
    cola.shift();
    descartados++;
  }
  return descartados;
}

export function topeDesdeEntorno(valor, porDefecto = 200) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : porDefecto;
}
