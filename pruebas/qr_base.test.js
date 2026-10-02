import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import QRCode from 'qrcode';
import { vcard } from '../herramientas/hacer_tarjeta.js';
import { Base, abrirBase, blobAVector, sentenciasDe, sincronizarRed, vectorABlob } from '../src/base.js';
import { alcanceM, distanciaPorAltoM, focalDesdeFovDiagonal, tiempoDeLlegadaS, velocidadKmh } from '../src/medir.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { interpretarTarjeta, leerQr, resumirEnlace } from '../src/qr.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';

const tic = () => new Promise(r => setImmediate(r));
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} no está a ${tol} de ${b}`);

// Un cuadro de cámara con un código QR en el medio, como lo mostraría alguien.
function cuadroConQr(texto, { ancho = 640, alto = 480, escala = 5 } = {}) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, lado = n * escala;
  const data = new Uint8Array(ancho * alto * 4).fill(150);
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const x0 = Math.floor((ancho - lado) / 2), y0 = Math.floor((alto - lado) / 2), margen = 4 * escala;
  for (let y = -margen; y < lado + margen; y++) for (let x = -margen; x < lado + margen; x++) {
    const dentro = x >= 0 && y >= 0 && x < lado && y < lado;
    const negro = dentro && qr.modules.data[Math.floor(y / escala) * n + Math.floor(x / escala)];
    const d = ((y0 + y) * ancho + x0 + x) * 4;
    data[d] = data[d + 1] = data[d + 2] = negro ? 0 : 255;
  }
  return { width: ancho, height: alto, data };
}

const TARJETA = vcard({ nombre: 'Ana Pérez', org: 'Taller Sur', cargo: 'Electrónica', urls: ['https://www.instagram.com/ana.perez', 'https://github.com/anap'], nota: 'Mendoza' });

test('el QR de una tarjeta se lee de la imagen y se resume en tres renglones', () => {
  const img = cuadroConQr(TARJETA);
  assert.equal(leerQr(img), TARJETA);
  const t = interpretarTarjeta(TARJETA);
  assert.equal(t.tipo, 'vcard');
  assert.equal(t.nombre, 'Ana Pérez');
  assert.deepEqual(t.lineas, ['Ana Pérez', 'Electrónica, Taller Sur', 'Instagram: @ana.perez']);
  // Una imagen sin QR no inventa nada.
  assert.equal(leerQr({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(128) }), null);
});

test('los otros formatos de tarjeta, y lo que NO se interpreta como enlace', () => {
  assert.deepEqual(interpretarTarjeta('MECARD:N:Pérez,Ana;URL:https://x.com/anap;NOTE:Hola;;').lineas, ['Ana Pérez', 'X: @anap', 'Hola']);
  assert.deepEqual(interpretarTarjeta('https://www.linkedin.com/in/ana-perez/'), { tipo: 'enlace', nombre: '', lineas: ['LinkedIn: ana-perez'], contenido: 'https://www.linkedin.com/in/ana-perez/' });
  assert.equal(resumirEnlace('https://wa.me/5492615550000'), 'WhatsApp: +5492615550000');
  assert.equal(resumirEnlace('https://www.ejemplo.com.ar/perfil/ana'), 'ejemplo.com.ar/perfil/ana');
  assert.equal(interpretarTarjeta('  Mesa 4  ').lineas[0], 'Mesa 4');
  // Un «enlace» que no es http no se resume como enlace: se muestra como texto.
  assert.equal(resumirEnlace('javascript:alert(1)'), null);
  assert.equal(interpretarTarjeta('javascript:alert(1)').tipo, 'texto');
  assert.equal(interpretarTarjeta('x'.repeat(5000)).contenido.length, 2000);
});

test('una tarjeta mostrada aparece en el HUD y se guarda sólo si se pide', async () => {
  const json = [], guardadas = [], reconocidos = [];
  const registro = { tarjeta: t => guardadas.push(t), reconocimiento: r => reconocidos.push(r), identificacion() {} };
  const sesion = new Sesion({ enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE), registro });
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  const mostrar = async (img, veces = 1) => {
    const cuadro = jpeg.encode(img, 85).data;
    for (let i = 0; i < veces; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadro)); do { await tic(); } while (sesion.drenando); }
  };

  await mostrar(cuadroConQr(TARJETA));
  assert.deepEqual(hud(), { t: 'hud', titulo: 'Tarjeta QR', lineas: ['Ana Pérez', 'Electrónica, Taller …', 'Instagram: @ana.perez'], pie: 'veo: sin entrenar' });
  assert.equal(sesion.ejecutar('leer_tarjeta').nombre, 'Ana Pérez');
  assert.equal(guardadas.length, 0);                                  // leerla no la guarda

  assert.equal(sesion.alJson({ t: 'guardar_tarjeta' }).ok, true);
  assert.equal(hud().titulo, 'Tarjeta guardada');
  sesion.alJson({ t: 'guardar_tarjeta' });                            // dos veces: una sola
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].contenido, TARJETA);

  // Se va el QR: la tarjeta sigue unos cuadros y después se borra.
  const vacio = { width: 640, height: 480, data: new Uint8Array(640 * 480 * 4).fill(140) };
  await mostrar(vacio, 10);
  assert.equal(hud().titulo, 'Tarjeta guardada');
  await mostrar(vacio, 1);
  assert.equal(hud().titulo, 'MIIA gafas');
  assert.equal(sesion.ejecutar('leer_tarjeta').hay, false);
  assert.equal(sesion.alJson({ t: 'guardar_tarjeta' }).ok, false);
});

test('lo reconocido se anota una vez por cambio, no una vez por cuadro', async () => {
  const reconocidos = [];
  let dice = 'auto';
  const conjunto = { clases: [], predecir: async () => ({ indice: 0, nombre: dice, confianza: 0.91 }) };
  const sesion = new Sesion({ enviarJson() {}, enviarBin() {}, red: new RedObjetos(DIM, FUENTE), conjunto,
                              registro: { reconocimiento: r => reconocidos.push(r), tarjeta() {}, identificacion() {} } });
  const gris = jpeg.encode({ width: 320, height: 240, data: new Uint8Array(320 * 240 * 4).fill(120) }, 80).data;
  const mostrar = async (veces) => { for (let i = 0; i < veces; i++) { sesion.alBinario(empaquetar(BIN_JPEG, gris)); do { await tic(); } while (sesion.drenando); } };
  await mostrar(12);
  assert.deepEqual(reconocidos, [{ nombre: 'auto', confianza: 0.91, origen: 'general', color: 'gris' }]);
  dice = 'moto';
  await mostrar(8);
  assert.deepEqual(reconocidos.map(r => r.nombre), ['auto', 'moto']);
});

// ── La base, con un pool de mentira ─────────────────────────────────────────
function poolDeMentira({ falla = null, demora = 0 } = {}) {
  const consultas = [];
  return {
    consultas,
    async query(sql, valores) {
      if (demora) await new Promise(r => setTimeout(r, demora));
      consultas.push({ sql, valores });
      if (falla && falla.test(sql)) throw new Error('la base dijo que no');
      return [[]];
    },
    async end() {},
  };
}

test('el esquema se parte en sentencias y los vectores van y vuelven sin perder nada', () => {
  const s = sentenciasDe('-- un comentario\nCREATE TABLE a (x INT);\n\n  -- otro\nCREATE TABLE b (\n  y INT -- no es comentario de línea entera\n);\n');
  assert.equal(s.length, 2);
  assert.match(s[0], /^CREATE TABLE a/);
  const v = [0.5, -1.25, 3.0000001, 1e-7];
  const ida = vectorABlob(v);
  assert.equal(ida.length, 16);
  assert.deepEqual(blobAVector(ida), Array.from(Float32Array.from(v)));
});

test('la base anota sin frenar a nadie: cola acotada, y un error no la detiene', async () => {
  const errores = [];
  const pool = poolDeMentira({ falla: /identificaciones/, demora: 2 });
  const base = new Base(pool, e => errores.push(e.message));
  base.identificacion({ tipo: 'celular', marca: '', modelo: 'X', seguridad: 'baja', caracteristicas: [], partes: [] });
  for (let i = 0; i < 300; i++) base.reconocimiento({ nombre: 'auto', confianza: 0.9, origen: 'general' });
  base.tarjeta({ tipo: 'vcard', nombre: 'Ana', lineas: ['Ana'], contenido: TARJETA });
  assert.ok(base.cola.length <= 200);
  assert.ok(base.descartados >= 100);                 // se cayeron los más viejos, no los nuevos
  await base.cerrar();
  assert.equal(base.cola.length, 0);
  assert.equal(errores.length <= 1, true);            // el que falló avisó (o ya se había descartado)
  const ultima = pool.consultas.at(-1);
  assert.match(ultima.sql, /INSERT INTO tarjetas_qr .* ON DUPLICATE KEY UPDATE veces = veces \+ 1/);
  assert.equal(ultima.valores[0].length, 64);         // la huella sha256
  assert.equal(ultima.valores[4], TARJETA);
});

test('sin configuración o sin MySQL, no hay base y nadie se cae', async () => {
  assert.equal(await abrirBase({ host: '127.0.0.1', port: 3306, user: '', password: '', database: '' }), null);
  const avisos = [];
  const sinServidor = await abrirBase({ host: '127.0.0.1', port: 9, user: 'x', password: 'x', database: 'x' }, a => avisos.push(a));
  assert.equal(sinServidor, null);
  assert.match(avisos[0], /sin base de datos/);
});

// ── La base de verdad (el MySQL de XAMPP), si está prendida ─────────────────
try { process.loadEnvFile('.env'); } catch { /* sin .env: la prueba se saltea */ }
const real = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
}, () => {});

test('lo aprendido sobrevive a un reinicio: se guarda en MySQL y se recupera igual',
     { skip: real ? false : 'MySQL apagado o sin DB_* en .env' }, async () => {
  // Una fuente inventada para esta corrida: no toca lo que el usuario enseñó de verdad.
  const fuente = `prueba_${randomBytes(4).toString('hex')}`;
  const nombres = [`__prueba_a_${fuente}`.slice(0, 16), `__prueba_b_${fuente}`.slice(0, 16)];
  const rng = (() => { let a = 7; return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  const ejemplo = (centro) => Array.from({ length: 8 }, (_, i) => (i === centro ? 3 : 0) + rng() * 0.2);
  try {
    const red = new RedObjetos(8, fuente);
    for (let i = 0; i < 12; i++) { red.agregarEjemplo(nombres[0], ejemplo(0)); red.agregarEjemplo(nombres[1], ejemplo(5)); }
    red.entrenar();
    await real.guardarEjemplos(red);

    // «Reinicio»: una red nueva y vacía, como al arrancar el cerebro.
    const otra = new RedObjetos(8, fuente);
    assert.equal(await sincronizarRed(real, otra), 24);
    assert.deepEqual(otra.clases, red.clases);
    assert.deepEqual(otra.memoria, red.memoria.map(m => m.map(v => Array.from(Float32Array.from(v)))));
    assert.equal(otra.predecir(ejemplo(5)).nombre, nombres[1]);

    // Olvidar uno y guardar: en la base queda sólo el otro.
    otra.olvidar(nombres[0]); otra.entrenar();
    await real.guardarEjemplos(otra);
    const tercera = new RedObjetos(8, fuente);
    assert.equal(await sincronizarRed(real, tercera), 12);
    assert.deepEqual(tercera.clases, [nombres[1]]);

    // Otro extractor no ve estos ejemplos.
    assert.deepEqual(await real.cargarEjemplos('otro_extractor', 8), []);
  } finally {
    await real.pool.query('DELETE FROM ejemplos WHERE fuente = ?', [fuente]);
    await real.pool.query('DELETE FROM objetos WHERE nombre IN (?, ?)', nombres);
  }
});

test('cerrar la conexión de prueba', { skip: real ? false : 'sin base' }, async () => { await real.cerrar(); });

// ── Vehículos ───────────────────────────────────────────────────────────────
test('distancia, velocidad y tiempo de llegada de un vehículo', () => {
  const focal = focalDesdeFovDiagonal(640, 480, 55);        // la Logi C270
  cerca(focal, 768.4, 0.1);
  cerca(distanciaPorAltoM('auto', 115, focal), 10.02, 0.01);   // un auto de 115 px de alto está a 10 m
  cerca(distanciaPorAltoM('auto', 57.5, focal), 20.04, 0.01);  // la mitad de píxeles, el doble de lejos
  cerca(velocidadKmh(20, 10, 1), 36, 1e-9);                    // 10 m en un segundo
  assert.ok(velocidadKmh(10, 20, 1) < 0);                      // se aleja
  cerca(tiempoDeLlegadaS(10, 36), 1, 1e-9);
  assert.equal(tiempoDeLlegadaS(10, 0), Infinity);
  assert.equal(tiempoDeLlegadaS(10, -5), Infinity);
  cerca(alcanceM('auto', focal), 57.6, 0.1);                   // más lejos que eso, menos de 20 px: no se mide
  assert.throws(() => distanciaPorAltoM('ovni', 100, focal), /no hay alto típico/);
  assert.throws(() => velocidadKmh(20, 10, 0), /positivo/);
});
