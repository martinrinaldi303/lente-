import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIN_AUDIO_BAJA, BIN_AUDIO_SUBE, BIN_JPEG, desempaquetar, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));

function armar(opciones = {}) {
  const json = [], bin = [];
  let guardadas = 0;
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin: b => bin.push(b),
    red: new RedObjetos(DIM, FUENTE), guardarRed: () => { guardadas++; }, ...opciones,
  });
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  // De a un cuadro, esperando a que se procese: así ninguno cae por la cola acotada.
  const mostrar = async (objeto, cuantos, rng) => {
    for (let i = 0; i < cuantos; i++) {
      sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg(objeto, rng)));
      do { await tic(); } while (sesion.drenando);
    }
  };
  return { sesion, json, bin, hud, mostrar, guardadas: () => guardadas };
}

test('enseñar dos objetos por la cámara y después reconocerlos', async () => {
  const { sesion, hud, mostrar, guardadas } = armar();
  const rng = azar(11);
  for (const objeto of ['nada', 'taza', 'pinza']) {
    assert.equal(sesion.alJson({ t: 'ensenar', nombre: objeto }).ok, true);
    assert.equal(hud().titulo, 'Aprendiendo');
    await mostrar(objeto, 12, rng);
  }
  assert.equal(guardadas(), 3);
  assert.equal(hud().pie, 'veo: -');

  await mostrar('taza', 5, rng);
  assert.match(hud().pie, /^veo: taza \d+%$/);
  assert.equal(sesion.ejecutar('que_veo').objeto, 'taza');

  await mostrar('pinza', 5, rng);
  assert.match(hud().pie, /^veo: pinza \d+%$/);

  // El fondo vacío es una clase, pero no se anuncia como objeto.
  await mostrar('nada', 5, rng);
  assert.equal(hud().pie, 'veo: -');
  assert.equal(sesion.ejecutar('que_veo').objeto, null);
});

test('la red general opina sólo cuando está segura, y lo enseñado tiene prioridad', async () => {
  // Un conjunto de mentira: dice «reloj» con la confianza que se le pida.
  let confianza = 0.9, pedidos = [];
  const conjunto = {
    clases: ['nada', 'reloj'],
    // Tarda, como la red ya entrenada: la sesión tiene que esperarlo.
    predecir: async (img, region, yaCalculados) => {
      await tic();
      pedidos.push(region);
      assert.equal(yaCalculados[FUENTE].length, DIM);     // el vector de v0 se reusa, no se recalcula
      return { indice: 1, nombre: 'reloj', confianza };
    },
  };
  const { sesion, hud, mostrar } = armar({ conjunto });
  const rng = azar(13);

  await mostrar('cinta', 2, rng);
  assert.equal(hud().pie, 'veo: -');                      // dos votos no alcanzan
  await mostrar('cinta', 3, rng);
  assert.equal(hud().pie, 'creo: reloj 90%');
  assert.deepEqual(pedidos[0], { x0: 88, y0: 48, ancho: 144, alto: 144 });   // en vivo mira el recuadro del centro
  assert.equal(sesion.ejecutar('que_veo').fuente, 'red general');

  confianza = 0.4;                                        // deja de estar segura: se calla
  await mostrar('cinta', 5, rng);
  assert.equal(hud().pie, 'veo: -');

  // Lo que el usuario enseñó le gana a la red general.
  confianza = 0.95;
  for (const objeto of ['nada', 'taza']) { sesion.alJson({ t: 'ensenar', nombre: objeto }); await mostrar(objeto, 12, rng); }
  await mostrar('taza', 5, rng);
  assert.match(hud().pie, /^veo: taza \d+%$/);
  assert.equal(sesion.ejecutar('que_veo').fuente, 'enseñado por el usuario');
});

