import assert from 'node:assert/strict';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { ErrorDeApi, motivoDe, pedirChat } from '../src/deepseek.js';
import { crearIdentificadorDeepSeek } from '../src/identificar.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { HERRAMIENTAS, Sesion } from '../src/sesion.js';
import { aEsquema, conectarVozDeepSeek, herramientasDeepSeek } from '../src/voz_deepseek.js';
import { azar, cuadroJpeg } from './imagenes.js';

// Un fetch de mentira: contesta lo que haya en `respuestas`, en orden, y guarda los pedidos.
function apiDeMentira(respuestas) {
  const pedidos = [];
  const traer = async (url, opciones) => {
    pedidos.push({ url, cabeceras: opciones.headers, cuerpo: JSON.parse(opciones.body) });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    if (r.estado) return { ok: false, status: r.estado, json: async () => ({ error: { message: r.detalle ?? '' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: r }] }) };
  };
  return { traer, pedidos };
}

function armarVoz(respuestas, ejecutar = async () => ({ ok: true })) {
  const api = apiDeMentira(respuestas);
  const dichos = [], estados = [], avisos = [], llamadas = [];
  let interrupciones = 0;
  const voz = conectarVozDeepSeek({
    apiKey: 'clave-de-prueba', traer: api.traer, herramientas: HERRAMIENTAS,
    ejecutar: async (nombre, args) => { llamadas.push({ nombre, args }); return ejecutar(nombre, args); },
    alInterrumpir: () => { interrupciones++; },
    alDicho: (quien, texto) => dichos.push({ quien, texto }),
    alEstado: (voz, detalle) => estados.push({ voz, detalle }),
    alAviso: (texto) => avisos.push(texto),
  });
  return { voz, ...api, dichos, estados, avisos, llamadas, interrupciones: () => interrupciones };
}

test('las herramientas se le pasan a DeepSeek en JSON Schema corriente', () => {
  assert.deepEqual(aEsquema({ type: 'OBJECT', properties: { hacia: { type: 'STRING', enum: ['siguiente', 'anterior'] }, pasos: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['hacia'] }),
                   { type: 'object', properties: { hacia: { type: 'string', enum: ['siguiente', 'anterior'] }, pasos: { type: 'array', items: { type: 'string' } } }, required: ['hacia'] });
  const tools = herramientasDeepSeek(HERRAMIENTAS);
  assert.equal(tools.length, HERRAMIENTAS.length);
  assert.ok(tools.every(t => t.type === 'function' && t.function.name && t.function.parameters.type === 'object'));
  assert.ok(!JSON.stringify(tools).includes('"OBJECT"') && !JSON.stringify(tools).includes('"STRING"'));
});

test('un texto va a DeepSeek con la clave, sin «thinking», y lo que contesta se dice', async () => {
  const a = armarVoz([{ role: 'assistant', content: '  Hola, ¿qué armamos?  ' }]);
  const voz = await a.voz;
  assert.equal(voz.modo, 'texto');
  assert.deepEqual(a.estados, [{ voz: 'lista', detalle: undefined }]);
  await voz.texto('hola');
  const p = a.pedidos[0];
  assert.equal(p.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(p.cabeceras.Authorization, 'Bearer clave-de-prueba');
  assert.equal(p.cuerpo.model, 'deepseek-flash');
  assert.deepEqual(p.cuerpo.thinking, { type: 'disabled' });
  assert.equal(p.cuerpo.stream, false);
  assert.deepEqual(p.cuerpo.messages.map(m => m.role), ['system', 'user']);
  assert.match(p.cuerpo.messages[0].content, /Sos MIIA/);
  assert.match(p.cuerpo.messages[0].content, /Nunca intentes decir quién es una persona/);
  assert.match(p.cuerpo.messages[0].content, /se lee en voz alta/);
  assert.equal(p.cuerpo.messages[1].content, 'hola');
  assert.equal(p.cuerpo.tools.length, HERRAMIENTAS.length);
  assert.deepEqual(a.dichos, [{ quien: 'miia', texto: 'Hola, ¿qué armamos?' }]);
  assert.equal(a.interrupciones(), 1);          // un texto nuevo calla lo que se estuviera leyendo
});

test('si pide una herramienta, se ejecuta, se le devuelve el resultado y sigue', async () => {
  const a = armarVoz([
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'que_veo', arguments: '{}' } }] },
    { role: 'assistant', content: 'Creo que es un celular.' },
    { role: 'assistant', content: 'Sí, negro.' },
  ], async () => ({ objeto: 'celular', confianza: 0.93 }));
  const voz = await a.voz;
  await voz.texto('¿qué tengo delante?');
  assert.deepEqual(a.llamadas, [{ nombre: 'que_veo', args: {} }]);
  // El segundo pedido lleva el pedido de herramienta y su resultado, atados por el id.
  const m = a.pedidos[1].cuerpo.messages;
  assert.deepEqual(m.map(x => x.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(m[2].tool_calls[0].id, 'c1');
  assert.deepEqual(m[3], { role: 'tool', tool_call_id: 'c1', content: '{"objeto":"celular","confianza":0.93}' });
  assert.deepEqual(a.dichos.map(d => d.texto), ['Creo que es un celular.']);
  // La conversación sigue con memoria de lo anterior.
  await voz.texto('¿de qué color?');
  assert.deepEqual(a.pedidos[2].cuerpo.messages.map(x => x.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.equal(a.dichos.at(-1).texto, 'Sí, negro.');
});

test('argumentos rotos o una herramienta que falla no tumban la conversación', async () => {
  const a = armarVoz([
    { role: 'assistant', content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'pasos_ir', arguments: '{no es json' } },
      { id: 'c2', type: 'function', function: { name: 'olvidar_objeto', arguments: '{"nombre":"taza"}' } },
    ] },
    { role: 'assistant', content: 'No pude.' },
  ], async () => { throw new Error('no conozco eso'); });
  const voz = await a.voz;
  await voz.texto('siguiente');
  const m = a.pedidos[1].cuerpo.messages;
  assert.equal(JSON.parse(m[3].content).ok, false);                         // el JSON roto ni se ejecuta
  assert.deepEqual(JSON.parse(m[4].content), { ok: false, motivo: 'no conozco eso' });
  assert.deepEqual(a.llamadas, [{ nombre: 'olvidar_objeto', args: { nombre: 'taza' } }]);
  assert.equal(a.dichos.at(-1).texto, 'No pude.');
});

