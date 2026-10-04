// entrenar_todo.js — entrena las redes de cada extractor y mide el conjunto.
//
//   npm run entrenar            (usa datos/rasgos y deja los pesos en estado/)
//
// Tres pasos:
//   1 · Por cada extractor, cpp/entrenar.exe entrena class23 + class24 y mide.
//   2 · Se cargan todas en un Conjunto y se mide el voto sobre la MISMA prueba.
//   3 · Tabla: cada extractor solo, voto parejo y voto pesado por validación.
//
// Si el voto no le gana al mejor extractor solo, el extractor flojo está restando
// y hay que sacarlo: sumar votantes no es gratis.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivoDeRed, Conjunto } from '../src/conjunto.js';
import { EXTRACTORES } from '../src/extractores.js';
import { leerRasgos } from '../src/formato_rasgos.js';
import { DIM as DIM_DINO, FUENTE as DINO } from '../src/rasgos_dino.js';
import { BINARIO } from './compilar.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

// Acierto del conjunto sobre la prueba, y qué pasa si sólo opina cuando está seguro.
export function medirConjunto(conjunto, pruebas) {
  const n = pruebas[0].filas.length;
  if (pruebas.some(p => p.filas.length !== n)) throw new Error('las pruebas de los extractores no tienen las mismas filas');
  let ok = 0;
  const umbrales = [0.5, 0.7, 0.9].map(u => ({ umbral: u, opina: 0, acierta: 0 }));
  for (let k = 0; k < n; k++) {
    const etiqueta = pruebas[0].filas[k].etiqueta;
    const p = conjunto.votar(pruebas.map(pr => pr.filas[k].vector));
    if (p.indice === etiqueta) ok++;
    for (const u of umbrales) if (p.confianza >= u.umbral) { u.opina++; if (p.indice === etiqueta) u.acierta++; }
  }
  const acierto = ok / n;
  return { n, acierto, margen95: 1.96 * Math.sqrt(acierto * (1 - acierto) / n), umbrales };
}