test('si llegan cuadros más rápido de lo que se procesan, se descartan los viejos', async () => {
  const { sesion } = armar();
  const rng = azar(12);
  for (let i = 0; i < 10; i++) sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng)));
  assert.equal(sesion.cuadros.length, 2);
  assert.equal(sesion.cuadrosDescartados, 8);
  do { await tic(); } while (sesion.drenando);
  assert.equal(sesion.cuadros.length, 0);
});

test('la guía paso a paso se corta a la medida del OLED', () => {
  const { sesion, hud } = armar();
  const r = sesion.ejecutar('pasos_cargar', {
    titulo: 'Desarmar canilla de la cocina',
    pasos: ['Cerrar la llave de paso que está debajo de la mesada', 'Sacar la tapa del volante', 'Aflojar el tornillo'],
  });
  assert.deepEqual(r, { ok: true, pasos: 3 });
  assert.equal(hud().titulo, 'Desarmar canilla 1/3');
  assert.deepEqual(hud().lineas, ['Cerrar la llave de', 'paso que está debajo', 'de la mesada']);
  assert.ok([hud().titulo, ...hud().lineas, hud().pie].every(l => l.length <= 21));

  assert.equal(sesion.alJson({ t: 'paso', hacia: 1 }).paso, 2);
  assert.equal(sesion.ejecutar('pasos_ir', { hacia: 'siguiente' }).es_el_ultimo, true);
  assert.equal(sesion.ejecutar('pasos_ir', { hacia: 'siguiente' }).paso, 3);   // no se pasa del final
  assert.equal(sesion.ejecutar('pasos_ir', { hacia: 'anterior' }).paso, 2);
  sesion.ejecutar('pasos_terminar');
  assert.equal(hud().titulo, 'MIIA gafas');
  assert.equal(sesion.ejecutar('pasos_ir', { hacia: 'siguiente' }).ok, false);
});

test('el audio sube a la voz y baja a las gafas con su cabecera', async () => {
  const subio = [];
  const { sesion, json, bin } = armar();
  let manejadores;
  await sesion.conectarVoz(async (m) => {
    manejadores = m;
    m.alEstado('lista');
    return { audio: pcm => subio.push(pcm), frame() {}, texto() {}, cerrar() {} };
  });
  assert.equal(json.find(m => m.t === 'estado' && m.voz === 'lista') !== undefined, true);

  sesion.alBinario(empaquetar(BIN_AUDIO_SUBE, Buffer.from([1, 2, 3, 4])));
  assert.deepEqual([...subio[0]], [1, 2, 3, 4]);

  manejadores.alAudio(Buffer.from([9, 8, 7, 6]));
  assert.equal(bin[0][0], BIN_AUDIO_BAJA);
  assert.deepEqual([...bin[0].subarray(1)], [9, 8, 7, 6]);

  manejadores.alInterrumpir();
  assert.deepEqual(json.at(-1), { t: 'callar' });

  // Lo que pide el LLM pasa por el mismo camino que los botones.
  assert.equal(manejadores.ejecutar('hud_mostrar', { texto: 'Hola Martín' }).ok, true);
  assert.deepEqual(json.filter(m => m.t === 'hud').at(-1).lineas, ['Hola Martín']);
});

test('sin clave la sesión queda sin voz y no rompe', async () => {
  const { sesion, json } = armar();
  await sesion.conectarVoz(null);
  assert.equal(json[0].voz, 'sin_clave');
  assert.equal(sesion.alJson({ t: 'texto', texto: 'hola' }).ok, false);
  assert.equal(sesion.alBinario(empaquetar(BIN_AUDIO_SUBE, Buffer.alloc(320))), true);
});

