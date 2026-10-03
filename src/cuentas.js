// cuentas.js — usuarios, sesiones del panel web y anteojos vinculados.
//
// Tres cosas que se asocian en la base:
//   usuario  → quién es: nombre, correo, contraseña y, si quiere, su edad. Son datos
//              de la persona SOBRE SÍ MISMA; nadie carga datos de otro.
//   anteojos → cada par que el usuario vinculó, con su modelo de hardware y una llave
//              propia (token) para conectarse al cerebro.
//   lo aprendido → los objetos que el usuario le enseñó (tablas objetos y ejemplos, con
//              su usuario_id). Cualquiera de sus anteojos los usa; los de otro usuario, no.
//
// Lo que había antes de las cuentas queda como «sin cuenta» (usuario_id 0) y sigue
// andando igual: el emulador sin sesión y unas gafas con el TOKEN_GAFAS del .env.
//
// Seguridad, en corto:
//   · La contraseña se guarda con scrypt y sal propia. Nunca en texto.
//   · La sesión del panel es una cookie HttpOnly y SameSite=Strict; en la base queda
//     sólo la huella (sha256) del token. Lo mismo con la llave de cada anteojo: se
//     muestra UNA vez al crearla y después no se puede volver a leer, sólo cambiar.
//   · Los pedidos que cambian algo exigen JSON y, si el navegador manda Origin, que sea
//     esta misma página: un formulario de otro sitio no puede usar la cookie.
//   · Entrar y crear cuenta tienen un tope de intentos por dirección.
//
// También se puede entrar con Google (src/google.js verifica la constancia). Una cuenta
// de Google NO se pega sola a una cuenta con contraseña del mismo correo: el correo de
// las cuentas con contraseña nunca se verificó, y alguien podría crear antes una cuenta
// con el correo de otro y quedársela cuando el dueño entre con Google. Para unirlas,
// se entra con la contraseña y se vincula Google desde el panel.

import express from 'express';
import { createHash, randomBytes, scrypt as scryptConCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptConCallback);

export const SIN_CUENTA = 0;
export const COOKIE = 'gafas_sesion';
const DIAS_DE_SESION = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 64 };
const CLAVE_MINIMA = 8;
const MODELOS = ['XIAO ESP32-S3 Sense', 'Emulador del navegador', 'Otro'];
const EMULADOR = 'Emulador del navegador';

// ── Piezas sueltas (se prueban sin base) ─────────────────────────────────────

