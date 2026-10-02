import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DIM, FUENTE, extraerRasgos } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { azar, imagen } from './imagenes.js';

function vectores(objeto, cuantos, rng) {
  return Array.from({ length: cuantos }, () => extraerRasgos(imagen(objeto, rng)));
}

function acierto(red, objeto, cuantos, rng) {
  let ok = 0;
  for (const v of vectores(objeto, cuantos, rng)) if (red.predecir(v)?.nombre === objeto) ok++;
  return ok / cuantos;
}

test('los rasgos tienen la dimensión declarada y no traen NaN', () => {
  const v = extraerRasgos(imagen('taza', azar(1)));
  assert.equal(v.length, DIM);
  assert.ok(v.every(Number.isFinite));
});

test('con una sola clase la red no opina', () => {
  const red = new RedObjetos(DIM, FUENTE);
  for (const v of vectores('taza', 12, azar(2))) red.agregarEjemplo('taza', v);
  red.entrenar();
  assert.equal(red.predecir(extraerRasgos(imagen('taza', azar(3)))), null);
});

test('aprende tres objetos y el fondo con 12 cuadros de cada uno', () => {
  const red = new RedObjetos(DIM, FUENTE);
  const rng = azar(4);
  for (const o of ['nada', 'taza', 'pinza', 'cinta'])
    for (const v of vectores(o, 12, rng)) red.agregarEjemplo(o, v);
  red.entrenar();
  // Cuadros NUEVOS, que no estuvieron en el entrenamiento.
  const prueba = azar(99);
  for (const o of ['nada', 'taza', 'pinza', 'cinta'])
    assert.ok(acierto(red, o, 30, prueba) >= 0.9, `acierto bajo en ${o}`);
});

test('agregar un objeto nuevo no borra los que ya sabía', () => {
  const red = new RedObjetos(DIM, FUENTE);
  const rng = azar(5);
  for (const o of ['nada', 'taza'])
    for (const v of vectores(o, 12, rng)) red.agregarEjemplo(o, v);
  red.entrenar();
  for (const v of vectores('pinza', 12, rng)) red.agregarEjemplo('pinza', v);
  red.entrenar();
  const prueba = azar(98);
  for (const o of ['taza', 'pinza']) assert.ok(acierto(red, o, 30, prueba) >= 0.9, `acierto bajo en ${o}`);
});

test('un vector de otra dimensión se rechaza y NO toca los pesos', () => {
  const red = new RedObjetos(DIM, FUENTE);
  const rng = azar(6);
  for (const o of ['taza', 'pinza'])
    for (const v of vectores(o, 12, rng)) red.agregarEjemplo(o, v);
  red.entrenar();
  const antes = JSON.stringify(red.aJSON());
  const aviso = console.warn; console.warn = () => {};
  try {
    assert.equal(red.predecir(new Float32Array(64)), null);
    assert.equal(red.agregarEjemplo('taza', new Float32Array(64)), false);
  } finally { console.warn = aviso; }
  assert.equal(JSON.stringify(red.aJSON()), antes);
});

test('guardar y cargar devuelve la misma red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-'));
  try {
    const red = new RedObjetos(DIM, FUENTE);
    const rng = azar(7);
    for (const o of ['taza', 'cinta'])
      for (const v of vectores(o, 12, rng)) red.agregarEjemplo(o, v);
    red.entrenar();
    red.guardar(dir);
    const otra = RedObjetos.cargar(dir, DIM, FUENTE);
    const v = extraerRasgos(imagen('cinta', azar(8)));
    assert.deepEqual(otra.predecir(v), red.predecir(v));
    // Un archivo de otra dimensión no se usa a medias: se arranca de cero.
    assert.equal(RedObjetos.desdeJSON(red.aJSON(), 64, FUENTE), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('olvidar saca la clase y deja el resto', () => {
  const red = new RedObjetos(DIM, FUENTE);
  const rng = azar(9);
  for (const o of ['taza', 'pinza', 'cinta'])
    for (const v of vectores(o, 12, rng)) red.agregarEjemplo(o, v);
  red.entrenar();
  assert.equal(red.olvidar('Pinza'), true);
  red.entrenar();
  assert.deepEqual(red.clases, ['taza', 'cinta']);
  assert.ok(acierto(red, 'cinta', 20, azar(97)) >= 0.9);
});
