import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { abrirBase, SIN_CUENTA } from '../src/base.js';
import {
  claveCorrecta, cifrarClave, Cuentas, huella, leerCookie, Limitador, rutasDeCuentas, tokenNuevo,
  validarPerfil, validarRegistro,
} from '../src/cuentas.js';
import { RedObjetos } from '../src/red_objetos.js';

// ── Sin base ────────────────────────────────────────────────────────────────

test('la contraseña se guarda con scrypt y sal propia, y sólo la correcta entra', async () => {
  const a = await cifrarClave('una clave larga'), b = await cifrarClave('una clave larga');
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);                                   // la misma clave, dos sales distintas
  assert.ok(!a.includes('una clave larga'));
  assert.equal(await claveCorrecta('una clave larga', a), true);
  assert.equal(await claveCorrecta('una clave larg', a), false);
  assert.equal(await claveCorrecta('una clave larga', 'texto plano'), false);
  assert.equal(await claveCorrecta(undefined, a), false);
});

test('lo que se pide al crear una cuenta, validado', () => {
  const bien = validarRegistro({ nombre: '  Martín  ', correo: ' Martin@Ejemplo.COM ', clave: '12345678', edad: '22' });
  assert.deepEqual(bien, { ok: true, datos: { nombre: 'Martín', correo: 'martin@ejemplo.com', clave: '12345678', edad: 22 } });
  assert.equal(validarRegistro({ nombre: 'M', correo: 'm@e.com', clave: '12345678' }).datos.edad, undefined);   // la edad es opcional
  assert.match(validarRegistro({ correo: 'm@e.com', clave: '12345678' }).motivo, /nombre/);
  assert.match(validarRegistro({ nombre: 'M', correo: 'no-es-correo', clave: '12345678' }).motivo, /correo/);
  assert.match(validarRegistro({ nombre: 'M', correo: 'm@e.com', clave: 'corta' }).motivo, /8 caracteres/);
  assert.match(validarRegistro({ nombre: 'M', correo: 'm@e.com', clave: '12345678', edad: 200 }).motivo, /edad/);
  assert.match(validarRegistro({ nombre: 'M', correo: 'm@e.com', clave: '12345678', edad: 'veinte' }).motivo, /edad/);
  // Al editar el perfil se puede cambiar una sola cosa, o borrar la edad.
  assert.deepEqual(validarPerfil({ edad: 30 }, { parcial: true }), { ok: true, datos: { edad: 30 } });
  assert.deepEqual(validarPerfil({ edad: '' }, { parcial: true }), { ok: true, datos: { edad: null } });
  assert.match(validarPerfil({ nombre: '   ' }, { parcial: true }).motivo, /nombre/);
});

test('cookies, llaves y huellas', () => {
  assert.equal(leerCookie('a=1; gafas_sesion=abc%2Bd; b=2'), 'abc+d');
  assert.equal(leerCookie('otra=1'), null);
  assert.equal(leerCookie(undefined), null);
  const llave = tokenNuevo('gaf_');
  assert.match(llave, /^gaf_[A-Za-z0-9_-]{32}$/);          // lo que acepta el firmware: sin comillas ni espacios
  assert.notEqual(tokenNuevo('gaf_'), llave);
  assert.equal(huella(llave).length, 64);
  assert.notEqual(huella(llave), llave);
});

test('el tope de intentos', () => {
  let t = 0;
  const l = new Limitador({ maximo: 3, ventanaMs: 1000, reloj: () => t });
  for (let i = 0; i < 3; i++) { assert.equal(l.permitido('ip'), true); l.anotar('ip'); }
  assert.equal(l.permitido('ip'), false);
  assert.equal(l.permitido('otra ip'), true);
  t = 1500;                                                 // pasó la ventana
  assert.equal(l.permitido('ip'), true);
  l.anotar('ip'); l.limpiar('ip');
  assert.equal(l.permitido('ip'), true);
});