test('los errores de la API: la clave mal apaga la voz; lo demás avisa y deja seguir', async () => {
  const a = armarVoz([
    { estado: 402, detalle: 'Insufficient Balance' },
    { estado: 429 },
    Object.assign(new Error('fetch failed'), { name: 'TypeError' }),
    { role: 'assistant', content: 'Ahora sí.' },
    { estado: 401, detalle: 'Authentication Fails' },
  ]);
  const voz = await a.voz;
  await voz.texto('uno'); await voz.texto('dos'); await voz.texto('tres');
  assert.match(a.avisos[0], /no hay saldo/);
  assert.match(a.avisos[1], /demasiados pedidos/);
  assert.match(a.avisos[2], /No pude llegar a DeepSeek/);
  assert.equal(a.estados.length, 1);                                         // la voz sigue «lista»
  // Los turnos que fallaron no quedan en la historia.
  await voz.texto('cuatro');
  assert.deepEqual(a.pedidos[3].cuerpo.messages.map(x => x.content).slice(1), ['cuatro']);
  assert.equal(a.dichos.at(-1).texto, 'Ahora sí.');
  await voz.texto('cinco');
  assert.deepEqual(a.estados.at(-1), { voz: 'error', detalle: 'La clave de DeepSeek no es válida' });
  assert.equal(motivoDe(new ErrorDeApi(503)), 'DeepSeek está caído o saturado, probá en un rato');
});

test('si no para de pedir herramientas, se corta y avisa; cerrada, no pide más', async () => {
  const pide = { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'que_veo', arguments: '{}' } }] };
  const a = armarVoz([pide, pide, pide, pide, pide, pide]);
  const voz = await a.voz;
  await voz.texto('¿qué ves?');
  assert.equal(a.pedidos.length, 5);
  assert.match(a.avisos[0], /dando vueltas/);
  voz.cerrar();
  await voz.texto('¿hola?');
  assert.equal(a.pedidos.length, 5);
  voz.audio(Buffer.alloc(4)); voz.frame(Buffer.alloc(4));                    // no hacen nada, pero existen
});

