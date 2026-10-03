// correcciones.js — enseñarle al detector lo que NO es.
//
// YOLOS-tiny viene entrenado de fábrica y acá no se reentrena. Con la ropa colgada del
// placar de Martín dice «persona 96 %» (3-oct-2026), y eso no lo arregla ningún
// umbral: está seguro y se equivoca. Lo que sí se puede es la segunda opinión de las
// redes propias, con ejemplos SUYOS: él toca el recuadro equivocado («esto no es una
// persona») y se guarda cómo se ve ese recorte (el vector de DINOv2, no la foto).
// Desde ahí, un recuadro de esa clase que se parece mucho a algo corregido, y menos a
// los ejemplos de verdad de la clase (las personas de la base de entrenamiento), se
// descarta.
//
// Una persona con la cara a la vista nunca se descarta: si YuNet (src/caras.js) ve una
// cara adentro del recuadro, es una persona. Sólo se busca que HAYA una cara; de
// quién es no se mira. Sin cara no alcanza para tirarla (alguien de espaldas en la
// vereda tiene que seguir contando): ahí deciden las correcciones.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { leerRasgos } from './formato_rasgos.js';
import { cajaEntera } from './seguimiento.js';

// Medido con COCO (3-oct-2026): las 31 «personas» que el detector marca seguro donde no
// hay ninguna hicieron de lo que Martín corregiría, y 400 personas de verdad de prueba.
//   parecido ≥ 0,6: la misma cosa en otro cuadro se descarta 31/31; personas tiradas 3/400
//   parecido ≥ 0,7:                                            31/31;                 1/400
//   parecido ≥ 0,8:                                            29/31;                 0/400
// Tirar a una persona de verdad es el error que no se puede cometer en la calle: 0,8.
export const UMBRAL_CORREGIDO = 0.8;      // parecido mínimo con algo corregido
export const MARGEN = 0.05;               // y tiene que ganarle a los ejemplos de verdad por esto
const MAX_POR_CUADRO = 6;                 // recuadros a revisar por cuadro: cada uno es una pasada de DINOv2
const CONFIANZA_CARA = 0.9;

const aBlob = (v) => Buffer.from(Float32Array.from(v).buffer);
const aVector = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function coseno(a, b) {
  let p = 0, na = 0, nb = 0;
  for (let k = 0; k < a.length; k++) { p += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
  return p / Math.sqrt(na * nb || 1);
}
const maximo = (v, lista = []) => lista.reduce((m, u) => Math.max(m, coseno(v, u)), -1);
function iou(a, b) {
  const w = Math.min(a.x0 + a.ancho, b.x0 + b.ancho) - Math.max(a.x0, b.x0), h = Math.min(a.y0 + a.alto, b.y0 + b.alto) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? (w * h) / (a.ancho * a.alto + b.ancho * b.alto - w * h) : 0;
}

export class Correcciones {
  constructor(pool) { this.pool = pool; }

  async agregar(usuarioId, clase, fuente, vector) {
    await this.pool.query('INSERT INTO correcciones (usuario_id, clase, fuente, dim, vector) VALUES (?, ?, ?, ?, ?)',
                          [usuarioId, clase, fuente, vector.length, aBlob(vector)]);
  }

  // Map clase → [Float32Array], sólo las de ese extractor.
  async deUsuario(usuarioId, fuente, dim) {
    const [filas] = await this.pool.query('SELECT clase, vector FROM correcciones WHERE usuario_id = ? AND fuente = ? AND dim = ? ORDER BY id', [usuarioId, fuente, dim]);
    const porClase = new Map();
    for (const f of filas) {
      if (f.vector.length !== dim * 4) continue;
      if (!porClase.has(f.clase)) porClase.set(f.clase, []);
      porClase.get(f.clase).push(aVector(f.vector));
    }
    return porClase;
  }

  async olvidar(usuarioId) {
    const [r] = await this.pool.query('DELETE FROM correcciones WHERE usuario_id = ?', [usuarioId]);
    return r.affectedRows;
  }
}

// Los ejemplos de verdad de cada clase, de los rasgos ya calculados para entrenar la red
// general (datos/rasgos/_cache, ver herramientas/exportar_rasgos.js). Sin ellos (sin
// datos/ en la PC), las correcciones valen solas con un parecido más alto.
export function cargarPositivos({ dirRasgos, categorias, fuente, dim, maxPorClase = 150 }) {
  const porClase = new Map();
  if (!existsSync(join(dirRasgos, '_cache'))) return porClase;
  for (const [carpeta, clase] of Object.entries(categorias)) {
    const archivo = join(dirRasgos, '_cache', `${carpeta.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '')}__${fuente}_${dim}__max200_espejo.bin`);
    if (!existsSync(archivo)) continue;
    const filas = leerRasgos(archivo).filas.filter(f => f.etiqueta === 0);      // las de entrenamiento
    const lista = porClase.get(clase) ?? [];
    for (const f of filas.slice(0, maxPorClase)) lista.push(f.vector);
    porClase.set(clase, lista);
  }
  return porClase;
}
export const leerCategorias = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));

