import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CLASES_DEL_DETECTOR } from '../src/detector.js';
import { fichaDe, paginasDe, paginasSueltas, resumenDeFicha } from '../src/fichas.js';
import { ANIMALES, ESPECIES_DE, NIVELES, pisoDePeligro } from '../src/fichas_animales.js';
import { PIEZAS } from '../src/fichas_piezas.js';
import { normalizar } from '../src/identificar.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const COLS = 21;

function armar({ dice = 'serpiente', identificar } = {}) {
  const estado = { dice, t: 0 };
  const json = [];
  const conjunto = { clases: [], predecir: async () => ({ indice: 0, nombre: estado.dice, confianza: 0.9 }) };
  const sesion = new Sesion({ enviarJson: m => json.push(m), enviarBin: () => {}, red: new RedObjetos(DIM, FUENTE),
                              conjunto, identificar, reloj: () => estado.t });
  const rng = azar(61);
  const mostrar = async (cuantos = 5) => {
    for (let i = 0; i < cuantos; i++) {
      estado.t += 500;
      sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng)));
      do { await tic(); } while (sesion.drenando);
    }
  };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  const alertas = () => json.filter(m => m.t === 'alerta');
  return { sesion, estado, json, mostrar, hud, alertas };
}

test('las fichas de animales y de piezas entran en el OLED y están completas', () => {
  for (const [nombre, a] of Object.entries(ANIMALES)) {
    assert.ok(NIVELES.includes(a.peligro), `${nombre}: peligro «${a.peligro}»`);
    assert.ok(a.tipo && a.hacer.length && a.rasgos.length, nombre);
    for (const l of [a.tipo, ...a.hacer, ...a.rasgos]) assert.ok(l.length <= COLS, `${nombre}: «${l}» tiene ${l.length}`);
  }
  for (const [nombre, p] of Object.entries(PIEZAS)) {
    assert.ok(p.funcion.length && p.diseno.length && p.caracteristicas.length, nombre);
    for (const l of [p.aviso ?? '', ...p.funcion, ...p.diseno, ...p.caracteristicas]) assert.ok(l.length <= COLS, `${nombre}: «${l}» tiene ${l.length}`);
  }
  // Toda página, de cualquier ficha, entra: título y hasta tres renglones.
  for (const nombre of [...Object.keys(ANIMALES), ...Object.keys(PIEZAS)])
    for (const p of [...paginasDe(nombre), ...paginasSueltas(nombre).map(lineas => ({ lineas, fijas: [] }))]) {
      assert.ok([...(p.fijas ?? []), ...p.lineas].length <= 3 || p.fijas.length, nombre);
      for (const l of [...(p.fijas ?? []), ...p.lineas]) assert.ok(l.length <= COLS, `${nombre}: «${l}»`);
    }
});

test('todo animal que reconocen la red general o el detector tiene su ficha', () => {
  const categorias = JSON.parse(readFileSync(new URL('../herramientas/categorias.json', import.meta.url), 'utf8'));
  const animalesDelDetector = ['pajaro', 'gato', 'perro', 'caballo', 'oveja', 'vaca', 'elefante', 'oso', 'cebra', 'jirafa'];
  for (const n of animalesDelDetector) {
    assert.ok(CLASES_DEL_DETECTOR.includes(n), `el detector no dice «${n}»`);
    assert.equal(fichaDe(n)?.tipo, 'animal', n);
  }
  const clases = new Set(Object.values(categorias));
  for (const n of Object.keys(ANIMALES).filter(n => clases.has(n))) assert.equal(fichaDe(n).clave, n);
  // Las clases nuevas de la red (3-oct-2026) que son animales, todas con ficha.
  for (const [carpeta, clase] of Object.entries(categorias))
    if (/^(007|009|024|028|034|038|040|049|052|056|057|060|064|065|080|084|085|087|089|090|093|100|105|111|113|114|116|121|124|129|134|150|151|152|158|164|166|168|179|186|189|190|198|201|207|250|254|256)\./.test(carpeta))
      assert.equal(fichaDe(clase)?.tipo, 'animal', `${carpeta} → ${clase}`);
  // Las especies que se le reconocen a «pajaro» existen.
  for (const e of ESPECIES_DE.pajaro) assert.ok(ANIMALES[e], e);
  // Un peluche no es un animal.
  assert.equal(fichaDe('oso de peluche').tipo, 'aparato');
});

