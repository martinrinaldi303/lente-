// base.js — lo que las gafas guardan en MySQL (XAMPP). Esquema: docs/esquema_gafas.sql.
//
// Es el equivalente de class42 en MIIA: el ÚNICO lugar que habla con la base. Dos
// diferencias, las dos aprendidas allá:
//   · Crea el esquema ENTERO al arrancar (class42 creaba 3 tablas de 36, y rearmar
//     la base dependía de un volcado guardado aparte).
//   · La base es opcional. Con MySQL apagado el cerebro arranca igual, guarda lo
//     aprendido en estado/ como antes, y avisa. Una base caída no tumba las gafas.
//
// Lo que se escribe seguido (reconocimientos) pasa por una cola acotada: si la base
// se pone lenta, se descartan los más viejos en vez de acumular memoria — la misma
// fuga que tuvo class30.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encolarAcotado } from './cola_acotada.js';

const ESQUEMA = join(dirname(dirname(fileURLToPath(import.meta.url))), 'docs', 'esquema_gafas.sql');
const TOPE_COLA = 200;

// Las sentencias del .sql, sin los comentarios.
export function sentenciasDe(sql) {
  return sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
}

export const vectorABlob = (v) => Buffer.from(Float32Array.from(v).buffer);
export const blobAVector = (b) => Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));

// `pool` es un pool de mysql2/promise (o algo con query() y getConnection()).
export class Base {
  constructor(pool, alError = (e) => console.warn(`⚠️ base: ${e.message}`)) {
    this.pool = pool;
    this.alError = alError;
    this.cola = [];
    this.vaciando = false;
    this.descartados = 0;
  }

  async crearEsquema() {
    for (const s of sentenciasDe(readFileSync(ESQUEMA, 'utf8'))) await this.pool.query(s);
  }

