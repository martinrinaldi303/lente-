// Lo de la decimoquinta pasada: fotos propias, aumentos, otras cosas como «nada»,
// calibración del detector, umbrales por clase y CLIP.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { exportar } from '../herramientas/exportar_rasgos.js';
import { marcarCiertas, umbralPara } from '../herramientas/calibrar_detector.js';
import { umbralDeClase } from '../herramientas/umbrales_general.js';
import { arruinar, azarDe } from '../src/aumentos.js';
import { DIR_CLIP, Tokenizador, Vocabulario, cuadradoDe } from '../src/clip.js';
import { EXTRACTORES } from '../src/extractores.js';
import { leerRasgos } from '../src/formato_rasgos.js';
import { CONFIANZA_SEGURA, interpretarDfine, recalibrar } from '../src/detector.js';
import { Muestras, carpetaDe, esDePrueba, recorteJpeg } from '../src/muestras.js';
import { FUENTE } from '../src/rasgos.js';
import { VOCABULARIO } from '../src/vocabulario_clip.js';
import { azar, cuadroJpeg, imagen } from './imagenes.js';

const solo = (fuente) => [EXTRACTORES[fuente]];

test('los aumentos: siempre iguales para la misma foto, distintos entre sí, y no rompen nada', () => {
  const img = imagen('taza', azar(3));
  const a = arruinar(img, azarDe('x:1')), b = arruinar(img, azarDe('x:1')), c = arruinar(img, azarDe('x:2'));
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  assert.deepEqual(Buffer.from(a.data), Buffer.from(b.data));
  assert.notDeepEqual(Buffer.from(a.data), Buffer.from(c.data));
  for (let k = 0; k < 40; k++) {
    const r = arruinar(img, azarDe(`k:${k}`));
    assert.ok(r.width >= 8 && r.height >= 8 && r.data.length === r.width * r.height * 4);
  }
});

