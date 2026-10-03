import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { BINARIO } from '../herramientas/compilar.js';
import { entrenarTodo } from '../herramientas/entrenar_todo.js';
import { exportar, vaAPrueba } from '../herramientas/exportar_rasgos.js';
import { Conjunto, votantes } from '../src/conjunto.js';
import { EXTRACTORES } from '../src/extractores.js';
import { leerRasgos } from '../src/formato_rasgos.js';
import { regionCompleta } from '../src/imagen.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedGeneral } from '../src/red_general.js';
import { azar, cuadroJpeg } from './imagenes.js';

const SIN_BINARIO = existsSync(BINARIO) ? false : 'falta compilar: npm run compilar';

// Una base de juguete con la forma de Caltech-256: una carpeta por clase.
function baseDeJuguete(dir, porCarpeta) {
  const rng = azar(41);
  const carpetas = { '001.vacio': 'nada', '002.taza-roja': 'taza', '003.pinza-azul': 'pinza', '004.cinta': 'cinta', '005.otra-taza': 'taza' };
  for (const [carpeta, clase] of Object.entries(carpetas)) {
    mkdirSync(join(dir, carpeta));
    for (let i = 0; i < porCarpeta; i++)
      writeFileSync(join(dir, carpeta, `${carpeta.slice(0, 3)}_${String(i).padStart(4, '0')}.jpg`), cuadroJpeg(clase, rng));
  }
  writeFileSync(join(dir, '001.vacio', 'roto.jpg'), 'esto no es un jpeg');
  return carpetas;
}

