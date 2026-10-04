// calibrar_detector.js — un umbral por clase para el detector, y cuál detector conviene.
//
//   node herramientas/calibrar_detector.js <modelo> [fotos] [precisión] [--guardar]
//      modelo: dfine-s | yolos (ver MODELOS_DETECTOR en src/detector.js)
//
// Con fotos de validación de COCO (que ningún detector usó para entrenar). Las de id
// PAR calibran: para cada clase, el puntaje más bajo desde el que lo que marca es
// cierto en la proporción pedida (por defecto 85 %). Las de id IMPAR miden, sin haber
// visto la calibración: así el número no está inflado.
//
// Cierto = hay un objeto anotado de la misma clase que se superpone al menos a la
// mitad (IoU ≥ 0,5), y cada anotación cuenta una sola vez. Encontrado = un objeto
// anotado de 48 px o más que alguna detección segura marcó.
//
// Con --guardar deja estado/umbrales_detector_<modelo>.json, que lee src/detector.js.

import jpeg from 'jpeg-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASES_DEL_DETECTOR, CONFIANZA_SEGURA, crearDetector, recalibrar } from '../src/detector.js';
import { principalDe } from '../src/seguimiento.js';
import { iou } from './medir_detector.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const LADO_MINIMO = 48;
const MINIMO_POR_CLASE = 15;   // con menos recuadros de una clase, su umbral es el general

// El puntaje más bajo desde el que la proporción de ciertos es ≥ `precision`, o null.
// `lista`: [{ puntaje, cierto }].
export function umbralPara(lista, precision, { minimo = MINIMO_POR_CLASE } = {}) {
  const orden = lista.slice().sort((a, b) => b.puntaje - a.puntaje);
  let ciertos = 0, mejor = null;
  orden.forEach((d, k) => {
    if (d.cierto) ciertos++;
    if (k + 1 >= minimo && ciertos / (k + 1) >= precision) mejor = d.puntaje;
  });
  return mejor;
}