test('fotos propias: se guardan por clase, una de cada tres de prueba, y nunca de personas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-propias-'));
  try {
    const m = new Muestras({ dir, reloj: (() => { let t = Date.UTC(2026, 9, 3); return () => (t += 1000); })() });
    const foto = recorteJpeg(imagen('taza', azar(5)), { x0: 100, y0: 60, ancho: 120, alto: 100 });
    assert.ok(jpeg.decode(foto).width <= 512);
    for (let i = 0; i < 30; i++) assert.ok(m.guardar({ usuarioId: 7, clase: 'Cámara', mostrado: 'celular', origen: 'se_equivoco', jpeg: Buffer.concat([foto, Buffer.from([i])]) }));
    assert.equal(m.guardar({ usuarioId: 7, clase: 'persona', origen: 'acerto', jpeg: foto }), null);
    assert.ok(m.guardar({ usuarioId: 7, clase: 'persona', noEs: true, origen: 'correccion', jpeg: foto }));
    const lista = m.listar();
    assert.equal(lista.length, 31);
    assert.ok(lista.filter(x => !x.noEs).every(x => x.clase === 'camara'));
    const prueba = lista.filter(x => x.prueba).length;
    assert.ok(prueba >= 4 && prueba <= 18, `prueba=${prueba}`);
    assert.ok(lista.every(x => x.prueba === esDePrueba(x.archivo)));
    assert.equal(m.indice().get(lista[0].archivo).mostrado, 'celular');
    assert.deepEqual(Object.keys(m.resumen(7)).sort(), ['camara', 'no es persona']);
    assert.deepEqual(m.resumen(8), {});
    assert.equal(carpetaDe('El Control Remoto'), 'control remoto');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exportar con aumentos, fotos propias y otras cosas como «nada»', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-aum-'));
  try {
    const rng = azar(9);
    const carpetas = { '001.vacio': 'nada', '002.taza': 'taza', '003.pinza': 'pinza', '004.cinta-rara': { clase: 'nada', max: 5, soloEntrenamiento: true } };
    for (const [c, v] of Object.entries(carpetas)) {
      mkdirSync(join(dir, c));
      const clase = typeof v === 'string' ? v : 'cinta';
      for (let i = 0; i < 15; i++) writeFileSync(join(dir, c, `${c.slice(0, 3)}_${String(i).padStart(4, '0')}.jpg`), cuadroJpeg(clase, rng));
    }
    const propias = join(dir, 'propias'), m = new Muestras({ dir: propias });
    for (let i = 0; i < 9; i++) m.guardar({ usuarioId: 1, clase: i % 3 ? 'taza' : 'lata de aerosol', origen: 'acerto', jpeg: cuadroJpeg('taza', rng) });

    const base = await exportar({ base: dir, categorias: carpetas, salida: join(dir, 'a'), espejo: true, extractores: solo(FUENTE) });
    const r = await exportar({ base: dir, categorias: carpetas, salida: join(dir, 'b'), espejo: true, aumentar: 2, propias, extractores: solo(FUENTE) });
    // Las «otras cosas» entran sólo al entrenamiento, y como mucho 5.
    assert.ok(base.porClase.nada.prueba === r.porClase.nada.prueba);
    assert.equal(r.filasPorFoto, 4);
    const ent = leerRasgos(join(dir, 'b', FUENTE, 'entrenamiento.bin'));
    assert.equal(ent.filas.length % 4, 0);
    for (let k = 0; k < ent.filas.length; k += 4) assert.ok(ent.filas.slice(k, k + 4).every(f => f.etiqueta === ent.filas[k].etiqueta));
    // La prueba de siempre no cambia; la arruinada tiene una fila por foto de prueba.
    const prueba = leerRasgos(join(dir, 'b', FUENTE, 'prueba.bin')), pa = leerRasgos(join(dir, 'a', FUENTE, 'prueba.bin'));
    assert.deepEqual(prueba.filas.map(f => f.etiqueta), pa.filas.map(f => f.etiqueta));
    assert.equal(leerRasgos(join(dir, 'b', FUENTE, 'prueba_arruinada.bin')).filas.length, prueba.filas.length);
    // Las propias: las de prueba aparte; «lata de aerosol» no es una clase: entra como nada.
    const propiasPrueba = leerRasgos(join(dir, 'b', FUENTE, 'prueba_propias.bin'));
    assert.equal(propiasPrueba.filas.length, r.propias.prueba);
    assert.equal(r.propias.entrenamiento + r.propias.prueba, 9);
    assert.equal(r.propias.comoNada, 3);
    // Una segunda exportación usa el cache de los aumentos y da lo mismo.
    const otra = await exportar({ base: dir, categorias: carpetas, salida: join(dir, 'c'), espejo: true, aumentar: 2, extractores: solo(FUENTE) });
    assert.deepEqual(leerRasgos(join(dir, 'c', FUENTE, 'prueba_arruinada.bin')).filas.map(f => Array.from(f.vector)),
                     leerRasgos(join(dir, 'b', FUENTE, 'prueba_arruinada.bin')).filas.map(f => Array.from(f.vector)));
    assert.equal(otra.entrenamiento, r.entrenamiento - 4 * 3 * r.propias.entrenamiento);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('el detector calibrado: el umbral de cada clase pasa a valer 0,9', () => {
  assert.equal(recalibrar(0.66, 0.66), CONFIANZA_SEGURA);
  assert.ok(recalibrar(0.8, 0.66) > 0.9 && recalibrar(1, 0.66) === 1);
  assert.ok(Math.abs(recalibrar(0.33, 0.66) - 0.45) < 1e-9);
  assert.equal(recalibrar(0.7, null), 0.7);
  // D-FINE: sigmoide por clase, la mejor de cada consulta, en el orden de ids de COCO.
  const logits = new Float32Array(2 * 80).fill(-10);
  logits[0 * 80 + 0] = 2;          // persona
  logits[1 * 80 + 67] = 0;         // celular (id 77 de COCO, puesto 67), 0,5
  const cajas = Float32Array.from([0.5, 0.5, 0.2, 0.4, 0.25, 0.25, 0.1, 0.1]);
  const r = interpretarDfine(logits, cajas, 80, 640, 480, 0.4);
  assert.deepEqual(r.map(d => d.nombre), ['persona', 'celular']);
  assert.ok(Math.abs(r[0].confianza - 1 / (1 + Math.exp(-2))) < 1e-6);
  assert.deepEqual(Object.values(r[0].caja).map(Math.round), [256, 144, 128, 192]);   // x0, y0, ancho, alto
});

test('calibrar: el umbral más bajo con la precisión pedida, y nada con pocos ejemplos', () => {
  const lista = [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5].map((p, i) => ({ puntaje: p, cierto: i !== 2 && i < 5 }));
  assert.equal(umbralPara(lista, 0.8, { minimo: 3 }), 0.7);       // 4 de 5
  assert.equal(umbralPara(lista, 0.99, { minimo: 3 }), null);
  assert.equal(umbralPara(lista.slice(0, 2), 0.5), null);
  const reales = [{ nombre: 'taza', caja: { x0: 0, y0: 0, ancho: 10, alto: 10 } }];
  const marcadas = marcarCiertas([{ nombre: 'taza', confianza: 0.9, caja: { x0: 0, y0: 0, ancho: 10, alto: 10 } },
                                  { nombre: 'taza', confianza: 0.8, caja: { x0: 1, y0: 0, ancho: 10, alto: 10 } }], reales);
  assert.deepEqual(marcadas.map(d => d.cierto), [true, false]);    // la misma taza cuenta una vez
  assert.equal(umbralDeClase(lista.map(x => ({ confianza: x.puntaje, cierto: x.cierto })), 0.8, { minimo: 3 }), 0.7);
  assert.equal(umbralDeClase(lista.slice(0, 2).map(x => ({ confianza: x.puntaje, cierto: true })), 0.8), null);
});

test('CLIP: el vocabulario no tiene nada sobre gente, y las frases de un nombre suman', () => {
  for (const e of VOCABULARIO.filter(x => x.clase !== 'persona'))
    assert.doesNotMatch(`${e.es} ${e.en}`, /(?<!\p{L})(man|woman|boy|girl|people|hombre|mujer|chic[oa]|nen[ea])(?!\p{L})/iu, e.es);
  const v = new Vocabulario([{ es: 'taza', en: 'mug' }, { es: 'taza', en: 'cup' }, { es: 'lata', en: 'can' }],
                            [Float32Array.from([1, 0]), Float32Array.from([0.9, 0.1]), Float32Array.from([0, 1])]);
  const r = v.ranking(Float32Array.from([1, 0]), 5);
  assert.equal(r.length, 2);
  assert.equal(r[0].es, 'taza');
  assert.ok(Math.abs(r[0].p + r[1].p - 1) < 1e-6);
  assert.equal(v.probabilidadDe(r, 'lata'), r[1].p);
  assert.deepEqual(cuadradoDe({ x0: 300, y0: 10, ancho: 30, alto: 100 }, { width: 320, height: 240 }), { x0: 220, y0: 10, ancho: 100, alto: 100 });
});

test('el tokenizador de CLIP da los mismos números que el original', { skip: existsSync(join(DIR_CLIP, 'vocab.json')) ? false : 'falta modelos/clip-b32' }, () => {
  const t = Tokenizador.cargar();
  assert.deepEqual(t.codificar('a photo of a cat.'), [49406, 320, 1125, 539, 320, 2368, 269, 49407]);
});

// ── En la sesión ────────────────────────────────────────────────────────────
import { RedObjetos } from '../src/red_objetos.js';
import { DIM } from '../src/rasgos.js';
import { Sesion } from '../src/sesion.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';

const tic = () => new Promise(r => setImmediate(r));
function armarSesion({ general = 'pantalla', clip = null, vocabulario = null } = {}) {
  const json = [], guardadas = [], nombres = [];
  const estado = { general };
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
    conjunto: { clases: ['nada', 'persona', 'pantalla'], predecir: async () => ({ indice: 1, nombre: estado.general, confianza: 0.95 }) },
    guardarMuestra: (m) => { guardadas.push(m); return { archivo: `x/${guardadas.length}.jpg`, prueba: false }; },
    clip, vocabulario, guardarNombres: (l) => nombres.push(l),
  });
  const cuadro = cuadroJpeg('taza', azar(12));             // siempre el mismo: la misma cosa mirada
  const mostrar = async (n) => { for (let i = 0; i < n; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadro)); do { await tic(); } while (sesion.drenando); } };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  return { sesion, estado, json, guardadas, nombres, mostrar, hud };
}

