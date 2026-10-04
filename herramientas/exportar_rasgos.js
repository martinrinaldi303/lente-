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
//
// --aumentar N (3-oct-2026) agrega además cada foto de entrenamiento arruinada de N
// formas (src/aumentos.js: poca luz, desenfoque, movimiento, cortada, torcida, JPEG
// fuerte), y escribe aparte `prueba_arruinada.bin`: cada foto de prueba arruinada una
// vez, para medir si la red aguanta lo que ve una webcam. Una foto de entrenamiento
// ocupa entonces (espejo ? 2 : 1) + N filas seguidas: original, espejo, arruinadas.
//
// --propias <carpeta> suma las fotos de la cámara del usuario (src/muestras.js): las de
// entrenamiento, REPETIDAS veces (son pocas y valen más que las de catálogo); las de
// prueba van a `prueba_propias.bin`, aparte, para no cambiar la prueba de siempre. Una
// foto de algo que la red no tiene, o de lo que NO es una clase, entra como «nada».
//
// En categorias.json, una carpeta puede ir como { "clase": "nada", "max": 15,
// "soloEntrenamiento": true }: así entran las categorías de Caltech que la red no tiene
// («otras cosas») como ejemplos de nada, sin tocar la prueba (--otros categorias_otros.json).

import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACTORES, extractoresDisponibles } from '../src/extractores.js';
import { escribirRasgos, leerRasgos } from '../src/formato_rasgos.js';
import { espejar, regionCompleta } from '../src/imagen.js';
import { arruinar, azarDe } from '../src/aumentos.js';
import { Muestras } from '../src/muestras.js';