// `fuentes` es [{ fuente, dim }]: para entrenar no hace falta el extractor en sí,
// sólo saber qué carpetas de rasgos hay.
// `soloMedir` saltea el entrenamiento y mide las redes que ya están en dirEstado.
export function entrenarTodo({ dirRasgos, dirEstado, epocas = 30, lr = 0.01, fuentes = Object.values(EXTRACTORES),
                               soloMedir = false, registrar = console.log }) {
  if (!soloMedir && !existsSync(BINARIO)) throw new Error('falta compilar el entrenador: npm run compilar');
  const extractores = fuentes.filter(e => existsSync(join(dirRasgos, e.fuente, 'entrenamiento.bin')));
  if (!extractores.length) throw new Error(`no hay rasgos exportados en ${dirRasgos}`);

  let filasPorFoto = 1;
  try { filasPorFoto = JSON.parse(readFileSync(join(dirRasgos, 'exportacion.json'), 'utf8')).filasPorFoto ?? 1; }
  catch { /* exportación vieja, sin espejo */ }
  mkdirSync(dirEstado, { recursive: true });

  for (const e of soloMedir ? [] : extractores) {
    registrar(`\n══ ${e.fuente}|${e.dim} ══`);
    const salida = execFileSync(BINARIO, [
      join(dirRasgos, e.fuente, 'entrenamiento.bin'), join(dirRasgos, e.fuente, 'prueba.bin'),
      archivoDeRed(dirEstado, e), '--epocas', String(epocas), '--lr', String(lr), '--grupo', String(filasPorFoto),
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    registrar(salida.split('\n').filter(l => /se queda con|azar|ensamble|ventaja/.test(l)).join('\n'));
  }

  const pruebas = extractores.map(e => leerRasgos(join(dirRasgos, e.fuente, 'prueba.bin')));
  const pesado = Conjunto.cargar(dirEstado, { extractores });
  const parejo = Conjunto.cargar(dirEstado, { extractores, parejo: true });
  const filas = pesado.miembros.map(m => ({
    nombre: `${m.extractor.fuente} solo`, acierto: m.red.medicion.acierto, margen95: m.red.medicion.margen95, peso: m.peso,
  }));
  const azar = pesado.miembros[0].red.medicion.azar;
  const rParejo = medirConjunto(parejo, pruebas), rPesado = medirConjunto(pesado, pruebas);
  filas.push({ nombre: 'todos, voto parejo', ...rParejo }, { nombre: 'todos, voto por validación', ...rPesado });

  registrar(`\n══ CONJUNTO — ${rPesado.n} fotos de prueba, ${pesado.clases.length} clases ══`);
  registrar(`  ${'azar'.padEnd(30)} ${(100 * azar).toFixed(1).padStart(5)}%`);
  for (const f of filas)
    registrar(`  ${f.nombre.padEnd(30)} ${(100 * f.acierto).toFixed(1).padStart(5)}%  (± ${(100 * f.margen95).toFixed(1)})` +
              (f.peso !== undefined ? `   peso ${f.peso.toFixed(4)}` : ''));
  registrar('\n  si sólo opina cuando está seguro (voto por validación):');
  for (const u of rPesado.umbrales)
    registrar(`    confianza ≥ ${u.umbral}: opina en ${(100 * u.opina / rPesado.n).toFixed(0)}% de las fotos, acierta ${u.opina ? (100 * u.acierta / u.opina).toFixed(0) : '—'}%`);
  // Las pruebas aparte, si están: las mismas fotos arruinadas (¿aguanta lo que ve una
  // webcam?) y las fotos de la cámara del usuario (lo que de verdad importa).
  const extras = {};
  for (const [archivo, nombre] of [['prueba_arruinada.bin', 'arruinadas'], ['prueba_propias.bin', 'propias']]) {
    if (!extractores.every(e => existsSync(join(dirRasgos, e.fuente, archivo)))) continue;
    const otras = extractores.map(e => leerRasgos(join(dirRasgos, e.fuente, archivo)));
    if (!otras[0].filas.length) continue;
    const r = medirConjunto(pesado, otras);
    extras[nombre] = r;
    registrar(`\n  fotos de prueba ${nombre}: ${r.n} — acierta ${(100 * r.acierto).toFixed(1)}% (± ${(100 * r.margen95).toFixed(1)})` +
              r.umbrales.map(u => ` · ≥${u.umbral}: opina ${(100 * u.opina / r.n).toFixed(0)}%, acierta ${u.opina ? (100 * u.acierta / u.opina).toFixed(0) : '—'}%`).join(''));
  }
  // Queda escrito para quien lo necesite sin volver a medir (el documento Word).
  writeFileSync(join(dirEstado, 'medicion_conjunto.json'), JSON.stringify({
    cuando: new Date().toISOString(), clases: pesado.clases.length, fotos_de_prueba: rPesado.n, azar, filas, umbrales: rPesado.umbrales,
    ...(Object.keys(extras).length ? { otras_pruebas: Object.fromEntries(Object.entries(extras).map(([k, r]) => [k, { n: r.n, acierto: r.acierto, margen95: r.margen95, umbrales: r.umbrales }])) } : {}),
  }, null, 2));
  return { azar, filas, pesado: rPesado, parejo: rParejo, extras };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (nombre, defecto) => { const i = process.argv.indexOf(nombre); return i >= 0 ? process.argv[i + 1] : defecto; };
  try {
    entrenarTodo({
      dirRasgos: arg('--rasgos', join(RAIZ, 'datos', 'rasgos')),
      dirEstado: arg('--estado', join(RAIZ, 'estado')),
      epocas: Number(arg('--epocas', 30)), lr: Number(arg('--lr', 0.01)),
      soloMedir: process.argv.includes('--solo-medir'),
      fuentes: [...Object.values(EXTRACTORES), { fuente: DINO, dim: DIM_DINO }],
    });
  } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
