// bajar_ropa_lvis.js — ropa que NO lleva puesta nadie (colgada, en una silla, en una
// percha), para que las gafas sepan de entrada que eso no es una persona.
//
//   node herramientas/bajar_ropa_lvis.js [recortes]
//
// LVIS (v1, CC BY 4.0) son anotaciones de 1.203 clases sobre las mismas fotos de COCO.
// De sus clases de ropa y perchas se queda con los recuadros que no tocan a ninguna
// persona anotada en COCO (una campera puesta es una persona: sería enseñar mal), baja
// sólo esas fotos desde images.cocodataset.org y guarda los recortes en
// datos/lvis_ropa/. Lo ya bajado no se vuelve a bajar.
//
// Para qué (3-oct-2026): la ropa colgada del placar de Martín salía «persona 96 %». Los
// recortes son la clase «ropa» de la red general (herramientas/categorias.json), para
// que del recuadro del centro diga «creo: ropa».
// Se probó también usarlos como correcciones «de fábrica» para «persona» (como las de
// src/correcciones.js, pero para todos) y NO sirvió: no tiran personas de verdad (0 de
// 400), pero en 474 fotos con ropa suelta el detector marcó 28 «personas» falsas sobre
// la ropa y las correcciones de OTRAS fotos no tiraron ninguna. Cada prenda es distinta:
// lo que anda es corregir la ropa de uno mismo.

import jpeg from 'jpeg-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recortar, recuadroCon } from './recortar_coco.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const MAXIMO = Number(process.argv[2] ?? 600);
// Las clases de LVIS que son ropa suelta o lo que la sostiene.
const ROPA = /^(jacket|coat|shirt|sweater|sweatshirt|blazer|trousers|jean|dress|skirt|bathrobe|robe|raincoat|vest|polo_shirt|coat_hanger|coatrack|clothes_hamper|cardigan|parka|ski_parka|towel|bath_towel|scarf|suit_\(clothing\)|dress_suit|apron)$/;

// lvis_min.json: lo justo de lvis_v1_train.json (1,1 GB), ver lvis_a_chico.js.
const lvis = JSON.parse(readFileSync(join(RAIZ, 'datos', 'lvis', 'lvis_min.json'), 'utf8'));
const clases = new Map(lvis.categories.filter(c => ROPA.test(c.name)).map(c => [c.id, c.name]));
console.log('clases de ropa en LVIS:', [...clases.values()].join(', '));
// Las personas de COCO (LVIS usa las mismas fotos, con los mismos números).
const personas = new Map();
for (const parte of ['train2017', 'val2017']) {
  const coco = JSON.parse(readFileSync(join(RAIZ, 'datos', 'coco', 'annotations', `instances_${parte}.json`), 'utf8'));
  for (const an of coco.annotations) if (an.category_id === 1) {
    if (!personas.has(an.image_id)) personas.set(an.image_id, []);
    personas.get(an.image_id).push(an.bbox);
  }
}
const comun = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
const imagenes = new Map(lvis.images.map(i => [i.id, i]));
const elegidas = lvis.annotations
  .filter(an => clases.has(an.category_id))
  .filter(an => !(personas.get(an.image_id) ?? []).some(p => comun(p, an.bbox) > 0.05 * an.bbox[2] * an.bbox[3]))
  .filter(an => { const i = imagenes.get(an.image_id); return recuadroCon(an.bbox, i.width, i.height); })
  .sort((a, b) => b.area - a.area || a.id - b.id)
  .slice(0, MAXIMO);
const porImagen = new Map();
for (const an of elegidas) { if (!porImagen.has(an.image_id)) porImagen.set(an.image_id, []); porImagen.get(an.image_id).push(an); }
console.log(`${elegidas.length} recortes de ropa sin nadie adentro, en ${porImagen.size} fotos`);

const salida = join(RAIZ, 'datos', 'lvis_ropa'), dirFotos = join(RAIZ, 'datos', 'coco', 'lvis_fotos');
mkdirSync(salida, { recursive: true }); mkdirSync(dirFotos, { recursive: true });
let hechas = 0, fallas = 0;
const cola = [...porImagen.keys()];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cola.length) {
    const id = cola.shift(), info = imagenes.get(id), archivo = join(dirFotos, `${String(id).padStart(12, '0')}.jpg`);
    try {
      if (!existsSync(archivo)) {
        const r = await fetch(info.coco_url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        writeFileSync(archivo, Buffer.from(await r.arrayBuffer()));
      }
      const img = jpeg.decode(readFileSync(archivo), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 });
      for (const an of porImagen.get(id)) {
        const r = recuadroCon(an.bbox, img.width, img.height);
        if (r) writeFileSync(join(salida, `${String(id).padStart(12, '0')}_${an.id}_${clases.get(an.category_id)}.jpg`), jpeg.encode(recortar(img, r), 85).data);
      }
    } catch { fallas++; }
    if (++hechas % 100 === 0) console.log(`  ${hechas}/${porImagen.size} fotos (${fallas} fallas)`);
  }
}));
console.log(`listo: ${hechas} fotos, ${fallas} fallas`);
