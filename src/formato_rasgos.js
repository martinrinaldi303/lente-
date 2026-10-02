// formato_rasgos.js — el archivo .bin que une el exportador (Node) con el
// entrenador (C++). Binario y sin dependencias: lo lee cpp/entrenar.cpp con
// `ifstream`, sin parser de JSON.
//
//   "GFR1"
//   texto   fuente            (uint16 largo + bytes UTF-8)
//   uint32  n · uint32 dim · uint32 nClases
//   texto   × nClases         nombres de las clases
//   n × { uint32 etiqueta · float32 × dim }
//
// Todo little-endian.

import { readFileSync, writeFileSync } from 'node:fs';

const MAGIA = Buffer.from('GFR1');

function texto(s) {
  const bytes = Buffer.from(s, 'utf8');
  if (bytes.length > 0xffff) throw new Error('texto demasiado largo');
  const largo = Buffer.alloc(2);
  largo.writeUInt16LE(bytes.length);
  return Buffer.concat([largo, bytes]);
}

// `filas` es [{ etiqueta, vector }], con `etiqueta` un índice en `clases`.
export function escribirRasgos(ruta, { fuente, dim, clases, filas }) {
  const cabecera = Buffer.alloc(12);
  cabecera.writeUInt32LE(filas.length, 0);
  cabecera.writeUInt32LE(dim, 4);
  cabecera.writeUInt32LE(clases.length, 8);
  const cuerpo = Buffer.alloc(filas.length * (4 + 4 * dim));
  let p = 0;
  for (const { etiqueta, vector } of filas) {
    if (vector.length !== dim) throw new Error(`vector de dim ${vector.length}, se esperaba ${dim}`);
    if (!(etiqueta >= 0 && etiqueta < clases.length)) throw new Error(`etiqueta fuera de rango: ${etiqueta}`);
    cuerpo.writeUInt32LE(etiqueta, p); p += 4;
    for (let i = 0; i < dim; i++) { cuerpo.writeFloatLE(vector[i], p); p += 4; }
  }
  writeFileSync(ruta, Buffer.concat([MAGIA, texto(fuente), cabecera, ...clases.map(texto), cuerpo]));
}

export function leerRasgos(ruta) {
  const buf = readFileSync(ruta);
  if (!buf.subarray(0, 4).equals(MAGIA)) throw new Error(`${ruta} no es un archivo de rasgos (GFR1)`);
  let p = 4;
  const leerTexto = () => { const l = buf.readUInt16LE(p); p += 2; const s = buf.toString('utf8', p, p + l); p += l; return s; };
  const fuente = leerTexto();
  const n = buf.readUInt32LE(p), dim = buf.readUInt32LE(p + 4), nClases = buf.readUInt32LE(p + 8);
  p += 12;
  const clases = Array.from({ length: nClases }, leerTexto);
  const filas = [];
  for (let k = 0; k < n; k++) {
    const etiqueta = buf.readUInt32LE(p); p += 4;
    const vector = new Float32Array(dim);
    for (let i = 0; i < dim; i++) { vector[i] = buf.readFloatLE(p); p += 4; }
    filas.push({ etiqueta, vector });
  }
  return { fuente, dim, clases, filas };
}
