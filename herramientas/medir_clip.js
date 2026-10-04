// medir_clip.js — ¿CLIP ayuda a no inventar y a nombrar lo que la red no conoce?
//
//   node herramientas/medir_clip.js [fotos por clase conocida] [fotos por clase desconocida]
//
// Dos grupos de fotos que ni la red general ni los ejemplos de «parecido» vieron:
//   · CONOCIDAS: las de prueba de cada clase de la red (el mismo reparto que
//     exportar_rasgos.js, por el nombre del archivo).
//   · DESCONOCIDAS: las categorías de Caltech-256 que la red no tiene (armónica, dados,
//     yo-yo…). Lo que la red diga de ellas está mal por definición.
// Para cada regla se cuenta qué haría la pantalla: nombrar (bien o mal) o callarse
// («No lo conozco»). Y aparte, cuántas desconocidas nombra bien CLIP con su vocabulario.

import jpeg from 'jpeg-js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearClip, Vocabulario } from '../src/clip.js';
import { Conjunto, votantes } from '../src/conjunto.js';
import { extractoresDisponibles } from '../src/extractores.js';
import { regionCompleta } from '../src/imagen.js';
import { Ejemplos, UMBRAL_CONOCIDO } from '../src/parecido.js';
import { VOCABULARIO } from '../src/vocabulario_clip.js';
import { vaAPrueba } from './exportar_rasgos.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = join(RAIZ, 'datos', '256_ObjectCategories');

// Las fotos de prueba de una carpeta, como las reparte exportar_rasgos.js (tope de 200).
export function fotosDePrueba(base, carpeta, cuantas, { max = 200 } = {}) {
  const dir = join(base, carpeta);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(a => /\.jpe?g$/i.test(a)).sort().slice(0, max)
    .filter(a => vaAPrueba(`${carpeta}/${a}`)).slice(0, cuantas).map(a => join(dir, a));
}

