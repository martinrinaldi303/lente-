// imagenes.js — cuadros sintéticos para las pruebas en frío. No es un test.
//
// Tres «objetos» de color y forma distintos sobre un fondo gris, con ruido, un
// corrimiento y un cambio de brillo distintos en cada cuadro, para que la red no
// pueda acertar memorizando un único vector.

import jpeg from 'jpeg-js';

const ANCHO = 320, ALTO = 240;

export function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OBJETOS = {
  nada:      { color: null },
  taza:      { color: [200, 40, 40],  dentro: (dx, dy) => Math.hypot(dx, dy) < 45 },
  pinza:     { color: [40, 70, 200],  dentro: (dx, dy) => Math.abs(dx) < 12 && Math.abs(dy) < 60 },
  cinta:     { color: [230, 200, 40], dentro: (dx, dy) => { const r = Math.hypot(dx, dy); return r > 30 && r < 50; } },
};

export function imagen(objeto, rng) {
  const o = OBJETOS[objeto];
  const data = new Uint8Array(ANCHO * ALTO * 4);
  const cx = ANCHO / 2 + (rng() - 0.5) * 24, cy = ALTO / 2 + (rng() - 0.5) * 24;
  const brillo = 0.85 + rng() * 0.3;
  for (let y = 0; y < ALTO; y++) {
    for (let x = 0; x < ANCHO; x++) {
      const k = (y * ANCHO + x) * 4;
      const base = o.color && o.dentro(x - cx, y - cy) ? o.color : [120, 120, 120];
      for (let c = 0; c < 3; c++) {
        const v = base[c] * brillo + (rng() - 0.5) * 30;
        data[k + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      data[k + 3] = 255;
    }
  }
  return { width: ANCHO, height: ALTO, data };
}

export function cuadroJpeg(objeto, rng) {
  return jpeg.encode(imagen(objeto, rng), 70).data;
}