test('exportar: una carpeta por clase, reparto fijo y JPEG rotos salteados', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-base-'));
  try {
    const categorias = baseDeJuguete(dir, 30);
    categorias['999.no-existe'] = 'fantasma';
    const salida = join(dir, 'rasgos');
    const r = await exportar({ base: dir, categorias, salida });

    assert.equal(r.saltadas, 1);
    assert.deepEqual(r.carpetasFaltantes, ['999.no-existe']);
    assert.equal(r.entrenamiento + r.prueba, 150);
    // Dos carpetas a la misma clase se suman.
    assert.equal(r.porClase.taza.entrenamiento + r.porClase.taza.prueba, 60);
    // Cerca del 20 % a prueba, y siempre las mismas.
    assert.ok(r.prueba >= 15 && r.prueba <= 45, `prueba=${r.prueba}`);
    assert.equal(vaAPrueba('002.taza-roja/002_0007.jpg'), vaAPrueba('002.TAZA-ROJA/002_0007.JPG'));

    // Una carpeta por extractor, con las mismas filas en el mismo orden.
    assert.deepEqual(r.fuentes, Object.keys(EXTRACTORES));
    const porFuente = r.fuentes.map(f => leerRasgos(join(salida, f, 'entrenamiento.bin')));
    for (const [k, ent] of porFuente.entries()) {
      const e = EXTRACTORES[r.fuentes[k]];
      assert.equal(ent.fuente, e.fuente);
      assert.equal(ent.dim, e.dim);
      // La clase cuya carpeta no existe no entra: sería una salida sin ejemplos.
      assert.deepEqual(ent.clases, ['nada', 'taza', 'pinza', 'cinta']);
      assert.equal(ent.filas.length, r.entrenamiento);
      assert.ok(ent.filas.every(f => f.vector.length === e.dim && f.vector.every(Number.isFinite)));
      assert.deepEqual(ent.filas.map(f => f.etiqueta), porFuente[0].filas.map(f => f.etiqueta));
    }
    assert.equal(JSON.parse(readFileSync(join(salida, 'exportacion.json'), 'utf8')).filasPorFoto, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exportar con espejo duplica el entrenamiento y deja la prueba como está', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-base-'));
  try {
    const categorias = baseDeJuguete(dir, 20);
    const simple = await exportar({ base: dir, categorias, salida: join(dir, 'a') });
    const doble  = await exportar({ base: dir, categorias, salida: join(dir, 'b'), espejo: true });
    assert.equal(doble.entrenamiento, 2 * simple.entrenamiento);
    assert.equal(doble.prueba, simple.prueba);
    assert.equal(doble.filasPorFoto, 2);
    // La foto y su espejo van en filas seguidas, con la misma etiqueta.
    const ent = leerRasgos(join(dir, 'b', FUENTE, 'entrenamiento.bin'));
    for (let k = 0; k < ent.filas.length; k += 2) assert.equal(ent.filas[k].etiqueta, ent.filas[k + 1].etiqueta);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('varios extractores a la vez: se entrenan por separado y votan juntos', { skip: SIN_BINARIO }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-conj-'));
  try {
    const categorias = baseDeJuguete(dir, 40);
    const dirRasgos = join(dir, 'rasgos'), dirEstado = join(dir, 'estado');
    await exportar({ base: dir, categorias, salida: dirRasgos, espejo: true });
    const r = entrenarTodo({ dirRasgos, dirEstado, epocas: 8, registrar: () => {} });

    assert.equal(r.filas.length, Object.keys(EXTRACTORES).length + 2);
    assert.ok(r.pesado.acierto >= 0.9 && r.parejo.acierto >= 0.9);
    assert.ok(r.azar < 0.6);

    const conjunto = Conjunto.cargar(dirEstado);
    assert.deepEqual(conjunto.miembros.map(m => m.extractor.fuente), Object.keys(EXTRACTORES));
    assert.ok(conjunto.miembros.every(m => m.peso > 0 && m.peso <= 1));
    // En vivo: una imagen entra, cada extractor saca su vector y sale un solo voto.
    const img = jpeg.decode(cuadroJpeg('pinza', azar(77)), { useTArray: true });
    const p = await conjunto.predecir(img, regionCompleta(img));
    assert.equal(p.nombre, 'pinza');
    assert.ok(p.confianza > 0.5 && p.confianza <= 1);

    assert.equal(Conjunto.cargar(join(dir, 'vacio')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('las redes en C++ aprenden, y el cerebro predice lo mismo que midió el entrenador', { skip: SIN_BINARIO }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-cpp-'));
  try {
    const categorias = baseDeJuguete(dir, 60);
    const salida = join(dir, 'rasgos');
    await exportar({ base: dir, categorias, salida });
    const pesos = join(dir, 'red_general.json');
    const informe = execFileSync(BINARIO,
      [join(salida, FUENTE, 'entrenamiento.bin'), join(salida, FUENTE, 'prueba.bin'), pesos, '--epocas', '30'], { encoding: 'utf8' });
    assert.match(informe, /ventaja sobre el azar .* significativa/);

    const red = RedGeneral.cargar(pesos, DIM, FUENTE);
    assert.ok(red, 'el cerebro no pudo cargar los pesos del entrenador');
    assert.deepEqual(red.redes.map(r => r.nombre), ['class23', 'class24']);
    assert.deepEqual(red.redes[0].tam, [DIM, DIM / 2, DIM / 4, 4]);
    assert.deepEqual(red.redes[1].tam, [DIM, 64, 4]);

    const m = red.medicion;
    assert.ok(m.acierto >= 0.9, `acierto ${m.acierto}`);
    assert.ok(m.azar < 0.6);
    assert.equal(m.significativa, true);

    // La misma cuenta en los dos lenguajes: imagen por imagen.
    const prueba = leerRasgos(join(salida, FUENTE, 'prueba.bin'));
    assert.equal(prueba.filas.length, m.n_prueba);
    const iguales = prueba.filas.filter((f, k) => red.predecir(f.vector).indice === m.predicciones_prueba[k]).length;
    assert.equal(iguales, prueba.filas.length, 'JS y C++ no predicen lo mismo');
    const aciertoJs = prueba.filas.filter(f => red.predecir(f.vector).indice === f.etiqueta).length / prueba.filas.length;
    assert.ok(Math.abs(aciertoJs - m.acierto) < 1e-12);

    // Un archivo de otro extractor no se usa a medias.
    const aviso = console.warn; console.warn = () => {};
    try {
      assert.equal(RedGeneral.cargar(pesos, 64, FUENTE), null);
      assert.equal(RedGeneral.cargar(pesos, DIM, 'otro_extractor'), null);
    } finally { console.warn = aviso; }
    assert.equal(RedGeneral.cargar(join(dir, 'no-existe.json'), DIM, FUENTE), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('el entrenador rechaza archivos que no son de rasgos', { skip: SIN_BINARIO }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gafas-cpp-'));
  try {
    const basura = join(dir, 'basura.bin');
    writeFileSync(basura, 'no soy un archivo de rasgos');
    assert.throws(() => execFileSync(BINARIO, [basura, basura, join(dir, 'x.json')], { stdio: 'pipe' }));
    assert.equal(existsSync(join(dir, 'x.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('con DINOv2 vota sólo él; sin el modelo, votan los hechos a mano', () => {
  const propios = Object.values(EXTRACTORES), dino = { fuente: 'dino_s', dim: 384, extraer: () => [] };
  assert.deepEqual(votantes([...propios, dino]), [dino]);
  assert.deepEqual(votantes(propios), propios);
  assert.deepEqual(votantes([...propios, dino], { todos: true }), [...propios, dino]);
});
