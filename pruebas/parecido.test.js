import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { EXTRACTORES } from '../src/extractores.js';
import { escribirRasgos } from '../src/formato_rasgos.js';
import { regionCentral } from '../src/imagen.js';
import { Ejemplos, UMBRAL_CONOCIDO } from '../src/parecido.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} ≠ ${b}`);

test('el parecido es el promedio del coseno con los 5 ejemplos más parecidos', () => {
  const e = new Ejemplos(new Map([
    ['taza', [[1, 0], [0, 1], [1, 1], [2, 0], [3, 0.1], [-1, 0], [0, -1]]],
  ]));
  // Con [1, 0]: 1, 1, 0,9994, 0,7071 y 0 son los 5 mejores (los opuestos quedan afuera).
  cerca(e.parecido([5, 0], 'taza'), (1 + 1 + Math.cos(Math.atan2(0.1, 3)) + Math.SQRT1_2 + 0) / 5);
  assert.equal(e.parecido([1, 0], 'celular'), null);         // sin ejemplos de esa clase
  assert.equal(e.conoce([1, 0], 'celular'), true);            // y entonces no se rechaza
  assert.equal(e.conoce([-1, -1], 'taza'), false);
  assert.equal(e.parecido([1, 0, 0], 'taza'), null);          // otra dimensión: no se compara
  assert.equal(e.total, 7);
  // Menos de 5 ejemplos: el promedio de los que hay.
  cerca(new Ejemplos(new Map([['x', [[1, 0], [0, 1]]]])).parecido([1, 0], 'x'), 0.5);
});

test('se cargan los ejemplos de la red general (sin el espejo) y los del detector', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-parecido-'));
  try {
    mkdirSync(join(dir, 'dino_s')); mkdirSync(join(dir, 'ejemplos_detector'));
    writeFileSync(join(dir, 'exportacion.json'), JSON.stringify({ filasPorFoto: 2 }));
    // Dos fotos de taza, cada una con su espejo.
    escribirRasgos(join(dir, 'dino_s', 'entrenamiento.bin'), { fuente: 'dino_s', dim: 2, clases: ['nada', 'taza'], filas: [
      { etiqueta: 1, vector: [1, 0] }, { etiqueta: 1, vector: [0.9, 0.1] }, { etiqueta: 1, vector: [0, 1] }, { etiqueta: 1, vector: [0.1, 0.9] },
    ] });
    escribirRasgos(join(dir, 'ejemplos_detector', 'entrenamiento.bin'), { fuente: 'dino_s', dim: 2, clases: ['zanahoria', 'taza'], filas: [
      { etiqueta: 0, vector: [1, 1] }, { etiqueta: 1, vector: [-1, 0] },
    ] });
    const e = Ejemplos.cargar(dir);
    assert.equal(e.porClase.get('taza').n, 3);                 // 2 fotos + 1 del detector
    assert.equal(e.porClase.get('zanahoria').n, 1);
    assert.equal(e.dim, 2);
    assert.equal(Ejemplos.cargar(join(dir, 'no-existe')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la red general muy segura de algo que no se parece a esa clase: «no lo conozco»', async () => {
  // Lo que la red mira en vivo es el recuadro del centro: ése es el vector que se compara.
  const rng = azar(21), cuadro = cuadroJpeg('taza', rng);
  const img = jpeg.decode(cuadro, { useTArray: true });
  const v = await EXTRACTORES[FUENTE].extraer(img, regionCentral(img));
  const armar = (vector) => {
    const json = [];
    const sesion = new Sesion({
      enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
      conjunto: { clases: ['nada', 'celular'], predecir: async () => ({ indice: 1, nombre: 'celular', confianza: 0.99 }) },
      ejemplos: new Ejemplos(new Map([['celular', [vector]]]), { fuente: FUENTE, dim: DIM }),
    });
    const mostrar = async (n) => { for (let i = 0; i < n; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadro)); do { await tic(); } while (sesion.drenando); } };
    return { sesion, mostrar, hud: () => json.filter(m => m.t === 'hud').at(-1) };
  };
  const lejos = armar(Array.from(v, x => -x - 1));
  await lejos.mostrar(5);
  assert.equal(lejos.hud().titulo, 'No lo conozco');
  assert.equal(lejos.hud().pie, 'veo: ?');
  assert.equal(lejos.sesion.ejecutar('que_veo').desconocido, true);

  const igual = armar(v);
  await igual.mostrar(5);
  assert.equal(igual.hud().pie, 'creo: celular 99%');
  assert.ok(UMBRAL_CONOCIDO > 0 && UMBRAL_CONOCIDO < 1);
});

test('unos ejemplos de otro extractor no se usan (no se pueden comparar)', () => {
  const e = new Ejemplos(new Map([['celular', [[1, 2, 3]]]]), { fuente: 'dino_s', dim: 3 });
  const sesion = new Sesion({ enviarJson() {}, enviarBin() {}, red: new RedObjetos(DIM, FUENTE), ejemplos: e });
  assert.equal(sesion.ejemplos, null);
});