  // ── El aprendizaje ─────────────────────────────────────────────────────────
  // Los ejemplos de ese extractor, agrupados: [{ nombre, vectores: [[...], ...] }].
  async cargarEjemplos(fuente, dim) {
    const [filas] = await this.pool.query(
      'SELECT o.nombre, e.vector FROM ejemplos e JOIN objetos o ON o.id = e.objeto_id WHERE e.fuente = ? AND e.dim = ? ORDER BY o.id, e.id',
      [fuente, dim]);
    const porNombre = new Map();
    for (const f of filas) {
      if (f.vector.length !== dim * 4) continue;        // un vector cortado no entra a la red
      if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, []);
      porNombre.get(f.nombre).push(blobAVector(f.vector));
    }
    return [...porNombre].map(([nombre, vectores]) => ({ nombre, vectores }));
  }

  // Deja en la base EXACTAMENTE lo que la red tiene en memoria para ese extractor.
  // Todo o nada: si falla a la mitad, queda lo que había.
  async guardarEjemplos(red) {
    const con = await this.pool.getConnection();
    try {
      await con.beginTransaction();
      await con.query('DELETE FROM ejemplos WHERE fuente = ? AND dim = ?', [red.fuente, red.inDim]);
      for (const [c, nombre] of red.clases.entries()) {
        await con.query('INSERT IGNORE INTO objetos (nombre) VALUES (?)', [nombre]);
        const [[{ id }]] = await con.query('SELECT id FROM objetos WHERE nombre = ?', [nombre]);
        const filas = red.memoria[c].map(v => [id, red.fuente, red.inDim, vectorABlob(v)]);
        if (filas.length) await con.query('INSERT INTO ejemplos (objeto_id, fuente, dim, vector) VALUES ?', [filas]);
      }
      // Un objeto que se olvidó no deja su nombre suelto.
      await con.query('DELETE FROM objetos WHERE id NOT IN (SELECT DISTINCT objeto_id FROM ejemplos)');
      await con.commit();
    } catch (e) {
      await con.rollback();
      throw e;
    } finally {
      con.release();
    }
  }

  // ── Lo que se anota ────────────────────────────────────────────────────────
  // No esperan a la base: encolan y siguen. Lo que falle se informa por alError.
  reconocimiento({ nombre, confianza, origen, color = null }) {
    this._encolar('INSERT INTO reconocimientos (cuando, nombre, confianza, origen, color) VALUES (NOW(3), ?, ?, ?, ?)',
                  [nombre, confianza, origen, color]);
  }

  identificacion(f) {
    this._encolar('INSERT INTO identificaciones (cuando, tipo, marca, modelo, seguridad, respuesta) VALUES (NOW(3), ?, ?, ?, ?, ?)',
                  [f.tipo, f.marca || null, f.modelo || null, f.seguridad, JSON.stringify(f)]);
  }

  medicion({ objeto, distanciaM, velocidadKmh, llegadaS }) {
    const finito = (v) => Number.isFinite(v) ? v : null;
    this._encolar('INSERT INTO mediciones (cuando, objeto, distancia_m, velocidad_kmh, llegada_s, metodo) VALUES (NOW(3), ?, ?, ?, ?, ?)',
                  [objeto, finito(distanciaM), finito(velocidadKmh), finito(llegadaS), 'tamano_aparente']);
  }

  // La misma tarjeta guardada dos veces es una sola fila con el contador en 2.
  tarjeta(t) {
    const huella = createHash('sha256').update(t.contenido).digest('hex');
    this._encolar(
      'INSERT INTO tarjetas_qr (huella, tipo, nombre, lineas, contenido) VALUES (?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE veces = veces + 1, vista = NOW()',
      [huella, t.tipo, t.nombre || null, JSON.stringify(t.lineas), t.contenido]);
  }

  _encolar(sql, valores) {
    this.descartados += encolarAcotado(this.cola, { sql, valores }, TOPE_COLA);
    if (!this.vaciando) { this.vaciando = true; this._vaciar(); }
  }

  async _vaciar() {
    while (this.cola.length) {
      const { sql, valores } = this.cola.shift();
      try { await this.pool.query(sql, valores); }
      catch (e) { this.alError(e); }
    }
    this.vaciando = false;
  }

  // Para apagar: espera a que salga lo encolado.
  async cerrar() {
    while (this.vaciando) await new Promise(r => setTimeout(r, 20));
    await this.pool.end();
  }
}

// Conecta, crea el esquema y devuelve la Base. null si no hay configuración o si
// MySQL no contesta: quien llama sigue sin base.
export async function abrirBase({ host, port, user, password, database }, registrar = console.warn) {
  if (!user || !database) return null;
  let pool;
  try {
    const mysql = (await import('mysql2/promise')).default;
    pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 4, connectTimeout: 4000 });
    const base = new Base(pool);
    await base.crearEsquema();
    return base;
  } catch (e) {
    registrar(`⚠️ sin base de datos (${e.code ?? e.message}): lo aprendido se guarda sólo en estado/. ¿Está prendido el MySQL de XAMPP?`);
    try { await pool?.end(); } catch { /* nunca llegó a abrir */ }
    return null;
  }
}

// Al arrancar: la red personal sale de la base. Si la base está vacía y el archivo
// de estado/ tenía algo (lo aprendido antes de que existiera la base), se sube.
// Devuelve cuántos ejemplos quedaron cargados desde la base, o null si no se usó.
export async function sincronizarRed(base, red) {
  const guardados = await base.cargarEjemplos(red.fuente, red.inDim);
  if (!guardados.length) {
    if (red.clases.length) await base.guardarEjemplos(red);
    return null;
  }
  // La base manda: se vacía lo que traía el archivo y se rearma de los ejemplos.
  for (const nombre of red.clases.slice()) red.olvidar(nombre);
  let n = 0;
  for (const { nombre, vectores } of guardados) for (const v of vectores) if (red.agregarEjemplo(nombre, v)) n++;
  red.entrenar();
  return n;
}
