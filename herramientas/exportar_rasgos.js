// exportar_rasgos.js — de una base de imágenes a los .bin que lee el entrenador.
//
//   node herramientas/exportar_rasgos.js <carpeta_base> <categorias.json> <carpeta_salida> [--max N] [--espejo]
//
// La base tiene que venir como UNA CARPETA POR CLASE con los JPEG adentro, que es
// como viene Caltech-256 y como conviene guardar fotos propias.
//
// `categorias.json` dice qué carpetas entran y cómo se llama la clase en las gafas.
// Varias carpetas pueden ir a la misma clase:
//
//   { "159.people": "persona", "253.faces-easy-101": "persona", "041.coffee-mug": "taza" }
//
// Cada imagen se decodifica UNA vez y pasa por TODOS los extractores de
// src/extractores.js, que son los mismos que usa el cerebro en vivo. Sale una
// carpeta por extractor, y en todas las filas van en el mismo orden: por eso
// después se pueden hacer votar juntas las redes de extractores distintos.
//
// El reparto entre entrenamiento y prueba sale del NOMBRE del archivo, no de un
// sorteo: una imagen cae siempre del mismo lado, se corra cuando se corra. Si no,
// cada corrida mediría contra una prueba distinta y los números no se podrían comparar.
//
// --espejo agrega cada imagen de ENTRENAMIENTO también dada vuelta. A la prueba no
// se le agrega nada: la prueba son fotos, no fotos inventadas.

import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACTORES, extractoresDisponibles } from '../src/extractores.js';
import { escribirRasgos, leerRasgos } from '../src/formato_rasgos.js';
import { espejar, regionCompleta } from '../src/imagen.js';

const UNA_DE_CADA_N_A_PRUEBA = 5;   // 20 %

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

export function vaAPrueba(nombreArchivo) {
  return fnv1a(nombreArchivo.toLowerCase()) % UNA_DE_CADA_N_A_PRUEBA === 0;
}

// Dos fotos con los mismos vectores en todos los extractores son la misma foto.
function claveDeFoto(vectores) {
  const h = createHash('sha1');
  for (const v of vectores) h.update(Buffer.from(Float32Array.from(v).buffer));
  return h.digest('hex');
}

