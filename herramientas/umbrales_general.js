// umbrales_general.js — un umbral por clase para la red general.
//
//   node herramientas/umbrales_general.js [precisión] [--guardar]
//
// La pantalla nombra lo que la red general dice con confianza ≥ 0,7 (CONFIANZA_GENERAL
// en sesion.js), igual para todas las clases. Pero no se equivoca igual con una cebra
// que con un procesador (que confunde con la placa madre): a la cebra le sobra con
// 0,5, y el procesador con 0,7 se equivoca seguido.
//
// Con las fotos de prueba de la red (datos/rasgos/<extractor>/prueba.bin): las filas
// PARES calibran (para cada clase, la confianza más baja desde la que, cuando la red la
// dice, acierta la proporción pedida, 95 % por defecto) y las IMPARES miden. Una clase
// con pocas fotos usa el umbral de siempre. Ninguna baja de 0,5 ni pasa de 0,99.
//
// Con --guardar deja estado/umbrales_general.json, que lee la sesión.

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Conjunto } from '../src/conjunto.js';
import { EXTRACTORES } from '../src/extractores.js';
import { leerRasgos } from '../src/formato_rasgos.js';
import { DIM as DIM_DINO, FUENTE as DINO } from '../src/rasgos_dino.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const UMBRAL_DE_SIEMPRE = 0.7;
const PISO = 0.5, TECHO = 0.99, MINIMO = 8;

// La confianza más baja desde la que la clase acierta ≥ `precision`, o null si con las
// fotos que hay no se puede saber. `lista`: [{ confianza, cierto }] de lo que la red DIJO
// que era esa clase.
export function umbralDeClase(lista, precision, { minimo = MINIMO } = {}) {
  const orden = lista.slice().sort((a, b) => b.confianza - a.confianza);
  if (orden.length < minimo) return null;
  let ciertos = 0, mejor = null;
  orden.forEach((d, k) => {
    if (d.cierto) ciertos++;
    if (k + 1 >= minimo && ciertos / (k + 1) >= precision) mejor = d.confianza;
  });
  return mejor === null ? TECHO : Math.min(TECHO, Math.max(PISO, mejor));
}

// Qué haría la pantalla con un umbral por clase: { opina, acierta }.
export function medirConUmbrales(predicciones, umbralDe) {
  let opina = 0, acierta = 0;
  for (const p of predicciones) {
    if (p.nombre === 'nada' || p.confianza < umbralDe(p.nombre)) continue;
    opina++; if (p.cierto) acierta++;
  }
  return { opina, acierta };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const precision = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 0.95);
  const dirRasgos = join(RAIZ, 'datos', 'rasgos'), dirEstado = join(RAIZ, 'estado');
  const fuentes = [...Object.values(EXTRACTORES), { fuente: DINO, dim: DIM_DINO }].filter(e => existsSync(join(dirRasgos, e.fuente, 'prueba.bin')));
  const conjunto = Conjunto.cargar(dirEstado, { extractores: fuentes.filter(f => f.fuente === DINO).length ? fuentes.filter(f => f.fuente === DINO) : fuentes });
  const fuentesDelConjunto = conjunto.miembros.map(m => m.extractor);

  const predecir = (archivo) => {
    if (!fuentesDelConjunto.every(e => existsSync(join(dirRasgos, e.fuente, archivo)))) return null;
    const pruebas = fuentesDelConjunto.map(e => leerRasgos(join(dirRasgos, e.fuente, archivo)));
    return pruebas[0].filas.map((f, k) => {
      const p = conjunto.votar(pruebas.map(pr => pr.filas[k].vector));
      return { nombre: p.nombre, confianza: p.confianza, cierto: p.indice === f.etiqueta, k };
    });
  };
  const todas = predecir('prueba.bin');
  const calibran = todas.filter(p => p.k % 2 === 0), miden = todas.filter(p => p.k % 2 === 1);
  const porClase = new Map();
  for (const p of calibran) (porClase.get(p.nombre) ?? porClase.set(p.nombre, []).get(p.nombre)).push(p);
  const umbrales = {};
  for (const [clase, lista] of porClase) { if (clase === 'nada') continue; const u = umbralDeClase(lista, precision); if (u !== null) umbrales[clase] = Number(u.toFixed(3)); }
  const propio = (n) => umbrales[n] ?? UMBRAL_DE_SIEMPRE;

  const pc = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(1)} %`;
  console.log(`Red general (${conjunto.clases.length} clases): ${calibran.length} fotos calibran, ${miden.length} miden. Precisión pedida ${(100 * precision).toFixed(0)} %.`);
  console.log(`${Object.keys(umbrales).length} clases con umbral propio; ${Object.values(umbrales).filter(u => u < UMBRAL_DE_SIEMPRE).length} más bajo que 0,7, ${Object.values(umbrales).filter(u => u >= 0.95).length} en 0,95 o más.\n`);
  for (const [nombre, archivo] of [['las fotos de prueba', 'prueba.bin'], ['las mismas, arruinadas', 'prueba_arruinada.bin'], ['tus fotos', 'prueba_propias.bin']]) {
    const preds = archivo === 'prueba.bin' ? miden : predecir(archivo)?.filter(p => p.k % 2 === 1);
    if (!preds?.length) continue;
    const a = medirConUmbrales(preds, () => UMBRAL_DE_SIEMPRE), b = medirConUmbrales(preds, propio);
    console.log(`  ${nombre.padEnd(24)} 0,7 para todo: opina ${pc(a.opina, preds.length)}, acierta ${pc(a.acierta, a.opina)}   ·   uno por clase: opina ${pc(b.opina, preds.length)}, acierta ${pc(b.acierta, b.opina)}`);
  }
  const ordenados = Object.entries(umbrales).sort((x, y) => y[1] - x[1]);
  console.log(`\n  los más exigentes: ${ordenados.slice(0, 8).map(([c, u]) => `${c} ${u}`).join(' · ')}`);
  console.log(`  los más sueltos:   ${ordenados.slice(-8).map(([c, u]) => `${c} ${u}`).join(' · ')}`);

  if (process.argv.includes('--guardar')) {
    const archivo = join(dirEstado, 'umbrales_general.json');
    writeFileSync(archivo, JSON.stringify({ cuando: new Date().toISOString(), precision, de_siempre: UMBRAL_DE_SIEMPRE, clases: conjunto.clases.length, umbrales }, null, 2));
    console.log(`\nGuardado en ${archivo}`);
  }
}