test('los nombres se buscan sin tildes ni mayúsculas, y con sus otros nombres', () => {
  assert.equal(fichaDe('Memoria RAM').clave, 'memoria ram');
  assert.equal(fichaDe('ram').clave, 'memoria ram');
  assert.equal(fichaDe('Víbora').clave, 'serpiente');
  assert.equal(fichaDe('escorpión').clave, 'alacran');
  assert.equal(fichaDe('Placa de Video').tipo, 'pieza');
  assert.equal(fichaDe('celular').tipo, 'aparato');
  assert.equal(fichaDe('no existe'), null);
  assert.deepEqual(resumenDeFicha('alacran').que_hacer.at(-1), 'Intox.: 0800-333-0160');
  assert.equal(resumenDeFicha('fuente').aviso, 'No abrir: capacitores');
});

test('el peligro de lo venenoso no baja, lo diga quien lo diga', () => {
  assert.equal(pisoDePeligro('Yarará', 'bajo'), 'alto');
  assert.equal(pisoDePeligro('culebra inofensiva', 'bajo'), 'alto');
  assert.equal(pisoDePeligro('Araña del rincón', 'bajo'), 'medio');
  assert.equal(pisoDePeligro('oso de peluche', 'bajo'), 'bajo');
  assert.equal(pisoDePeligro('oso pardo', 'medio'), 'muy alto');
  assert.equal(pisoDePeligro('gato', 'bajo'), 'bajo');
  assert.equal(pisoDePeligro('pirata', 'bajo'), 'bajo');            // «rata» va como palabra, no adentro de otra

  // Lo que contesta el LLM pasa por el mismo piso, el de la ficha propia, y si no
  // está seguro de la especie, no baja de «medio».
  assert.equal(normalizar({ categoria: 'animal', tipo: 'culebra', peligro: 'bajo', seguridad: 'alta', caracteristicas: [] }).peligro, 'alto');
  assert.equal(normalizar({ categoria: 'animal', tipo: 'murcielago', peligro: 'bajo', seguridad: 'alta', caracteristicas: [] }).peligro, 'medio');
  assert.equal(normalizar({ categoria: 'animal', tipo: 'Gato montés', peligro: 'bajo', seguridad: 'baja', caracteristicas: [] }).peligro, 'medio');
  assert.equal(normalizar({ categoria: 'animal', tipo: 'gato', peligro: 'bajo', seguridad: 'alta', caracteristicas: [] }).peligro, 'bajo');
  const a = normalizar({ categoria: 'animal', tipo: 'Yarará', marca: 'Acme', peligro: 'altísimo', seguridad: 'media', caracteristicas: ['Cruz en la cabeza'] });
  assert.equal(a.peligro, 'alto');
  assert.equal(a.marca, '');                                          // un animal no tiene marca
  assert.deepEqual(a.que_hacer.slice(0, 2), ['Tratala de venenosa', 'Alejate despacio']);   // sin consejo del LLM, el de la ficha
  assert.deepEqual(normalizar({ categoria: 'animal', tipo: 'Cobra', seguridad: 'alta', caracteristicas: [] }).que_hacer, ['No te acerques']);
  const p = normalizar({ categoria: 'pieza', tipo: 'Memoria RAM', marca: 'Kingston', modelo: 'DDR4 8 GB', seguridad: 'alta',
                         funcion: ['Guarda lo que usás'], diseno: ['Tira con chips'], caracteristicas: ['DDR4'], peligro: 'alto' });
  assert.deepEqual([p.categoria, p.marca, p.funcion, p.diseno, p.peligro], ['pieza', 'Kingston', ['Guarda lo que usás'], ['Tira con chips'], undefined]);
});

