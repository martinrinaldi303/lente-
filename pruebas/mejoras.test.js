// mejoras.test.js — la décima pasada: memoria de objetos, aviso de vehículos, leer
// texto, guías guardadas, medir con el sensor láser y pruebas reales. En frío: sin
// servidor, sin LLM, sin modelos bajados.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import QRCode from 'qrcode';
import { cartelDeLugar } from '../herramientas/hacer_tarjeta.js';
import { guiaDeManual, partirPaso } from '../herramientas/importar_myfixit.js';
import { margenWilson, resumir } from '../herramientas/resumir_pruebas.js';
import { renglonesDeAlerta, Vigia } from '../src/alertas.js';
import { buscarGuia, cargarGuias } from '../src/guias.js';
import { envolver } from '../src/hud.js';
import { crearLectorDeepSeek, normalizarLectura, paginar, recorteParaLeer } from '../src/leer.js';
import { focalDesdeFovDiagonal, renglonDeTamano, tamanoDeCajaCm } from '../src/medir.js';
import { haceCuanto, lugarDeQr, Memoria, normalizarNombre } from '../src/memoria.js';
import { BIN_FOTO, BIN_JPEG, desempaquetar, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const tic = () => new Promise(r => setImmediate(r));
const det = (nombre, x0, y0, ancho, alto, confianza = 0.95) => ({ nombre, confianza, caja: { x0, y0, ancho, alto } });
const MIN = 60 * 1000;

// Una sesión con todo de mentira. `estado.clasificador` es lo que dice la red general
// del recuadro del centro; `estado.detecciones`, lo que marca el detector.
function armar({ detector = false, alEnviar = () => {}, ...opciones } = {}) {
  const estado = { t: 1_000_000, clasificador: 'taza', detecciones: [] };
  const json = [];
  const sesion = new Sesion({
    enviarJson: (m) => { json.push(m); alEnviar(m); }, enviarBin() {},
    red: new RedObjetos(DIM, FUENTE), reloj: () => estado.t,
    conjunto: { clases: [], predecir: async () => ({ indice: 0, nombre: estado.clasificador, confianza: 0.95 }) },
    detector: detector ? { detectar: async () => { await tic(); return estado.detecciones; } } : null,
    ...opciones,
  });
  const cuadro = cuadroJpeg('taza', azar(91));            // 320×240
  const mostrar = async (veces = 5, pasoMs = 500) => {
    for (let i = 0; i < veces; i++) {
      estado.t += pasoMs;
      sesion.alBinario(empaquetar(BIN_JPEG, cuadro));
      do { await tic(); } while (sesion.drenando);
    }
  };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  return { sesion, estado, json, hud, mostrar, cuadro };
}

// ── «¿Dónde dejé…?» ─────────────────────────────────────────────────────────
test('la memoria encuentra el objeto aunque se lo pida con artículo, plural o tildes', () => {
  let t = 0;
  const m = new Memoria({ reloj: () => t });
  assert.equal(normalizarNombre('  Las Llaves '), 'llaves');
  assert.equal(normalizarNombre('el control remoto'), 'control remoto');

  m.marcarLugar('cocina');
  m.vi('llave', 0.97);
  t += 12 * MIN;
  m.vi('control remoto', 0.93);
  m.vi('persona', 0.99);                                  // nunca
  m.vi('nada', 0.99);

  assert.equal(m.buscar('las llaves').nombre, 'llave');
  assert.equal(m.buscar('el control').nombre, 'control remoto');
  assert.equal(m.buscar('persona'), null);
  assert.equal(m.vistos.size, 2);
  t += 3 * MIN;
  const r = m.dondeEsta('mis llaves');
  assert.deepEqual([r.visto, r.hace, r.lugar], [true, 'hace 15 min', 'cocina']);
  assert.equal(r.frase, 'llave: hace 15 min, en cocina');
  assert.equal(m.dondeEsta('paraguas').visto, false);

  // El lugar se vence: lo que se ve después ya no queda «en la cocina».
  t += 20 * MIN;
  assert.equal(m.lugarActual(), null);
  m.vi('taza');
  assert.equal(m.dondeEsta('taza').lugar, null);
  assert.equal(m.marcarLugar(''), null);

  assert.equal(haceCuanto(20 * 1000), 'recién');
  assert.equal(haceCuanto(3 * 60 * MIN), 'hace 3 h');
  assert.equal(haceCuanto(72 * 60 * MIN), 'hace 3 días');
});

test('la memoria se guarda en disco y vuelve al arrancar, sin personas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-memoria-'));
  try {
    const archivo = join(dir, 'memoria.json');
    let t = 10_000;
    const a = new Memoria({ archivo, reloj: () => t });
    a.vi('celular', 0.95);
    a.guardar();
    assert.deepEqual(JSON.parse(readFileSync(archivo, 'utf8')).vistos.map(v => v.nombre), ['celular']);
    const b = new Memoria({ archivo, reloj: () => t + MIN });
    assert.equal(b.dondeEsta('celular').hace, 'hace 1 min');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un QR que dice LUGAR:… es el cartel de un lugar, no una tarjeta', () => {
  assert.equal(lugarDeQr('LUGAR:cocina'), 'cocina');
  assert.equal(lugarDeQr('  lugar:  Taller de abajo '), 'Taller de abajo');
  assert.equal(lugarDeQr('https://ejemplo.com'), null);
  assert.equal(lugarDeQr(null), null);
});

