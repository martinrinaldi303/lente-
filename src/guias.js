// guias.js — guías paso a paso guardadas en disco: andan sin LLM y sin internet.
//
// Las guías que arma el LLM (pasos_cargar) pueden equivocarse con un aparato que no
// conoce. Éstas no: alguien las escribió y se pueden revisar. Viven en guias/, una
// por archivo .json, en carpetas por tema:
//
//   { "titulo": "RCP en un adulto",
//     "palabras": ["rcp", "reanimacion", "paro"],     ← con qué se la busca
//     "aparatos": ["control remoto"],                  ← opcional: los tipos de las redes
//     "fuente": "…", "licencia": "…", "aviso": "…",
//     "pasos": ["Una acción por paso", "…"] }
//
// Cada paso entra en 3 renglones de 21 letras (60 letras, más o menos). Uno más
// largo se ve cortado con «…»: herramientas/importar_myfixit.js los parte antes.
//
// El id de una guía es su ruta sin «.json»: «primeros_auxilios/rcp_adulto».

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizarNombre } from './memoria.js';

const MAX_PASOS = 60;

function archivosJson(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...archivosJson(ruta));
    else if (nombre.endsWith('.json')) out.push(ruta);
  }
  return out;
}

// Todas las guías de `dir`, ordenadas por id. Una mal escrita se avisa y se saltea.
export function cargarGuias(dir, avisar = console.warn) {
  if (!existsSync(dir)) return [];
  const guias = [];
  for (const ruta of archivosJson(dir).sort()) {
    const id = relative(dir, ruta).replace(/\\/g, '/').replace(/\.json$/, '');
    try {
      const g = JSON.parse(readFileSync(ruta, 'utf8'));
      const pasos = (Array.isArray(g.pasos) ? g.pasos : []).map(p => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!g.titulo || !pasos.length) throw new Error('le falta el título o los pasos');
      guias.push({
        id, titulo: String(g.titulo).slice(0, 60), tema: id.includes('/') ? id.split('/')[0] : '',
        palabras: (g.palabras ?? []).map(String), aparatos: (g.aparatos ?? []).map(String),
        fuente: g.fuente ?? '', licencia: g.licencia ?? '', aviso: g.aviso ?? '',
        pasos: pasos.slice(0, MAX_PASOS),
      });
    } catch (e) { avisar(`⚠️ guía ${id} salteada: ${e.message}`); }
  }
  return guias;
}

const palabrasDe = (texto) => normalizarNombre(texto).split(' ').filter(w => w.length > 2);
// Palabras que aparecen en cualquier pedido y no dicen de QUÉ es la guía: con ellas
// solas, «cambiar el embrague» encontraba «Cambiar pilas del control».
const GENERICAS = new Set(['como', 'con', 'para', 'que', 'del', 'las', 'los', 'una', 'uno', 'por', 'esta', 'este', 'esto',
  'hay', 'tengo', 'quiero', 'hacer', 'cambiar', 'arreglar', 'reparar', 'guia', 'ayuda', 'necesito', 'sobre', 'mas']);

// La guía que mejor coincide con lo que se pide, o null. Vale el id exacto, el tipo de
// aparato exacto, o las palabras en común con el título y las palabras clave.
export function buscarGuia(guias, consulta) {
  const q = normalizarNombre(consulta);
  if (!q) return null;
  const exacta = guias.find(g => g.id === String(consulta).trim()) ?? guias.find(g => g.aparatos.some(a => normalizarNombre(a) === q));
  if (exacta) return exacta;
  const pedidas = new Set(palabrasDe(consulta).map(w => w.replace(/s$/, '')).filter(w => !GENERICAS.has(w)));
  let mejor = null, puntos = 0;
  for (const g of guias) {
    const suyas = new Set([g.titulo, ...g.palabras, ...g.aparatos].flatMap(palabrasDe).map(w => w.replace(/s$/, '')));
    let p = 0;
    for (const w of pedidas) if (suyas.has(w)) p++;
    if (p > puntos || (p === puntos && p > 0 && g.titulo.length < mejor.titulo.length)) { mejor = g; puntos = p; }
  }
  return puntos > 0 ? mejor : null;
}

// Lo que se le cuenta al LLM o al emulador de las guías que hay.
export const resumenDeGuias = (guias) => guias.map(g => ({ id: g.id, titulo: g.titulo, tema: g.tema }));
