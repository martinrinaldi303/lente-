import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import jpeg from 'jpeg-js';
import { abrirBase } from '../src/base.js';
import { DIR_MODELOS, Reconocedor, crearCaras, decodificarYunet, matrizDeAlineacion, poseDe, similitud } from '../src/caras.js';
import { Conocidos, rutasDeConocidos } from '../src/conocidos.js';
import { Cuentas, rutasDeCuentas } from '../src/cuentas.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const PLANTILLA = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

// ── Sin modelos ─────────────────────────────────────────────────────────────

test('alinear: la semejanza que lleva los 5 puntos de una cara a la plantilla', () => {
  // Una cara al doble de tamaño, girada 20° y corrida: la matriz tiene que deshacerlo.
  const g = 20 * Math.PI / 180, s = 2;
  const puntos = PLANTILLA.map(([x, y]) => [s * (Math.cos(g) * x - Math.sin(g) * y) + 100, s * (Math.sin(g) * x + Math.cos(g) * y) + 40]);
  const [a, b, tx, ty] = matrizDeAlineacion(puntos);
  puntos.forEach(([x, y], k) => {
    assert.ok(Math.abs(a * x - b * y + tx - PLANTILLA[k][0]) < 1e-6);
    assert.ok(Math.abs(b * x + a * y + ty - PLANTILLA[k][1]) < 1e-6);
  });
  assert.ok(Math.abs(Math.hypot(a, b) - 1 / s) < 1e-9);
});

test('la pose, por dónde cae la nariz entre los ojos', () => {
  assert.equal(poseDe(PLANTILLA), 'frente');
  const corrida = (dx) => PLANTILLA.map(([x, y], k) => (k === 2 ? [x + dx, y] : [x, y]));
  assert.equal(poseDe(corrida(-12)), 'izquierda');
  assert.equal(poseDe(corrida(12)), 'derecha');
});

test('YuNet: de las salidas crudas a una cara con su caja y sus 5 puntos', () => {
  const salidas = {};
  for (const paso of [8, 16, 32]) {
    const n = (640 / paso) ** 2;
    Object.assign(salidas, { [`cls_${paso}`]: new Float32Array(n), [`obj_${paso}`]: new Float32Array(n), [`bbox_${paso}`]: new Float32Array(n * 4), [`kps_${paso}`]: new Float32Array(n * 10) });
  }
  // Una cara en la celda (fila 3, columna 5) de paso 32: centro (5,5 ; 3,5) × 32.
  const i = 3 * 20 + 5;
  salidas.cls_32[i] = 0.98; salidas.obj_32[i] = 0.96;
  salidas.bbox_32.set([0.5, 0.5, Math.log(3), Math.log(4)], i * 4);
  salidas.kps_32.set([0.2, 0.3, 0.8, 0.3, 0.5, 0.6, 0.3, 0.8, 0.7, 0.8], i * 10);
  // Y la misma cara repetida en la celda de al lado, menos segura: se suprime.
  salidas.cls_32[i + 1] = 0.9; salidas.obj_32[i + 1] = 0.9; salidas.bbox_32.set([-0.4, 0.5, Math.log(3), Math.log(4)], (i + 1) * 4);
  const caras = decodificarYunet(salidas, 0.85);
  assert.equal(caras.length, 1);
  const [c] = caras;
  assert.ok(Math.abs(c.confianza - Math.sqrt(0.98 * 0.96)) < 1e-6);
  assert.deepEqual([c.caja.x0, c.caja.y0, c.caja.ancho, c.caja.alto].map(v => Math.round(v)), [128, 48, 96, 128]);
  assert.deepEqual(c.puntos[0].map(v => Math.round(v * 10) / 10), [166.4, 105.6]);
});