// Un cuadro de 320×240 con un código QR en el medio.
function cuadroConQr(texto, escala = 4) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, lado = n * escala, ancho = 320, alto = 240;
  const data = new Uint8Array(ancho * alto * 4).fill(255);
  const x0 = Math.floor((ancho - lado) / 2), y0 = Math.floor((alto - lado) / 2);
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
    if (!qr.modules.data[Math.floor(y / escala) * n + Math.floor(x / escala)]) continue;
    const d = ((y0 + y) * ancho + x0 + x) * 4;
    data[d] = data[d + 1] = data[d + 2] = 0;
  }
  return jpeg.encode({ width: ancho, height: alto, data }, 90).data;
}

test('en la sesión: el cartel QR de un lugar marca el lugar y no se muestra como tarjeta', async () => {
  const memoria = new Memoria();
  const { sesion, hud } = armar({ memoria });
  for (let i = 0; i < 2; i++) {
    sesion.alBinario(empaquetar(BIN_JPEG, cuadroConQr(cartelDeLugar('taller'))));
    do { await tic(); } while (sesion.drenando);
  }
  assert.equal(memoria.lugarActual(), 'taller');
  assert.equal(sesion.tarjeta, null);
  assert.deepEqual(hud().lineas, ['Lugar: taller']);
});

test('en la sesión: lo que se ve entra a la memoria, y «¿dónde está?» contesta y lo dice', async () => {
  const memoria = new Memoria({ reloj: () => estado.t });
  const { sesion, estado, json, hud, mostrar } = armar({ memoria, detector: true });
  sesion.alJson({ t: 'lugar', nombre: 'living' });
  assert.deepEqual(hud().lineas, ['Lugar: living']);

  // La taza al centro (la nombra la pantalla) y un control remoto en un costado (sólo el detector).
  estado.detecciones = [det('control remoto', 5, 5, 40, 30, 0.96), det('persona', 200, 10, 100, 220, 0.99)];
  await mostrar(5);
  assert.equal(hud().pie, 'creo: taza 95%');
  assert.deepEqual([...memoria.vistos.keys()].sort(), ['control remoto', 'taza']);

  estado.t += 5 * MIN;
  const r = sesion.alJson({ t: 'donde', nombre: 'el control' });
  assert.equal(r.ok, true);
  assert.equal(r.frase, 'control remoto: hace 5 min, en living');
  assert.deepEqual(json.at(-1), { t: 'decir', texto: 'control remoto: hace 5 min, en living' });
  assert.equal(sesion.ejecutar('donde_esta', { nombre: 'persona' }).visto, false);

  // Sin memoria, se avisa.
  const otra = armar();
  assert.equal(otra.sesion.alJson({ t: 'donde', nombre: 'taza' }).ok, false);
});

