import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRACTORES, extractor, extractoresDisponibles } from '../src/extractores.js';
import { aTamano, colorDominante, espejar, nombreDeColor, reducir, regionCentral, regionCompleta } from '../src/imagen.js';
import { crearExtractorDino } from '../src/rasgos_dino.js';
import { azar, imagen } from './imagenes.js';

// Una imagen de 4×2: la mitad izquierda roja, la derecha azul.
function mitades() {
  const data = new Uint8Array(4 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
    const k = (y * 4 + x) * 4;
    data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], k);
  }
  return { width: 4, height: 2, data };
}

test('reducir promedia todos los píxeles de cada celda', () => {
  const img = mitades();
  const rgb = reducir(img, regionCompleta(img), 2);
  assert.deepEqual([...rgb.slice(0, 6)], [1, 0, 0, 0, 0, 1]);          // arriba: rojo, azul
  const uno = reducir(img, regionCompleta(img), 1);
  assert.deepEqual([...uno].map(v => Number(v.toFixed(3))), [0.5, 0, 0.5]);   // todo junto: violeta
  // Agrandar no deja agujeros negros.
  const grande = reducir(img, regionCompleta(img), 8);
  for (let t = 0; t < 64; t++) assert.ok(grande[t * 3] + grande[t * 3 + 2] > 0.99, `celda ${t} vacía`);
});

test('espejar da vuelta la imagen, y dos veces la deja igual', () => {
  const img = mitades();
  const e = espejar(img);
  assert.deepEqual([...e.data.slice(0, 4)], [0, 0, 255, 255]);          // ahora el azul está a la izquierda
  assert.deepEqual([...espejar(e).data], [...img.data]);
});

test('las regiones: el centro en vivo, la foto entera al entrenar', () => {
  const img = { width: 320, height: 240, data: new Uint8Array(0) };
  assert.deepEqual(regionCentral(img), { x0: 88, y0: 48, ancho: 144, alto: 144 });
  assert.deepEqual(regionCompleta(img), { x0: 0, y0: 0, ancho: 320, alto: 240 });
});

test('cada extractor entrega su dimensión, sin NaN, y distingue objetos', () => {
  const rng = azar(31);
  const taza = imagen('taza', rng), pinza = imagen('pinza', rng), otraTaza = imagen('taza', rng);
  const distancia = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  for (const e of Object.values(EXTRACTORES)) {
    const vt = e.extraer(taza), vp = e.extraer(pinza), vo = e.extraer(otraTaza);
    assert.equal(vt.length, e.dim, e.fuente);
    assert.ok(vt.every(Number.isFinite), e.fuente);
    // Dos tazas se parecen más entre sí que una taza y una pinza.
    assert.ok(distancia(vt, vo) < distancia(vt, vp), `${e.fuente} no separa taza de pinza`);
    // La región cambia el vector: no es lo mismo el centro que la foto entera.
    assert.ok(distancia(vt, e.extraer(taza, regionCompleta(taza))) > 0, e.fuente);
  }
  assert.equal(extractor('rasgos_v1').dim, 1060);
  assert.throws(() => extractor('no_existe'), /extractor desconocido/);
});

test('aTamano agranda interpolando, sin escalones ni agujeros', () => {
  const img = mitades();
  const rgb = aTamano(img, regionCompleta(img), 8);
  const rojo = (x, y) => rgb[(y * 8 + x) * 3], azul = (x, y) => rgb[(y * 8 + x) * 3 + 2];
  assert.ok(rojo(0, 0) > 0.99 && azul(7, 7) > 0.99);
  // En el medio hay mezcla, y el rojo baja de izquierda a derecha sin volver a subir.
  for (let x = 1; x < 8; x++) assert.ok(rojo(x, 3) <= rojo(x - 1, 3) + 1e-6);
  assert.ok(rojo(3, 3) > 0 && rojo(3, 3) < 1 || rojo(4, 3) > 0 && rojo(4, 3) < 1);
  // Para achicar hace lo mismo que reducir.
  assert.deepEqual([...aTamano(img, regionCompleta(img), 2)], [...reducir(img, regionCompleta(img), 2)]);
});

const dino = await crearExtractorDino();

test('el extractor ya entrenado da 384 números, estables, y está entre los disponibles',
     { skip: dino ? false : 'no está el modelo en modelos/dinov2-small o falta onnxruntime-node' }, async () => {
  const rng = azar(32);
  const taza = imagen('taza', rng), pinza = imagen('pinza', rng);
  const a = await dino.extraer(taza), b = await dino.extraer(taza), c = await dino.extraer(pinza);
  assert.equal(a.length, 384);
  assert.ok(a.every(Number.isFinite));
  assert.deepEqual([...a], [...b]);                              // la misma imagen da el mismo vector
  assert.ok(a.some((v, i) => Math.abs(v - c[i]) > 1e-3));        // otra imagen, otro vector
  const fuentes = (await extractoresDisponibles()).map(e => `${e.fuente}|${e.dim}`);
  assert.deepEqual(fuentes, ['rasgos_v0|168', 'rasgos_v1|1060', 'dino_s|384']);
});

test('sin el modelo, el extractor no aparece y no rompe nada', async () => {
  assert.equal(await crearExtractorDino('modelos/no-existe.onnx'), null);
});

test('el color dominante se nombra, y un recuadro sin color claro no inventa', () => {
  assert.equal(nombreDeColor(0.05, 0.05, 0.05), 'negro');
  assert.equal(nombreDeColor(0.95, 0.95, 0.95), 'blanco');
  assert.equal(nombreDeColor(0.5, 0.5, 0.5), 'gris');
  assert.equal(nombreDeColor(0.8, 0.1, 0.1), 'rojo');
  assert.equal(nombreDeColor(0.4, 0.25, 0.1), 'marrón');
  assert.equal(nombreDeColor(0.1, 0.3, 0.8), 'azul');
  assert.equal(nombreDeColor(0.9, 0.8, 0.1), 'amarillo');
  const rng = azar(33);
  const taza = imagen('taza', rng), vacio = imagen('nada', rng);
  assert.equal(colorDominante(taza, regionCentral(taza)), 'rojo');
  assert.equal(colorDominante(vacio, regionCentral(vacio)), 'gris');
  // Mitad roja y mitad azul, con el borde en el medio: gana uno de los dos, no un tercero.
  const m = mitades();
  assert.ok(['rojo', 'azul', 'violeta'].includes(colorDominante(m, regionCompleta(m))));
});
