// medir_velocidad.js — cuánto tarda el cerebro en procesar un cuadro, con todo prendido.
//
//   node herramientas/medir_velocidad.js [cuadros]
//
// Arma una sesión como la del servidor (detector, redes, «parecido», CLIP), le pasa
// fotos de COCO a 640×480 de a una y mide cuánto tarda cada una. Las gafas mandan 2
// cuadros por segundo: si un cuadro tarda más de 500 ms, se van salteando y la pantalla
// tarda más en decidir (pide 3 de 5 cuadros seguidos).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarVocabulario, crearClip } from '../src/clip.js';
import { Conjunto, votantes } from '../src/conjunto.js';
import { crearDetector } from '../src/detector.js';
import { extractoresDisponibles } from '../src/extractores.js';
import { Ejemplos } from '../src/parecido.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { FUENTE as DINO } from '../src/rasgos_dino.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { VOCABULARIO } from '../src/vocabulario_clip.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const cuantos = Number(process.argv[2] ?? 20);
const extractores = await extractoresDisponibles();
const dino = extractores.find(e => e.fuente === DINO);
const conjunto = Conjunto.cargar(join(RAIZ, 'estado'), { extractores: votantes(extractores) });
const detector = await crearDetector();
const ejemplos = Ejemplos.cargar(join(RAIZ, 'datos', 'rasgos'), { fuente: DINO });
const clip = await crearClip();
const vocabulario = clip ? await cargarVocabulario(clip, VOCABULARIO, join(RAIZ, 'estado', 'vocabulario_clip.json')) : null;
const fotos = readdirSync(join(RAIZ, 'datos', 'coco', 'val2017')).slice(0, cuantos).map(f => readFileSync(join(RAIZ, 'datos', 'coco', 'val2017', f)));

for (const [nombre, opciones] of [['todo (zoom y CLIP)', { zoom: true, clip, vocabulario }], ['sin zoom', { zoom: false, clip, vocabulario }], ['sin CLIP', { zoom: true }]]) {
  const sesion = new Sesion({ enviarJson() {}, enviarBin() {}, red: new RedObjetos(dino.dim, dino.fuente), extractorPersonal: dino,
                              conjunto, detector, ejemplos, ...opciones });
  const tiempos = [];
  for (const jpg of fotos) {
    const t = performance.now();
    await sesion._procesar(empaquetar(BIN_JPEG, jpg).subarray(1));
    tiempos.push(performance.now() - t);
  }
  tiempos.sort((a, b) => a - b);
  const prom = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
  console.log(`${nombre.padEnd(20)} promedio ${prom.toFixed(0)} ms · mediana ${tiempos[tiempos.length >> 1].toFixed(0)} · peor ${tiempos.at(-1).toFixed(0)}  (${detector.nombre})`);
  sesion.cerrar();
}
