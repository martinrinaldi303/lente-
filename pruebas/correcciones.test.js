import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { abrirBase } from '../src/base.js';
import { Correcciones, coseno, esCorregido, filtrarCorregidos } from '../src/correcciones.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const v = (...xs) => Float32Array.from(xs);
const det = (nombre, x0, y0, ancho, alto, confianza = 0.96) => ({ nombre, confianza, caja: { x0, y0, ancho, alto } });

test('una corrección vale si se parece mucho a lo corregido y menos a los ejemplos de verdad', () => {
  assert.ok(Math.abs(coseno(v(1, 0), v(1, 0)) - 1) < 1e-9);
  const ropa = [v(1, 0, 0)], personas = [v(0, 1, 0), v(0.2, 0.9, 0.1)];
  assert.equal(esCorregido(v(0.95, 0.1, 0), ropa, personas), true);            // la misma ropa, otro cuadro
  assert.equal(esCorregido(v(0.1, 0.95, 0), ropa, personas), false);           // una persona
  assert.equal(esCorregido(v(0.6, 0.6, 0), ropa, personas), false);            // ni una ni otra: no se tira
  // Sin ejemplos de verdad de la clase, hace falta parecerse mucho más.
  assert.equal(esCorregido(v(0.9, 0.3, 0), ropa, undefined), false);
  assert.equal(esCorregido(v(1, 0.05, 0), ropa, undefined), true);
});

test('filtrar: lo corregido se va; una persona con cara a la vista, nunca', async () => {
  // Un extractor de mentira: el vector depende de dónde está el recuadro.
  const extractor = { async extraer(img, r) { return r.x0 < 100 ? v(1, 0, 0) : v(0, 1, 0); } };
  const negativos = new Map([['persona', [v(1, 0, 0)]]]);
  const ropa = det('persona', 10, 10, 60, 120), yo = det('persona', 150, 20, 120, 200, 0.99), taza = det('taza', 20, 150, 30, 30);
  const img = { width: 320, height: 240, data: new Uint8Array(320 * 240 * 4) };
  let r = await filtrarCorregidos([ropa, yo, taza], img, { negativos, positivos: new Map(), extractor });
  assert.deepEqual(r.quedan, [yo, taza]);
  assert.deepEqual(r.tiradas, [ropa]);
  // Si en el recuadro corregido hay una cara, es una persona: se queda.
  const caras = { async detectar() { return [{ confianza: 0.97, caja: { x0: 25, y0: 20, ancho: 30, alto: 30 } }]; } };
  r = await filtrarCorregidos([ropa, yo], img, { negativos, positivos: new Map(), extractor, caras });
  assert.deepEqual(r.tiradas, []);
  // Sin correcciones no se mira nada.
  r = await filtrarCorregidos([ropa], img, { negativos: new Map(), extractor: { extraer() { throw new Error('no tenía que mirar'); } } });
  assert.deepEqual(r.quedan, [ropa]);
});

// ── En la sesión ────────────────────────────────────────────────────────────
function armar({ detecciones, caraEn = null } = {}) {
  const estado = { detecciones };
  const json = [], guardadas = [];
  let olvidadas = 0;
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
    conjunto: { clases: [], predecir: async () => ({ indice: 0, nombre: 'nada', confianza: 0.95 }) },
    detector: { detectar: async () => { await tic(); return estado.detecciones; } },
    caras: caraEn ? { async detectar() { return [{ confianza: 0.97, caja: caraEn, puntos: [] }]; } } : null,
    guardarCorreccion: (clase, fuente, vector) => { guardadas.push({ clase, fuente, n: vector.length }); },
    olvidarCorrecciones: () => { olvidadas++; },
  });
  const rng = azar(33);
  const mostrar = async (n) => { for (let i = 0; i < n; i++) { sesion.alBinario(empaquetar(BIN_JPEG, cuadroJpeg('taza', rng))); do { await tic(); } while (sesion.drenando); } };
  const cajas = () => json.filter(m => m.t === 'cajas').at(-1);
  const avisos = () => json.filter(m => m.t === 'aviso').map(m => m.texto);
  return { sesion, estado, json, guardadas, mostrar, cajas, avisos, olvidadas: () => olvidadas };
}

