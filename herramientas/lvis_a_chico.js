// lvis_a_chico.js — lvis_v1_train.json pesa 1,1 GB: más de lo que Node puede leer como
// un solo texto. Esto lo recorre de a pedazos y deja en datos/lvis/lvis_min.json lo
// que usa bajar_ropa_lvis.js: las clases, las fotos (número, URL, tamaño) y, de cada
// anotación, sólo su recuadro (sin los polígonos, que son casi todo el peso).
//
//   node herramientas/lvis_a_chico.js

import { createReadStream, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const entrada = join(RAIZ, 'datos', 'lvis', 'lvis_v1_train.json');
const LISTAS = new Set(['annotations', 'images', 'categories']);

const res = { categories: [], images: [], annotations: [] };
let profundidad = 0, enTexto = false, escape = false, clave = '', ultimoTexto = '', lista = null, objeto = null;
let textoActual = '';
const guardar = (nombre, o) => {
  if (nombre === 'annotations') res.annotations.push({ id: o.id, image_id: o.image_id, category_id: o.category_id, bbox: o.bbox, area: o.area });
  else if (nombre === 'images') res.images.push({ id: o.id, coco_url: o.coco_url, width: o.width, height: o.height });
  else res.categories.push({ id: o.id, name: o.name });
};
for await (const pedazo of createReadStream(entrada, { encoding: 'utf8', highWaterMark: 1 << 22 })) {
  for (let i = 0; i < pedazo.length; i++) {
    const ch = pedazo[i];
    if (objeto !== null) objeto.push(ch);
    if (enTexto) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') { enTexto = false; ultimoTexto = textoActual; }
      else if (profundidad === 1) textoActual += ch;
      continue;
    }
    if (ch === '"') { enTexto = true; textoActual = ''; continue; }
    if (ch === ':' && profundidad === 1) { clave = ultimoTexto; continue; }
    if (ch === '{' || ch === '[') {
      profundidad++;
      if (profundidad === 2 && ch === '[') lista = LISTAS.has(clave) ? clave : null;
      if (profundidad === 3 && ch === '{' && lista) objeto = ['{'];
    } else if (ch === '}' || ch === ']') {
      if (profundidad === 3 && ch === '}' && objeto) { guardar(lista, JSON.parse(objeto.join(''))); objeto = null; }
      if (profundidad === 2) lista = null;
      profundidad--;
    }
  }
}
writeFileSync(join(RAIZ, 'datos', 'lvis', 'lvis_min.json'), JSON.stringify(res));
console.log(`${res.categories.length} clases, ${res.images.length} fotos, ${res.annotations.length} anotaciones`);