test('lo aprendido sin cuenta sólo lo trae la primera cuenta, y no pisa lo suyo', async () => {
  const consultas = [];
  const pool = (primera, mios) => ({
    async query(sql, valores) {
      consultas.push({ sql, valores });
      if (/MIN\(id\)/.test(sql)) return [[{ id: primera }]];
      if (/SELECT nombre FROM objetos/.test(sql)) return [mios.map(nombre => ({ nombre }))];
      return [{ affectedRows: 2 }];
    },
  });
  await assert.rejects(new Cuentas(pool(1, [])).adoptarSinCuenta(2), /primera cuenta/);
  assert.equal(await new Cuentas(pool(1, ['taza'])).adoptarSinCuenta(1), 2);
  const update = consultas.at(-1);
  assert.match(update.sql, /UPDATE objetos SET usuario_id = \? WHERE usuario_id = \? AND nombre NOT IN \(\?\)/);
  assert.deepEqual(update.valores, [1, SIN_CUENTA, ['taza']]);
});

// ── Con el MySQL de verdad, si está prendido ────────────────────────────────
// Todo lo que se crea acá lleva un correo «@prueba.invalid» y se borra al final. Lo
// del usuario de verdad (lo aprendido sin cuenta) no se toca: no se prueba «traer
// lo aprendido sin cuenta» contra la base real, porque se lo llevaría.

try { process.loadEnvFile('.env'); } catch { /* sin .env: se saltea */ }
const base = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
}, () => {});
const saltear = base ? false : 'MySQL apagado o sin DB_* en .env';
const marca = randomBytes(4).toString('hex');
const correo = (quien) => `${quien}-${marca}@prueba.invalid`;

