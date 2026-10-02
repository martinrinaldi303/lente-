import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encolarAcotado } from '../src/cola_acotada.js';
import { envolver, recortar } from '../src/hud.js';
import { calibrarFocal, distanciaPorReferenciaMm, focalDesdeFov, pesoEstimadoG, tamanoRealMm } from '../src/medir.js';

const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} no está a ${tol} de ${b}`);

test('medir: una tarjeta de 85,6 mm a 30 cm, ida y vuelta', () => {
  // Se calibra con la tarjeta: a 300 mm ocupa 180 px.
  const focal = calibrarFocal(180, 85.6, 300);
  cerca(tamanoRealMm(180, 300, focal), 85.6, 1e-9);
  // Al doble de distancia ocupa la mitad de píxeles y mide lo mismo.
  cerca(tamanoRealMm(90, 600, focal), 85.6, 1e-9);
  // Sin sensor: la tarjeta en la imagen da la distancia, y con ella se mide otra cosa.
  const d = distanciaPorReferenciaMm(120, 85.6, focal);
  cerca(d, 450, 1e-9);
  cerca(tamanoRealMm(240, d, focal), 171.2, 1e-9);
});

test('medir: la focal que sale del campo de visión', () => {
  cerca(focalDesdeFov(320, 90), 160, 1e-9);     // con 90° la focal es medio ancho
});

test('peso: un cubo de acero de 1 cm pesa 7,85 g', () => {
  cerca(pesoEstimadoG({ forma: 'caja', anchoMm: 10, altoMm: 10, fondoMm: 10, material: 'acero' }), 7.85, 1e-9);
  // Un litro de agua en un cilindro.
  cerca(pesoEstimadoG({ forma: 'cilindro', diametroMm: 100, altoMm: 127.32, material: 'agua' }), 1000, 0.1);
  // Una pieza impresa al 15 % de relleno pesa el 15 %.
  cerca(pesoEstimadoG({ forma: 'caja', anchoMm: 50, altoMm: 50, fondoMm: 50, material: 'pla', relleno: 0.15 }), 23.25, 1e-9);
  assert.throws(() => pesoEstimadoG({ forma: 'caja', anchoMm: 1, altoMm: 1, fondoMm: 1, material: 'unobtanio' }));
});

test('hud: ningún renglón pasa de 21 columnas', () => {
  const lineas = envolver('Desenroscar la tuerca supercalifragilisticoespialidosa con la llave del 10 y guardarla aparte');
  assert.equal(lineas.length, 3);
  assert.ok(lineas.every(l => l.length <= 21), JSON.stringify(lineas));
  assert.ok(lineas[2].endsWith('…'));
  assert.deepEqual(envolver('Hola'), ['Hola']);
  assert.deepEqual(envolver(''), []);
  assert.equal(recortar('  dos   espacios  '), 'dos espacios');
  assert.equal(recortar('x'.repeat(30)).length, 21);
});

test('cola acotada: descarta lo más viejo', () => {
  const cola = [];
  assert.equal(encolarAcotado(cola, 1, 2), 0);
  assert.equal(encolarAcotado(cola, 2, 2), 0);
  assert.equal(encolarAcotado(cola, 3, 2), 1);
  assert.deepEqual(cola, [2, 3]);
});
