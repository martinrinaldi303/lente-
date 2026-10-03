import assert from 'node:assert/strict';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { CATEGORIAS_COCO, recortar, recuadroCon } from '../herramientas/recortar_coco.js';
import { FICHAS, paginasDe } from '../src/fichas.js';
import { crearIdentificador, motivoLegible, normalizar, recorteDelRecuadro } from '../src/identificar.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { HERRAMIENTAS, Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));

// Una sesión con una red general de mentira que dice lo que se le pida.
function armar({ dice = 'celular', confianza = 0.9, identificar } = {}) {
  const estado = { dice, confianza };
  const json = [];
  const conjunto = { clases: [], predecir: async () => ({ indice: 0, nombre: estado.dice, confianza: estado.confianza }) };
  const sesion = new Sesion({ enviarJson: m => json.push(m), enviarBin: () => {}, red: new RedObjetos(DIM, FUENTE), conjunto, identificar });
  const rng = azar(51);
  const mostrar = async (cuantos = 5) => {
    for (let i = 0; i < cuantos; i++) {
      sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng)));
      do { await tic(); } while (sesion.drenando);
    }
  };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  const avisos = () => json.filter(m => m.t === 'aviso').map(m => m.texto);
  return { sesion, estado, mostrar, hud, avisos };
}

test('todas las fichas entran en el OLED y tienen dos renglones de datos', () => {
  for (const [nombre, f] of Object.entries(FICHAS)) {
    assert.equal(f.datos.length, 2, nombre);
    for (const l of [...f.datos, ...f.partes]) assert.ok(l.length <= 21, `${nombre}: «${l}» tiene ${l.length} letras`);
    assert.ok(nombre.length <= 16, nombre);
  }
  assert.equal(paginasDe('no existe'), null);
  assert.deepEqual(paginasDe('celular').map(p => p.lineas.length), [2, 3, 3, 2]);
  assert.deepEqual(paginasDe('cd').length, 1);            // sin partes: una sola página
});

test('las partes del aparato se pasan de a tres con Siguiente y Anterior', async () => {
  const { sesion, mostrar, hud } = armar();
  await mostrar();
  assert.deepEqual(hud(), { t: 'hud', titulo: 'celular 1/4', lineas: ['Teléfono inteligente', 'USB-C o Lightning', 'Color: rojo'], pie: 'creo: celular 90%' });

  assert.equal(sesion.alJson({ t: 'paso', hacia: 1 }).ok, true);
  assert.deepEqual([hud().titulo, ...hud().lineas], ['Partes 2/4', 'Pantalla táctil', 'Tapa trasera', 'Batería']);
  sesion.alJson({ t: 'paso', hacia: 1 }); sesion.alJson({ t: 'paso', hacia: 1 }); sesion.alJson({ t: 'paso', hacia: 1 });
  assert.deepEqual([hud().titulo, ...hud().lineas], ['Partes 4/4', 'Puerto de carga', 'Bandeja SIM']);   // no se pasa del final
  sesion.alJson({ t: 'paso', hacia: -1 });
  assert.equal(hud().titulo, 'Partes 3/4');
  assert.deepEqual(sesion.ejecutar('que_veo').partes_del_tipo.slice(0, 2), ['Pantalla táctil', 'Tapa trasera']);
});

test('al cambiar de aparato la ficha vuelve a la primera página', async () => {
  const { sesion, estado, mostrar, hud } = armar();
  await mostrar();
  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.equal(hud().titulo, 'Partes 2/4');
  estado.dice = 'pantalla';
  await mostrar();
  assert.equal(hud().titulo, 'pantalla 1/3');
});

