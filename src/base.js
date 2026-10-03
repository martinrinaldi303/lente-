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
export const SIN_CUENTA = 0;      // el dueño de lo que no tiene cuenta (ver src/cuentas.js)

// Lo que le falta a una base creada antes de las cuentas (2-oct-2026). Cada paso se
// hace sólo si hace falta, así que correrlo dos veces no cambia nada. Lo que había
// queda con usuario_id 0: «sin cuenta». Está acá y no en el .sql porque MySQL 8 no
// entiende «ADD COLUMN IF NOT EXISTS».
const MIGRACIONES = [
  // Entrar con Google (3-oct-2026): la contraseña pasa a ser opcional.
  { tabla: 'usuarios', columna: 'google_sub', sql: 'ALTER TABLE usuarios ADD COLUMN google_sub VARCHAR(64) NULL AFTER clave' },
  { tabla: 'usuarios', indice: 'uq_usuarios_google', sql: 'ALTER TABLE usuarios ADD UNIQUE KEY uq_usuarios_google (google_sub)' },
  { tabla: 'usuarios', nula: 'clave', sql: 'ALTER TABLE usuarios MODIFY clave VARCHAR(255) NULL' },
  { tabla: 'objetos', columna: 'usuario_id', sql: 'ALTER TABLE objetos ADD COLUMN usuario_id INT NOT NULL DEFAULT 0 AFTER id' },
  { tabla: 'objetos', indice: 'uq_objetos_usuario_nombre', sql: 'ALTER TABLE objetos ADD UNIQUE KEY uq_objetos_usuario_nombre (usuario_id, nombre)' },
  { tabla: 'objetos', quitar: 'uq_objetos_nombre', sql: 'ALTER TABLE objetos DROP INDEX uq_objetos_nombre' },
  { tabla: 'tarjetas_qr', columna: 'usuario_id', sql: 'ALTER TABLE tarjetas_qr ADD COLUMN usuario_id INT NOT NULL DEFAULT 0 AFTER id' },
  { tabla: 'tarjetas_qr', indice: 'uq_tarjetas_usuario_huella', sql: 'ALTER TABLE tarjetas_qr ADD UNIQUE KEY uq_tarjetas_usuario_huella (usuario_id, huella)' },
  { tabla: 'tarjetas_qr', quitar: 'uq_tarjetas_huella', sql: 'ALTER TABLE tarjetas_qr DROP INDEX uq_tarjetas_huella' },
  ...['reconocimientos', 'identificaciones', 'mediciones'].flatMap(t => [
    { tabla: t, columna: 'usuario_id', sql: `ALTER TABLE ${t} ADD COLUMN usuario_id INT NOT NULL DEFAULT 0 AFTER id` },
    { tabla: t, columna: 'anteojos_id', sql: `ALTER TABLE ${t} ADD COLUMN anteojos_id INT NULL AFTER usuario_id` },
    { tabla: t, indice: `ix_${t}_usuario`, sql: `ALTER TABLE ${t} ADD KEY ix_${t}_usuario (usuario_id, cuando)` },
  ]),
];

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
    await this.migrar();
  }

  // Devuelve cuántos pasos de MIGRACIONES hizo (0 si la base ya estaba al día).
  async migrar() {
    const existe = async (sql, valores) => (await this.pool.query(sql, valores))[0].length > 0;
    const columna = (t, c) => existe('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]);
    const indice = (t, i) => existe('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [t, i]);
    const aceptaNull = (t, c) => existe("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND IS_NULLABLE = 'YES'", [t, c]);
    let hechos = 0;
    for (const m of MIGRACIONES) {
      if (m.columna && await columna(m.tabla, m.columna)) continue;
      if (m.nula && await aceptaNull(m.tabla, m.nula)) continue;
      if (m.indice && await indice(m.tabla, m.indice)) continue;
      if (m.quitar && !(await indice(m.tabla, m.quitar))) continue;
      await this.pool.query(m.sql);
      hechos++;
    }
    // Hasta el 3-oct-2026 se anotaba el color de las personas: el de su piel o su ropa.
    // No se guarda más (ver reconocimiento), y lo que quedó se borra.
    const [borrados] = await this.pool.query("UPDATE reconocimientos SET color = NULL WHERE nombre = 'persona' AND color IS NOT NULL");
    if (borrados.affectedRows) hechos++;
    return hechos;
  }

  // ── El aprendizaje ─────────────────────────────────────────────────────────
  // Los ejemplos de ese extractor y de ese usuario, agrupados: [{ nombre, vectores: [[...], ...] }].
  async cargarEjemplos(fuente, dim, usuarioId = SIN_CUENTA) {
    const [filas] = await this.pool.query(
      'SELECT o.nombre, e.vector FROM ejemplos e JOIN objetos o ON o.id = e.objeto_id WHERE e.fuente = ? AND e.dim = ? AND o.usuario_id = ? ORDER BY o.id, e.id',
      [fuente, dim, usuarioId]);
    const porNombre = new Map();
    for (const f of filas) {
      if (f.vector.length !== dim * 4) continue;        // un vector cortado no entra a la red
      if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, []);
      porNombre.get(f.nombre).push(blobAVector(f.vector));
    }
    return [...porNombre].map(([nombre, vectores]) => ({ nombre, vectores }));
  }

  // Deja en la base EXACTAMENTE lo que la red de ese usuario tiene en memoria para ese
  // extractor. Lo de los demás usuarios no se toca. Todo o nada: si falla a la mitad,
  // queda lo que había.
  async guardarEjemplos(red, usuarioId = SIN_CUENTA) {
    const con = await this.pool.getConnection();
    try {
      await con.beginTransaction();
      await con.query('DELETE e FROM ejemplos e JOIN objetos o ON o.id = e.objeto_id WHERE e.fuente = ? AND e.dim = ? AND o.usuario_id = ?',
                      [red.fuente, red.inDim, usuarioId]);
      for (const [c, nombre] of red.clases.entries()) {
        await con.query('INSERT IGNORE INTO objetos (usuario_id, nombre) VALUES (?, ?)', [usuarioId, nombre]);
        const [[{ id }]] = await con.query('SELECT id FROM objetos WHERE usuario_id = ? AND nombre = ?', [usuarioId, nombre]);
        const filas = red.memoria[c].map(v => [id, red.fuente, red.inDim, vectorABlob(v)]);
        if (filas.length) await con.query('INSERT INTO ejemplos (objeto_id, fuente, dim, vector) VALUES ?', [filas]);
      }
      // Un objeto que se olvidó no deja su nombre suelto.
      await con.query('DELETE FROM objetos WHERE usuario_id = ? AND id NOT IN (SELECT DISTINCT objeto_id FROM ejemplos)', [usuarioId]);
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
  // `ctx` dice de quién es: { usuarioId, anteojosId }. Sin ctx, «sin cuenta».
  // De una persona no se guarda el color, venga de donde venga.
  reconocimiento({ nombre, confianza, origen, color = null }, ctx = {}) {
    this._encolar('INSERT INTO reconocimientos (usuario_id, anteojos_id, cuando, nombre, confianza, origen, color) VALUES (?, ?, NOW(3), ?, ?, ?, ?)',
                  [...dueno(ctx), nombre, confianza, origen, nombre === 'persona' ? null : color]);
  }

  identificacion(f, ctx = {}) {
    this._encolar('INSERT INTO identificaciones (usuario_id, anteojos_id, cuando, tipo, marca, modelo, seguridad, respuesta) VALUES (?, ?, NOW(3), ?, ?, ?, ?, ?)',
                  [...dueno(ctx), f.tipo, f.marca || null, f.modelo || null, f.seguridad, JSON.stringify(f)]);
  }

  medicion({ objeto, distanciaM, velocidadKmh, llegadaS }, ctx = {}) {
    const finito = (v) => Number.isFinite(v) ? v : null;
    this._encolar('INSERT INTO mediciones (usuario_id, anteojos_id, cuando, objeto, distancia_m, velocidad_kmh, llegada_s, metodo) VALUES (?, ?, NOW(3), ?, ?, ?, ?, ?)',
                  [...dueno(ctx), objeto, finito(distanciaM), finito(velocidadKmh), finito(llegadaS), 'tamano_aparente']);
  }

  // La misma tarjeta guardada dos veces es una sola fila con el contador en 2.
  tarjeta(t, ctx = {}) {
    const huella = createHash('sha256').update(t.contenido).digest('hex');
    this._encolar(
      'INSERT INTO tarjetas_qr (usuario_id, huella, tipo, nombre, lineas, contenido) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE veces = veces + 1, vista = NOW()',
      [dueno(ctx)[0], huella, t.tipo, t.nombre || null, JSON.stringify(t.lineas), t.contenido]);
  }

  // Lo mismo, ya atado a un dueño: es lo que recibe cada sesión de gafas como `registro`.
  para(ctx = {}) {
    return {
      reconocimiento: (d) => this.reconocimiento(d, ctx),
      identificacion: (f) => this.identificacion(f, ctx),
      medicion: (m) => this.medicion(m, ctx),
      tarjeta: (t) => this.tarjeta(t, ctx),
    };
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

const dueno = ({ usuarioId = SIN_CUENTA, anteojosId = null } = {}) => [usuarioId, anteojosId];

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
