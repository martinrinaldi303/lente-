// importar_myfixit.js — de los manuales de MyFixit (iFixit) a guías de las gafas.
//
//   node herramientas/importar_myfixit.js datos/myfixit/Phone.json [más archivos…]
//
// MyFixit (github.com/rub-ksv/MyFixit-Dataset) son 31.601 manuales de reparación de
// iFixit en 15 categorías, un archivo JSON por categoría con un manual por renglón.
// Formato verificado el 3-oct-2026 con jsons/Skills.json: Title, Guidid, Category,
// Url, Toolbox [{Name}], Steps [{Order, Text_raw, Lines [{Text}]}].
//
// ⚠️ Licencia CC BY-NC-SA 3.0: sirve para uso personal, NO comercial, citando la
// fuente (cada guía lleva su Url). Por eso guias/myfixit/ no se sube a git.
// ⚠️ Están en inglés. La pantalla las muestra tal cual; traducirlas es otro paso.
//
// Cada paso de iFixit es un párrafo; la pantalla muestra 3 renglones de 21 letras.
// Acá se parte por oraciones y, si una oración no entra, por palabras.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLS, envolver, LINEAS_TEXTO } from '../src/hud.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const SALIDA = join(RAIZ, 'guias', 'myfixit');
const MAX_PASOS = 60;

// Un párrafo en pedazos que entran en la pantalla, sin cortar palabras.
export function partirPaso(texto) {
  const oraciones = String(texto ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const pedazos = [];
  for (const o of oraciones) {
    const renglones = envolver(o, COLS, Infinity);
    for (let i = 0; i < renglones.length; i += LINEAS_TEXTO) pedazos.push(renglones.slice(i, i + LINEAS_TEXTO).join(' '));
  }
  return pedazos;
}

const herramientas = (toolbox) => (toolbox ?? [])
  .flatMap(t => Array.isArray(t?.Name) ? t.Name : [t?.Name]).filter(Boolean).map(String);

// Un manual de MyFixit → una guía, o null si no tiene pasos con texto.
export function guiaDeManual(m) {
  const pasos = [...(m?.Steps ?? [])].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
    .flatMap(p => partirPaso(p.Text_raw ?? (p.Lines ?? []).map(l => l.Text).join(' ')));
  if (!m?.Title || !pasos.length) return null;
  const tools = herramientas(m.Toolbox);
  return {
    titulo: String(m.Title).slice(0, 60),
    palabras: [m.Category, m.Subject, ...(m.Ancestors ?? []).filter(a => a !== 'Root')].filter(Boolean).map(String),
    fuente: `iFixit vía MyFixit: ${m.Url ?? ''}`.trim(),
    licencia: 'CC BY-NC-SA 3.0 (no comercial)',
    aviso: tools.length ? `Herramientas: ${tools.slice(0, 6).join(', ')}` : '',
    pasos: (tools.length ? partirPaso(`Necesitás: ${tools.slice(0, 6).join(', ')}`).slice(0, 1) : []).concat(pasos).slice(0, MAX_PASOS),
  };
}

export function importar(archivo, salida = SALIDA) {
  const categoria = basename(archivo).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const dir = join(salida, categoria);
  mkdirSync(dir, { recursive: true });
  let n = 0, salteados = 0;
  for (const renglon of readFileSync(archivo, 'utf8').split('\n')) {
    if (!renglon.trim()) continue;
    let guia = null, id = null;
    try { const m = JSON.parse(renglon); guia = guiaDeManual(m); id = m.Guidid; }
    catch { /* renglón roto */ }
    if (!guia || id === undefined || id === null) { salteados++; continue; }
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(guia, null, 1));
    n++;
  }
  return { categoria, guias: n, salteados };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const archivos = process.argv.slice(2);
  if (!archivos.length) {
    console.error('Uso: node herramientas/importar_myfixit.js datos/myfixit/Phone.json [más archivos…]');
    process.exit(1);
  }
  for (const a of archivos) {
    const r = importar(a);
    console.log(`${r.categoria}: ${r.guias} guías en guias/myfixit/${r.categoria}/ (${r.salteados} salteadas)`);
  }
}