test('el reconocedor dice un nombre si gana 2 de los últimos 3 cuadros, y no por parecido flojo', () => {
  const v = (...xs) => Float32Array.from(xs);
  const r = new Reconocedor({ umbral: 0.5 });
  assert.equal(r.activo, false);
  r.ponerConocidos([{ id: 7, nombre: 'Martín', plantillas: [v(1, 0, 0)] }, { id: 8, nombre: 'Ana', plantillas: [v(0, 1, 0)] }]);
  const caja = { x0: 0, y0: 0, ancho: 50, alto: 50 };
  assert.deepEqual(r.agregar([{ caja, plantilla: v(0.9, 0.1, 0) }]), []);               // un cuadro solo no alcanza
  assert.deepEqual(r.agregar([{ caja, plantilla: v(0.9, 0.2, 0.1) }]).map(q => q.nombre), ['Martín']);
  assert.deepEqual(r.agregar([{ caja, plantilla: v(0.3, 0.3, 0.9) }]), []);             // parecido flojo: nadie
  assert.equal(similitud(v(1, 0), v(0, 1)), 0);
  r.ponerConocidos([]);
  assert.equal(r.activo, false);
});

// ── Con los modelos de verdad, sobre una foto pública ───────────────────────
const conModelos = existsSync(join(DIR_MODELOS, 'face_recognition_sface_2021dec.onnx')) ? false : 'faltan los modelos en modelos/caras';
const FOTO = new URL('../datos/256_ObjectCategories/253.faces-easy-101/253_0001.jpg', import.meta.url);

test('YuNet y SFace de verdad: una cara, alineada; la misma espejada se parece mucho', { skip: conModelos || (!existsSync(FOTO) && 'falta Caltech-256') }, async () => {
  const caras = await crearCaras();
  const img = jpeg.decode(readFileSync(FOTO), { useTArray: true });
  const [c, ...otras] = await caras.detectar(img);
  assert.equal(otras.length, 0);
  assert.ok(c.confianza > 0.9);
  assert.equal(poseDe(c.puntos), 'frente');
  const espejo = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    espejo.data.set(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (y * img.width + img.width - 1 - x) * 4);
  const a = await caras.plantilla(img, c), b = await caras.plantilla(espejo, (await caras.detectar(espejo))[0]);
  assert.equal(a.length, 128);
  assert.ok(similitud(a, b) > 0.9, String(similitud(a, b)));
});

// ── Con la base: cargarse uno mismo, dar y sacar permisos ───────────────────
try { process.loadEnvFile('.env'); } catch { /* sin .env: se saltea */ }
const base = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
}, () => {});
const saltear = base ? false : 'MySQL apagado o sin DB_* en .env';
const marca = randomBytes(4).toString('hex');

// Unas caras de mentira: cada foto trae la pose que dice su nombre de archivo.
function carasDeMentira() {
  let pose = 'frente';
  const puntos = { frente: PLANTILLA, izquierda: PLANTILLA.map(([x, y], k) => (k === 2 ? [x - 12, y] : [x, y])), derecha: PLANTILLA.map(([x, y], k) => (k === 2 ? [x + 12, y] : [x, y])) };
  return {
    ponerPose(p) { pose = p; },
    async detectar() { return pose === 'ninguna' ? [] : [{ confianza: 0.97, caja: { x0: 10, y0: 10, ancho: 120, alto: 150 }, puntos: puntos[pose] }]; },
    async plantilla() { return Float32Array.from({ length: 128 }, (_, k) => (k === 0 ? 1 : 0)); },
  };
}
const fotoChica = () => `data:image/jpeg;base64,${Buffer.from(jpeg.encode({ width: 8, height: 8, data: new Uint8Array(256).fill(128) }, 80).data).toString('base64')}`;