test('cada prueba guarda la foto con lo que ERA; lo que no era deja de nombrarse; de una persona, nada', async () => {
  const a = armarSesion();
  a.sesion.anotarEvaluacion = () => {};
  await a.mostrar(5);
  assert.match(a.hud().pie, /pantalla/);
  assert.equal(a.sesion.alJson({ t: 'evaluar', acierto: true }).foto.archivo, 'x/1.jpg');
  assert.deepEqual([a.guardadas[0].clase, a.guardadas[0].mostrado, a.guardadas[0].origen], ['pantalla', 'pantalla', 'acerto']);
  assert.ok(jpeg.decode(a.guardadas[0].jpeg).width > 0);
  a.sesion.alJson({ t: 'evaluar', acierto: false, real: 'lata de aerosol' });
  assert.deepEqual([a.guardadas[1].clase, a.guardadas[1].mostrado], ['lata de aerosol', 'pantalla']);
  for (let i = 0; i < 4; i++) await tic();
  assert.equal(a.sesion.negativos.get('pantalla').length, 1);
  // La misma cosa, otra vez: ya no se llama «pantalla».
  await a.mostrar(5);
  assert.ok(a.sesion.noSe);                               // (la pantalla todavía dice «Anotado»)
  assert.equal(a.hud().pie, 'veo: ?');
  // Una persona: se anota la prueba, sin foto.
  const b = armarSesion({ general: 'persona' });
  b.sesion.anotarEvaluacion = () => {};
  await b.mostrar(5);
  assert.equal(b.sesion.alJson({ t: 'evaluar', acierto: false, real: 'perchero' }).foto, null);
  assert.equal(b.guardadas.length, 0);
});