// Un cliente HTTP con su propia cookie, como un navegador.
function navegador(url) {
  let cookie = '';
  return async (metodo, ruta, cuerpo, { origen, tipo = 'application/json' } = {}) => {
    const r = await fetch(`${url}/api/${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': tipo } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origen ? { Origin: origen } : {}) },
      body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
    const puesta = r.headers.get('set-cookie');
    if (puesta) cookie = puesta.split(';')[0].endsWith('=') ? '' : puesta.split(';')[0];
    return { estado: r.status, datos: await r.json().catch(() => ({})), puesta };
  };
}

test('cuentas de punta a punta contra la base: crear, entrar, anteojos, llaves y borrar', { skip: saltear }, async () => {
  const cuentas = new Cuentas(base.pool);
  const cambios = [];
  const app = express().use('/api', rutasDeCuentas({
    cuentas, limitador: new Limitador({ maximo: 5 }),
    estadoDe: async () => ({ conectados: new Set(), red: { clave: 'dino_s|384', objetos: [] } }),
    alCambiar: async (id, que) => { cambios.push({ id, ...que }); },
  }));
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const ana = navegador(url), beto = navegador(url), anonimo = navegador(url);
  try {
    // Crear la cuenta deja la sesión abierta, con una cookie que el JavaScript no puede leer.
    const alta = await ana('POST', 'registro', { nombre: 'Ana', correo: correo('ana'), clave: 'clave-de-ana', edad: 30 });
    assert.equal(alta.estado, 201, JSON.stringify(alta.datos));
    assert.match(alta.puesta, /gafas_sesion=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    assert.deepEqual([alta.datos.usuario.nombre, alta.datos.usuario.edad], ['Ana', 30]);
    assert.equal('clave' in alta.datos.usuario, false);
    assert.equal((await anonimo('POST', 'registro', { nombre: 'Otra', correo: correo('ana'), clave: '12345678' })).estado, 409);

    // En la base no está la contraseña ni el token de la sesión: sólo el scrypt y la huella.
    const [[fila]] = await base.pool.query('SELECT clave FROM usuarios WHERE correo = ?', [correo('ana')]);
    assert.match(fila.clave, /^scrypt\$/);

    const yo = await ana('GET', 'yo');
    assert.equal(yo.estado, 200);
    assert.deepEqual(yo.datos.anteojos, []);
    assert.equal(yo.datos.red.clave, 'dino_s|384');
    assert.equal((await anonimo('GET', 'yo')).estado, 401);

    // Pedidos de otra página, o que no son JSON: no.
    assert.equal((await ana('POST', 'anteojos', { nombre: 'X' }, { origen: 'https://otro-sitio.example' })).estado, 403);
    assert.equal((await ana('POST', 'anteojos', 'nombre=X', { tipo: 'application/x-www-form-urlencoded' })).estado, 415);

    // Vincular unos anteojos: la llave se ve UNA vez y en la base queda sólo su huella.
    const par = await ana('POST', 'anteojos', { nombre: 'Gafas de taller', modelo: 'XIAO ESP32-S3 Sense' });
    assert.equal(par.estado, 201);
    const llave = par.datos.token;
    assert.match(llave, /^gaf_/);
    const [[guardado]] = await base.pool.query('SELECT huella_token FROM anteojos WHERE id = ?', [par.datos.anteojos.id]);
    assert.equal(guardado.huella_token, huella(llave));
    const quien = await cuentas.deLlave(llave);
    assert.deepEqual([quien.usuario.nombre, quien.anteojos.nombre], ['Ana', 'Gafas de taller']);
    assert.equal(await cuentas.deLlave('gaf_inventada'), null);

    // El emulador se crea una sola vez y no tiene llave.
    const emu = await cuentas.emuladorDe(alta.datos.usuario.id);
    assert.equal((await cuentas.emuladorDe(alta.datos.usuario.id)).id, emu.id);
    assert.equal(emu.con_llave, false);
    assert.equal((await ana('GET', 'yo')).datos.anteojos.length, 2);

    // Llave nueva: la vieja deja de andar y el cerebro se entera (para cortar la conexión).
    const nueva = await ana('POST', `anteojos/${par.datos.anteojos.id}/llave`, {});
    assert.equal(nueva.estado, 200);
    assert.equal(await cuentas.deLlave(llave), null);
    assert.equal((await cuentas.deLlave(nueva.datos.token)).anteojos.id, par.datos.anteojos.id);
    assert.deepEqual(cambios.at(-1), { id: alta.datos.usuario.id, anteojos: par.datos.anteojos.id });

    // Otro usuario no puede tocar los anteojos de Ana.
    assert.equal((await beto('POST', 'registro', { nombre: 'Beto', correo: correo('beto'), clave: 'clave-de-beto' })).estado, 201);
    assert.equal((await beto('DELETE', `anteojos/${par.datos.anteojos.id}`, {})).estado, 404);
    assert.equal((await beto('POST', `anteojos/${par.datos.anteojos.id}/llave`, {})).estado, 404);
    assert.deepEqual((await beto('GET', 'yo')).datos.anteojos, []);

    // Perfil.
    assert.equal((await ana('PATCH', 'yo', { edad: 'muchos' })).estado, 400);
    assert.deepEqual((await ana('PATCH', 'yo', { nombre: 'Ana María', edad: '' })).datos.usuario.edad, null);

    // Salir y volver a entrar; una contraseña mal no dice si el correo existe.
    assert.equal((await ana('POST', 'salir', {})).estado, 200);
    assert.equal((await ana('GET', 'yo')).estado, 401);
    const mal = await ana('POST', 'entrar', { correo: correo('ana'), clave: 'otra' });
    assert.deepEqual([mal.estado, mal.datos.motivo], [401, 'El correo o la contraseña no coinciden']);
    assert.equal((await ana('POST', 'entrar', { correo: correo('nadie'), clave: 'otra' })).datos.motivo, 'El correo o la contraseña no coinciden');
    assert.equal((await ana('POST', 'entrar', { correo: correo('ANA').toUpperCase(), clave: 'clave-de-ana' })).estado, 200);

    // Cambiar la contraseña cierra las demás sesiones.
    const otraPestana = navegador(url);
    await otraPestana('POST', 'entrar', { correo: correo('ana'), clave: 'clave-de-ana' });
    assert.equal((await ana('POST', 'yo/clave', { actual: 'no es', nueva: 'clave-nueva-1' })).estado, 403);
    assert.equal((await ana('POST', 'yo/clave', { actual: 'clave-de-ana', nueva: 'clave-nueva-1' })).estado, 200);
    assert.equal((await otraPestana('GET', 'yo')).estado, 401);
    assert.equal((await ana('GET', 'yo')).estado, 200);       // la de quien la cambió sigue

    // Lo aprendido es de cada uno: dos usuarios con un objeto del mismo nombre.
    const fuente = `prueba_${marca}`;
    const red = (centro) => { const r = new RedObjetos(4, fuente); for (let i = 0; i < 3; i++) r.agregarEjemplo('celular', [centro, 0, 0, i / 10]); return r; };
    await base.guardarEjemplos(red(1), alta.datos.usuario.id);
    const idBeto = (await beto('GET', 'yo')).datos.usuario.id;
    await base.guardarEjemplos(red(9), idBeto);
    assert.equal((await base.cargarEjemplos(fuente, 4, alta.datos.usuario.id))[0].vectores[0][0], 1);
    assert.equal((await base.cargarEjemplos(fuente, 4, idBeto))[0].vectores[0][0], 9);
    assert.deepEqual(await base.cargarEjemplos(fuente, 4, SIN_CUENTA), []);   // lo sin cuenta, intacto

    // Lo anotado lleva dueño.
    base.para({ usuarioId: idBeto, anteojosId: null }).reconocimiento({ nombre: `__prueba_${marca}`, confianza: 0.9, origen: 'general' });
    await new Promise(r => setTimeout(r, 200));
    const [[anotado]] = await base.pool.query('SELECT usuario_id FROM reconocimientos WHERE nombre = ?', [`__prueba_${marca}`]);
    assert.equal(anotado.usuario_id, idBeto);

    // Borrar la cuenta se lleva todo lo suyo, y sólo lo suyo.
    assert.equal((await beto('POST', 'yo/borrar', { clave: 'mal' })).estado, 403);
    assert.equal((await beto('POST', 'yo/borrar', { clave: 'clave-de-beto' })).estado, 200);
    assert.equal((await beto('GET', 'yo')).estado, 401);
    assert.deepEqual(await base.cargarEjemplos(fuente, 4, idBeto), []);
    assert.equal((await base.cargarEjemplos(fuente, 4, alta.datos.usuario.id)).length, 1);
    const [quedan] = await base.pool.query('SELECT id FROM reconocimientos WHERE nombre = ?', [`__prueba_${marca}`]);
    assert.equal(quedan.length, 0);
    assert.deepEqual(cambios.at(-1), { id: idBeto, borrado: true });

    // El tope de intentos: después de 5 fallidos, ni la correcta.
    const insistente = navegador(url);
    for (let i = 0; i < 5; i++) await insistente('POST', 'entrar', { correo: correo('ana'), clave: `intento ${i}` });
    assert.equal((await insistente('POST', 'entrar', { correo: correo('ana'), clave: 'clave-nueva-1' })).estado, 429);
  } finally {
    servidor.close();
    const [usuarios] = await base.pool.query('SELECT id FROM usuarios WHERE correo LIKE ?', [`%-${marca}@prueba.invalid`]);
    for (const { id } of usuarios) {
      for (const tabla of ['reconocimientos', 'identificaciones', 'mediciones', 'tarjetas_qr', 'objetos'])
        await base.pool.query(`DELETE FROM ${tabla} WHERE usuario_id = ?`, [id]);
      await base.pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
    }
    await base.pool.query('DELETE FROM ejemplos WHERE fuente = ?', [`prueba_${marca}`]);
  }
});

test('entrar con Google contra la base: crear, volver, no pisar una cuenta con contraseña, vincular', { skip: saltear }, async () => {
  const cuentas = new Cuentas(base.pool);
  // En vez de Google, un verificador de mentira: la constancia «g:<sub>:<correo>» vale; otra cosa no.
  const verificarGoogle = async (c) => {
    const [g, sub, correoG] = String(c ?? '').split(':');
    if (g !== 'g') throw new Error('La firma de la constancia no es de Google');
    return { sub: `${sub}-${marca}`, correo: correoG, nombre: 'Desde Google' };
  };
  const levantar = async (opciones) => {
    const s = express().use('/api', rutasDeCuentas({ cuentas, limitador: new Limitador({ maximo: 50 }), ...opciones })).listen(0, '127.0.0.1');
    await once(s, 'listening');
    return s;
  };
  const sinGoogle = await levantar({});
  const servidor = await levantar({ verificarGoogle, googleClientId: 'cliente-de-prueba' });
  const url = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const nadie = navegador(`http://127.0.0.1:${sinGoogle.address().port}`);
    assert.equal((await nadie('POST', 'google', { credencial: 'g:1:x@prueba.invalid' })).estado, 503);
    const cfg = await (await fetch(`${url}/api/config`)).json();
    assert.deepEqual(cfg, { google: 'cliente-de-prueba', base: true, registro: true });

    // Primera vez con Google: se crea la cuenta, sin contraseña.
    const gabi = navegador(url);
    const alta = await gabi('POST', 'google', { credencial: `g:1:${correo('gabi')}` });
    assert.deepEqual([alta.estado, alta.datos.creado, alta.datos.usuario.con_google, alta.datos.usuario.con_clave], [201, true, true, false]);
    assert.equal(alta.datos.usuario.nombre, 'Desde Google');
    assert.match(alta.puesta, /HttpOnly; SameSite=Strict/);
    // Vuelve: es la misma cuenta.
    const vuelta = await navegador(url)('POST', 'google', { credencial: `g:1:${correo('gabi')}` });
    assert.deepEqual([vuelta.estado, vuelta.datos.usuario.id], [200, alta.datos.usuario.id]);
    // Una constancia falsa no entra.
    assert.equal((await navegador(url)('POST', 'google', { credencial: 'falsa' })).estado, 401);
    // Con contraseña no entra nadie: no tiene.
    assert.equal((await navegador(url)('POST', 'entrar', { correo: correo('gabi'), clave: 'cualquiera' })).estado, 401);

    // Sin contraseña no se puede desvincular Google (se quedaría afuera); se pone una sin «actual».
    assert.equal((await gabi('DELETE', 'yo/google', {})).estado, 409);
    assert.equal((await gabi('POST', 'yo/clave', { nueva: 'clave-de-gabi' })).estado, 200);
    assert.equal((await gabi('GET', 'yo')).datos.usuario.con_clave, true);
    assert.equal((await gabi('DELETE', 'yo/google', {})).datos.usuario.con_google, false);

    // Una cuenta con contraseña y el mismo correo: Google NO entra solo...
    const hugo = navegador(url);
    await hugo('POST', 'registro', { nombre: 'Hugo', correo: correo('hugo'), clave: 'clave-de-hugo' });
    const intento = await navegador(url)('POST', 'google', { credencial: `g:2:${correo('hugo')}` });
    assert.deepEqual([intento.estado, /Entrá con tu contraseña y vinculá Google/.test(intento.datos.motivo)], [409, true]);
    // ...pero Hugo, con su sesión, sí lo puede vincular. Y después entra con Google.
    assert.equal((await hugo('POST', 'yo/google', { credencial: `g:2:${correo('hugo')}` })).datos.usuario.con_google, true);
    assert.equal((await navegador(url)('POST', 'google', { credencial: `g:2:${correo('hugo')}` })).datos.usuario.nombre, 'Hugo');
    // La misma cuenta de Google no se puede unir a dos cuentas.
    assert.equal((await gabi('POST', 'yo/google', { credencial: `g:2:${correo('hugo')}` })).estado, 409);

    // Borrar una cuenta que nunca tuvo contraseña se confirma escribiendo el correo.
    const sinClave = navegador(url);
    await sinClave('POST', 'google', { credencial: `g:3:${correo('ines')}` });
    assert.equal((await sinClave('POST', 'yo/borrar', { clave: 'otro@correo' })).estado, 403);
    assert.equal((await sinClave('POST', 'yo/borrar', { clave: correo('ines').toUpperCase() })).estado, 200);
  } finally {
    servidor.close(); sinGoogle.close();
    const [usuarios] = await base.pool.query('SELECT id FROM usuarios WHERE correo LIKE ?', [`%-${marca}@prueba.invalid`]);
    for (const { id } of usuarios) await base.pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
  }
});

test('la base vieja se pone al día una sola vez', { skip: saltear }, async () => {
  assert.equal(await base.migrar(), 0);                    // ya se migró al abrirla: no queda nada por hacer
  const [cols] = await base.pool.query("SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'usuario_id' ORDER BY TABLE_NAME");
  assert.deepEqual(cols.map(c => c.t), ['anteojos', 'correcciones', 'identificaciones', 'mediciones', 'objetos', 'reconocimientos', 'rostros', 'sesiones_web', 'tarjetas_qr']);
});

test('cerrar la base de las pruebas de cuentas', { skip: saltear }, async () => { await base.cerrar(); });