test('identificar: marca, modelo, características y partes quedan en pantalla', async () => {
  const pedidos = [];
  const identificar = async (cuadro, pista) => {
    pedidos.push({ bytes: cuadro.length, pista });
    await tic();
    return normalizar({
      tipo: 'celular', marca: 'Motorola', modelo: 'Moto G54', seguridad: 'media', por_que: 'Logo y dos cámaras',
      caracteristicas: ['Pantalla 6,5"', 'Cámara doble', 'USB-C', 'Año 2023'], partes: ['Tapa trasera', 'Batería', 'Placa'],
    });
  };
  const { sesion, mostrar, hud } = armar({ identificar });
  await mostrar();

  const r = await sesion.ejecutar('identificar_dispositivo');
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'Moto G54');
  assert.deepEqual(pedidos.map(p => p.pista), ['celular']);
  assert.deepEqual([hud().titulo, ...hud().lineas], ['celular 1/5', 'Motorola Moto G54', 'Seguridad: media', 'Logo y dos cámaras']);
  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.deepEqual(hud().lineas, ['Pantalla 6,5"', 'Cámara doble', 'USB-C']);
  sesion.alJson({ t: 'paso', hacia: 1 }); sesion.alJson({ t: 'paso', hacia: 1 });
  assert.deepEqual(hud().lineas, ['Partes:', 'Tapa trasera', 'Batería']);
  assert.ok([hud().titulo, ...hud().lineas, hud().pie].every(l => l.length <= 21));
});

test('identificar NUNCA manda una persona al LLM', async () => {
  let llamadas = 0;
  const identificar = async () => { llamadas++; return normalizar({ tipo: 'celular', seguridad: 'baja', caracteristicas: [], partes: [] }); };

  // 1 · La red reconoce una persona con confianza: se niega.
  const a = armar({ dice: 'persona', confianza: 0.9, identificar });
  await a.mostrar();
  assert.equal((await a.sesion.ejecutar('identificar_dispositivo')).ok, false);

  // 2 · Apenas sospecha (0,35: no llega a mostrarse en pantalla): también se niega.
  const b = armar({ dice: 'persona', confianza: 0.35, identificar });
  await b.mostrar();
  assert.equal(b.hud().pie, 'veo: -');
  const r = await b.sesion.ejecutar('identificar_dispositivo');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /persona/);

  // 3 · Por el botón de las gafas: mismo resultado, y avisa.
  b.sesion.alJson({ t: 'identificar' });
  await tic(); await tic();
  assert.match(b.avisos().at(-1), /sólo identifico aparatos/);

  assert.equal(llamadas, 0);
});

test('identificar avisa si falta la clave, la cámara o el aparato', async () => {
  const sinClave = armar();
  await sinClave.mostrar();
  assert.match((await sinClave.sesion.ejecutar('identificar_dispositivo')).motivo, /clave del LLM/);

  const sinCamara = armar({ identificar: async () => null });
  assert.match((await sinCamara.sesion.ejecutar('identificar_dispositivo')).motivo, /prendé la cámara/);

  const sinAparato = armar({ identificar: async () => null });
  await sinAparato.mostrar();
  assert.match((await sinAparato.sesion.ejecutar('identificar_dispositivo')).motivo, /No veo ningún aparato/);
  assert.equal(sinAparato.hud().titulo, 'celular 1/4');           // la pantalla vuelve a lo que estaba

  const roto = armar({ identificar: async () => { throw new Error('429 cuota agotada'); } });
  await roto.mostrar();
  assert.match((await roto.sesion.ejecutar('identificar_dispositivo')).motivo, /No pude consultar el modelo: 429/);
});