// El 1-oct-2026 estos tres pedidos se perdían sin decir nada y parecía que el
// emulador no andaba. Ahora cada uno contesta con un aviso, y el aviso va al HUD.
test('un pedido que no se puede hacer avisa por qué', async () => {
  const { sesion, json, hud } = armar();
  const avisos = () => json.filter(m => m.t === 'aviso').map(m => m.texto);

  sesion.alJson({ t: 'texto', texto: 'hola' });
  assert.match(avisos().at(-1), /voz está apagada/);
  assert.deepEqual(hud().lineas, ['La voz está apagada:', 'no hay quien conteste']);

  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.match(avisos().at(-1), /No hay ninguna guía/);

  sesion.alJson({ t: 'olvidar', nombre: 'Martillo' });
  assert.match(avisos().at(-1), /No conozco «martillo»/);

  sesion.alJson({ t: 'ensenar', nombre: '' });
  assert.match(avisos().at(-1), /Falta el nombre/);
  assert.equal(avisos().length, 4);
});

test('enseñar con la cámara apagada no queda esperando para siempre', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sesion, json, hud } = armar();
  assert.equal(sesion.alJson({ t: 'ensenar', nombre: 'taza' }).ok, true);
  assert.equal(hud().titulo, 'Aprendiendo');
  t.mock.timers.tick(3000);
  assert.equal(sesion.aprendiendo, null);
  assert.match(json.filter(m => m.t === 'aviso').at(-1).texto, /prendé la cámara/);
  assert.equal(hud().titulo, 'MIIA gafas');
});

test('una guía cargada a mano se recorre con los botones', () => {
  const { sesion, hud } = armar();
  assert.equal(sesion.alJson({ t: 'guia', titulo: 'Cambiar pilas', pasos: ['Abrir la tapa', 'Sacar las pilas'] }).ok, true);
  assert.equal(hud().titulo, 'Cambiar pilas 1/2');
  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.deepEqual(hud().lineas, ['Sacar las pilas']);
});

test('los paquetes mal formados se rechazan', () => {
  assert.equal(desempaquetar(Buffer.from([BIN_JPEG, 1, 2, 3])), null);             // no es un JPEG
  assert.equal(desempaquetar(Buffer.from([BIN_AUDIO_SUBE, 1, 2, 3])), null);       // PCM impar
  assert.equal(desempaquetar(Buffer.from([0x7f, 1, 2])), null);                    // tipo desconocido
  assert.equal(desempaquetar(Buffer.concat([Buffer.from([BIN_JPEG, 0xff, 0xd8]), Buffer.alloc(400 * 1024)])), null);
  const { sesion } = armar();
  assert.equal(sesion.alBinario(Buffer.from([BIN_JPEG, 0, 0])), false);
});

test('la red personal puede usar otro extractor, y no se mezclan fuentes', async () => {
  // Un extractor que tarda y entrega 3 números: el promedio de rojo, verde y azul del recuadro.
  const lento = {
    fuente: 'promedio', dim: 3,
    extraer: async (img, r) => {
      await tic();
      const suma = [0, 0, 0];
      for (let y = r.y0; y < r.y0 + r.alto; y++) for (let x = r.x0; x < r.x0 + r.ancho; x++)
        for (let c = 0; c < 3; c++) suma[c] += img.data[(y * img.width + x) * 4 + c];
      return Float32Array.from(suma, s => s / (r.ancho * r.alto * 255));
    },
  };
  const { sesion, hud, mostrar } = armar({ red: new RedObjetos(3, 'promedio'), extractorPersonal: lento });
  const rng = azar(14);
  for (const objeto of ['nada', 'taza']) { sesion.alJson({ t: 'ensenar', nombre: objeto }); await mostrar(objeto, 12, rng); }
  await mostrar('taza', 5, rng);
  assert.match(hud().pie, /^veo: taza \d+%$/);
  assert.equal(sesion.red.clave, 'promedio|3');

  // Una red de rasgos_v0 con un extractor de otra dimensión no arranca: mezclarlas
  // haría que la red rechace todos los vectores sin decir por qué.
  assert.throws(() => armar({ extractorPersonal: lento }), /la red personal es rasgos_v0\|168 y el extractor es promedio\|3/);
});

