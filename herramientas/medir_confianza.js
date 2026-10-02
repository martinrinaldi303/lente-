// medir_confianza.js — cuánto creerle al detector según la confianza que dice tener.
//
//   node herramientas/medir_confianza.js [cuántas fotos]
//
// medir_detector.js cuenta cuánto ENCUENTRA. Esto cuenta lo contrario: de lo que
// marca, cuánto es verdad. Sobre fotos de validación de COCO (las 80 clases), cada
// recuadro del detector se compara con las anotaciones: es un acierto si hay un
// objeto anotado de la MISMA clase que se superpone al menos a la mitad (IoU ≥ 0,5).
// Sale separado por tramo de confianza, que es lo que sirve para elegir el umbral:
// un recuadro que aparece y desaparece en la pantalla es peor que no mostrar nada.

import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASES_DEL_DETECTOR, crearDetector } from '../src/detector.js';
import { Conjunto } from '../src/conjunto.js';
import { extractoresDisponibles } from '../src/extractores.js';
import { confirmar, principalDe } from '../src/seguimiento.js';
import { iou } from './medir_detector.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const TRAMOS = [0.5, 0.6, 0.7, 0.8, 0.9];

const cuantas = Number(process.argv[2] ?? 400);
const dirCoco = join(RAIZ, 'datos', 'coco');
const a = JSON.parse(readFileSync(join(dirCoco, 'annotations', 'instances_val2017.json'), 'utf8'));
// Las categorías de COCO, ordenadas por id, van en el mismo orden que las del detector.
const nombreDe = new Map(a.categories.slice().sort((x, y) => x.id - y.id).map((c, i) => [c.id, CLASES_DEL_DETECTOR[i]]));
const porImagen = new Map();
for (const an of a.annotations) {
  if (!porImagen.has(an.image_id)) porImagen.set(an.image_id, []);
  porImagen.get(an.image_id).push({ nombre: nombreDe.get(an.category_id), caja: { x0: an.bbox[0], y0: an.bbox[1], ancho: an.bbox[2], alto: an.bbox[3] } });
}
const detector = await crearDetector();
if (!detector) { console.error('falta el modelo en modelos/yolos-tiny'); process.exit(1); }

const cuenta = TRAMOS.map(() => ({ marcados: 0, ciertos: 0 }));
// Lo mismo para EL objeto que elige la mirada (principalDe), con cada umbral: en
// cuántas fotos opina y en cuántas de ésas lo que dice es cierto.
const UMBRALES = [...TRAMOS, 0.95];
const mirada = UMBRALES.map(() => ({ opina: 0, cierto: 0 }));
// Y con las redes propias confirmando lo dudoso, para dos radios de mirada.
let conjunto = null;
try { conjunto = Conjunto.cargar(join(RAIZ, 'estado'), { extractores: await extractoresDisponibles() }); } catch { /* sin redes entrenadas no se mide esta parte */ }
const VARIANTES = [0.22, 0.30].flatMap(radio => [false, true].map(confirma => ({ radio, confirma, opina: 0, cierto: 0, porRedes: 0, porRedesCierto: 0 })));
let fotos = 0;
for (const foto of a.images.slice(0, cuantas)) {
  let img;
  try { img = jpeg.decode(readFileSync(join(dirCoco, 'val2017', foto.file_name)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
  catch { continue; }
  fotos++;
  const reales = porImagen.get(foto.id) ?? [];
  const esCierto = (d) => reales.some(r => r.nombre === d.nombre && iou(d.caja, r.caja) >= 0.5);
  const detecciones = await detector.detectar(img);
  for (const d of detecciones) {
    const tramo = cuenta[Math.min(TRAMOS.length - 1, Math.floor((d.confianza - TRAMOS[0]) * 10))];
    tramo.marcados++;
    if (esCierto(d)) tramo.ciertos++;
  }
  UMBRALES.forEach((umbral, i) => {
    const p = principalDe(detecciones, img.width, img.height, { confianza: umbral });
    if (p) { mirada[i].opina++; if (esCierto(p)) mirada[i].cierto++; }
  });
  for (const v of VARIANTES) {
    if (v.confirma && !conjunto) continue;
    const confirmadas = v.confirma ? await confirmar(detecciones, img, conjunto, { radio: v.radio }) : [];
    const p = principalDe([...detecciones, ...confirmadas], img.width, img.height, { radio: v.radio });
    if (!p) continue;
    v.opina++; if (esCierto(p)) v.cierto++;
    if (p.confirmado) { v.porRedes++; if (esCierto(p)) v.porRedesCierto++; }
  }
}

console.log(`${fotos} fotos de validación de COCO, las 80 clases`);
console.log('confianza     marcados   ciertos');
TRAMOS.forEach((desde, i) => {
  const c = cuenta[i], hasta = i + 1 < TRAMOS.length ? TRAMOS[i + 1] : 1;
  console.log(`${desde.toFixed(1)} a ${hasta.toFixed(1)}   ${String(c.marcados).padStart(8)}   ${String(c.ciertos).padStart(5)} (${(100 * c.ciertos / Math.max(1, c.marcados)).toFixed(0)}%)`);
});
console.log('\ndesde         marcados   ciertos');
TRAMOS.forEach((desde, i) => {
  const resto = cuenta.slice(i), m = resto.reduce((s, c) => s + c.marcados, 0), ok = resto.reduce((s, c) => s + c.ciertos, 0);
  console.log(`≥ ${desde.toFixed(1)}        ${String(m).padStart(8)}   ${String(ok).padStart(5)} (${(100 * ok / Math.max(1, m)).toFixed(0)}%)`);
});
console.log('\nEl objeto que elige la mirada (uno por foto, sólo en el centro)');
console.log('umbral     opina en    es cierto');
UMBRALES.forEach((umbral, i) => {
  const m = mirada[i];
  console.log(`${umbral.toFixed(2)}       ${String(m.opina).padStart(5)} (${(100 * m.opina / Math.max(1, fotos)).toFixed(0)}%)   ${String(m.cierto).padStart(5)} (${(100 * m.cierto / Math.max(1, m.opina)).toFixed(0)}%)`);
});

console.log('\nCon las redes propias confirmando los recuadros dudosos (umbral del detector 0,9)');
console.log('radio   confirma   opina en     es cierto     de ésas, puestas por las redes');
for (const v of VARIANTES) {
  console.log(`${v.radio.toFixed(2)}    ${v.confirma ? 'sí' : 'no'}        ${String(v.opina).padStart(4)} (${(100 * v.opina / Math.max(1, fotos)).toFixed(0)}%)   ${String(v.cierto).padStart(4)} (${(100 * v.cierto / Math.max(1, v.opina)).toFixed(0)}%)    ${v.confirma ? `${v.porRedes}, ciertas ${v.porRedesCierto}` : ''}`);
}
