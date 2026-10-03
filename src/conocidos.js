// conocidos.js — las caras que cada persona cargó de SÍ MISMA, y a quién le dio permiso
// para que la reconozca. Ver la cabecera de src/caras.js: por qué es así y no «guardá
// a esta persona».
//
//   GET    /api/conocidos                 tu cara (cuántas fotos, de qué poses), a quién
//                                          le diste permiso, y quiénes te lo dieron a vos
//   POST   /api/conocidos/foto            { imagen: JPEG en base64 } una foto TUYA, de la
//                                          cámara de la PC, con la sesión abierta
//   DELETE /api/conocidos/cara            borra tu cara y todos los permisos que diste
//   POST   /api/conocidos/permisos        { correo } que esa cuenta te pueda reconocer
//   DELETE /api/conocidos/permisos/:id    que esa cuenta ya no te reconozca
//   DELETE /api/conocidos/reconocer/:id   dejar de reconocer a alguien que te dio permiso

import express from 'express';
import jpeg from 'jpeg-js';
import { ErrorDeCuenta, leerCookie } from './cuentas.js';
import { CONFIANZA_CARA, poseDe } from './caras.js';

export const POSES = ['frente', 'izquierda', 'derecha'];
const MAX_POR_POSE = 3;                 // 9 fotos como mucho
const LADO_MINIMO_FOTO = 80;            // px de cara en la foto de la PC: más chica no sirve para cargar
const MAX_JPEG = 600 * 1024;

const aBlob = (v) => Buffer.from(Float32Array.from(v).buffer);
const aVector = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export class Conocidos {
  constructor(pool) { this.pool = pool; }

  async resumenDe(usuarioId) {
    const [filas] = await this.pool.query('SELECT pose, COUNT(*) AS n FROM rostros WHERE usuario_id = ? GROUP BY pose', [usuarioId]);
    const poses = Object.fromEntries(POSES.map(p => [p, 0]));
    for (const f of filas) poses[f.pose] = Number(f.n);
    const [permisos] = await this.pool.query(
      'SELECT u.id, u.nombre, u.correo, p.creado AS desde FROM permisos_rostro p JOIN usuarios u ON u.id = p.lector_id WHERE p.dueno_id = ? ORDER BY p.creado', [usuarioId]);
    const [conocidos] = await this.pool.query(
      'SELECT u.id, u.nombre, p.creado AS desde FROM permisos_rostro p JOIN usuarios u ON u.id = p.dueno_id WHERE p.lector_id = ? ORDER BY u.nombre', [usuarioId]);
    return { poses, total: Object.values(poses).reduce((a, b) => a + b, 0), completa: POSES.every(p => poses[p] > 0), permisos, conocidos };
  }

  async agregarPlantilla(usuarioId, vector, pose) {
    if (!POSES.includes(pose)) throw new ErrorDeCuenta('Pose desconocida');
    const [[{ n }]] = await this.pool.query('SELECT COUNT(*) AS n FROM rostros WHERE usuario_id = ? AND pose = ?', [usuarioId, pose]);
    if (Number(n) >= MAX_POR_POSE) throw new ErrorDeCuenta(`Ya hay ${MAX_POR_POSE} fotos ${pose === 'frente' ? 'de frente' : 'de ese costado'}: probá con otra pose`, 409);
    await this.pool.query('INSERT INTO rostros (usuario_id, vector, pose) VALUES (?, ?, ?)', [usuarioId, aBlob(vector), pose]);
  }

  // Borra la cara y todos los permisos que dio. Devuelve a quiénes se los había dado.
  async borrarCara(usuarioId) {
    const [lectores] = await this.pool.query('SELECT lector_id FROM permisos_rostro WHERE dueno_id = ?', [usuarioId]);
    await this.pool.query('DELETE FROM permisos_rostro WHERE dueno_id = ?', [usuarioId]);
    await this.pool.query('DELETE FROM rostros WHERE usuario_id = ?', [usuarioId]);
    return lectores.map(l => l.lector_id);
  }

  async darPermiso(duenoId, correo) {
    const r = await this.resumenDe(duenoId);
    if (!r.completa) throw new ErrorDeCuenta('Primero cargá tu cara: de frente y de los dos costados');
    const [[lector]] = await this.pool.query('SELECT id, nombre FROM usuarios WHERE correo = ?', [String(correo ?? '').trim().toLowerCase().slice(0, 120)]);
    if (!lector) throw new ErrorDeCuenta('No hay ninguna cuenta con ese correo', 404);
    if (lector.id === duenoId) throw new ErrorDeCuenta('Ése es tu propio correo');
    await this.pool.query('INSERT IGNORE INTO permisos_rostro (dueno_id, lector_id) VALUES (?, ?)', [duenoId, lector.id]);
    return lector;
  }

  async quitarPermiso(duenoId, lectorId) {
    const [r] = await this.pool.query('DELETE FROM permisos_rostro WHERE dueno_id = ? AND lector_id = ?', [duenoId, lectorId]);
    return r.affectedRows > 0;
  }

  // Lo que necesitan las gafas de una cuenta: las caras de quienes le dieron permiso.
  // [{ id, nombre, plantillas: [Float32Array] }]
  async deLector(lectorId) {
    if (!lectorId) return [];
    const [filas] = await this.pool.query(
      `SELECT u.id, u.nombre, r.vector FROM permisos_rostro p
         JOIN usuarios u ON u.id = p.dueno_id JOIN rostros r ON r.usuario_id = p.dueno_id
        WHERE p.lector_id = ? ORDER BY u.id, r.id`, [lectorId]);
    const porId = new Map();
    for (const f of filas) {
      if (!porId.has(f.id)) porId.set(f.id, { id: f.id, nombre: f.nombre, plantillas: [] });
      porId.get(f.id).plantillas.push(aVector(f.vector));
    }
    return [...porId.values()];
  }
}