test('personas conocidas: se carga uno mismo, da permiso a otra cuenta, y lo saca', { skip: saltear }, async () => {
  const cuentas = new Cuentas(base.pool), conocidos = new Conocidos(base.pool), caras = carasDeMentira();
  const cambios = [];
  const app = express();
  app.use('/api', rutasDeConocidos({ cuentas, conocidos, caras, alCambiar: (ids) => { cambios.push(ids); } }));
  app.use('/api', rutasDeCuentas({ cuentas, registroAbierto: true }));
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  const url = `http://127.0.0.1:${http.address().port}`;
  const navegador = () => {
    let cookie = '';
    return async (metodo, ruta, cuerpo, { origen } = {}) => {
      const r = await fetch(`${url}/api/${ruta}`, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origen ? { Origin: origen } : {}) } });
      const puesta = r.headers.get('set-cookie'); if (puesta) cookie = puesta.split(';')[0];
      return { estado: r.status, datos: await r.json().catch(() => ({})) };
    };
  };
  const amigo = navegador(), yo = navegador();
  try {
    const a = (await amigo('POST', 'registro', { nombre: 'Amigo', correo: `amigo-${marca}@prueba.invalid`, clave: 'una clave larga' })).datos.usuario;
    const b = (await yo('POST', 'registro', { nombre: 'Yo', correo: `yo-${marca}@prueba.invalid`, clave: 'una clave larga' })).datos.usuario;

    // Sin cargar la cara, no hay permiso que dar.
    assert.match((await amigo('POST', 'conocidos/permisos', { correo: `yo-${marca}@prueba.invalid` })).datos.motivo, /Primero cargá tu cara/);
    // Una foto sin cara, o de otra página, no entra.
    caras.ponerPose('ninguna');
    assert.equal((await amigo('POST', 'conocidos/foto', { imagen: fotoChica() })).estado, 422);
    caras.ponerPose('frente');
    assert.equal((await amigo('POST', 'conocidos/foto', { imagen: fotoChica() }, { origen: 'https://otra.example' })).estado, 403);
    // De frente y de los dos costados: queda cargada.
    for (const p of ['frente', 'izquierda', 'derecha']) {
      caras.ponerPose(p);
      const r = await amigo('POST', 'conocidos/foto', { imagen: fotoChica() });
      assert.equal(r.estado, 200, JSON.stringify(r.datos));
      assert.equal(r.datos.pose, p);
    }
    let r = await amigo('GET', 'conocidos');
    assert.deepEqual([r.datos.completa, r.datos.total], [true, 3]);

    // Le da permiso a mi cuenta: mis gafas lo cargan, con su nombre y sus 3 caras.
    r = await amigo('POST', 'conocidos/permisos', { correo: `YO-${marca}@prueba.invalid` });
    assert.equal(r.datos.agregado, 'Yo');
    assert.deepEqual(cambios.at(-1), [b.id]);
    assert.deepEqual((await yo('GET', 'conocidos')).datos.conocidos.map(c => c.nombre), ['Amigo']);
    const cargados = await conocidos.deLector(b.id);
    assert.deepEqual(cargados.map(c => [c.nombre, c.plantillas.length]), [['Amigo', 3]]);
    assert.deepEqual(await conocidos.deLector(a.id), []);                  // al revés, no: él no me dio nada
    // A una cuenta que no existe, o a sí mismo, no.
    assert.equal((await amigo('POST', 'conocidos/permisos', { correo: `nadie-${marca}@prueba.invalid` })).estado, 404);
    assert.match((await amigo('POST', 'conocidos/permisos', { correo: `amigo-${marca}@prueba.invalid` })).datos.motivo, /tu propio correo/);

    // Yo puedo dejar de reconocerlo; él me lo puede volver a dar, y sacármelo.
    await yo('DELETE', `conocidos/reconocer/${a.id}`);
    assert.deepEqual(await conocidos.deLector(b.id), []);
    await amigo('POST', 'conocidos/permisos', { correo: `yo-${marca}@prueba.invalid` });
    await amigo('DELETE', `conocidos/permisos/${b.id}`);
    assert.deepEqual(await conocidos.deLector(b.id), []);
    // Borrar su cara se lleva todo, y avisa a quienes lo tenían.
    await amigo('POST', 'conocidos/permisos', { correo: `yo-${marca}@prueba.invalid` });
    r = await amigo('DELETE', 'conocidos/cara');
    assert.deepEqual([r.datos.total, r.datos.permisos.length], [0, 0]);
    assert.deepEqual(cambios.at(-1), [b.id]);
    assert.deepEqual(await conocidos.deLector(b.id), []);

    // Y al borrar la cuenta no queda nada suyo.
    caras.ponerPose('frente');
    await amigo('POST', 'conocidos/foto', { imagen: fotoChica() });
    await amigo('POST', 'yo/borrar', { clave: 'una clave larga' });
    await yo('POST', 'yo/borrar', { clave: 'una clave larga' });
    const [[{ n }]] = await base.pool.query('SELECT COUNT(*) AS n FROM rostros WHERE usuario_id IN (?, ?)', [a.id, b.id]);
    assert.equal(Number(n), 0);
  } finally {
    http.close();
  }
});