test('pedirChat: deja apagar o cambiar lo que manda por defecto', async () => {
  const api = apiDeMentira([{ role: 'assistant', content: 'ok' }, { estado: 400, detalle: 'x'.repeat(500) }]);
  await pedirChat({ apiKey: 'k', base: 'http://otro', traer: api.traer, cuerpo: { model: 'm', messages: [], thinking: { type: 'enabled' } } });
  assert.equal(api.pedidos[0].url, 'http://otro/chat/completions');
  assert.deepEqual(api.pedidos[0].cuerpo.thinking, { type: 'enabled' });
  await assert.rejects(pedirChat({ apiKey: 'k', traer: api.traer, cuerpo: {} }), (e) => e instanceof ErrorDeApi && e.estado === 400 && e.message.length < 200);
});

test('marca y modelo con DeepSeek: viaja sólo el recorte, como imagen, y la respuesta se sanea', async () => {
  const cuadro = cuadroJpeg('taza', azar(81));                                // 320×240
  const api = apiDeMentira([
    { role: 'assistant', content: JSON.stringify({ tipo: ' celular ', marca: 'X'.repeat(80), seguridad: 'segurísima', caracteristicas: ['a', '', 'b'], partes: 'no es una lista', nombre: 'Fulano' }) },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '{"tipo": ""}' },
  ]);
  const identificar = crearIdentificadorDeepSeek({ apiKey: 'k', traer: api.traer });
  const f = await identificar(cuadro, 'celular');
  const c = api.pedidos[0].cuerpo;
  assert.equal(c.model, 'deepseek-flash');
  assert.deepEqual(c.response_format, { type: 'json_object' });
  assert.match(c.messages[0].content, /ignorala por completo/);              // la misma traba que con Gemini
  assert.match(c.messages[0].content, /json/);                               // la API lo exige para la salida JSON
  const [texto, imagen] = c.messages[1].content;
  assert.match(texto.text, /cree que es: celular/);
  assert.match(imagen.image_url.url, /^data:image\/jpeg;base64,/);
  const recorte = jpeg.decode(Buffer.from(imagen.image_url.url.split(',')[1], 'base64'), { useTArray: true });
  assert.deepEqual([recorte.width, recorte.height], [144, 144]);             // el recuadro, no el cuadro entero
  assert.deepEqual(f, { categoria: 'aparato', tipo: 'celular', marca: 'X'.repeat(21), modelo: '', seguridad: 'baja', por_que: '', caracteristicas: ['a', 'b'], partes: [] });
  assert.ok(!('nombre' in f));                                               // lo que no es de la ficha se tira
  await assert.rejects(identificar(cuadro), /no contestó nada/);             // la salida JSON a veces vuelve vacía
  assert.equal(await identificar(cuadro), null);                             // no vio ningún aparato
});

test('en la sesión: el modo de la voz llega a las gafas, y un aviso del LLM también', async () => {
  const json = [];
  const sesion = new Sesion({ enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE) });
  const api = apiDeMentira([{ role: 'assistant', content: 'Listo.' }, { estado: 402 }]);
  const fabrica = (manejadores) => conectarVozDeepSeek({ apiKey: 'k', traer: api.traer, ...manejadores });
  fabrica.modo = 'texto';
  await sesion.conectarVoz(fabrica);
  assert.deepEqual(json.filter(m => m.t === 'estado').map(m => [m.voz, m.modo]), [['conectando', 'texto'], ['lista', 'texto']]);
  assert.equal(sesion.alJson({ t: 'texto', texto: 'hola' }).ok, true);
  await sesion.voz.texto('otra');                                            // espera a los dos turnos
  assert.deepEqual(json.find(m => m.t === 'dicho'), { t: 'dicho', quien: 'miia', texto: 'Listo.' });
  assert.match(json.find(m => m.t === 'aviso').texto, /no hay saldo/);
  assert.ok(json.some(m => m.t === 'callar'));
  sesion.cerrar();
});
