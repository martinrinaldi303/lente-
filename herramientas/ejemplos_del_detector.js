// ejemplos_del_detector.js — cómo se ve de verdad cada cosa que nombra el detector.
//
//   node herramientas/ejemplos_del_detector.js
//
// El detector (YOLOS) y la red general eligen SIEMPRE una de sus clases, aunque lo que
// tienen enfrente no sea ninguna: un marcador naranja sale «zanahoria» y una lata de
// desodorante «celular 93 %» (Martín, 3-oct-2026). Para poder decir «no sé qué es», el
// cerebro compara lo que ve con ejemplos de verdad de la clase que le dijeron
// (src/parecido.js). Los de las clases de la red general ya están (datos/rasgos); este
// script saca los de las 80 clases del detector, recortados de las fotos de COCO que ya
// están bajadas (val2017 y la parte de train2017), y los pasa por DINOv2.
//
// Sale datos/rasgos/ejemplos_detector/{entrenamiento,prueba}.bin: con los de
// entrenamiento compara el cerebro, y con los de prueba se mide el umbral.
// Sin «persona»: a una persona no se la rechaza por parecido (ver correcciones.js).

import jpeg from 'jpeg-js';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOMBRES_COCO } from '../src/detector.js';
import { extractoresDisponibles } from '../src/extractores.js';
import { escribirRasgos } from '../src/formato_rasgos.js';
import { regionCompleta } from '../src/imagen.js';
import { vaAPrueba } from './exportar_rasgos.js';
import { recortar, recuadroCon } from './recortar_coco.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_POR_CLASE = 200;

export async function ejemplosDelDetector({ dirCoco = join(RAIZ, 'datos', 'coco'), salida = join(RAIZ, 'datos', 'rasgos', 'ejemplos_detector'),
                                            maxPorClase = MAX_POR_CLASE, registrar = () => {} } = {}) {
  const dino = (await extractoresDisponibles()).find(e => e.fuente === 'dino_s');
  if (!dino) throw new Error('falta el modelo de DINOv2 (modelos/)');
  const clases = Object.entries(NOMBRES_COCO).filter(([, n]) => n !== 'persona');
  const claseDe = new Map(clases.map(([id, n]) => [Number(id), n]));
  const nombres = clases.map(([, n]) => n);

  // Las anotaciones de las fotos que están en disco, de las dos particiones.
  const candidatos = [];
  for (const [particion, carpeta] of [['val2017', 'val2017'], ['train2017', 'train2017_parcial']]) {
    const dirFotos = join(dirCoco, carpeta);
    if (!existsSync(dirFotos)) continue;
    const enDisco = new Set(readdirSync(dirFotos));
    const anot = JSON.parse(readFileSync(join(dirCoco, 'annotations', `instances_${particion}.json`), 'utf8'));
    const imagenes = new Map(anot.images.filter(i => enDisco.has(i.file_name)).map(i => [i.id, i]));
    for (const a of anot.annotations) {
      const info = imagenes.get(a.image_id);
      if (!info || a.iscrowd || !claseDe.has(a.category_id) || !recuadroCon(a.bbox, info.width, info.height)) continue;
      candidatos.push({ a, info, ruta: join(dirFotos, info.file_name) });
    }
  }
  // Los más grandes primero, y un tope por clase.
  candidatos.sort((x, y) => y.a.area - x.a.area || x.a.id - y.a.id);
  const cuenta = new Map(), porFoto = new Map();
  for (const c of candidatos) {
    const n = claseDe.get(c.a.category_id);
    if ((cuenta.get(n) ?? 0) >= maxPorClase) continue;
    cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
    (porFoto.get(c.ruta) ?? porFoto.set(c.ruta, []).get(c.ruta)).push(c);
  }

  const filas = { entrenamiento: [], prueba: [] };
  let hechas = 0;
  for (const [ruta, lista] of porFoto) {
    let img;
    try { img = jpeg.decode(readFileSync(ruta), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
    catch { continue; }
    for (const { a } of lista) {
      const r = recuadroCon(a.bbox, img.width, img.height);
      if (!r) continue;
      const recorte = recortar(img, r);
      const vector = await dino.extraer(recorte, regionCompleta(recorte));
      filas[vaAPrueba(`${a.image_id}_${a.id}`) ? 'prueba' : 'entrenamiento'].push({ etiqueta: nombres.indexOf(claseDe.get(a.category_id)), vector });
      if (++hechas % 1000 === 0) registrar(`  ${hechas} recortes…`);
    }
  }
  mkdirSync(salida, { recursive: true });
  for (const lado of ['entrenamiento', 'prueba'])
    escribirRasgos(join(salida, `${lado}.bin`), { fuente: dino.fuente, dim: dino.dim, clases: nombres, filas: filas[lado] });
  return { porClase: Object.fromEntries(cuenta), entrenamiento: filas.entrenamiento.length, prueba: filas.prueba.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await ejemplosDelDetector({ registrar: console.log });
  console.log(`${r.entrenamiento} de entrenamiento y ${r.prueba} de prueba`);
  for (const [clase, n] of Object.entries(r.porClase).sort((a, b) => a[1] - b[1])) console.log(`  ${clase.padEnd(16)} ${n}`);
}
