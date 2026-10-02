// medir_detector.js — cuánto encuentra el detector, medido contra las anotaciones de COCO.
//
//   node herramientas/medir_detector.js [fotos por clase] [lado menor]
//
// La parte de validación de COCO (datos/coco/val2017) no se usó para entrenar
// YOLOS-tiny, así que sirve de examen. Por cada clase se toman fotos que la
// contienen y se cuenta:
//   encontrados → objetos anotados que el detector marcó con la MISMA clase y un
//                 recuadro que se superpone al menos a la mitad (IoU ≥ 0,5).
//   de más      → veces que dijo esa clase donde la anotación no la tiene.
// Sólo se cuentan objetos de 48 px o más de lado: los más chicos no se ven ni a ojo.

import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearDetector } from '../src/detector.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const LADO_MINIMO = 48;

// Cuánto se superponen dos recuadros: área común sobre área total.
export function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x0 + a.ancho, b.x0 + b.ancho), y1 = Math.min(a.y0 + a.alto, b.y0 + b.alto);
  const comun = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return comun / (a.ancho * a.alto + b.ancho * b.alto - comun);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const porClase = Number(process.argv[2] ?? 80), ladoMenor = Number(process.argv[3] ?? 384);
  const CLASES = { 'cell phone': 'celular', person: 'persona', car: 'auto', motorcycle: 'moto', bus: 'colectivo', truck: 'camion',
                   bicycle: 'bicicleta', laptop: 'notebook', tv: 'pantalla', keyboard: 'teclado', mouse: 'mouse', remote: 'control remoto',
                   cup: 'taza', bottle: 'botella' };
  const dirCoco = join(RAIZ, 'datos', 'coco');
  const a = JSON.parse(readFileSync(join(dirCoco, 'annotations', 'instances_val2017.json'), 'utf8'));
  const idDe = new Map(a.categories.map(c => [c.name, c.id]));
  const imagenes = new Map(a.images.map(i => [i.id, i]));
  const porImagen = new Map();
  for (const an of a.annotations) {
    if (an.iscrowd) continue;
    if (!porImagen.has(an.image_id)) porImagen.set(an.image_id, []);
    porImagen.get(an.image_id).push(an);
  }
  const detector = await crearDetector({ ladoMenor });
  if (!detector) { console.error('falta el modelo en modelos/yolos-tiny'); process.exit(1); }

  console.log(`Detector con lado menor ${ladoMenor}, hasta ${porClase} fotos por clase`);
  console.log('clase            objetos  encontrados   de más   ms por foto');
  let totalObj = 0, totalEnc = 0;
  for (const [coco, nombre] of Object.entries(CLASES)) {
    const id = idDe.get(coco);
    const grande = (an) => an.bbox[2] >= LADO_MINIMO && an.bbox[3] >= LADO_MINIMO;
    const fotos = [...porImagen].filter(([, ans]) => ans.some(an => an.category_id === id && grande(an))).slice(0, porClase);
    let objetos = 0, encontrados = 0, deMas = 0, ms = 0;
    for (const [idImagen, ans] of fotos) {
      let img;
      try { img = jpeg.decode(readFileSync(join(dirCoco, 'val2017', imagenes.get(idImagen).file_name)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
      catch { continue; }
      const t = performance.now();
      const dets = (await detector.detectar(img)).filter(d => d.nombre === nombre);
      ms += performance.now() - t;
      const reales = ans.filter(an => an.category_id === id).map(an => ({ caja: { x0: an.bbox[0], y0: an.bbox[1], ancho: an.bbox[2], alto: an.bbox[3] }, grande: grande(an) }));
      const usadas = new Set();
      for (const r of reales.filter(r => r.grande)) {
        objetos++;
        const k = dets.findIndex((d, i) => !usadas.has(i) && iou(d.caja, r.caja) >= 0.5);
        if (k >= 0) { usadas.add(k); encontrados++; }
      }
      // Una detección que cae sobre un objeto real chico no es un error: no se cuenta.
      deMas += dets.filter((d, i) => !usadas.has(i) && !reales.some(r => iou(d.caja, r.caja) >= 0.5)).length;
    }
    totalObj += objetos; totalEnc += encontrados;
    console.log(`${nombre.padEnd(16)} ${String(objetos).padStart(6)}  ${String(encontrados).padStart(5)} (${(100 * encontrados / Math.max(1, objetos)).toFixed(0).padStart(3)}%)  ${String(deMas).padStart(6)}   ${(ms / Math.max(1, fotos.length)).toFixed(0).padStart(6)}`);
  }
  console.log(`EN TOTAL: ${totalEnc} de ${totalObj} objetos (${(100 * totalEnc / totalObj).toFixed(0)}%)`);
}