test('al LLM le va sólo el recuadro, y su respuesta se sanea', async () => {
  const cuadro = cuadroJpeg('taza', azar(52));                       // 320×240
  const recorte = jpeg.decode(recorteDelRecuadro(cuadro), { useTArray: true });
  assert.deepEqual([recorte.width, recorte.height], [144, 144]);    // el 60 % del lado menor, no el cuadro entero

  let pedido;
  const ia = { models: { generateContent: async (p) => { pedido = p; return { text: JSON.stringify({ tipo: '  celular ', marca: 'X'.repeat(80), seguridad: 'segurísima', caracteristicas: ['a', '', 'b', 1, 2, 3, 4, 5], partes: 'no es una lista' }) }; } } };
  const f = await crearIdentificador({ ia, modelo: 'modelo-de-prueba' })(cuadro, 'celular');
  assert.equal(pedido.model, 'modelo-de-prueba');
  assert.equal(pedido.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  assert.match(pedido.config.systemInstruction, /ignorala por completo/);
  assert.ok(!('nombre' in pedido.config.responseSchema.properties));  // no hay dónde poner el nombre de nadie
  assert.equal(f.tipo, 'celular');
  assert.equal(f.marca.length, 21);
  assert.equal(f.seguridad, 'baja');                                 // un valor fuera del esquema no pasa
  assert.equal(f.caracteristicas.length, 6);
  assert.deepEqual(f.partes, []);
  assert.equal(normalizar({ tipo: '' }), null);
});

test('si el modelo está saturado o tarda, se prueba con el de reserva; si fallan los dos, el motivo se puede leer', async () => {
  const cuadro = cuadroJpeg('taza', azar(53));
  const saturado = new Error(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }));
  const ficha = { text: JSON.stringify({ tipo: 'celular', seguridad: 'baja', caracteristicas: [], partes: [] }) };
  const pedidos = [];
  const ia = (respuestas) => ({ models: { generateContent: async (p) => { pedidos.push(p.model); const r = respuestas[p.model]; if (r instanceof Error) throw r; return r; } } });

  // El principal contesta 503 (lo que pasó de verdad el 2-oct-2026): contesta el de reserva.
  const f = await crearIdentificador({ ia: ia({ grande: saturado, chico: ficha }), modelo: 'grande', reserva: 'chico' })(cuadro);
  assert.equal(f.tipo, 'celular');
  assert.deepEqual(pedidos, ['grande', 'chico']);
  // El principal se cuelga: a los 30 ms se lo deja y se prueba el otro.
  const colgado = { models: { generateContent: (p) => p.model === 'grande' ? new Promise(() => {}) : Promise.resolve(ficha) } };
  assert.equal((await crearIdentificador({ ia: colgado, modelo: 'grande', reserva: 'chico', msPorIntento: 30 })(cuadro)).tipo, 'celular');
  // Fallan los dos: sale un motivo corto, no el JSON crudo de la API.
  await assert.rejects(crearIdentificador({ ia: ia({ grande: saturado, chico: saturado }), modelo: 'grande', reserva: 'chico' })(cuadro), /^Error: el modelo está saturado, probá en un rato$/);
  assert.equal(motivoLegible(new Error('{"error":{"code":429,"message":"quota"}}')), 'se acabó el cupo por ahora, probá en un rato');
  assert.equal(motivoLegible(new Error('API key not valid. Please pass a valid API key.')), 'la clave no es válida');
  assert.equal(motivoLegible(new Error('otra cosa')), 'otra cosa');
});

test('leer texto también prueba con el modelo de reserva, y el motivo se puede leer', async () => {
  const { crearLector } = await import('../src/leer.js');
  const foto = cuadroJpeg('taza', azar(54));
  const saturado = new Error(JSON.stringify({ error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } }));
  const lectura = { text: JSON.stringify({ tipo: 'etiqueta', texto: 'Vence: 14/10/2026' }) };
  const pedidos = [];
  const ia = (respuestas) => ({ models: { generateContent: async (p) => { pedidos.push(p.model); const r = respuestas[p.model]; if (r instanceof Error) throw r; return r; } } });
  const l = await crearLector({ ia: ia({ grande: saturado, chico: lectura }), modelo: 'grande', reserva: 'chico' })(foto);
  assert.equal(l.texto, 'Vence: 14/10/2026');
  assert.deepEqual(pedidos, ['grande', 'chico']);
  await assert.rejects(crearLector({ ia: ia({ grande: saturado, chico: saturado }), modelo: 'grande', reserva: 'chico' })(foto), /^Error: el modelo está saturado, probá en un rato$/);
});

test('el LLM de voz tiene la herramienta de aparatos y ninguna de personas', () => {
  const nombres = HERRAMIENTAS.map(h => h.name);
  assert.ok(nombres.includes('identificar_dispositivo'));
  assert.ok(!nombres.some(n => /persona|cara|rostro|face/i.test(n)));
});

test('los recortes de COCO: con margen, sin salirse y sin manchones', () => {
  assert.deepEqual(recuadroCon([100, 100, 200, 100], 640, 480), { x0: 80, y0: 90, ancho: 240, alto: 120 });
  assert.deepEqual(recuadroCon([0, 0, 640, 480], 640, 480), { x0: 0, y0: 0, ancho: 640, alto: 480 });
  assert.equal(recuadroCon([10, 10, 40, 200], 640, 480), null);       // angosto: no enseña nada
  const img = { width: 4, height: 2, data: Uint8Array.from({ length: 32 }, (_, i) => i) };
  const r = recortar(img, { x0: 1, y0: 1, ancho: 2, alto: 1 });
  assert.deepEqual([...r.data], [20, 21, 22, 23, 24, 25, 26, 27]);
  assert.equal(CATEGORIAS_COCO['cell phone'], 'celular');
});