// La foto que manda la página, decodificada. Acepta «data:image/jpeg;base64,…» o el base64 solo.
export function decodificarFoto(texto) {
  const b64 = String(texto ?? '').replace(/^data:image\/jpeg;base64,/, '');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length || bytes.length > MAX_JPEG) throw new ErrorDeCuenta('La foto no llegó bien');
  try { return jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 }); }
  catch { throw new ErrorDeCuenta('La foto no es un JPEG'); }
}

// `alCambiar(lectores)`: las cuentas cuyas gafas tienen que recargar a sus conocidos.
export function rutasDeConocidos({ cuentas, conocidos, caras, alCambiar = () => {} }) {
  const r = express.Router();
  r.use('/conocidos', express.json({ limit: '1mb' }));
  const responder = (res, estado, cuerpo) => res.status(estado).json(cuerpo);
  // Lo que cambia algo: de esta misma página y en JSON (como las rutas de la cuenta).
  r.use('/conocidos', (req, res, next) => {
    if (req.method === 'GET') return next();
    let ok = true;
    if (req.headers.origin) { try { ok = new URL(req.headers.origin).host === req.headers.host; } catch { ok = false; } }
    if (!ok) return responder(res, 403, { motivo: 'Pedido de otra página' });
    if (req.method === 'POST' && !req.is('application/json')) return responder(res, 415, { motivo: 'Tiene que ser JSON' });
    next();
  });
  const conUsuario = (fn) => async (req, res) => {
    try {
      if (!cuentas || !conocidos) return responder(res, 503, { motivo: 'La base de datos está apagada: prendé MySQL en XAMPP' });
      const usuario = await cuentas.usuarioDeSesion(leerCookie(req.headers.cookie));
      if (!usuario) return responder(res, 401, { motivo: 'Tenés que entrar con tu cuenta' });
      await fn(req, res, usuario);
    } catch (e) {
      if (e instanceof ErrorDeCuenta) return responder(res, e.estado, { motivo: e.message });
      console.warn(`⚠️ conocidos: ${e.message}`);
      responder(res, 500, { motivo: 'Algo falló del lado del cerebro' });
    }
  };
  const resumen = async (res, usuario, extra = {}) => responder(res, 200, { ...(await conocidos.resumenDe(usuario.id)), disponible: Boolean(caras), ...extra });

  r.get('/conocidos', conUsuario((req, res, usuario) => resumen(res, usuario)));

  r.post('/conocidos/foto', conUsuario(async (req, res, usuario) => {
    if (!caras) return responder(res, 503, { motivo: 'Faltan los modelos de caras en modelos/caras' });
    const img = decodificarFoto(req.body?.imagen);
    const encontradas = (await caras.detectar(img, { umbral: CONFIANZA_CARA })).filter(c => c.confianza >= 0.9);
    if (!encontradas.length) throw new ErrorDeCuenta('No veo ninguna cara: acercate y mirá a la cámara', 422);
    if (encontradas.length > 1) throw new ErrorDeCuenta('Veo más de una cara: que quede sólo la tuya', 422);
    const [cara] = encontradas;
    if (Math.min(cara.caja.ancho, cara.caja.alto) < LADO_MINIMO_FOTO) throw new ErrorDeCuenta('La cara se ve chica: acercate a la cámara', 422);
    const pose = poseDe(cara.puntos);
    await conocidos.agregarPlantilla(usuario.id, await caras.plantilla(img, cara), pose);
    const r2 = await conocidos.resumenDe(usuario.id);
    // Las gafas de quienes ya tenían permiso suman la foto nueva.
    if (r2.permisos.length) await alCambiar(r2.permisos.map(p => p.id));
    responder(res, 200, { ...r2, disponible: true, pose });
  }));

  r.delete('/conocidos/cara', conUsuario(async (req, res, usuario) => {
    await alCambiar(await conocidos.borrarCara(usuario.id));
    await resumen(res, usuario);
  }));

  r.post('/conocidos/permisos', conUsuario(async (req, res, usuario) => {
    const lector = await conocidos.darPermiso(usuario.id, req.body?.correo);
    await alCambiar([lector.id]);
    await resumen(res, usuario, { agregado: lector.nombre });
  }));

  r.delete('/conocidos/permisos/:id', conUsuario(async (req, res, usuario) => {
    const lector = Number(req.params.id);
    await conocidos.quitarPermiso(usuario.id, lector);
    await alCambiar([lector]);
    await resumen(res, usuario);
  }));

  r.delete('/conocidos/reconocer/:id', conUsuario(async (req, res, usuario) => {
    await conocidos.quitarPermiso(Number(req.params.id), usuario.id);
    await alCambiar([usuario.id]);
    await resumen(res, usuario);
  }));
  return r;
}