// Une detecciones y anotaciones de una foto: cada anotación, a lo sumo una detección
// (la de más puntaje primero).
export function marcarCiertas(detecciones, reales) {
  const usadas = new Set();
  return detecciones.slice().sort((a, b) => b.confianza - a.confianza).map(d => {
    const k = reales.findIndex((r, i) => !usadas.has(i) && r.nombre === d.nombre && iou(d.caja, r.caja) >= 0.5);
    if (k >= 0) usadas.add(k);
    return { ...d, cierto: k >= 0, real: k >= 0 ? k : null };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [modelo = 'dfine-s', cuantasTxt = '2000', precisionTxt = '0.85'] = process.argv.slice(2).filter((a, i, l) => !a.startsWith('--') && l[i - 1] !== '--minimo');
  const cuantas = Number(cuantasTxt), precision = Number(precisionTxt);
  const detector = await crearDetector({ modelo, calibrar: false });
  if (!detector || detector.clave !== modelo) { console.error(`falta el modelo ${modelo} en modelos/`); process.exit(1); }

  const dirCoco = join(RAIZ, 'datos', 'coco');
  const a = JSON.parse(readFileSync(join(dirCoco, 'annotations', 'instances_val2017.json'), 'utf8'));
  const nombreDe = new Map(a.categories.slice().sort((x, y) => x.id - y.id).map((c, i) => [c.id, CLASES_DEL_DETECTOR[i]]));
  const porImagen = new Map();
  for (const an of a.annotations) {
    if (an.iscrowd) continue;
    if (!porImagen.has(an.image_id)) porImagen.set(an.image_id, []);
    porImagen.get(an.image_id).push({ nombre: nombreDe.get(an.category_id), caja: { x0: an.bbox[0], y0: an.bbox[1], ancho: an.bbox[2], alto: an.bbox[3] },
                                      grande: an.bbox[2] >= LADO_MINIMO && an.bbox[3] >= LADO_MINIMO });
  }

  // Una pasada por cada foto: lo crudo, una sola vez. Queda guardado en datos/ para
  // probar otros umbrales sin volver a correr el detector.
  const archivoCrudo = join(RAIZ, 'datos', `detecciones_${modelo}_${cuantas}.json`);
  let fotos = [];
  let ms = 0;
  if (existsSync(archivoCrudo)) ({ fotos, ms } = JSON.parse(readFileSync(archivoCrudo, 'utf8')));
  else for (const foto of a.images.slice(0, cuantas)) {
    let img;
    try { img = jpeg.decode(readFileSync(join(dirCoco, 'val2017', foto.file_name)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
    catch { continue; }
    const t = performance.now();
    const dets = await detector.detectar(img);
    ms += performance.now() - t;
    fotos.push({ id: foto.id, ancho: img.width, alto: img.height, dets, reales: porImagen.get(foto.id) ?? [] });
    if (fotos.length % 250 === 0) console.error(`  ${fotos.length} fotos…`);
  }
  if (!existsSync(archivoCrudo)) writeFileSync(archivoCrudo, JSON.stringify({ fotos, ms }));
  const calibran = fotos.filter(f => f.id % 2 === 0), miden = fotos.filter(f => f.id % 2 === 1);

  // Calibrar con las pares.
  const porClase = new Map(), todas = [];
  for (const f of calibran) for (const d of marcarCiertas(f.dets, f.reales)) {
    const x = { puntaje: d.confianza, cierto: d.cierto };
    todas.push(x);
    (porClase.get(d.nombre) ?? porClase.set(d.nombre, []).get(d.nombre)).push(x);
  }
  const global = umbralPara(todas, precision, { minimo: 50 }) ?? 0.95;
  // Una clase con pocos recuadros da un umbral que es puro ruido (medido: con 15 la
  // precisión total quedaba peor que con un umbral único). --minimo N lo cambia.
  const iMin = process.argv.indexOf('--minimo');
  const minimo = iMin >= 0 ? Number(process.argv[iMin + 1]) : MINIMO_POR_CLASE;
  const umbrales = {};
  for (const [clase, lista] of porClase) { const u = umbralPara(lista, precision, { minimo }); if (u !== null) umbrales[clase] = Number(u.toFixed(4)); }

  // Medir con las impares: el umbral único de siempre contra uno por clase.
  const medir = (confianzaDe) => {
    let marcadas = 0, ciertas = 0, objetos = 0, encontrados = 0, opina = 0, acierta = 0;
    for (const f of miden) {
      const dets = marcarCiertas(f.dets, f.reales).map(d => ({ ...d, confianza: confianzaDe(d) }));
      const seguras = dets.filter(d => d.confianza >= CONFIANZA_SEGURA);
      marcadas += seguras.length; ciertas += seguras.filter(d => d.cierto).length;
      const halladas = new Set(seguras.filter(d => d.cierto).map(d => d.real));
      f.reales.forEach((r, i) => { if (r.grande) { objetos++; if (halladas.has(i)) encontrados++; } });
      const p = principalDe(dets, f.ancho, f.alto);
      if (p) { opina++; if (p.cierto) acierta++; }
    }
    return { marcadas, ciertas, objetos, encontrados, opina, acierta };
  };
  const filas = [
    ['puntaje crudo ≥ 0,9', medir(d => d.confianza)],
    [`un umbral para todo (${global.toFixed(3)})`, medir(d => recalibrar(d.confianza, global))],
    ['un umbral por clase', medir(d => recalibrar(d.confianza, umbrales[d.nombre] ?? global))],
  ];
  const pc = (x, n) => `${(100 * x / Math.max(1, n)).toFixed(1)} %`;
  console.log(`\n${detector.nombre}: ${fotos.length} fotos de validación de COCO (${calibran.length} calibran, ${miden.length} miden), ${(ms / fotos.length).toFixed(0)} ms por foto`);
  console.log(`Precisión pedida: ${(100 * precision).toFixed(0)} %. Umbral general ${global.toFixed(3)}; ${Object.keys(umbrales).length} clases con umbral propio.\n`);
  console.log('                                   seguras: ciertas         objetos ≥48 px encontrados     la mirada: opina en / acierta');
  for (const [nombre, r] of filas)
    console.log(`  ${nombre.padEnd(32)} ${String(r.ciertas).padStart(5)} de ${String(r.marcadas).padEnd(5)} (${pc(r.ciertas, r.marcadas).padStart(7)})   ${String(r.encontrados).padStart(5)} de ${r.objetos} (${pc(r.encontrados, r.objetos)})   ${String(r.opina).padStart(4)} (${pc(r.opina, miden.length)}) / ${pc(r.acierta, r.opina)}`);
  const muestra = ['persona', 'celular', 'auto', 'notebook', 'taza', 'botella', 'control remoto', 'pantalla'];
  console.log(`\n  umbrales: ${muestra.map(c => `${c} ${umbrales[c]?.toFixed(2) ?? '(general)'}`).join(' · ')}`);

  if (process.argv.includes('--guardar')) {
    const archivo = join(RAIZ, 'estado', `umbrales_detector_${detector.clave}.json`);
    writeFileSync(archivo, JSON.stringify({
      modelo: detector.clave, cuando: new Date().toISOString(), precision, global: Number(global.toFixed(4)), umbrales,
      medido: Object.fromEntries(filas.map(([n, r]) => [n, r])), fotos: { calibran: calibran.length, miden: miden.length }, ms_por_foto: Math.round(ms / fotos.length),
    }, null, 2));
    console.log(`\nGuardado en ${archivo}`);
  }
}
