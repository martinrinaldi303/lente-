// bajar_coco_train.js — más ejemplos para la red general, de la parte de ENTRENAMIENTO
// de COCO (118.287 fotos), sin bajarla entera (18 GB).
//
//   node herramientas/bajar_coco_train.js [recortes por clase]
//
// Las anotaciones ya estaban en datos/coco/annotations_trainval2017.zip (se usaba sólo
// la parte de validación). Esto elige, por cada clase de recortar_coco.js, los objetos
// más grandes (los que se parecen a «el objeto llena el recuadro») hasta N por clase,
// baja SÓLO esas fotos desde images.cocodataset.org y guarda los recortes en
// datos/coco_train_recortes/<clase>, como recortar_coco.js. Lo ya bajado no se vuelve
// a bajar: si se corta, se corre otra vez y sigue.
//
// Para qué (3-oct-2026): había clases con muy pocos ejemplos — mouse 18, microondas 27,
// control remoto 31, celular 62 — y en COCO train hay cientos o miles de cada una.

import jpeg from 'jpeg-js';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIAS_COCO, recortar, recuadroCon } from './recortar_coco.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const POR_CLASE = Number(process.argv[2] ?? 200);
const EN_PARALELO = 8;
const CALIDAD = 85;
const salida = join(RAIZ, 'datos', 'coco_train_recortes');
const dirFotos = join(RAIZ, 'datos', 'coco', 'train2017_parcial');

const a = JSON.parse(readFileSync(join(RAIZ, 'datos', 'coco', 'annotations', 'instances_train2017.json'), 'utf8'));
const carpetaDe = new Map();
for (const c of a.categories) if (CATEGORIAS_COCO[c.name]) carpetaDe.set(c.id, CATEGORIAS_COCO[c.name]);
const imagenes = new Map(a.images.map(i => [i.id, i]));
const elegidas = a.annotations.filter(an => carpetaDe.has(an.category_id) && !an.iscrowd).sort((x, y) => y.area - x.area || x.id - y.id);
const cuenta = {}, porImagen = new Map();
for (const an of elegidas) {
  const carpeta = carpetaDe.get(an.category_id), info = imagenes.get(an.image_id);
  if ((cuenta[carpeta] ?? 0) >= POR_CLASE || !recuadroCon(an.bbox, info.width, info.height)) continue;
  cuenta[carpeta] = (cuenta[carpeta] ?? 0) + 1;
  if (!porImagen.has(an.image_id)) porImagen.set(an.image_id, []);
  porImagen.get(an.image_id).push({ an, carpeta });
}
for (const carpeta of new Set(carpetaDe.values())) mkdirSync(join(salida, carpeta), { recursive: true });
mkdirSync(dirFotos, { recursive: true });
const ids = [...porImagen.keys()];
console.log(`${ids.length} fotos para ${Object.values(cuenta).reduce((s, n) => s + n, 0)} recortes (hasta ${POR_CLASE} por clase)`);

let hechas = 0, bajadas = 0, fallas = 0, bytes = 0;
async function procesar(id) {
  const info = imagenes.get(id), archivo = join(dirFotos, info.file_name);
  if (!existsSync(archivo)) {
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fetch(info.coco_url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        writeFileSync(archivo, buf); bajadas++; bytes += buf.length;
        break;
      } catch (e) { if (intento === 2) { fallas++; return; } await new Promise(r => setTimeout(r, 1000 * (intento + 1))); }
    }
  }
  let img;
  try { img = jpeg.decode(readFileSync(archivo), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); } catch { fallas++; return; }
  for (const { an, carpeta } of porImagen.get(id)) {
    const r = recuadroCon(an.bbox, img.width, img.height);
    if (r) writeFileSync(join(salida, carpeta, `${String(id).padStart(12, '0')}_${an.id}.jpg`), jpeg.encode(recortar(img, r), CALIDAD).data);
  }
  if (++hechas % 250 === 0) console.log(`  ${hechas}/${ids.length} fotos (${bajadas} bajadas, ${(bytes / 1e6).toFixed(0)} MB, ${fallas} fallas)`);
}
const cola = ids.slice();
await Promise.all(Array.from({ length: EN_PARALELO }, async () => { while (cola.length) await procesar(cola.shift()); }));
console.log(`listo: ${hechas} fotos, ${bajadas} bajadas (${(bytes / 1e6).toFixed(0)} MB), ${fallas} fallas`);
for (const c of readdirSync(salida).sort()) console.log(`  ${c.padEnd(16)} ${readdirSync(join(salida, c)).length}`);