test('con la pantalla libre, un dispositivo reconocido muestra sus datos y su color; una persona, sin color', async () => {
  let nombre = 'pantalla';
  const conjunto = { clases: ['nada', 'pantalla', 'persona'], predecir: async () => ({ indice: 1, nombre, confianza: 0.9 }) };
  const { sesion, hud, mostrar } = armar({ conjunto });
  const rng = azar(15);

  await mostrar('taza', 5, rng);                          // el dibujo de prueba es un círculo rojo
  assert.deepEqual(hud(), { t: 'hud', titulo: 'pantalla 1/3', lineas: ['Monitor o televisor', 'HDMI, DP, VGA, antena', 'Color: rojo'], pie: 'creo: pantalla 90%' });
  assert.ok(hud().lineas.every(l => l.length <= 21));
  const r = sesion.ejecutar('que_veo');
  assert.equal(r.color, 'rojo');
  assert.deepEqual(r.datos_del_tipo, ['Monitor o televisor', 'HDMI, DP, VGA, antena']);

  // Lo que no tiene ficha muestra sólo lo medido. Y lo medido tiene un límite: el
  // dibujo es una barra azul finita, que no llena el medio del recuadro, así que
  // el color que gana es el del fondo. Con objetos finos el color no es del objeto.
  nombre = 'pinza';
  await mostrar('pinza', 5, rng);
  assert.deepEqual(hud().lineas, ['Color: gris']);

  // De una persona no se dice el color: sería el de su piel o su ropa. Ni en la
  // pantalla, ni al LLM, ni en el registro, aunque se haya medido (el dibujo es rojo).
  const anotados = [];
  sesion.registro = { reconocimiento: (r) => anotados.push(r) };
  nombre = 'persona';
  await mostrar('taza', 5, rng);
  assert.equal(sesion.color, 'rojo');
  assert.deepEqual(hud().lineas, []);
  assert.equal(sesion.ejecutar('que_veo').color, undefined);
  assert.equal(anotados.at(-1).nombre, 'persona');
  assert.equal(anotados.at(-1).color, null);

  // Lo enseñado puede ser una persona con otro nombre: sin color si en la mirada hay
  // una persona («Martin, color: marrón», 3-oct-2026). Si no, el color vuelve.
  const otra = armar({ conjunto: { clases: ['nada', 'persona', 'pantalla'], predecir: async () => ({ indice: 1, nombre: otra.general, confianza: 0.95 }) } });
  otra.general = 'pantalla';
  for (const objeto of ['nada', 'martin']) {
    otra.sesion.alJson({ t: 'ensenar', nombre: objeto });
    await otra.mostrar(objeto === 'nada' ? 'nada' : 'taza', 12, rng);
  }
  otra.sesion.ejecutar('pasos_terminar');                 // saca el «Aprendí: martin» de la pantalla
  otra.general = 'persona';
  await otra.mostrar('taza', 5, rng);
  assert.match(otra.hud().pie, /^veo: martin/);
  assert.ok(!otra.hud().lineas.some(l => /Color/.test(l)), JSON.stringify(otra.hud()));
  assert.equal(otra.sesion.ejecutar('que_veo').color, undefined);
  otra.general = 'pantalla';
  await otra.mostrar('taza', 5, rng);
  assert.ok(otra.hud().lineas.includes('Color: rojo'), JSON.stringify(otra.hud()));

  // Un nombre largo no se come el porcentaje: se acorta el rótulo.
  nombre = 'reproductor mp3';
  await mostrar('taza', 5, rng);
  assert.equal(hud().pie, '~reproductor mp3 90%');
  nombre = 'persona';
  await mostrar('pinza', 5, rng);

  // Si la pantalla está ocupada (una guía, un texto del asistente), no se pisa.
  sesion.ejecutar('hud_mostrar', { texto: 'Hola' });
  assert.deepEqual(hud().lineas, ['Hola']);
  assert.equal(hud().pie, 'creo: persona 90%');
});
