// recortar_coco.js — saca de COCO un recorte por objeto, en una carpeta por clase.
//
//   node herramientas/recortar_coco.js datos/coco datos/coco_recortes
//
// COCO no viene como Caltech (un objeto por foto): son fotos de escenas con varios
// objetos, y un archivo de anotaciones que dice dónde está cada uno. Este script
// recorta cada objeto por su recuadro y lo guarda como JPEG, para que
// exportar_rasgos.js lo lea igual que a Caltech.
//
// Para qué se bajó (2-oct-2026): Caltech-256 es de 2007 y no tiene celulares. Y sus
// fotos son de catálogo; las de COCO son de casas y calles reales, así que de paso
// se suman recortes a clases que ya existían.
//
// Sólo entran categorías de OBJETOS, de animales y «person» como categoría. COCO no trae nombres
// de nadie y acá no se guarda nada más que el recorte.

import jpeg from 'jpeg-js';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Categoría de COCO → carpeta de salida. La clase final la decide categorias.json.
export const CATEGORIAS_COCO = {
  'cell phone': 'celular',
  'remote': 'control_remoto',
  'tv': 'televisor',
  'laptop': 'notebook',
  'keyboard': 'teclado',
  'mouse': 'mouse',
  'microwave': 'microondas',
  'refrigerator': 'heladera',
  'person': 'persona',
  // Vehículos (2-oct-2026). En COCO están en la calle, a distancia y de todos los
  // ángulos; en Caltech-256 son de costado y de catálogo. Se usan las dos.
  'car': 'auto',
  'motorcycle': 'moto',
  'bus': 'colectivo',
  'truck': 'camion',
  'bicycle': 'bicicleta',
  'train': 'tren',
  'airplane': 'avion',
  'boat': 'barco',
  // Animales (3-oct-2026). Los mismos que marca el detector, para que la red y el
  // detector los llamen igual. «bird» NO entra: en COCO hay patos, gansos y cisnes
  // marcados «bird», y en Caltech-256 cada uno es su propia clase; mezclados, la red
  // aprendería que un pato es «pato» y «pájaro» a la vez. El pájaro lo da el detector.
  'cat': 'gato',
  'dog': 'perro',
  'horse': 'caballo',
  'sheep': 'oveja',
  'cow': 'vaca',
  'elephant': 'elefante',
  'bear': 'oso',
  'zebra': 'cebra',
  'giraffe': 'jirafa',
  // Para que un peluche no salga «oso, peligro muy alto».
  'teddy bear': 'oso_de_peluche',
};

const LADO_MINIMO  = 64;     // recortes más chicos son un manchón: no enseñan nada
const MARGEN       = 0.10;   // un poco de contexto alrededor del recuadro
const MAX_POR_CLASE = 300;
const CALIDAD      = 85;

// El recuadro de la anotación, con margen y sin salirse de la imagen. null si queda chico.
export function recuadroCon(bbox, ancho, alto) {
  const [x, y, w, h] = bbox;
  const x0 = Math.max(0, Math.floor(x - w * MARGEN)), y0 = Math.max(0, Math.floor(y - h * MARGEN));
  const x1 = Math.min(ancho, Math.ceil(x + w * (1 + MARGEN))), y1 = Math.min(alto, Math.ceil(y + h * (1 + MARGEN)));
  if (w < LADO_MINIMO || h < LADO_MINIMO || x1 - x0 < LADO_MINIMO || y1 - y0 < LADO_MINIMO) return null;
  return { x0, y0, ancho: x1 - x0, alto: y1 - y0 };
}

export function recortar(img, r) {
  const data = new Uint8Array(r.ancho * r.alto * 4);
  for (let y = 0; y < r.alto; y++) {
    const desde = ((r.y0 + y) * img.width + r.x0) * 4;
    data.set(img.data.subarray(desde, desde + r.ancho * 4), y * r.ancho * 4);
  }
  return { width: r.ancho, height: r.alto, data };
}

export function recortarCoco({ dirCoco, salida, particion = 'val2017', registrar = () => {} }) {
  const anotaciones = JSON.parse(readFileSync(join(dirCoco, 'annotations', `instances_${particion}.json`), 'utf8'));
  const carpetaDe = new Map();
  for (const c of anotaciones.categories) if (CATEGORIAS_COCO[c.name]) carpetaDe.set(c.id, CATEGORIAS_COCO[c.name]);
  const imagenes = new Map(anotaciones.images.map(i => [i.id, i]));

  // Los más grandes primero: son los que se parecen a «el objeto llena el recuadro».
  const elegidas = anotaciones.annotations
    .filter(a => carpetaDe.has(a.category_id) && !a.iscrowd)
    .sort((a, b) => b.area - a.area || a.id - b.id);

  const cuenta = {}, porImagen = new Map();
  for (const a of elegidas) {
    const carpeta = carpetaDe.get(a.category_id);
    const info = imagenes.get(a.image_id);
    if ((cuenta[carpeta] ?? 0) >= MAX_POR_CLASE || !recuadroCon(a.bbox, info.width, info.height)) continue;
    cuenta[carpeta] = (cuenta[carpeta] ?? 0) + 1;
    if (!porImagen.has(a.image_id)) porImagen.set(a.image_id, []);
    porImagen.get(a.image_id).push({ a, carpeta });
  }

  rmSync(salida, { recursive: true, force: true });
  for (const carpeta of new Set(carpetaDe.values())) mkdirSync(join(salida, carpeta), { recursive: true });
  let escritos = 0, saltadas = 0;
  for (const [idImagen, recortes] of porImagen) {
    const info = imagenes.get(idImagen);
    let img;
    try { img = jpeg.decode(readFileSync(join(dirCoco, particion, info.file_name)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
    catch { saltadas++; continue; }
    for (const { a, carpeta } of recortes) {
      const r = recuadroCon(a.bbox, img.width, img.height);
      if (!r) continue;
      writeFileSync(join(salida, carpeta, `${String(idImagen).padStart(12, '0')}_${a.id}.jpg`), jpeg.encode(recortar(img, r), CALIDAD).data);
      escritos++;
    }
  }
  registrar(`${escritos} recortes de ${porImagen.size} fotos` + (saltadas ? ` (${saltadas} fotos no se pudieron leer)` : ''));
  return { escritos, porClase: cuenta, saltadas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dirCoco, salida] = process.argv.slice(2);
  if (!dirCoco || !salida) { console.error('uso: node herramientas/recortar_coco.js <carpeta_coco> <carpeta_salida>'); process.exit(2); }
  const r = recortarCoco({ dirCoco, salida, registrar: console.log });
  for (const [clase, n] of Object.entries(r.porClase)) console.log(`  ${clase.padEnd(16)} ${n}`);
}
