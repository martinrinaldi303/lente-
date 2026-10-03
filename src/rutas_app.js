// rutas_app.js — lo que las pantallas del panel le piden al cerebro, además de la
// cuenta (src/cuentas.js): el historial de lo que vieron tus anteojos y la memoria de
// objetos («¿dónde dejé…?»). Todo es de la cuenta que tiene la sesión abierta: nadie ve
// el historial de otro.
//
//   GET    /api/historial?periodo=hora|hoy|todo&min=0.9&q=celular&pagina=1
//   GET    /api/historial/resumen
//   DELETE /api/historial               borra TU historial (no lo aprendido)
//   GET    /api/objetos                 lo que la memoria vio, del más reciente al más viejo
//   GET    /api/objetos/donde?nombre=…  «¿dónde dejé…?»
//   DELETE /api/objetos                 vacía TU memoria de objetos

import express from 'express';
import { ErrorDeCuenta, leerCookie } from './cuentas.js';

const POR_PAGINA = 25;
const PERIODOS = { hora: 'ev.cuando >= NOW() - INTERVAL 1 HOUR', hoy: 'ev.cuando >= CURDATE()', todo: '1 = 1' };

// Las tres tablas de lo anotado, con las mismas columnas, para listarlas juntas.
const EVENTOS = `
  SELECT 'reconocimiento' AS tipo, id, usuario_id, anteojos_id, cuando, nombre, confianza, origen, color,
         NULL AS marca, NULL AS modelo, NULL AS seguridad, NULL AS distancia_m, NULL AS velocidad_kmh, NULL AS llegada_s
    FROM reconocimientos
  UNION ALL
  SELECT 'identificacion', id, usuario_id, anteojos_id, cuando, tipo, NULL, NULL, NULL, marca, modelo, seguridad, NULL, NULL, NULL
    FROM identificaciones
  UNION ALL
  SELECT 'medicion', id, usuario_id, anteojos_id, cuando, objeto, NULL, NULL, NULL, NULL, NULL, NULL, distancia_m, velocidad_kmh, llegada_s
    FROM mediciones`;

// Arma el WHERE de los filtros, siempre con el usuario primero.
export function filtrosDeHistorial({ periodo = 'todo', min, q } = {}, usuarioId) {
  const donde = ['ev.usuario_id = ?', PERIODOS[periodo] ?? PERIODOS.todo];
  const valores = [usuarioId];
  const minimo = Number(min);
  if (Number.isFinite(minimo) && minimo > 0) { donde.push('(ev.confianza IS NULL OR ev.confianza >= ?)'); valores.push(Math.min(1, minimo)); }
  const texto = String(q ?? '').trim().slice(0, 40);
  if (texto) { donde.push('ev.nombre LIKE ?'); valores.push(`%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  return { donde: donde.join(' AND '), valores };
}

export function rutasDeApp({ cuentas, memoriaDe }) {
  const r = express.Router();
  const responder = (res, estado, cuerpo) => res.status(estado).json(cuerpo);

  // Mismas reglas que las rutas de la cuenta: borrar exige JSON y la misma página.
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const origen = req.headers.origin;
    if (origen) {
      let ok = false;
      try { ok = new URL(origen).host === req.headers.host; } catch { /* queda en false */ }
      if (!ok) return responder(res, 403, { motivo: 'Pedido de otra página' });
    }
    next();
  });

  const conUsuario = (fn) => async (req, res) => {
    try {
      if (!cuentas) return responder(res, 503, { motivo: 'La base de datos está apagada: prendé MySQL en XAMPP' });
      const usuario = await cuentas.usuarioDeSesion(leerCookie(req.headers.cookie));
      if (!usuario) return responder(res, 401, { motivo: 'Tenés que entrar con tu cuenta' });
      await fn(req, res, usuario);
    } catch (e) {
      if (e instanceof ErrorDeCuenta) return responder(res, e.estado, { motivo: e.message });
      console.warn(`⚠️ panel: ${e.message}`);
      responder(res, 500, { motivo: 'Algo falló del lado del cerebro' });
    }
  };

  r.get('/historial', conUsuario(async (req, res, usuario) => {
    const { donde, valores } = filtrosDeHistorial(req.query, usuario.id);
    const pagina = Math.max(1, Math.min(10000, Number(req.query.pagina) || 1));
    const [[{ total }]] = await cuentas.pool.query(`SELECT COUNT(*) AS total FROM (${EVENTOS}) ev WHERE ${donde}`, valores);
    const [filas] = await cuentas.pool.query(
      `SELECT ev.*, a.nombre AS anteojos FROM (${EVENTOS}) ev LEFT JOIN anteojos a ON a.id = ev.anteojos_id
        WHERE ${donde} ORDER BY ev.cuando DESC, ev.id DESC LIMIT ? OFFSET ?`,
      [...valores, POR_PAGINA, (pagina - 1) * POR_PAGINA]);
    const eventos = filas.map(({ usuario_id, anteojos_id, ...f }) => ({
      ...f, confianza: f.confianza === null ? null : Number(Number(f.confianza).toFixed(3)),
    }));
    responder(res, 200, { eventos, total: Number(total), pagina, por_pagina: POR_PAGINA });
  }));

  r.get('/historial/resumen', conUsuario(async (req, res, usuario) => {
    const [[hoy]] = await cuentas.pool.query(
      `SELECT COUNT(*) AS eventos, COUNT(DISTINCT CASE WHEN tipo = 'reconocimiento' THEN nombre END) AS objetos,
              SUM(tipo = 'identificacion') AS identificaciones, SUM(tipo = 'medicion') AS mediciones
         FROM (${EVENTOS}) ev WHERE ev.usuario_id = ? AND ev.cuando >= CURDATE()`, [usuario.id]);
    const [[todo]] = await cuentas.pool.query(`SELECT COUNT(*) AS eventos, MIN(cuando) AS desde FROM (${EVENTOS}) ev WHERE ev.usuario_id = ?`, [usuario.id]);
    const n = (v) => Number(v ?? 0);
    responder(res, 200, {
      hoy: { eventos: n(hoy.eventos), objetos: n(hoy.objetos), identificaciones: n(hoy.identificaciones), mediciones: n(hoy.mediciones) },
      todo: { eventos: n(todo.eventos), desde: todo.desde },
    });
  }));

  r.delete('/historial', conUsuario(async (req, res, usuario) => {
    let borrados = 0;
    for (const tabla of ['reconocimientos', 'identificaciones', 'mediciones']) {
      const [x] = await cuentas.pool.query(`DELETE FROM ${tabla} WHERE usuario_id = ?`, [usuario.id]);
      borrados += x.affectedRows;
    }
    responder(res, 200, { borrados });
  }));

  r.get('/objetos', conUsuario(async (req, res, usuario) => {
    const m = memoriaDe(usuario.id);
    responder(res, 200, { objetos: m.recientes(200), lugar: m.lugarActual() });
  }));

  r.get('/objetos/donde', conUsuario(async (req, res, usuario) => {
    responder(res, 200, memoriaDe(usuario.id).dondeEsta(String(req.query.nombre ?? '').slice(0, 40)));
  }));

  r.delete('/objetos', conUsuario(async (req, res, usuario) => {
    memoriaDe(usuario.id).vaciar();
    responder(res, 200, { ok: true });
  }));

  return r;
}
