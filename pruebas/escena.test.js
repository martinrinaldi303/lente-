import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describirEscena, escenaParaLlm, metrosLegibles, paginasDeEscena } from '../src/escena.js';
import { componerHud } from '../src/hud.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const det = (nombre, x0, y0, ancho, alto, confianza = 0.95) => ({ nombre, confianza, caja: { x0, y0, ancho, alto } });
// En 320×240 con 55° de diagonal, la focal es de unos 384 px.

test('la escena: varias cosas, de qué lado, a qué distancia y quién tiene qué', () => {
  const e = describirEscena([
    det('persona', 100, 20, 80, 200),            // entera y de pie: ≈ 3,3 m
    det('celular', 130, 90, 10, 18),             // dentro de ella y a la misma distancia: lo tiene
    det('taza', 20, 150, 30, 30),                // a la izquierda, ≈ 1,3 m
    det('botella', 250, 120, 25, 60),            // a la derecha, ≈ 1,6 m
    det('silla', 200, 60, 40, 40, 0.6),          // dudosa: no entra
    det('persona', 101, 22, 80, 198, 0.92),      // la misma persona, dos veces: una sola
  ], 320, 240);
  assert.deepEqual(e.objetos.map(o => [o.nombre, o.lado]), [['persona', 'centro'], ['celular', 'centro'], ['botella', 'derecha'], ['taza', 'izquierda']]);
  const [persona, celular, botella, taza] = e.objetos;
  assert.equal(metrosLegibles(persona.metros), '3,5');
  assert.equal(metrosLegibles(taza.metros), '1,3');
  assert.equal(persona.definicion, 'Ser humano');
  assert.equal(celular.definicion, 'Teléfono inteligente');
  assert.equal(taza.definicion, 'Recipiente con asa');
  const textos = e.relaciones.map(r => r.texto);
  assert.ok(textos.includes('persona tiene celular'), textos.join(' | '));
  assert.ok(textos.some(t => /^botella-taza ≈[\d,]+ m$/.test(t)), textos.join(' | '));
  assert.ok(!textos.some(t => /^persona-celular/.test(t)));       // lo que tiene en la mano no se mide aparte
  void botella;

  // Para la pantalla: renglones de 21 letras, primero qué hay, después quién tiene qué.
  const paginas = paginasDeEscena(e);
  assert.deepEqual(paginas[0], ['persona ≈3,5m', 'celular ≈3m', 'botella ≈1,6m der.']);   // de 2 a 10 m, de a medio metro
  assert.ok(paginas.flat().includes('persona tiene celular'));
  for (const p of paginas) assert.ok(componerHud({ titulo: 'Escena', lineas: p, pie: '' }).lineas.every(l => l.length <= 21));
  // Para el LLM: sin cajas, y con la nota de no describir a la persona.
  const llm = escenaParaLlm(e);
  assert.ok(!('caja' in llm.objetos[0]));
  assert.match(llm.nota, /de las demás decí sólo «una persona»/);
});

test('una persona de busto (la webcam) no se mide, pero lo que tiene en la mano se dice igual', () => {
  const e = describirEscena([det('persona', 60, 30, 200, 205), det('celular', 140, 120, 30, 50)], 320, 240);
  assert.equal(e.objetos[0].metros, null);
  assert.deepEqual(e.relaciones.map(r => r.texto), ['persona tiene celular']);
  // Una cosa cortada por el borde tampoco se mide; dos personas llevan número.
  const d = describirEscena([det('persona', 0, 20, 60, 150), det('persona', 200, 20, 60, 150)], 320, 240);
  assert.deepEqual(d.objetos.map(o => o.nombre).sort(), ['persona', 'persona 2']);
  assert.equal(d.objetos.find(o => o.caja.x0 === 0).metros, null);
  assert.equal(paginasDeEscena({ objetos: [], relaciones: [] })[0][0], 'No veo nada seguro');
});

// ── En la sesión ────────────────────────────────────────────────────────────
function armar({ detecciones, clasificador = 'nada' } = {}) {
  const estado = { detecciones, clasificador };
  const json = [];
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
    conjunto: { clases: [], predecir: async () => ({ indice: 0, nombre: estado.clasificador, confianza: 0.95 }) },
    detector: { detectar: async () => { await tic(); return estado.detecciones; } },
  });
  const rng = azar(91);
  const mostrar = async (veces = 5) => {
    for (let i = 0; i < veces; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng))); do { await tic(); } while (sesion.drenando); }
  };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  return { sesion, estado, json, mostrar, hud };
}

test('«¿qué hay?»: la escena en pantalla y en voz alta, y en el panel siempre', async () => {
  const { sesion, json, mostrar, hud } = armar({ detecciones: [det('persona', 60, 30, 200, 205), det('celular', 140, 120, 30, 50), det('taza', 10, 150, 30, 30)] });
  await mostrar(3);
  // El panel recibe las tres, con sus relaciones; la pantalla de las gafas sigue con una.
  const cajas = json.filter(m => m.t === 'cajas').at(-1);
  assert.deepEqual(cajas.escena.objetos.map(o => o.nombre), ['persona', 'celular', 'taza']);
  assert.deepEqual(cajas.escena.relaciones.filter(r => r.tipo === 'tiene').map(r => [r.a, r.b]), [[0, 1]]);
  const r = sesion.ejecutar('que_hay');
  assert.equal(r.ok, true);
  assert.deepEqual(r.relaciones.filter(t => / tiene /.test(t)), ['persona tiene celular']);
  assert.match(r.frase, /^Veo persona, celular a unos [\d,]+ metros, taza a unos [\d,]+ metros\. Persona tiene celular\.$/);
  assert.match(hud().titulo, /^Escena/);
  // Con el botón, además lo dice.
  sesion.alJson({ t: 'escena' });
  assert.match(json.filter(m => m.t === 'decir').at(-1).texto, /^Veo persona, celular/);
});

test('a una persona no se la aprende con un nombre; a lo que tiene en la mano, sí', async () => {
  const cara = det('persona', 60, 20, 200, 215);
  const a = armar({ detecciones: [cara], clasificador: 'persona' });
  await a.mostrar(5);
  const r = a.sesion.ejecutar('ensenar_objeto', { nombre: 'martin' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no las aprendo por su cara/);
  assert.equal(a.sesion.ejecutar('ensenar_objeto', { nombre: 'persona' }).ok, false);

  // Si se pone delante mientras aprende otra cosa, esos cuadros no se usan y se corta.
  const b = armar({ detecciones: [], clasificador: 'nada' });
  await b.mostrar(2);
  assert.equal(b.sesion.ejecutar('ensenar_objeto', { nombre: 'martin' }).ok, true);
  b.estado.detecciones = [cara]; b.estado.clasificador = 'persona';
  await b.mostrar(4);
  assert.equal(b.sesion.aprendiendo, null);
  assert.equal(b.sesion.red.clases.includes('martin'), false);
  assert.match(b.json.filter(m => m.t === 'aviso').at(-1).texto, /no las aprendo/);

  // Con un celular en la mano delante de la cara, se aprende el celular.
  const c = armar({ detecciones: [cara, det('celular', 140, 90, 40, 70)], clasificador: 'celular' });
  await c.mostrar(3);
  assert.equal(c.sesion.ejecutar('ensenar_objeto', { nombre: 'mi celular' }).ok, true);
  await c.mostrar(12);
  assert.ok(c.sesion.red.clases.includes('mi celular'));
});