test('CLIP: veta a la red si ve claro otra cosa, dice «Parece: …», y no suma nombres de gente', async () => {
  const clip = { imagen: async () => Float32Array.from([1, 0]), nombre: async (en) => Float32Array.from(en === 'marker pen' ? [0.6, 0.8] : [0, 1]) };
  const vocabulario = new Vocabulario([{ es: 'pantalla', en: 'monitor', clase: 'pantalla' }, { es: 'lata de aerosol', en: 'spray can', clase: null },
                                       { es: 'persona', en: 'person', clase: 'persona' }],
                                      [Float32Array.from([0, 1]), Float32Array.from([1, 0]), Float32Array.from([-1, 0])]);
  const a = armarSesion({ clip, vocabulario });
  await a.mostrar(5);
  assert.deepEqual([a.hud().titulo, a.hud().lineas[0], a.hud().pie], ['lata de aerosol', 'Parece; no es seguro', 'veo: ?']);
  assert.equal(a.json.filter(m => m.t === 'cajas').length, 0);    // sin detector no hay recuadros
  assert.equal(a.sesion.ejecutar('que_veo').parece, 'lata de aerosol');
  // Nombres: cosas sí, gente no.
  assert.match((await a.sesion.ejecutar('sumar_nombre', { nombre: 'mi amigo', en_ingles: 'my friend' })).motivo, /personas no/);
  assert.match((await a.sesion.ejecutar('sumar_nombre', { nombre: 'nena', en_ingles: 'little girl' })).motivo, /personas no/);
  assert.equal((await a.sesion.ejecutar('sumar_nombre', { nombre: 'Marcador', en_ingles: 'marker pen' })).ok, true);
  assert.deepEqual(a.nombres.at(-1), [{ es: 'marcador', en: 'marker pen' }]);
  // Si CLIP ve una persona, no nombra nada aunque la red no la vea.
  const conPersona = new Vocabulario(vocabulario.entradas.slice(), [Float32Array.from([0, 1]), Float32Array.from([1, 0]), Float32Array.from([0.99, 0])]);
  const b = armarSesion({ clip, vocabulario: conPersona });
  await b.mostrar(5);
  assert.equal(b.hud().titulo, 'No lo conozco');
});

test('el zoom reusa lo que ya vio el cuadro entero (una pasada menos)', async () => {
  const { detectarConZoom } = await import('../src/detector.js');
  let pasadas = 0;
  const detector = { async detectar() { pasadas++; return []; } };
  const img = { width: 320, height: 240, data: new Uint8Array(320 * 240 * 4) };
  const entero = [{ nombre: 'taza', confianza: 0.95, caja: { x0: 10, y0: 10, ancho: 20, alto: 20 } }];
  const r = await detectarConZoom(detector, img, { entero });
  assert.equal(pasadas, 1);                     // sólo la del centro
  assert.deepEqual(r.map(d => d.nombre), ['taza']);
});