test('tocar un recuadro equivocado: no se marca más, se guarda, y se puede olvidar', async () => {
  const ropa = det('persona', 200, 30, 90, 180), yo = det('persona', 40, 20, 120, 210, 0.99);
  const a = armar({ detecciones: [ropa, yo], caraEn: { x0: 70, y0: 40, ancho: 50, alto: 50 } });
  await a.mostrar(3);
  a.sesion.alJson({ t: 'corregir', nombre: 'persona', caja: ropa.caja });
  await tic(); await tic();
  assert.match(a.avisos().at(-1), /Listo: eso no es «persona»/);
  assert.deepEqual(a.guardadas, [{ clase: 'persona', fuente: FUENTE, n: DIM }]);
  await a.mostrar(2);
  const lista = a.cajas().lista;
  assert.deepEqual(lista.map(c => [c.x0, Boolean(c.corregido)]), [[40, false], [200, true]]);
  assert.deepEqual(a.cajas().escena.objetos.map(o => o.x0), [40]);
  // A él no se lo puede corregir: tiene la cara a la vista.
  a.sesion.alJson({ t: 'corregir', nombre: 'persona', caja: yo.caja });
  await tic(); await tic();
  assert.match(a.avisos().at(-1), /Ahí hay una cara/);
  // Olvidar las correcciones: vuelve a marcarse.
  assert.match(a.sesion.alJson({ t: 'olvidar_correcciones' }).frase, /Olvidé 1 corrección$/);
  assert.equal(a.olvidadas(), 1);
  await a.mostrar(2);
  assert.ok(a.cajas().lista.every(c => !c.corregido));
});

test('por voz, «eso no es una persona» corrige lo que no tiene cara, nunca a quien la tiene', async () => {
  const ropa = det('persona', 200, 30, 90, 180), yo = det('persona', 100, 20, 120, 210, 0.99);
  const a = armar({ detecciones: [yo, ropa], caraEn: { x0: 130, y0: 40, ancho: 50, alto: 50 } });
  await a.mostrar(3);
  const r = await a.sesion.ejecutar('no_es', { nombre: 'una persona' });
  assert.equal(r.ok, true);
  await a.mostrar(2);
  assert.deepEqual(a.cajas().lista.filter(c => c.corregido).map(c => c.x0), [200]);
  // Si la única persona tiene cara, no hay nada para corregir.
  const b = armar({ detecciones: [yo], caraEn: { x0: 130, y0: 40, ancho: 50, alto: 50 } });
  await b.mostrar(2);
  assert.match((await b.sesion.ejecutar('no_es', { nombre: 'persona' })).motivo, /No veo ningún «persona»/);
});

// ── Con la base ─────────────────────────────────────────────────────────────
try { process.loadEnvFile('.env'); } catch { /* sin .env: se saltea */ }
const base = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
}, () => {});
const saltear = base ? false : 'MySQL apagado o sin DB_* en .env';

test('las correcciones se guardan por cuenta y por extractor, y se olvidan', { skip: saltear }, async () => {
  const c = new Correcciones(base.pool);
  const usuario = 900000 + randomBytes(2).readUInt16LE(0);          // una cuenta de mentira: no hay clave foránea
  try {
    await c.agregar(usuario, 'persona', 'dino_s', v(1, 2, 3));
    await c.agregar(usuario, 'notebook', 'dino_s', v(4, 5, 6));
    await c.agregar(usuario, 'persona', 'otro', v(1, 1));
    const m = await c.deUsuario(usuario, 'dino_s', 3);
    assert.deepEqual([...m.keys()].sort(), ['notebook', 'persona']);
    assert.deepEqual(Array.from(m.get('persona')[0]), [1, 2, 3]);
    assert.equal((await c.deUsuario(usuario + 1, 'dino_s', 3)).size, 0);   // las de otro no
    assert.equal(await c.olvidar(usuario), 3);
    assert.equal((await c.deUsuario(usuario, 'dino_s', 3)).size, 0);
  } finally {
    await base.pool.query('DELETE FROM correcciones WHERE usuario_id = ?', [usuario]);
    await base.cerrar();
  }
});