// ── Aviso de vehículos ──────────────────────────────────────────────────────
// Un auto que viene derecho a 18 km/h (5 m/s) desde 25 m, visto a 2 cuadros por
// segundo en un cuadro de 320×240: su alto en píxeles sale de la misma cuenta que usa
// la sesión para medir.
const ANCHO = 320, ALTO = 240, FOCAL = focalDesdeFovDiagonal(ANCHO, ALTO, 55);
const autoA = (metros, nombre = 'auto', confianza = 0.95) => {
  const alto = 1.5 * FOCAL / metros, ancho = alto * 1.6;
  return det(nombre, ANCHO / 2 - ancho / 2, ALTO / 2 - alto / 2, ancho, alto, confianza);
};

test('el vigía avisa cuando un vehículo está por llegar, y no por uno quieto', () => {
  const v = new Vigia();
  const avisos = [];
  for (let i = 0; i < 8; i++) {
    const a = v.agregar([autoA(25 - 2.5 * i), det('persona', 0, 20, 40, 200, 0.99)], ANCHO, ALTO, i * 500);
    if (a) avisos.push({ i, ...a });
  }
  assert.ok(avisos.length >= 1, 'no avisó');
  const a = avisos[0];
  assert.equal(a.objeto, 'auto');
  assert.ok(a.llegadaS < 4 && a.velocidadKmh > 12 && a.velocidadKmh < 24, JSON.stringify(a));
  // Una vez cada 4 segundos, no a cada cuadro.
  assert.ok(avisos.every((x, k) => k === 0 || x.i - avisos[k - 1].i >= 8));
  assert.deepEqual(renglonesDeAlerta({ objeto: 'auto', llegadaS: 3.7 }), ['auto se acerca', 'Llega en ≈ 3 s', 'Mirá y frená']);

  // Quieto, alejándose o dudoso: nada.
  const quieto = new Vigia(), lejos = new Vigia(), dudoso = new Vigia();
  for (let i = 0; i < 10; i++) {
    assert.equal(quieto.agregar([autoA(8)], ANCHO, ALTO, i * 500), null);
    assert.equal(lejos.agregar([autoA(5 + 2.5 * i)], ANCHO, ALTO, i * 500), null);
    assert.equal(dudoso.agregar([autoA(25 - 2.5 * i, 'auto', 0.7)], ANCHO, ALTO, i * 500), null);
  }
});

test('en la sesión: el aviso de un vehículo le gana a la pantalla y se va solo', async () => {
  const { estado, json, hud, mostrar } = armar({ detector: true });
  estado.clasificador = 'nada';
  for (let i = 0; i < 8 && !json.some(m => m.t === 'alerta'); i++) {
    estado.detecciones = [autoA(25 - 2.5 * i)];
    await mostrar(1);
  }
  const alerta = json.find(m => m.t === 'alerta');
  assert.equal(alerta?.objeto, 'auto');
  assert.ok(alerta.llegada_s < 4);
  assert.equal(hud().titulo, '¡CUIDADO!');
  assert.equal(hud().lineas[0], 'auto se acerca');
  // Tres segundos después, el auto ya no está: vuelve la pantalla de siempre.
  estado.detecciones = [];
  await mostrar(7);
  assert.notEqual(hud().titulo, '¡CUIDADO!');
});

// ── Leer texto ──────────────────────────────────────────────────────────────
test('lo que contesta el LLM al leer se sanea, y un documento personal no se lee', () => {
  assert.deepEqual(normalizarLectura({ tipo: 'Cartel', texto: '  SALIDA \n DE EMERGENCIA ', idioma: 'es' }),
                   { tipo: 'cartel', texto: 'SALIDA DE EMERGENCIA', idioma: 'es', traduccion: '' });
  assert.equal(normalizarLectura({ tipo: 'otro', texto: '' }), null);
  assert.equal(normalizarLectura({ tipo: 'documento personal', texto: 'Juan Pérez DNI 12.345.678' }).texto, '');
  const paginas = paginar('Agitar antes de usar. Mantener fuera del alcance de los niños. Vence: 12/2027.');
  assert.ok(paginas.length >= 2);
  assert.ok(paginas.every(p => p.length <= 3 && p.every(r => r.length <= 21)));
  assert.equal(paginas.flat().join(' '), 'Agitar antes de usar. Mantener fuera del alcance de los niños. Vence: 12/2027.');
});