export async function cifrarClave(clave) {
  const sal = randomBytes(16);
  const h = await scrypt(String(clave), sal, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function claveCorrecta(clave, guardada) {
  const [tipo, N, r, p, sal, h] = String(guardada ?? '').split('$');
  if (tipo !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const calculado = await scrypt(String(clave ?? ''), Buffer.from(sal, 'base64'), esperado.length, { N: Number(N), r: Number(r), p: Number(p) });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

export const huella = (token) => createHash('sha256').update(String(token)).digest('hex');
// La llave de un anteojo: letras, números, «-» y «_», como la pide el firmware.
export const tokenNuevo = (prefijo = '') => prefijo + randomBytes(24).toString('base64url');

const texto = (v, largo) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);

// Lo que se puede guardar de una persona, validado. { ok:false, motivo } si algo no va.
export function validarPerfil({ nombre, edad } = {}, { parcial = false } = {}) {
  const datos = {};
  if (nombre !== undefined || !parcial) {
    datos.nombre = texto(nombre, 60);
    if (!datos.nombre) return { ok: false, motivo: 'Falta el nombre' };
  }
  if (edad !== undefined && edad !== null && edad !== '') {
    const n = Number(edad);
    if (!Number.isInteger(n) || n < 1 || n > 120) return { ok: false, motivo: 'La edad tiene que ser un número entre 1 y 120' };
    datos.edad = n;
  } else if (edad === '' || edad === null) {
    datos.edad = null;
  }
  return { ok: true, datos };
}

export function validarRegistro({ nombre, correo, clave, edad } = {}) {
  const perfil = validarPerfil({ nombre, edad });
  if (!perfil.ok) return perfil;
  const c = texto(correo, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { ok: false, motivo: 'El correo no parece válido' };
  const v = validarClave(clave);
  if (!v.ok) return v;
  return { ok: true, datos: { ...perfil.datos, correo: c, clave: String(clave) } };
}

export function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < CLAVE_MINIMA) return { ok: false, motivo: `La contraseña tiene que tener ${CLAVE_MINIMA} caracteres o más` };
  if (clave.length > 200) return { ok: false, motivo: 'La contraseña es demasiado larga' };
  return { ok: true };
}

export function leerCookie(cabecera, nombre = COOKIE) {
  for (const parte of String(cabecera ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

// Tope de intentos por clave (una dirección IP): `maximo` en `ventanaMs`.
export class Limitador {
  constructor({ maximo = 10, ventanaMs = 15 * 60 * 1000, reloj = Date.now } = {}) {
    this.maximo = maximo; this.ventanaMs = ventanaMs; this.reloj = reloj;
    this.intentos = new Map();
  }
  permitido(clave) {
    const ahora = this.reloj(), lista = (this.intentos.get(clave) ?? []).filter(t => ahora - t < this.ventanaMs);
    this.intentos.set(clave, lista);
    return lista.length < this.maximo;
  }
  anotar(clave) { this.intentos.set(clave, [...(this.intentos.get(clave) ?? []), this.reloj()]); }
  limpiar(clave) { this.intentos.delete(clave); }
}

export class ErrorDeCuenta extends Error {
  constructor(motivo, estado = 400) { super(motivo); this.estado = estado; }
}

// ── Lo que vive en la base ───────────────────────────────────────────────────

const publico = (u) => u && {
  id: u.id, nombre: u.nombre, correo: u.correo, edad: u.edad ?? null, creado: u.creado,
  con_google: Boolean(u.con_google ?? u.google_sub), con_clave: Boolean(u.con_clave ?? u.clave),
};
const COLUMNAS = 'u.id, u.nombre, u.correo, u.edad, u.creado, (u.google_sub IS NOT NULL) AS con_google, (u.clave IS NOT NULL) AS con_clave';
const anteojoPublico = (a) => a && { id: a.id, nombre: a.nombre, modelo: a.modelo, con_llave: Boolean(a.huella_token), creado: a.creado, ultima_conexion: a.ultima_conexion };

export class Cuentas {
  // `pool` es el de mysql2/promise que ya abrió base.js (o uno de mentira para probar).
  constructor(pool, { reloj = Date.now } = {}) {
    this.pool = pool;
    this.reloj = reloj;
  }

  async crearUsuario(datos) {
    const clave = await cifrarClave(datos.clave);
    try {
      const [r] = await this.pool.query('INSERT INTO usuarios (nombre, correo, clave, edad) VALUES (?, ?, ?, ?)',
                                        [datos.nombre, datos.correo, clave, datos.edad ?? null]);
      return this.usuario(r.insertId);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new ErrorDeCuenta('Ya hay una cuenta con ese correo', 409);
      throw e;
    }
  }

  async usuario(id) {
    const [[u]] = await this.pool.query(`SELECT ${COLUMNAS} FROM usuarios u WHERE u.id = ?`, [id]);
    return publico(u) ?? null;
  }

  // El usuario si el correo y la contraseña coinciden; null si no (sin decir cuál falló).
  async entrar(correo, clave) {
    const [[u]] = await this.pool.query('SELECT * FROM usuarios WHERE correo = ?', [texto(correo, 120).toLowerCase()]);
    // Sin usuario se calcula igual un scrypt: así no se nota por el tiempo si el correo existe.
    const ok = await claveCorrecta(clave, u?.clave ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return u && ok ? publico(u) : null;
  }

  async abrirSesion(usuarioId) {
    const token = tokenNuevo();
    const vence = new Date(this.reloj() + DIAS_DE_SESION * 86400000);
    await this.pool.query('DELETE FROM sesiones_web WHERE vence < NOW()');
    await this.pool.query('INSERT INTO sesiones_web (huella, usuario_id, vence) VALUES (?, ?, ?)', [huella(token), usuarioId, vence]);
    return token;
  }

  async usuarioDeSesion(token) {
    if (!token) return null;
    const [[u]] = await this.pool.query(
      `SELECT ${COLUMNAS} FROM sesiones_web s JOIN usuarios u ON u.id = s.usuario_id WHERE s.huella = ? AND s.vence > NOW()`,
      [huella(token)]);
    return publico(u) ?? null;
  }

  async cerrarSesion(token) {
    if (token) await this.pool.query('DELETE FROM sesiones_web WHERE huella = ?', [huella(token)]);
  }

  async actualizarPerfil(id, datos) {
    const campos = Object.keys(datos).filter(k => ['nombre', 'edad'].includes(k));
    if (campos.length) await this.pool.query(`UPDATE usuarios SET ${campos.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...campos.map(c => datos[c]), id]);
    return this.usuario(id);
  }

  async _claveDe(id) {
    const [[u]] = await this.pool.query('SELECT clave FROM usuarios WHERE id = ?', [id]);
    return u?.clave;
  }

  // Una cuenta creada con Google no tiene contraseña: la primera se pone sin «actual».
  async cambiarClave(id, actual, nueva) {
    const guardada = await this._claveDe(id);
    if (guardada && !(await claveCorrecta(actual, guardada))) throw new ErrorDeCuenta('La contraseña actual no es esa', 403);
    const v = validarClave(nueva);
    if (!v.ok) throw new ErrorDeCuenta(v.motivo);
    await this.pool.query('UPDATE usuarios SET clave = ? WHERE id = ?', [await cifrarClave(nueva), id]);
    // Las otras sesiones abiertas se cierran: si alguien sabía la contraseña vieja, queda afuera.
    await this.pool.query('DELETE FROM sesiones_web WHERE usuario_id = ?', [id]);
  }

  // Borra la cuenta y TODO lo suyo: anteojos, sesiones, lo aprendido y lo anotado. Se
  // confirma con la contraseña; una cuenta de Google sin contraseña, escribiendo su correo.
  async borrarUsuario(id, clave) {
    const guardada = await this._claveDe(id);
    if (guardada) {
      if (!(await claveCorrecta(clave, guardada))) throw new ErrorDeCuenta('La contraseña no es esa', 403);
    } else if (texto(clave, 120).toLowerCase() !== (await this.usuario(id))?.correo) {
      throw new ErrorDeCuenta('Para confirmar, escribí tu correo tal cual', 403);
    }
    const con = await this.pool.getConnection();
    try {
      await con.beginTransaction();
      for (const tabla of ['reconocimientos', 'identificaciones', 'mediciones', 'tarjetas_qr', 'objetos', 'correcciones'])
        await con.query(`DELETE FROM ${tabla} WHERE usuario_id = ?`, [id]);     // los ejemplos caen con sus objetos
      await con.query('DELETE FROM usuarios WHERE id = ?', [id]);                // anteojos y sesiones caen solos
      await con.commit();
    } catch (e) { await con.rollback(); throw e; }
    finally { con.release(); }
  }

  // ── Google ──────────────────────────────────────────────────────────────────
  // Entrar con lo que verificó src/google.js: { sub, correo, nombre }. Devuelve
  // { usuario, creado }. `puedeCrear` es la misma regla que crear cuenta con contraseña.
  async entrarConGoogle({ sub, correo, nombre }, { puedeCrear = true } = {}) {
    const [[conGoogle]] = await this.pool.query('SELECT id FROM usuarios WHERE google_sub = ?', [sub]);
    if (conGoogle) return { usuario: await this.usuario(conGoogle.id), creado: false };
    const [[mismoCorreo]] = await this.pool.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    if (mismoCorreo) throw new ErrorDeCuenta('Ya hay una cuenta con ese correo. Entrá con tu contraseña y vinculá Google desde «Mi perfil»', 409);
    if (!puedeCrear) throw new ErrorDeCuenta('Las cuentas se crean desde la computadora donde corre el cerebro (o con REGISTRO=abierto en .env)', 403);
    const n = texto(nombre, 60) || correo.split('@')[0].slice(0, 60);
    try {
      const [r] = await this.pool.query('INSERT INTO usuarios (nombre, correo, clave, google_sub) VALUES (?, ?, NULL, ?)', [n, correo, sub]);
      return { usuario: await this.usuario(r.insertId), creado: true };
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new ErrorDeCuenta('Ya hay una cuenta con ese correo o esa cuenta de Google', 409);
      throw e;
    }
  }

  // Une la cuenta de Google a la cuenta que ya tiene la sesión abierta.
  async vincularGoogle(usuarioId, { sub }) {
    const [[otro]] = await this.pool.query('SELECT id FROM usuarios WHERE google_sub = ? AND id <> ?', [sub, usuarioId]);
    if (otro) throw new ErrorDeCuenta('Esa cuenta de Google ya está unida a otra cuenta', 409);
    await this.pool.query('UPDATE usuarios SET google_sub = ? WHERE id = ?', [sub, usuarioId]);
    return this.usuario(usuarioId);
  }

  async desvincularGoogle(usuarioId) {
    if (!(await this._claveDe(usuarioId))) throw new ErrorDeCuenta('Primero poné una contraseña: si no, te quedás sin forma de entrar', 409);
    await this.pool.query('UPDATE usuarios SET google_sub = NULL WHERE id = ?', [usuarioId]);
    return this.usuario(usuarioId);
  }

  // ── Anteojos ────────────────────────────────────────────────────────────────
  async anteojosDe(usuarioId) {
    const [filas] = await this.pool.query('SELECT * FROM anteojos WHERE usuario_id = ? ORDER BY id', [usuarioId]);
    return filas.map(anteojoPublico);
  }

  // Devuelve el par nuevo y su llave, que se muestra esta vez y nunca más.
  async crearAnteojos(usuarioId, { nombre, modelo }) {
    const n = texto(nombre, 40) || 'Mis anteojos';
    const m = MODELOS.includes(modelo) ? modelo : texto(modelo, 60) || MODELOS[0];
    const token = m === EMULADOR ? null : tokenNuevo('gaf_');
    const [r] = await this.pool.query('INSERT INTO anteojos (usuario_id, nombre, modelo, huella_token) VALUES (?, ?, ?, ?)',
                                      [usuarioId, n, m, token ? huella(token) : null]);
    const [[a]] = await this.pool.query('SELECT * FROM anteojos WHERE id = ?', [r.insertId]);
    return { anteojos: anteojoPublico(a), token };
  }

  async nuevaLlave(usuarioId, anteojosId) {
    const token = tokenNuevo('gaf_');
    const [r] = await this.pool.query('UPDATE anteojos SET huella_token = ? WHERE id = ? AND usuario_id = ? AND modelo <> ?',
                                      [huella(token), anteojosId, usuarioId, EMULADOR]);
    if (!r.affectedRows) throw new ErrorDeCuenta('Esos anteojos no son tuyos, o son el emulador (no usa llave)', 404);
    return token;
  }

  async borrarAnteojos(usuarioId, anteojosId) {
    const [r] = await this.pool.query('DELETE FROM anteojos WHERE id = ? AND usuario_id = ?', [anteojosId, usuarioId]);
    if (!r.affectedRows) throw new ErrorDeCuenta('Esos anteojos no son tuyos', 404);
  }

  // Quién se conecta con esa llave: { usuario, anteojos } o null.
  async deLlave(token) {
    if (!token) return null;
    const [[a]] = await this.pool.query('SELECT * FROM anteojos WHERE huella_token = ?', [huella(token)]);
    if (!a) return null;
    return { usuario: await this.usuario(a.usuario_id), anteojos: anteojoPublico(a) };
  }

  // El emulador del navegador de ese usuario: entra con la sesión del panel, sin llave.
  async emuladorDe(usuarioId) {
    const [[a]] = await this.pool.query('SELECT * FROM anteojos WHERE usuario_id = ? AND modelo = ? ORDER BY id LIMIT 1', [usuarioId, EMULADOR]);
    if (a) return anteojoPublico(a);
    return (await this.crearAnteojos(usuarioId, { nombre: 'Emulador', modelo: EMULADOR })).anteojos;
  }

  async marcarConexion(anteojosId) {
    await this.pool.query('UPDATE anteojos SET ultima_conexion = NOW() WHERE id = ?', [anteojosId]);
  }

  // ── Lo de antes de las cuentas ──────────────────────────────────────────────
  async objetosSinCuenta() {
    const [filas] = await this.pool.query(
      'SELECT o.nombre, COUNT(e.id) AS ejemplos FROM objetos o LEFT JOIN ejemplos e ON e.objeto_id = o.id WHERE o.usuario_id = ? GROUP BY o.id ORDER BY o.id', [SIN_CUENTA]);
    return filas.map(f => ({ nombre: f.nombre, ejemplos: Number(f.ejemplos) }));
  }

  // Sólo la PRIMERA cuenta puede quedarse con lo aprendido sin cuenta: es la del dueño de
  // la máquina. Si ya tiene un objeto con el mismo nombre, ése no se mueve.
  async adoptarSinCuenta(usuarioId) {
    const [[primera]] = await this.pool.query('SELECT MIN(id) AS id FROM usuarios');
    if (primera?.id !== usuarioId) throw new ErrorDeCuenta('Lo aprendido sin cuenta sólo lo puede traer la primera cuenta creada en esta máquina', 403);
    // En dos pasos: MySQL no deja leer y actualizar la misma tabla en una sola sentencia.
    const [mios] = await this.pool.query('SELECT nombre FROM objetos WHERE usuario_id = ?', [usuarioId]);
    const nombres = mios.map(f => f.nombre);
    const [r] = await this.pool.query(
      `UPDATE objetos SET usuario_id = ? WHERE usuario_id = ?${nombres.length ? ' AND nombre NOT IN (?)' : ''}`,
      nombres.length ? [usuarioId, SIN_CUENTA, nombres] : [usuarioId, SIN_CUENTA]);
    return r.affectedRows;
  }
}

// ── Las rutas del panel: /api/... ─────────────────────────────────────────────
//
// `cuentas` puede ser null (MySQL apagado): entonces todo contesta 503 con el motivo.
// `alCambiar(usuarioId, que)` avisa que algo cambió fuera de las gafas, para que el
// cerebro recargue o corte conexiones: { adoptado }, { borrado } o { anteojos: id }.
// `estadoDe(usuarioId)` (puede ser async) agrega lo que sabe el cerebro:
// { red: { clave, objetos }, conectados: Set(anteojosId) }.
// Dos topes aparte: los intentos FALLIDOS de entrar, y las cuentas creadas (todas).
// `verificarGoogle(token)` es el de src/google.js (null si no hay GOOGLE_CLIENT_ID), y
// `googleClientId` se le pasa a la página para dibujar el botón.
export function rutasDeCuentas({ cuentas, alCambiar = () => {}, estadoDe = () => ({}), registroAbierto = false,
                                limitador = new Limitador(), limitadorRegistro = new Limitador({ maximo: 10, ventanaMs: 60 * 60 * 1000 }),
                                verificarGoogle = null, googleClientId = null }) {
  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));

  const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const esLocal = (req) => LOCALES.has(req.socket.remoteAddress);
  const responder = (res, estado, cuerpo) => res.status(estado).json(cuerpo);
  const cookie = (req, token, segundos) => [
    `${COOKIE}=${token ? encodeURIComponent(token) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${segundos}`,
    ...(req.secure ? ['Secure'] : []),
  ].join('; ');

  // Pedidos que cambian algo: JSON y, si viene Origin, el de esta misma página.
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const origen = req.headers.origin;
    if (origen) {
      let ok = false;
      try { ok = new URL(origen).host === req.headers.host; } catch { /* ok queda en false */ }
      if (!ok) return responder(res, 403, { motivo: 'Pedido de otra página' });
    }
    if (!req.is('application/json')) return responder(res, 415, { motivo: 'Se espera JSON' });
    if (!cuentas) return responder(res, 503, { motivo: 'La base de datos está apagada: prendé MySQL en XAMPP' });
    next();
  });
  // Lo que la página necesita saber antes de dibujarse. Anda aunque la base esté apagada.
  r.get('/config', (req, res) => responder(res, 200, { google: googleClientId, base: Boolean(cuentas), registro: registroAbierto || esLocal(req) }));
  r.get(/.*/, (req, res, next) => (cuentas ? next() : responder(res, 503, { motivo: 'La base de datos está apagada: prendé MySQL en XAMPP' })));

  const conUsuario = (fn) => async (req, res) => {
    try {
      const token = leerCookie(req.headers.cookie);
      const usuario = await cuentas.usuarioDeSesion(token);
      if (!usuario) return responder(res, 401, { motivo: 'Tenés que entrar con tu cuenta' });
      await fn(req, res, usuario, token);
    } catch (e) { fallar(res, e); }
  };
  const fallar = (res, e) => {
    if (e instanceof ErrorDeCuenta) return responder(res, e.estado, { motivo: e.message });
    console.warn(`⚠️ cuentas: ${e.message}`);
    responder(res, 500, { motivo: 'Algo falló del lado del cerebro' });
  };
  const ip = (req) => req.socket.remoteAddress ?? '?';

  r.post('/registro', async (req, res) => {
    try {
      if (!registroAbierto && !esLocal(req))
        return responder(res, 403, { motivo: 'Las cuentas se crean desde la computadora donde corre el cerebro (o con REGISTRO=abierto en .env)' });
      if (!limitadorRegistro.permitido(ip(req))) return responder(res, 429, { motivo: 'Demasiadas cuentas nuevas desde acá: esperá un rato' });
      limitadorRegistro.anotar(ip(req));
      const v = validarRegistro(req.body);
      if (!v.ok) return responder(res, 400, { motivo: v.motivo });
      const usuario = await cuentas.crearUsuario(v.datos);
      res.setHeader('Set-Cookie', cookie(req, await cuentas.abrirSesion(usuario.id), DIAS_DE_SESION * 86400));
      responder(res, 201, { usuario });
    } catch (e) { fallar(res, e); }
  });

  r.post('/entrar', async (req, res) => {
    try {
      if (!limitador.permitido(ip(req))) return responder(res, 429, { motivo: 'Demasiados intentos: esperá unos minutos' });
      const usuario = await cuentas.entrar(req.body?.correo, req.body?.clave);
      if (!usuario) { limitador.anotar(ip(req)); return responder(res, 401, { motivo: 'El correo o la contraseña no coinciden' }); }
      limitador.limpiar(ip(req));
      res.setHeader('Set-Cookie', cookie(req, await cuentas.abrirSesion(usuario.id), DIAS_DE_SESION * 86400));
      responder(res, 200, { usuario });
    } catch (e) { fallar(res, e); }
  });

  // La constancia de Google: verificada, y con ella se entra (o se crea la cuenta).
  const deGoogle = async (req) => {
    if (!verificarGoogle) throw new ErrorDeCuenta('Entrar con Google no está configurado: falta GOOGLE_CLIENT_ID en .env', 503);
    try { return await verificarGoogle(req.body?.credencial); }
    catch (e) { throw new ErrorDeCuenta(e.message, 401); }
  };

  r.post('/google', async (req, res) => {
    try {
      if (!limitador.permitido(ip(req))) return responder(res, 429, { motivo: 'Demasiados intentos: esperá unos minutos' });
      let quien;
      try { quien = await deGoogle(req); }
      catch (e) { if (e.estado === 401) limitador.anotar(ip(req)); throw e; }
      const puedeCrear = registroAbierto || esLocal(req);
      if (puedeCrear && !limitadorRegistro.permitido(ip(req))) return responder(res, 429, { motivo: 'Demasiadas cuentas nuevas desde acá: esperá un rato' });
      const { usuario, creado } = await cuentas.entrarConGoogle(quien, { puedeCrear });
      if (creado) limitadorRegistro.anotar(ip(req));
      res.setHeader('Set-Cookie', cookie(req, await cuentas.abrirSesion(usuario.id), DIAS_DE_SESION * 86400));
      responder(res, creado ? 201 : 200, { usuario, creado });
    } catch (e) { fallar(res, e); }
  });

  r.post('/salir', async (req, res) => {
    try { await cuentas.cerrarSesion(leerCookie(req.headers.cookie)); } catch (e) { return fallar(res, e); }
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    responder(res, 200, { ok: true });
  });

  r.get('/yo', conUsuario(async (req, res, usuario) => {
    const estado = (await estadoDe(usuario.id)) ?? {};
    const anteojos = (await cuentas.anteojosDe(usuario.id)).map(a => ({ ...a, conectado: Boolean(estado.conectados?.has(a.id)) }));
    const [[{ primera }]] = await cuentas.pool.query('SELECT MIN(id) AS primera FROM usuarios');
    const sinCuenta = primera === usuario.id ? await cuentas.objetosSinCuenta() : [];
    responder(res, 200, { usuario, anteojos, red: estado.red ?? null, sin_cuenta: sinCuenta });
  }));

  r.patch('/yo', conUsuario(async (req, res, usuario) => {
    const v = validarPerfil(req.body, { parcial: true });
    if (!v.ok) return responder(res, 400, { motivo: v.motivo });
    responder(res, 200, { usuario: await cuentas.actualizarPerfil(usuario.id, v.datos) });
  }));

  r.post('/yo/clave', conUsuario(async (req, res, usuario) => {
    await cuentas.cambiarClave(usuario.id, req.body?.actual, req.body?.nueva);
    res.setHeader('Set-Cookie', cookie(req, await cuentas.abrirSesion(usuario.id), DIAS_DE_SESION * 86400));
    responder(res, 200, { ok: true });
  }));

  r.post('/yo/borrar', conUsuario(async (req, res, usuario) => {
    await cuentas.borrarUsuario(usuario.id, req.body?.clave);
    await alCambiar(usuario.id, { borrado: true });
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    responder(res, 200, { ok: true });
  }));

  r.post('/yo/google', conUsuario(async (req, res, usuario) => {
    responder(res, 200, { usuario: await cuentas.vincularGoogle(usuario.id, await deGoogle(req)) });
  }));

  r.delete('/yo/google', conUsuario(async (req, res, usuario) => {
    responder(res, 200, { usuario: await cuentas.desvincularGoogle(usuario.id) });
  }));

  r.post('/yo/traer-sin-cuenta', conUsuario(async (req, res, usuario) => {
    const movidos = await cuentas.adoptarSinCuenta(usuario.id);
    await alCambiar(usuario.id, { adoptado: true });
    responder(res, 200, { movidos });
  }));

  r.post('/anteojos', conUsuario(async (req, res, usuario) => {
    responder(res, 201, await cuentas.crearAnteojos(usuario.id, req.body ?? {}));
  }));

  r.post('/anteojos/:id/llave', conUsuario(async (req, res, usuario) => {
    const token = await cuentas.nuevaLlave(usuario.id, Number(req.params.id));
    await alCambiar(usuario.id, { anteojos: Number(req.params.id) });
    responder(res, 200, { token });
  }));

  r.delete('/anteojos/:id', conUsuario(async (req, res, usuario) => {
    await cuentas.borrarAnteojos(usuario.id, Number(req.params.id));
    await alCambiar(usuario.id, { anteojos: Number(req.params.id) });
    responder(res, 200, { ok: true });
  }));

  // JSON roto: que conteste en castellano y no con la página de error de Express.
  r.use((e, _req, res, _next) => responder(res, e.status ?? 400, { motivo: e.type === 'entity.too.large' ? 'Pedido demasiado grande' : 'El pedido no es JSON válido' }));
  return r;
}