test('un animal en la mirada: el peligro y qué hacer arriba, y un aviso por minuto si es peligroso', async () => {
  const { sesion, estado, mostrar, hud, alertas } = armar({ dice: 'serpiente' });
  await mostrar(5);
  // Primero, la pantalla de cuidado con tres pitidos.
  assert.deepEqual(alertas().map(a => [a.tipo, a.objeto, a.peligro]), [['animal', 'serpiente', 'alto']]);
  assert.deepEqual(hud(), { t: 'hud', titulo: '¡CUIDADO!', lineas: ['serpiente', 'Peligro: ALTO', 'Tratala de venenosa'], pie: 'creo: serpiente 90%' });
  // A los 3 s, la ficha: el peligro sigue arriba.
  await mostrar(7);
  assert.deepEqual(hud().lineas, ['Peligro: ALTO', 'Tratala de venenosa', 'Reptil']);
  assert.match(hud().titulo, /^serpiente 1\/\d$/);
  sesion.alJson({ t: 'paso', hacia: 1 });
  assert.deepEqual(hud(), { t: 'hud', titulo: 'Qué hacer 2/3', lineas: ['Alejate despacio', 'Si muerde: al médico', 'Intox.: 0800-333-0160'], pie: 'creo: serpiente 90%' });
  // No vuelve a pitar enseguida; pasado el minuto, sí.
  await mostrar(20);
  assert.equal(alertas().length, 1);
  estado.t += 60000;
  await mostrar(1);
  assert.equal(alertas().length, 2);

  // A lo que no es peligroso no se le pita, y la ficha dice su nivel.
  const gato = armar({ dice: 'gato' });
  await gato.mostrar(6);
  assert.equal(gato.alertas().length, 0);
  assert.deepEqual(gato.hud().lineas.slice(0, 2), ['Peligro: bajo', 'Puede arañar']);
  assert.equal(gato.sesion.ejecutar('que_veo').peligro, 'bajo');
});

test('mostrar_ficha: la pieza o el animal que se nombra, sin mirar la cámara', () => {
  const { sesion, hud } = armar();
  const r = sesion.ejecutar('mostrar_ficha', { nombre: 'Memoria RAM' });
  assert.equal(r.ok, true);
  assert.equal(r.es, 'pieza');
  assert.deepEqual(r.funcion, ['Guarda lo que usás', 'Se borra al apagar']);
  assert.deepEqual(hud().lineas, ['Guarda lo que usás', 'Se borra al apagar']);
  assert.match(hud().titulo, /^memoria ram 1\/\d$/);
  sesion.ejecutar('pasos_ir', { hacia: 'siguiente' });
  assert.deepEqual(hud().lineas, ['Diseño:', 'Tira con chips', 'DIMM o SO-DIMM (nb)']);
  assert.equal(sesion.ejecutar('mostrar_ficha', { nombre: 'unicornio' }).ok, false);
});

test('identificar un animal: el peligro en la primera página, y aviso si es alto', async () => {
  const identificar = async () => normalizar({ categoria: 'animal', tipo: 'Yarará', peligro: 'alto', seguridad: 'media',
    caracteristicas: ['Cruz en la cabeza'], que_hacer: ['Alejate despacio', 'No la toques', 'Si muerde: 107'] });
  const { sesion, mostrar, hud, alertas } = armar({ dice: 'nada', identificar });
  await mostrar(3);
  const r = await sesion.ejecutar('identificar');
  assert.equal(r.ok, true);
  assert.match(r.nota, /primero el peligro/);
  assert.deepEqual(hud().lineas, ['Peligro: ALTO', 'Alejate despacio', 'Seguridad: media']);
  assert.deepEqual(alertas().map(a => a.objeto), ['Yarará']);
  sesion.ejecutar('pasos_ir', { hacia: 'siguiente' });
  assert.deepEqual(hud().lineas, ['Qué hacer:', 'No la toques', 'Si muerde: 107']);
});