test('cerrar la base de las pruebas de conocidos', { skip: saltear }, async () => { await base.cerrar(); });

// ── En la sesión ────────────────────────────────────────────────────────────
function armar({ conocidos = [] } = {}) {
  const json = [], anotados = [];
  let llamadas = 0;
  const caras = {
    async detectar() { llamadas++; return [{ confianza: 0.97, caja: { x0: 120, y0: 40, ancho: 60, alto: 70 }, puntos: PLANTILLA }]; },
    async plantilla() { return Float32Array.from({ length: 128 }, (_, k) => (k === 0 ? 1 : 0)); },
  };
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
    conjunto: { clases: [], predecir: async () => ({ indice: 0, nombre: 'persona', confianza: 0.95 }) },
    detector: { detectar: async () => { await tic(); return [{ nombre: 'persona', confianza: 0.99, caja: { x0: 60, y0: 20, ancho: 200, alto: 215 } }]; } },
    registro: { reconocimiento: (r) => anotados.push(r), medicion() {} },
    caras, conocidos,
  });
  const rng = azar(97);
  const mostrar = async (veces) => { for (let i = 0; i < veces; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng))); do { await tic(); } while (sesion.drenando); } };
  return { sesion, json, anotados, mostrar, hud: () => json.filter(m => m.t === 'hud').at(-1), llamadas: () => llamadas };
}

test('en las gafas: a quien dio permiso se lo nombra; sin permisos ni se buscan caras', async () => {
  const yo = armar({ conocidos: [{ id: 7, nombre: 'Martín', plantillas: [Float32Array.from({ length: 128 }, (_, k) => (k === 0 ? 1 : 0))] }] });
  await yo.mostrar(6);
  assert.equal(yo.hud().titulo, 'Martín');
  assert.deepEqual(yo.hud().lineas, ['Persona conocida']);
  assert.equal(yo.sesion.ejecutar('que_veo').quien, 'Martín');
  assert.equal(yo.json.filter(m => m.t === 'cajas').at(-1).mirado.nombre, 'Martín');
  assert.deepEqual(yo.sesion.ejecutar('que_hay').objetos.map(o => [o.nombre, o.que_es]), [['Martín', 'Persona conocida']]);
  // Al registro va «persona», nunca el nombre: aceptó que lo reconozcan, no que lo sigan.
  assert.ok(yo.anotados.length && yo.anotados.every(a => a.nombre === 'persona'));
  yo.sesion.ejecutar('pasos_terminar');                                   // la escena quedó en pantalla
  // Si saca el permiso, deja de nombrarlo enseguida.
  yo.sesion.ponerConocidos([]);
  await yo.mostrar(5);
  assert.equal(yo.hud().titulo, 'persona');

  const nadie = armar({ conocidos: [] });
  await nadie.mostrar(5);
  assert.equal(nadie.llamadas(), 0);
  assert.equal(nadie.hud().titulo, 'persona');
});