test('al LLM viaja el centro de la foto, no la foto entera', async () => {
  const foto = cuadroJpeg('taza', azar(92));                // 320×240
  const recorte = jpeg.decode(recorteParaLeer(foto), { useTArray: true });
  assert.deepEqual([recorte.width, recorte.height], [256, 168]);

  let pedido = null;
  const traer = async (_url, init) => {
    pedido = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ tipo: 'etiqueta', texto: 'Keep dry', idioma: 'en', traduccion: 'Mantener seco' }) } }] }) };
  };
  const leer = crearLectorDeepSeek({ apiKey: 'x', traer });
  const r = await leer(foto, { traducirA: 'castellano' });
  assert.equal(r.traduccion, 'Mantener seco');
  assert.match(pedido.messages[0].content, /documento personal/);
  assert.match(pedido.messages[1].content[0].text, /traducilo al castellano/);
  assert.match(pedido.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('en la sesión: leer pide la foto grande, la usa, y lo dice en voz alta si lo pidió un botón', async () => {
  const foto = cuadroJpeg('pinza', azar(93));
  const llegaron = [];
  const leer = async (f, opciones) => { llegaron.push({ f, opciones }); return { tipo: 'cartel', texto: 'NO PASAR', idioma: 'es', traduccion: '' }; };
  let s;
  const { sesion, json, hud, mostrar } = armar({
    leer, msEsperaFoto: 200,
    // Las gafas contestan el pedido de foto con un paquete 0x04.
    alEnviar: (m) => { if (m.t === 'foto') setImmediate(() => s.alBinario(empaquetar(BIN_FOTO, foto))); },
  });
  s = sesion;
  await mostrar(5);
  assert.equal(sesion.alJson({ t: 'leer' }).pendiente, true);
  while (sesion.leyendo || !llegaron.length) await tic();
  assert.deepEqual([...llegaron[0].f], [...foto]);
  assert.equal(hud().titulo, 'Texto 1/1');
  assert.deepEqual(hud().lineas, ['NO PASAR']);
  assert.deepEqual(json.filter(m => m.t === 'decir').at(-1), { t: 'decir', texto: 'NO PASAR' });

  // Pedido por el LLM, no se dice: lo dice él.
  const antes = json.filter(m => m.t === 'decir').length;
  assert.equal((await sesion.ejecutar('leer_texto', {})).ok, true);
  assert.equal(json.filter(m => m.t === 'decir').length, antes);
});

test('leer: sin foto grande usa el último cuadro; con una persona o un documento, se niega', async () => {
  const llegaron = [];
  let respuesta = { tipo: 'envase', texto: 'Vence 10/2027', idioma: 'es', traduccion: '' };
  const leer = async (f) => { llegaron.push(f); return respuesta; };
  const { sesion, estado, hud, mostrar, cuadro } = armar({ leer, msEsperaFoto: 30 });
  assert.match((await sesion.ejecutar('leer_texto', {})).motivo, /prendé la cámara/);
  await mostrar(5);
  assert.equal((await sesion.ejecutar('leer_texto', {})).ok, true);
  assert.deepEqual([...llegaron[0]], [...cuadro]);

  respuesta = { tipo: 'documento personal', texto: '', idioma: '', traduccion: '' };
  const r = await sesion.ejecutar('leer_texto', {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /documento personal/);

  estado.clasificador = 'persona';
  await mostrar(5);
  const n = llegaron.length;
  assert.match((await sesion.ejecutar('leer_texto', {})).motivo, /persona/);
  assert.equal(llegaron.length, n);                       // no salió nada
  assert.notEqual(hud().titulo, 'Leyendo...');
});

test('la foto grande tiene su propio tope, y no tiene que ser un JPEG trucho', () => {
  const jpg = (n) => Buffer.concat([Buffer.from([BIN_FOTO, 0xff, 0xd8]), Buffer.alloc(n)]);
  assert.equal(desempaquetar(jpg(400 * 1024)).tipo, BIN_FOTO);       // más grande que un cuadro, entra
  assert.equal(desempaquetar(jpg(500 * 1024)), null);
  assert.equal(desempaquetar(Buffer.from([BIN_FOTO, 1, 2, 3])), null);
});

// ── Guías guardadas ─────────────────────────────────────────────────────────
test('las guías del repo cargan y cada paso entra en la pantalla', () => {
  const avisos = [];
  const guias = cargarGuias(join(RAIZ, 'guias'), (a) => avisos.push(a));
  assert.deepEqual(avisos, []);
  assert.ok(guias.length >= 6);
  for (const g of guias) {
    for (const p of g.pasos) {
      const r = envolver(p);
      assert.ok(r.length <= 3 && !r.at(-1).endsWith('…'), `${g.id}: «${p}» no entra`);
    }
  }
  // Las de primeros auxilios dicen a quién llamar y de dónde salen.
  for (const g of guias.filter(x => x.tema === 'primeros_auxilios')) {
    assert.ok(g.pasos.some(p => /107 o 911/.test(p)), g.id);
    assert.ok(g.fuente && g.aviso, g.id);
  }
});

test('buscar una guía por lo que se dice o por el tipo de aparato', () => {
  const guias = cargarGuias(join(RAIZ, 'guias'));
  assert.equal(buscarGuia(guias, 'me quemé con aceite')?.id, 'primeros_auxilios/quemadura');
  assert.equal(buscarGuia(guias, 'RCP')?.id, 'primeros_auxilios/rcp_adulto');
  assert.equal(buscarGuia(guias, 'se está ahogando')?.id, 'primeros_auxilios/atragantamiento_adulto');
  assert.equal(buscarGuia(guias, 'control remoto')?.id, 'hogar/pilas_control_remoto');
  assert.equal(buscarGuia(guias, 'hogar/limpiar_teclado')?.titulo, 'Limpiar el teclado');
  assert.equal(buscarGuia(guias, 'cambiar el embrague'), null);
  assert.equal(buscarGuia(guias, ''), null);
});

test('en la sesión: una guía guardada se carga sin LLM y se recorre', () => {
  const guias = cargarGuias(join(RAIZ, 'guias'));
  const { sesion, hud } = armar({ guias });
  const r = sesion.alJson({ t: 'guia_local', consulta: 'quemadura' });
  assert.equal(r.ok, true);
  assert.equal(hud().titulo, 'Quemadura 1/9');
  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.equal(hud().titulo, 'Quemadura 2/9');
  const no = sesion.ejecutar('buscar_guia', { consulta: 'cambiar el embrague' });
  assert.equal(no.ok, false);
  assert.ok(no.hay.includes('RCP en un adulto'));
});

test('un manual de MyFixit se vuelve una guía que entra en la pantalla', () => {
  const g = guiaDeManual({
    Title: 'iPhone 6 Battery Replacement', Guidid: 27, Category: 'iPhone 6', Subject: 'Battery', Ancestors: ['iPhone', 'Phone', 'Root'],
    Url: 'https://www.ifixit.com/Guide/27', Toolbox: [{ Name: 'spudger' }, { Name: ['p2 pentalobe screwdriver'] }],
    Steps: [
      { Order: 2, Text_raw: 'Remove the two 3.6 mm Pentalobe screws next to the Lightning connector. Keep track of each screw.' },
      { Order: 1, Lines: [{ Text: 'power off your iphone before you begin.' }] },
    ],
  });
  assert.equal(g.pasos[0], 'Necesitás: spudger, p2 pentalobe screwdriver');
  assert.equal(g.pasos[1], 'power off your iphone before you begin.');
  assert.match(g.fuente, /ifixit\.com\/Guide\/27/);
  assert.match(g.licencia, /no comercial/);
  assert.ok(g.palabras.includes('Battery') && !g.palabras.includes('Root'));
  assert.ok(g.pasos.every(p => envolver(p).length <= 3 && !envolver(p).at(-1).endsWith('…')));
  assert.equal(guiaDeManual({ Title: 'Vacía', Steps: [] }), null);
  assert.deepEqual(partirPaso(''), []);
});

// ── Medir con el sensor láser ───────────────────────────────────────────────
test('el tamaño de un recuadro con la distancia del sensor', () => {
  const t = tamanoDeCajaCm({ ancho: 100, alto: 50 }, 600, 400);   // a 60 cm, focal 400 px
  assert.deepEqual(t, { anchoCm: 15, altoCm: 7.5 });
  assert.equal(renglonDeTamano(t), 'Mide ≈ 15 × 8 cm');
  assert.equal(renglonDeTamano({ anchoCm: 120, altoCm: 75 }), 'Mide ≈ 1,2 × 0,8 m');
});

test('en la sesión: con el sensor, el objeto del centro muestra su tamaño y se le estima el peso', async () => {
  const { sesion, estado, hud, mostrar } = armar({ detector: true });
  estado.detecciones = [det('taza', 130, 90, 60, 60, 0.97)];
  assert.match(sesion.ejecutar('medir_objeto').motivo, /sensor de distancia/);

  // El sensor manda una lectura con cada cuadro, como el ESP32.
  for (let i = 0; i < 5; i++) { sesion.alJson({ t: 'distancia', mm: 400 }); await mostrar(1); }
  assert.match(hud().lineas[0], /^Mide ≈ \d+ × \d+ cm$/);
  const r = sesion.ejecutar('medir_objeto', { material: 'vidrio', forma: 'cilindro' });
  assert.equal(r.ok, true);
  assert.ok(r.ancho_cm > 5 && r.ancho_cm < 9, String(r.ancho_cm));        // 60 px a 40 cm con 55° de diagonal
  assert.equal(r.distancia_cm, 40);
  assert.ok(r.peso_estimado_g > 0);
  assert.match(sesion.ejecutar('medir_objeto', { material: 'madera', forma: 'caja' }).motivo_peso, /profundidad/);

  // La lectura del sensor envejece: sin lecturas nuevas, no se mide más.
  await mostrar(5);
  assert.equal(sesion.tamano, null);
});

// ── Pruebas reales ──────────────────────────────────────────────────────────
test('«acertó / se equivocó» se anota con lo que mostraba la pantalla', async () => {
  const filas = [];
  const { sesion, mostrar } = armar({ anotarEvaluacion: (f) => filas.push(f) });
  await mostrar(5);
  assert.equal(sesion.alJson({ t: 'evaluar', acierto: true }).ok, true);
  assert.equal(sesion.alJson({ t: 'evaluar', acierto: false, real: 'Mate' }).ok, true);
  assert.match(sesion.alJson({ t: 'evaluar', acierto: false }).motivo, /qué era/);
  assert.deepEqual(filas.map(f => [f.mostrado, f.origen, f.acierto, f.real]),
                   [['taza', 'general', true, 'taza'], ['taza', 'general', false, 'mate']]);
  assert.ok(filas.every(f => f.confianza === 0.95 && !Number.isNaN(Date.parse(f.cuando))));
  assert.equal(armar().sesion.alJson({ t: 'evaluar', acierto: true }).ok, false);
});

test('el resumen de las pruebas reales cuenta por clase y da el margen', () => {
  const filas = [
    { mostrado: 'taza', real: 'taza', acierto: true }, { mostrado: 'taza', real: 'taza', acierto: true },
    { mostrado: 'taza', real: 'mate', acierto: false }, { mostrado: null, real: 'celular', acierto: false },
  ];
  const r = resumir(filas);
  assert.deepEqual([r.n, r.aciertos, r.acierto], [4, 2, 0.5]);
  assert.deepEqual(r.porClase[0], { clase: 'taza', n: 2, aciertos: 2 });
  assert.deepEqual(r.confusiones, [['mate → taza', 1], ['celular → nada', 1]]);
  const m = margenWilson(2, 4);
  assert.ok(m.desde > 0.1 && m.desde < 0.2 && m.hasta > 0.8 && m.hasta < 0.9, JSON.stringify(m));
  assert.deepEqual(margenWilson(0, 0), { desde: 0, hasta: 0 });
});