const UNA_DE_CADA_N_A_PRUEBA = 5;   // 20 %
const REPETIR_PROPIAS = 3;          // cada foto propia de entrenamiento entra tres veces

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
export async function exportar({ base, categorias, salida, maxPorCarpeta = Infinity, espejo = false, aumentar = 0, propias = null,
                                 extractores = Object.values(EXTRACTORES), registrar = () => {} }) {
  const carpetasFaltantes = [], listado = [];
  for (const [carpeta, valor] of Object.entries(categorias)) {
    const { clase, max = maxPorCarpeta, soloEntrenamiento = false } = typeof valor === 'string' ? { clase: valor } : valor;
    try { listado.push({ carpeta, clase, max, soloEntrenamiento, archivos: readdirSync(join(base, carpeta)).filter(a => /\.jpe?g$/i.test(a)).sort() }); }
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
  const archivoCache = (carpeta, e, otraMarca = marca) => join(dirCache, `${carpeta.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '')}__${e.fuente}_${e.dim}__${otraMarca}.bin`);
  const LADOS = ['entrenamiento', 'prueba'];
  const leerCache = (carpeta, e, otraMarca = marca) => {
    try {
      const c = leerRasgos(archivoCache(carpeta, e, otraMarca));
      return c.fuente === e.fuente && c.dim === e.dim ? c.filas : null;
    } catch { return null; }
  };
  const fotos = [];
  // Las arruinadas van en su propio cache: así agregar --aumentar no recalcula las
  // originales. Tiene `aumentar` filas por foto de entrenamiento y una por foto de
  // prueba, en el mismo orden que el cache de las originales.
  const marcaDe = (tope, cual) => `max${Number.isFinite(tope) ? tope : 'todo'}_${cual}`;

  for (const { carpeta, clase, archivos, max, soloEntrenamiento } of listado) {
    if (!archivos.length) continue;
    const dir = join(base, carpeta);
    const etiqueta = clases.indexOf(clase);
    const tope = Math.min(max, maxPorCarpeta);
    const marcaCarpeta = tope === maxPorCarpeta ? marca : marcaDe(tope, espejo ? 'espejo' : 'simple');
    const marcaAumentos = marcaDe(tope, `aum${aumentar}`);
    const elegidos = archivos.slice(0, tope);

    const porExtractor = extractores.map(e => leerCache(carpeta, e, marcaCarpeta));
    const faltan = extractores.filter((_, k) => !porExtractor[k]);
    if (faltan.length) {
      const nuevas = faltan.map(() => []);
      for (const archivo of elegidos) {
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
        escribirRasgos(archivoCache(carpeta, e, marcaCarpeta), { fuente: e.fuente, dim: e.dim, clases: LADOS, filas: nuevas[k] });
        porExtractor[extractores.indexOf(e)] = nuevas[k];
      });
    }
    if (porExtractor.some(f => f.length !== porExtractor[0].length))
      throw new Error(`el cache de ${carpeta} quedó desparejo entre extractores: borrá ${dirCache}`);

    // Las arruinadas de esta carpeta (del cache, o se calculan ahora).
    let aum = null;
    if (aumentar > 0) {
      aum = extractores.map(e => leerCache(carpeta, e, marcaAumentos));
      const faltanAum = extractores.filter((_, k) => !aum[k]);
      if (faltanAum.length) {
        const nuevas = faltanAum.map(() => []);
        for (const archivo of elegidos) {
          const id = `${carpeta}/${archivo}`, aPrueba = vaAPrueba(id);
          let img;
          try { img = jpeg.decode(readFileSync(join(dir, archivo)), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
          catch { continue; }                   // la misma que se saltó al calcular las originales
          const versiones = aPrueba ? [arruinar(img, azarDe(`prueba:${id}`))]
            : Array.from({ length: aumentar }, (_, j) => arruinar(img, azarDe(`${j}:${id}`)));
          for (const i of versiones) {
            const vectores = await Promise.all(faltanAum.map(e => e.extraer(i, regionCompleta(i))));
            vectores.forEach((vector, k) => nuevas[k].push({ etiqueta: aPrueba ? 1 : 0, vector }));
          }
        }
        faltanAum.forEach((e, k) => {
          escribirRasgos(archivoCache(carpeta, e, marcaAumentos), { fuente: e.fuente, dim: e.dim, clases: LADOS, filas: nuevas[k] });
          aum[extractores.indexOf(e)] = nuevas[k];
        });
      }
    }

    // De a una foto: con espejo, una de entrenamiento son dos filas seguidas; con
    // aumentos, más sus arruinadas (que están en el otro cache, en el mismo orden).
    let a = 0;
    for (let k = 0; k < porExtractor[0].length;) {
      const deEntrenamiento = porExtractor[0][k].etiqueta === 0;
      const n = espejo && deEntrenamiento ? 2 : 1;
      const extra = aum ? (deEntrenamiento ? aumentar : 1) : 0;
      const filasExtra = aum ? aum.map(f => f.slice(a, a + extra)) : null;
      a += extra;
      if (!deEntrenamiento && soloEntrenamiento) { k += n; continue; }
      fotos.push({ clase, etiqueta, lado: LADOS[porExtractor[0][k].etiqueta],
                   filas: porExtractor.map((f, i) => [...f.slice(k, k + n), ...(deEntrenamiento && filasExtra ? filasExtra[i] : [])]),
                   arruinada: !deEntrenamiento && filasExtra ? filasExtra.map(f => f[0]) : null,
                   clave: claveDeFoto(porExtractor.map(f => f[k].vector)) });
      k += n;
    }
    if (aum && a !== aum[0].length) throw new Error(`el cache de aumentos de ${carpeta} no coincide con las fotos: borrá sus archivos _aum en ${dirCache}`);
    registrar(`${carpeta} → ${clase}: ${porExtractor[0].length} filas${faltan.length ? '' : ' (ya calculadas)'}`);
  }

  // Las fotos de la cámara del usuario (sin cache: son pocas y cambian seguido).
  const filasPropias = extractores.map(() => []);
  if (propias) {
    const lista = new Muestras({ dir: propias }).listar();
    resumen.propias = { entrenamiento: 0, prueba: 0, comoNada: 0 };
    for (const m of lista) {
      const clase = !m.noEs && clases.includes(m.clase) ? m.clase : 'nada';
      if (!clases.includes(clase)) continue;
      if (clase === 'nada' && m.clase !== 'nada') resumen.propias.comoNada++;
      let img;
      try { img = jpeg.decode(readFileSync(m.ruta), { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 }); }
      catch { resumen.saltadas++; continue; }
      const etiqueta = clases.indexOf(clase);
      if (m.prueba) {
        const vectores = await Promise.all(extractores.map(e => e.extraer(img, regionCompleta(img))));
        vectores.forEach((vector, k) => filasPropias[k].push({ etiqueta, vector }));
        resumen.propias.prueba++;
        continue;
      }
      const versiones = [img, ...(espejo ? [espejar(img)] : []), ...Array.from({ length: aumentar }, (_, j) => arruinar(img, azarDe(`${j}:${m.archivo}`)))];
      const filasDeFoto = extractores.map(() => []);
      for (const i of versiones) {
        const vectores = await Promise.all(extractores.map(e => e.extraer(i, regionCompleta(i))));
        vectores.forEach((vector, k) => filasDeFoto[k].push({ vector }));
      }
      for (let r = 0; r < REPETIR_PROPIAS; r++)
        fotos.push({ clase, etiqueta, lado: 'entrenamiento', filas: filasDeFoto, clave: `propia:${m.archivo}:${r}` });
      resumen.propias.entrenamiento++;
    }
    registrar(`fotos propias: ${resumen.propias.entrenamiento} de entrenamiento (×${REPETIR_PROPIAS}), ${resumen.propias.prueba} de prueba, ${resumen.propias.comoNada} como «nada»`);
  }

  // Fotos repetidas, byte por byte (dan los mismos vectores). La base de piezas de PC
  // de Kaggle trae 203: la misma foto de un teclado con su mouse está en «keyboard» y en
  // «mouse», y una con el teclado en «monitor». Si está en dos clases no se sabe cuál
  // es, y enseñaría las dos cosas a la vez: se saca entera. Si está dos veces en la
  // misma clase queda la primera, así la copia no cae en la prueba y la infla.
  const clasesDe = new Map();
  for (const f of fotos) (clasesDe.get(f.clave) ?? clasesDe.set(f.clave, new Set()).get(f.clave)).add(f.clase);
  const vistas = new Set();
  const arruinadas = extractores.map(() => []);
  resumen.ambiguas = 0; resumen.repetidas = 0;
  for (const f of fotos) {
    if (clasesDe.get(f.clave).size > 1) { resumen.ambiguas++; continue; }
    if (vistas.has(f.clave)) { resumen.repetidas++; continue; }
    vistas.add(f.clave);
    f.filas.forEach((filasDeFoto, k) => {
      for (const fila of filasDeFoto) filas[k][f.lado].push({ etiqueta: f.etiqueta, vector: fila.vector });
    });
    if (f.arruinada) f.arruinada.forEach((fila, k) => arruinadas[k].push({ etiqueta: f.etiqueta, vector: fila.vector }));
    resumen.porClase[f.clase][f.lado] += f.filas[0].length;
  }

  extractores.forEach((e, k) => {
    const dir = join(salida, e.fuente);
    mkdirSync(dir, { recursive: true });
    escribirRasgos(join(dir, 'entrenamiento.bin'), { fuente: e.fuente, dim: e.dim, clases, filas: filas[k].entrenamiento });
    escribirRasgos(join(dir, 'prueba.bin'),        { fuente: e.fuente, dim: e.dim, clases, filas: filas[k].prueba });
    if (aumentar > 0) escribirRasgos(join(dir, 'prueba_arruinada.bin'), { fuente: e.fuente, dim: e.dim, clases, filas: arruinadas[k] });
    if (propias) escribirRasgos(join(dir, 'prueba_propias.bin'), { fuente: e.fuente, dim: e.dim, clases, filas: filasPropias[k] });
  });
  resumen.entrenamiento = filas[0].entrenamiento.length;
  resumen.prueba = filas[0].prueba.length;
  // Con espejo, cada foto de entrenamiento ocupa dos filas seguidas. El entrenador
  // lo necesita saber para no repartir un par entre entrenamiento y validación.
  resumen.filasPorFoto = (espejo ? 2 : 1) + aumentar;
  writeFileSync(join(salida, 'exportacion.json'), JSON.stringify({
    filasPorFoto: resumen.filasPorFoto, espejo, aumentar, propias: resumen.propias ?? null, fuentes: resumen.fuentes, clases,
    entrenamiento: resumen.entrenamiento, prueba: resumen.prueba,
  }, null, 2));
  return resumen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, archivoCategorias, salida, ...resto] = process.argv.slice(2);
  if (!base || !archivoCategorias || !salida) {
    console.error('uso: node herramientas/exportar_rasgos.js <carpeta_base> <categorias.json> <carpeta_salida> [--max N] [--espejo] [--aumentar N] [--propias carpeta] [--otros categorias_otros.json]');
    process.exit(2);
  }
  const opcion = (nombre) => { const i = resto.indexOf(nombre); return i >= 0 ? resto[i + 1] : null; };
  const maxPorCarpeta = opcion('--max') ? Number(opcion('--max')) : Infinity;
  if (!statSync(base).isDirectory()) { console.error(`${base} no es una carpeta`); process.exit(1); }
  const categorias = { ...JSON.parse(readFileSync(archivoCategorias, 'utf8')), ...(opcion('--otros') ? JSON.parse(readFileSync(opcion('--otros'), 'utf8')) : {}) };
  const extractores = await extractoresDisponibles();
  const r = await exportar({ base, categorias, salida, maxPorCarpeta, espejo: resto.includes('--espejo'), aumentar: Number(opcion('--aumentar') ?? 0),
                             propias: opcion('--propias'), extractores, registrar: console.log });
  console.log(`\n${r.entrenamiento} de entrenamiento y ${r.prueba} de prueba, en ${r.clases.length} clases`);
  console.log(`Una carpeta por extractor en ${salida}: ${r.fuentes.join(', ')}`);
  if (r.ambiguas || r.repetidas) console.log(`Fotos repetidas sacadas: ${r.ambiguas} en más de una clase, ${r.repetidas} copias en la misma`);
  if (r.saltadas) console.log(`⚠️ ${r.saltadas} imágenes no se pudieron leer y se saltaron`);
  if (r.carpetasFaltantes.length) console.log(`⚠️ carpetas que no existen: ${r.carpetasFaltantes.join(', ')}`);
}