// ¿Se parece más a algo corregido que a los ejemplos de verdad?
export function esCorregido(vector, negativos, positivos, { umbral = UMBRAL_CORREGIDO, margen = MARGEN } = {}) {
  const sN = maximo(vector, negativos);
  if (sN < umbral) return false;
  // Sin ejemplos de verdad de la clase, hace falta parecerse más.
  if (!positivos?.length) return sN >= umbral + 0.15;
  return sN > maximo(vector, positivos) + margen;
}

// Revisa los recuadros del detector contra las correcciones de la cuenta. Devuelve
// { quedan, tiradas }. `caras` es opcional (src/caras.js): una persona con cara no se tira.
// `pistas`: dónde se corrigió algo en esta sesión (cajas en fracción del cuadro): esos
// lugares se revisan primero. Con la cámara quieta, la ropa del placar sigue ahí.
export async function filtrarCorregidos(detecciones, img, { negativos, positivos, extractor, caras = null, pistas = [] }) {
  if (!negativos?.size) return { quedan: detecciones, tiradas: [] };
  // Del centro hacia afuera: lo de la mirada es lo que llega a la pantalla. Por
  // confianza no: en una foto con mucha gente, la ropa del costado quedaba séptima.
  const medio = { x: img.width / 2, y: img.height / 2 };
  const lejos = (d) => Math.hypot(d.caja.x0 + d.caja.ancho / 2 - medio.x, d.caja.y0 + d.caja.alto / 2 - medio.y);
  const enPista = (d) => pistas.some(p => iou(d.caja, { x0: p.x0 * img.width, y0: p.y0 * img.height, ancho: p.ancho * img.width, alto: p.alto * img.height }) > 0.3);
  const candidatas = detecciones.filter(d => negativos.has(d.nombre))
    .sort((a, b) => (enPista(b) - enPista(a)) || (lejos(a) - lejos(b))).slice(0, MAX_POR_CUADRO);
  if (!candidatas.length) return { quedan: detecciones, tiradas: [] };
  let carasDelCuadro = null;
  const tieneCara = async (d) => {
    if (!caras || d.nombre !== 'persona') return false;
    carasDelCuadro ??= (await caras.detectar(img)).filter(c => c.confianza >= CONFIANZA_CARA);
    return carasDelCuadro.some(c => {
      const x = c.caja.x0 + c.caja.ancho / 2, y = c.caja.y0 + c.caja.alto / 2;
      return x >= d.caja.x0 && x <= d.caja.x0 + d.caja.ancho && y >= d.caja.y0 && y <= d.caja.y0 + d.caja.alto;
    });
  };
  const tiradas = [];
  for (const d of candidatas) {
    if (await tieneCara(d)) continue;
    const v = await extractor.extraer(img, cajaEntera(d.caja, img));
    if (esCorregido(v, negativos.get(d.nombre), positivos?.get(d.nombre))) tiradas.push(d);
  }
  return { quedan: detecciones.filter(d => !tiradas.includes(d)), tiradas };
}