// Devuelve el resumen. `maxPorCarpeta` acota las clases gigantes para que una sola
// no arrastre a la red (en Caltech-256 hay carpetas de 80 imágenes y de 800).
export async function exportar({ base, categorias, salida, maxPorCarpeta = Infinity, espejo = false,
                                 extractores = Object.values(EXTRACTORES), registrar = () => {} }) {
  const carpetasFaltantes = [], listado = [];
  for (const [carpeta, clase] of Object.entries(categorias)) {
    try { listado.push({ carpeta, clase, archivos: readdirSync(join(base, carpeta)).filter(a => /\.jpe?g$/i.test(a)).sort() }); }
    catch { carpetasFaltantes.push(carpeta); }
  }
  // Una clase sin ninguna carpeta en disco no entra: sería una salida de la red
  // que nunca vio un ejemplo.
  const clases = [...new Set(listado.filter(l => l.archivos.length).map(l => l.clase))];
  const filas = extractores.map(() => ({ entrenamiento: [], prueba: [] }));
  const resumen = { clases, porClase: {}, saltadas: 0, carpetasFaltantes, fuentes: extractores.map(e => e.fuente) };
  for (const c of clases) resumen.porClase[c] = { entrenamiento: 0, prueba: 0 };

  // Lo calculado se guarda POR CARPETA y POR EXTRACTOR en `_cache/`. Agregar una clase
  // o un extractor sólo calcula lo nuevo, y una corrida que se corta sigue donde quedó
  // (pasar 13.000 imágenes por la red ya entrenada lleva más de 8 minutos). El nombre
  // del archivo lleva todo lo que cambia el resultado: carpeta, extractor, tope y espejo.
  const dirCache = join(salida, '_cache');
  mkdirSync(dirCache, { recursive: true });
  const marca = `max${Number.isFinite(maxPorCarpeta) ? maxPorCarpeta : 'todo'}_${espejo ? 'espejo' : 'simple'}`;
  const archivoCache = (carpeta, e) => join(dirCache, `${carpeta.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '')}__${e.fuente}_${e.dim}__${marca}.bin`);
  const LADOS = ['entrenamiento', 'prueba'];
  const leerCache = (carpeta, e) => {
    try {
      const c = leerRasgos(archivoCache(carpeta, e));
      return c.fuente === e.fuente && c.dim === e.dim ? c.filas : null;
    } catch { return null; }
  };
  const fotos = [];

  for (const { carpeta, clase, archivos } of listado) {
    if (!archivos.length) continue;
    const dir = join(base, carpeta);
    const etiqueta = clases.indexOf(clase);

    const porExtractor = extractores.map(e => leerCache(carpeta, e));
    const faltan = extractores.filter((_, k) => !porExtractor[k]);
    if (faltan.length) {
      const nuevas = faltan.map(() => []);
      for (const archivo of archivos.slice(0, maxPorCarpeta)) {
        const aPrueba = vaAPrueba(`${carpeta}/${archivo}`);
        // Una imagen que no se puede leer no entra a NINGÚN extractor: si no, las
        // filas de uno dejarían de corresponder a las del otro.
        let img;
        try { img = jpeg.decode(readFileSync(join(dir, archivo)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
        catch { resumen.saltadas++; continue; }      // JPEG roto o de un formato raro
        for (const i of espejo && !aPrueba ? [img, espejar(img)] : [img]) {
          const vectores = await Promise.all(faltan.map(e => e.extraer(i, regionCompleta(i))));
          vectores.forEach((vector, k) => nuevas[k].push({ etiqueta: aPrueba ? 1 : 0, vector }));
        }
      }
      faltan.forEach((e, k) => {
        escribirRasgos(archivoCache(carpeta, e), { fuente: e.fuente, dim: e.dim, clases: LADOS, filas: nuevas[k] });
        porExtractor[extractores.indexOf(e)] = nuevas[k];
      });
    }
    if (porExtractor.some(f => f.length !== porExtractor[0].length))
      throw new Error(`el cache de ${carpeta} quedó desparejo entre extractores: borrá ${dirCache}`);

    // De a una foto: con espejo, una de entrenamiento son dos filas seguidas.
    for (let k = 0; k < porExtractor[0].length;) {
      const n = espejo && porExtractor[0][k].etiqueta === 0 ? 2 : 1;
      fotos.push({ clase, etiqueta, lado: LADOS[porExtractor[0][k].etiqueta], filas: porExtractor.map(f => f.slice(k, k + n)),
                   clave: claveDeFoto(porExtractor.map(f => f[k].vector)) });
      k += n;
    }
    registrar(`${carpeta} → ${clase}: ${porExtractor[0].length} filas${faltan.length ? '' : ' (ya calculadas)'}`);
  }

  // Fotos repetidas, byte por byte (dan los mismos vectores). La base de piezas de PC
  // de Kaggle trae 203: la misma foto de un teclado con su mouse está en «keyboard» y en
  // «mouse», y una con el teclado en «monitor». Si está en dos clases no se sabe cuál
  // es, y enseñaría las dos cosas a la vez: se saca entera. Si está dos veces en la
  // misma clase queda la primera, así la copia no cae en la prueba y la infla.
  const clasesDe = new Map();
  for (const f of fotos) (clasesDe.get(f.clave) ?? clasesDe.set(f.clave, new Set()).get(f.clave)).add(f.clase);
  const vistas = new Set();
  resumen.ambiguas = 0; resumen.repetidas = 0;
  for (const f of fotos) {
    if (clasesDe.get(f.clave).size > 1) { resumen.ambiguas++; continue; }
    if (vistas.has(f.clave)) { resumen.repetidas++; continue; }
    vistas.add(f.clave);
    f.filas.forEach((filasDeFoto, k) => {
      for (const fila of filasDeFoto) filas[k][f.lado].push({ etiqueta: f.etiqueta, vector: fila.vector });
    });
    resumen.porClase[f.clase][f.lado] += f.filas[0].length;
  }

  extractores.forEach((e, k) => {
    const dir = join(salida, e.fuente);
    mkdirSync(dir, { recursive: true });
    escribirRasgos(join(dir, 'entrenamiento.bin'), { fuente: e.fuente, dim: e.dim, clases, filas: filas[k].entrenamiento });
    escribirRasgos(join(dir, 'prueba.bin'),        { fuente: e.fuente, dim: e.dim, clases, filas: filas[k].prueba });
  });
  resumen.entrenamiento = filas[0].entrenamiento.length;
  resumen.prueba = filas[0].prueba.length;
  // Con espejo, cada foto de entrenamiento ocupa dos filas seguidas. El entrenador
  // lo necesita saber para no repartir un par entre entrenamiento y validación.
  resumen.filasPorFoto = espejo ? 2 : 1;
  writeFileSync(join(salida, 'exportacion.json'), JSON.stringify({
    filasPorFoto: resumen.filasPorFoto, fuentes: resumen.fuentes, clases,
    entrenamiento: resumen.entrenamiento, prueba: resumen.prueba,
  }, null, 2));
  return resumen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, archivoCategorias, salida, ...resto] = process.argv.slice(2);
  if (!base || !archivoCategorias || !salida) {
    console.error('uso: node herramientas/exportar_rasgos.js <carpeta_base> <categorias.json> <carpeta_salida> [--max N] [--espejo]');
    process.exit(2);
  }
  const iMax = resto.indexOf('--max');
  const maxPorCarpeta = iMax >= 0 ? Number(resto[iMax + 1]) : Infinity;
  if (!statSync(base).isDirectory()) { console.error(`${base} no es una carpeta`); process.exit(1); }
  const categorias = JSON.parse(readFileSync(archivoCategorias, 'utf8'));
  const extractores = await extractoresDisponibles();
  const r = await exportar({ base, categorias, salida, maxPorCarpeta, espejo: resto.includes('--espejo'), extractores, registrar: console.log });
  console.log(`\n${r.entrenamiento} de entrenamiento y ${r.prueba} de prueba, en ${r.clases.length} clases`);
  console.log(`Una carpeta por extractor en ${salida}: ${r.fuentes.join(', ')}`);
  if (r.ambiguas || r.repetidas) console.log(`Fotos repetidas sacadas: ${r.ambiguas} en más de una clase, ${r.repetidas} copias en la misma`);
  if (r.saltadas) console.log(`⚠️ ${r.saltadas} imágenes no se pudieron leer y se saltaron`);
  if (r.carpetasFaltantes.length) console.log(`⚠️ carpetas que no existen: ${r.carpetasFaltantes.join(', ')}`);
}