// El nombre en inglés de una carpeta de Caltech: «097.harmonica» → «harmonica».
export const nombreDeCarpeta = (c) => c.replace(/^.*\//, '').replace(/^\d+\./, '').replace(/-101$/, '').replace(/-/g, ' ');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const porConocida = Number(process.argv[2] ?? 12), porDesconocida = Number(process.argv[3] ?? 10);
  const categorias = JSON.parse(readFileSync(join(RAIZ, 'herramientas', 'categorias.json'), 'utf8'));
  const extractores = await extractoresDisponibles();
  const dino = extractores.find(e => e.fuente === 'dino_s');
  const conjunto = Conjunto.cargar(join(RAIZ, 'estado'), { extractores: votantes(extractores) });
  const ejemplos = Ejemplos.cargar(join(RAIZ, 'datos', 'rasgos'));
  const clip = await crearClip();
  if (!dino || !clip) { console.error('faltan DINOv2 o CLIP en modelos/'); process.exit(1); }
  const vocabulario = await Vocabulario.armar(clip, VOCABULARIO);

  // Las fotos: { ruta, real (clase de la red o null), nombreEn (de las desconocidas) }.
  const fotos = [];
  const porClase = new Map();
  for (const [carpeta, clase] of Object.entries(categorias)) {
    if (clase === 'nada' || clase === 'persona') continue;
    const ya = porClase.get(clase) ?? 0;
    if (ya >= porConocida) continue;
    const lista = fotosDePrueba(BASE, carpeta, porConocida - ya);
    porClase.set(clase, ya + lista.length);
    for (const ruta of lista) fotos.push({ ruta, real: clase });
  }
  // Las «otras cosas» que se le enseñan a la red como «nada» (categorias_otros.json)
  // tampoco cuentan como desconocidas: ya las vio.
  let otros = {};
  try { otros = JSON.parse(readFileSync(join(RAIZ, 'herramientas', 'categorias_otros.json'), 'utf8')); } catch { /* sin otros */ }
  const usadas = new Set([...Object.keys(categorias), ...Object.keys(otros)].filter(k => !k.includes('/')));
  const desconocidas = readdirSync(BASE).filter(c => /^\d{3}\./.test(c) && !usadas.has(c) && !/clutter/.test(c));
  for (const carpeta of desconocidas)
    for (const ruta of fotosDePrueba(BASE, carpeta, porDesconocida)) fotos.push({ ruta, real: null, nombreEn: nombreDeCarpeta(carpeta) });
  console.error(`${fotos.filter(f => f.real).length} conocidas de ${porClase.size} clases, ${fotos.filter(f => !f.real).length} desconocidas de ${desconocidas.length} categorías`);

  // Una pasada por foto: lo que dice la red, si se parece, y lo que dice CLIP.
  const filas = [];
  for (const f of fotos) {
    let img;
    try { img = jpeg.decode(readFileSync(f.ruta), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); } catch { continue; }
    const region = regionCompleta(img);
    const v = await dino.extraer(img, region);
    const red = await conjunto.predecir(img, region, { dino_s: v });
    const parece = !ejemplos || ejemplos.conoce(v, red.nombre, UMBRAL_CONOCIDO);
    const ranking = vocabulario.ranking(await clip.imagen(img, region), 400);
    filas.push({ ...f, red, parece, ranking });
    if (filas.length % 300 === 0) console.error(`  ${filas.length} fotos…`);
  }

  // ¿La desconocida está en el vocabulario? Por el nombre en inglés.
  const esDe = (en) => VOCABULARIO.find(x => x.en.toLowerCase() === en || x.en.toLowerCase().replace(/s$/, '') === en.replace(/s$/, ''))?.es ?? null;
  const pc = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(1)} %`;
  const conocidas = filas.filter(f => f.real), nuevas = filas.filter(f => !f.real);

  // Las reglas. Devuelven el nombre que mostraría la pantalla, o null.
  const red = (umbral) => (f) => (f.red.confianza >= umbral && f.red.nombre !== 'nada' ? f.red.nombre : null);
  const conParecido = (umbral) => (f) => (red(umbral)(f) && f.parece ? f.red.nombre : null);
  // CLIP veta si está claro que es otra cosa: su primer nombre no es el de la red, le
  // da `pOtro` o más, y al de la red menos de `pRed`.
  const conVeto = (umbral, pOtro, pRed) => (f) => {
    const n = conParecido(umbral)(f);
    if (!n) return null;
    const top = f.ranking[0];
    return top.clase !== n && top.p >= pOtro && vocabulario.probabilidadDe(f.ranking, n) < pRed ? null : n;
  };
  const reglas = [
    ['red ≥ 0,9', red(0.9)], ['red ≥ 0,7', red(0.7)],
    ['red ≥ 0,9 + parecido', conParecido(0.9)], ['red ≥ 0,7 + parecido', conParecido(0.7)],
    ...[[0.5, 0.05], [0.5, 0.1], [0.7, 0.05], [0.3, 0.05]].flatMap(([a, b]) => [
      [`red ≥ 0,9 + parecido + CLIP (${a}/${b})`, conVeto(0.9, a, b)], [`red ≥ 0,7 + parecido + CLIP (${a}/${b})`, conVeto(0.7, a, b)]]),
  ];
  console.log(`\n${conocidas.length} fotos de clases conocidas, ${nuevas.length} de ${new Set(nuevas.map(f => f.nombreEn)).size} categorías que la red no tiene\n`);
  console.log('regla                                         conocidas: nombra (acierta)        desconocidas: inventa');
  for (const [nombre, regla] of reglas) {
    const dichos = conocidas.map(f => [f, regla(f)]).filter(([, n]) => n);
    const bien = dichos.filter(([f, n]) => n === f.real).length;
    const inventa = nuevas.filter(f => regla(f)).length;
    console.log(`  ${nombre.padEnd(42)} ${pc(dichos.length, conocidas.length).padStart(7)} (${pc(bien, dichos.length).padStart(7)})          ${pc(inventa, nuevas.length).padStart(7)}`);
  }

  // CLIP solo, nombrando lo que la red no nombra.
  console.log('\nCLIP nombrando lo que la red NO conoce (desconocidas cuyo nombre está en el vocabulario):');
  const enVocabulario = nuevas.filter(f => esDe(f.nombreEn));
  console.log(`  ${new Set(enVocabulario.map(f => f.nombreEn)).size} categorías, ${enVocabulario.length} fotos`);
  for (const pMin of [0.3, 0.5, 0.7]) {
    const dice = enVocabulario.filter(f => f.ranking[0].p >= pMin);
    const bien = dice.filter(f => f.ranking[0].es === esDe(f.nombreEn)).length;
    // Y cuántas veces, de TODAS las desconocidas, nombraría con seguridad una clase que la red sí tiene (un error).
    const claseConocida = nuevas.filter(f => f.ranking[0].p >= pMin && f.ranking[0].clase).length;
    console.log(`  CLIP ≥ ${pMin}: nombra ${pc(dice.length, enVocabulario.length)}, acierta ${pc(bien, dice.length)} · en todas las desconocidas dice una clase de la red en ${pc(claseConocida, nuevas.length)}`);
  }
  // CLIP sobre las conocidas, por si sirve como segunda opinión directa.
  const clipBien = conocidas.filter(f => f.ranking[0].clase === f.real).length;
  console.log(`\nCLIP solo sobre las conocidas: primer nombre correcto en ${pc(clipBien, conocidas.length)}`);
  const peores = [...porClase.keys()].map(c => {
    const de = conocidas.filter(f => f.real === c);
    return [c, de.filter(f => f.ranking[0].clase === c).length, de.length];
  }).sort((a, b) => a[1] / a[2] - b[1] / b[2]).slice(0, 12);
  console.log(`  las que peor ve CLIP: ${peores.map(([c, b, n]) => `${c} ${b}/${n}`).join(' · ')}`);
}
