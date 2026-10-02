import assert from 'node:assert/strict';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { iou } from '../herramientas/medir_detector.js';
import { CLASES_DEL_DETECTOR, crearDetector, interpretar, tamanoDeEntrada } from '../src/detector.js';
import { normalizar, recorteDelRecuadro } from '../src/identificar.js';
import { focalDesdeFovDiagonal } from '../src/medir.js';
import { BIN_JPEG, empaquetar } from '../src/protocolo.js';
import { DIM, FUENTE } from '../src/rasgos.js';
import { RedObjetos } from '../src/red_objetos.js';
import { Permanencia } from '../src/permanencia.js';
import { RADIO_DE_MIRADA, Seguimiento, confirmar, dudosasDe, principalDe, renglonesDeMedida } from '../src/seguimiento.js';
import { Sesion } from '../src/sesion.js';
import { azar, cuadroJpeg, imagen } from './imagenes.js';

const tic = () => new Promise(r => setImmediate(r));
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} no está a ${tol} de ${b}`);
const W = 640, H = 480;
const det = (nombre, x0, y0, ancho, alto, confianza = 0.95) => ({ nombre, confianza, caja: { x0, y0, ancho, alto } });

test('el cuadro se le pasa al detector con la misma proporción y lados múltiplos de 16', () => {
  assert.deepEqual(tamanoDeEntrada(640, 480, 384), { ancho: 512, alto: 384 });
  assert.deepEqual(tamanoDeEntrada(320, 240, 384), { ancho: 512, alto: 384 });
  assert.deepEqual(tamanoDeEntrada(480, 640, 384), { ancho: 384, alto: 512 });
  const t = tamanoDeEntrada(500, 375, 384);
  assert.ok(t.ancho % 16 === 0 && t.alto % 16 === 0);
});

test('de las salidas crudas a objetos: se queda con los seguros y descarta «no hay nada»', () => {
  const N = 92, logits = new Float32Array(4 * N).fill(-5), cajas = new Float32Array(4 * 4);
  logits[0 * N + 77] = 9;                       // candidato 0: celular, el más seguro
  cajas.set([0.25, 0.5, 0.1, 0.4], 0);
  logits[1 * N + 91] = 8; logits[1 * N + 1] = 2;   // candidato 1: «no hay objeto»
  cajas.set([0.5, 0.5, 0.5, 0.5], 4);
  logits[2 * N + 12] = 6;                       // candidato 2: un id sin clase (hueco de COCO)
  cajas.set([0.5, 0.5, 0.2, 0.2], 8);
  logits[3 * N + 1] = 6;                        // candidato 3: persona que se sale del cuadro
  cajas.set([0.95, 0.5, 0.3, 1.2], 12);
  const r = interpretar(logits, cajas, N, W, H, 0.5);
  assert.deepEqual(r.map(d => d.nombre), ['celular', 'persona']);
  const redonda = Object.fromEntries(Object.entries(r[0].caja).map(([k, x]) => [k, Math.round(x)]));
  assert.deepEqual(redonda, { x0: 128, y0: 144, ancho: 64, alto: 192 });
  assert.ok(r[0].confianza > 0.99);
  assert.ok(r[1].caja.x0 + r[1].caja.ancho <= W && r[1].caja.y0 >= 0 && r[1].caja.alto <= H);   // recortada al cuadro
  assert.equal(CLASES_DEL_DETECTOR.length, 80);
  assert.ok(CLASES_DEL_DETECTOR.every(c => c.length <= 16));
});

test('el objeto principal: lo del centro, lo más específico, y lo que la persona tiene en la mano', () => {
  const persona = det('persona', 200, 40, 300, 440);
  // El caso de Martín: la cara al centro y el celular en la mano, al costado pero dentro de su recuadro.
  assert.equal(principalDe([persona, det('celular', 210, 150, 110, 200, 0.93)], W, H).nombre, 'celular');
  // Una taza en la mesa, FUERA del recuadro de la persona: se sigue mirando a la persona.
  assert.equal(principalDe([persona, det('taza', 20, 300, 80, 80)], W, H).nombre, 'persona');
  // Algo diminuto en la mano no le gana a la persona.
  assert.equal(principalDe([persona, det('reloj', 300, 300, 20, 20)], W, H).nombre, 'persona');
  // Dos recuadros contienen el centro: gana el más chico (la taza, no la mesa).
  assert.equal(principalDe([det('mesa', 0, 100, 640, 380), det('taza', 280, 200, 90, 90)], W, H).nombre, 'taza');
  // Nada contiene el centro: lo más cercano, si toca el círculo de la mirada.
  assert.equal(principalDe([det('auto', 20, 20, 100, 60), det('moto', 400, 260, 80, 60)], W, H).nombre, 'moto');
  // Lo dudoso no cuenta: de 0,5 a 0,9 el detector acierta menos de 4 de cada 10.
  assert.equal(principalDe([det('auto', 250, 200, 140, 90, 0.85)], W, H), null);
  assert.equal(principalDe([], W, H), null);
});

test('la mirada: lo que está fuera del círculo del centro no existe para la pantalla', () => {
  const radio = RADIO_DE_MIRADA * H;
  // Un auto bien marcado, pero en la esquina: no se lo está mirando.
  assert.equal(principalDe([det('auto', 20, 20, 100, 60)], W, H), null);
  // El mismo auto, justo adentro y justo afuera del círculo (a la derecha del centro).
  assert.equal(principalDe([det('auto', W / 2 + radio - 1, 220, 100, 60)], W, H).nombre, 'auto');
  assert.equal(principalDe([det('auto', W / 2 + radio + 1, 220, 100, 60)], W, H), null);
  // De todo lo que hay en el cuadro sale UNO solo.
  const muchos = [det('persona', 150, 20, 400, 460), det('silla', 10, 300, 90, 150), det('pantalla', 500, 40, 130, 100),
                  det('libro', 40, 60, 80, 50), det('planta', 560, 300, 70, 170)];
  assert.equal(principalDe(muchos, W, H).nombre, 'persona');

  // La captura de Martín del 2-oct-2026: la cara llena el cuadro, el detector marca
  // una cama en el fondo (arriba, dentro del recuadro de la persona) y toma la oreja
  // por un cepillo de dientes. Con el umbral viejo ganaba la cama.
  const cara = det('persona', 130, 0, 510, 470, 1);
  const cama = det('cama', 215, 90, 65, 25, 0.66), cepillo = det('cepillo dental', 350, 160, 40, 120, 0.52);
  assert.equal(principalDe([cara, cama, cepillo], W, H).nombre, 'persona');
  // Aunque el detector estuviera seguro de la cama, queda fuera de la mirada.
  assert.equal(principalDe([cara, { ...cama, confianza: 0.97 }, cepillo], W, H).nombre, 'persona');
});

test('la pantalla no cambia de tema antes de 4 cuadros, ni mueve el porcentaje por un punto', () => {
  const p = new Permanencia();
  const a = (confianza) => ({ nombre: 'taza', confianza }), b = { nombre: 'bol', confianza: 0.95 };
  assert.equal(p.actualizar(null), null);
  assert.equal(p.actualizar(a(0.92)).confianza, 0.92);            // lo primero entra enseguida
  assert.equal(p.actualizar(a(0.94)).confianza, 0.92);            // dos puntos: no se toca
  assert.equal(p.actualizar(b).nombre, 'taza');                   // otro tema, pero la taza lleva 2 cuadros
  assert.equal(p.actualizar(null).nombre, 'taza');                // tampoco se apaga antes de tiempo
  assert.equal(p.actualizar(b).nombre, 'bol');                    // al cuarto cuadro, cambia
  assert.equal(p.actualizar(a(0.99)).nombre, 'bol');
  assert.equal(p.actualizar(b).confianza, 0.95);
  // Si lo mismo sigue ahí y la confianza se movió de verdad, se actualiza.
  assert.equal(p.actualizar({ nombre: 'bol', confianza: 0.99, caja: 1 }).caja, 1);
  assert.equal(p.actualizar({ nombre: 'bol', confianza: 0.80 }).confianza, 0.80);
  // Alternando dos cosas a cada cuadro, en 40 cuadros hay como mucho 10 cambios.
  const q = new Permanencia();
  let cambios = 0, antes = null;
  for (let i = 0; i < 40; i++) { const m = q.actualizar(i % 2 ? b : a(0.95)); if (m?.nombre !== antes) cambios++; antes = m?.nombre; }
  assert.ok(cambios <= 10, `cambios: ${cambios}`);
  p.reiniciar();
  assert.equal(p.actualizar(null), null);
});

test('un auto que viene a 36 km/h: distancia, velocidad y tiempo de llegada', () => {
  const focal = focalDesdeFovDiagonal(W, H, 55);
  const s = new Seguimiento({ fovDiagonalGrados: 55 });
  const rng = azar(61);
  let m;
  for (let k = 0; k <= 8; k++) {
    const d = 45 - 10 * (k * 0.5);                         // 10 m/s: de 45 m a 5 m en 4 segundos
    const alto = 1.5 * focal / d * (1 + (rng() - 0.5) * 0.04);   // el recuadro tiembla ±2 %
    m = s.agregar(det('auto', 300, 240 - alto / 2, alto * 1.6, alto), W, H, k * 500);
    if (k < 3) assert.equal(m.velocidadKmh, null);          // todavía no hay con qué
  }
  cerca(m.distanciaM, 10, 1);                               // el promedio de las tres últimas lecturas: 15, 10 y 5 m
  cerca(m.velocidadKmh, 36, 5);
  cerca(m.llegadaS, 1, 0.3);
  assert.match(renglonesDeMedida(m).join(' | '), /^A ≈ [\d,]+ m \| Se acerca ≈ \d+ km\/h \| Llega en ≈ [\d,]+ s$/);
  assert.ok(renglonesDeMedida(m).every(l => l.length <= 21));
});

test('quieto, cortado por el borde, sin alto conocido y cambio de objeto', () => {
  const s = new Seguimiento();
  let m;
  for (let k = 0; k < 6; k++) m = s.agregar(det('persona', 280, 100, 80, 200), W, H, k * 500);
  assert.equal(m.velocidadKmh, 0);
  assert.equal(m.llegadaS, null);
  assert.deepEqual(renglonesDeMedida(m), ['A ≈ 6,5 m', 'Quieto']);
  // De a medio metro y de a 5 km/h: el último dígito no baila de un cuadro al otro.
  assert.deepEqual(renglonesDeMedida({ distanciaM: 6.71, velocidadKmh: 22.4, llegadaS: 1.08 }), ['A ≈ 6,5 m', 'Se acerca ≈ 20 km/h', 'Llega en ≈ 1,1 s']);
  assert.deepEqual(renglonesDeMedida({ distanciaM: 23.4, velocidadKmh: -6, llegadaS: null }), ['A ≈ 23 m', 'Se aleja ≈ 5 km/h']);
  // Toca el borde de abajo: está cortado, el alto es mentira.
  assert.equal(s.agregar(det('persona', 280, 200, 80, 280), W, H, 3000), null);
  assert.equal(s.agregar(det('persona', 280, 200, 80, 273), W, H, 3000), null);     // a 7 px del borde: también
  // Más ancha que alta: es un busto o está sentada, no mide 1,7 m.
  assert.equal(s.agregar(det('persona', 160, 195, 480, 250), W, H, 3000), null);
  // Un celular no tiene «alto típico»: no se mide, y se olvida lo anterior.
  assert.equal(s.agregar(det('celular', 280, 100, 80, 200), W, H, 3500), null);
  assert.equal(s.muestras.length, 0);
  // De golpe al doble de distancia: es otro objeto, se empieza de nuevo.
  s.agregar(det('auto', 280, 100, 300, 200), W, H, 4000);
  s.agregar(det('auto', 280, 100, 300, 200), W, H, 4500);
  s.agregar(det('auto', 300, 180, 100, 60), W, H, 5000);                 // más de 2,5 veces más lejos
  assert.equal(s.muestras.length, 1);
  assert.deepEqual(renglonesDeMedida(null), []);
});

test('cuánto se superponen dos recuadros', () => {
  const a = { x0: 0, y0: 0, ancho: 10, alto: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x0: 20, y0: 20, ancho: 5, alto: 5 }), 0);
  cerca(iou(a, { x0: 5, y0: 0, ancho: 10, alto: 10 }), 1 / 3, 1e-9);
});

// ── En la sesión ────────────────────────────────────────────────────────────
function armar({ detecciones, clasificador = 'persona', identificar } = {}) {
  const estado = { detecciones, t: 0 };
  const json = [], mediciones = [];
  const sesion = new Sesion({
    enviarJson: m => json.push(m), enviarBin() {}, red: new RedObjetos(DIM, FUENTE),
    // `clasificador` puede ser un nombre fijo o una función del recorte que le toca mirar.
    conjunto: { clases: [], predecir: async (img, region) => ({ indice: 0, nombre: typeof clasificador === 'function' ? clasificador(region) : clasificador, confianza: 0.95 }) },
    detector: { detectar: async () => { await tic(); return estado.detecciones; } },
    reloj: () => estado.t, identificar,
    registro: { reconocimiento() {}, tarjeta() {}, identificacion() {}, medicion: m => mediciones.push(m) },
  });
  const cuadro = jpeg.encode({ ...imagen('taza', azar(71)), width: 320, height: 240 }, 80).data;   // 320×240
  const mostrar = async (veces = 5, pasoMs = 500) => {
    for (let i = 0; i < veces; i++) { estado.t += pasoMs; sesion.alBinario(empaquetar(BIN_JPEG, cuadro)); do { await tic(); } while (sesion.drenando); }
  };
  const hud = () => json.filter(m => m.t === 'hud').at(-1);
  return { sesion, estado, json, mediciones, mostrar, hud };
}

test('con el celular en la mano junto a la cara, las gafas dicen «celular» y no «persona»', async () => {
  const persona = det('persona', 80, 10, 200, 225), celular = det('celular', 90, 80, 60, 110, 0.93);
  const { sesion, estado, json, mostrar, hud } = armar({ detecciones: [persona, celular] });
  await mostrar(2);
  assert.equal(hud().pie, 'veo: -');                              // dos cuadros no alcanzan
  await mostrar(3);
  assert.equal(hud().pie, 'creo: celular 93%');
  assert.equal(hud().titulo, 'celular 1/4');                      // con su ficha

  // Al emulador va UN recuadro: el del objeto que la pantalla nombra. Lo demás que
  // marcó el detector va aparte, crudo, y no se dibuja si no se pide.
  const cajas = json.filter(m => m.t === 'cajas').at(-1);
  assert.deepEqual([cajas.ancho, cajas.alto, cajas.radio], [320, 240, 53]);
  assert.deepEqual(cajas.mirado, { nombre: 'celular', x0: 92, y0: 80, ancho: 60, alto: 112, confianza: 93, metros: undefined });
  assert.deepEqual(cajas.lista.map(c => c.nombre), ['persona', 'celular']);

  // Se va el celular: queda la persona. Es un busto (más ancho que alto): NO se le
  // mide la distancia, porque el alto de 1,7 m no vale. A Martín, sentado a medio
  // metro de la cámara, le decía «A ≈ 3,5 m».
  estado.detecciones = [persona];
  await mostrar(5);
  assert.equal(hud().pie, 'creo: persona 95%');
  assert.equal(json.filter(m => m.t === 'cajas').at(-1).mirado.nombre, 'persona');
  assert.ok(!hud().lineas.some(l => l.startsWith('A ≈')), hud().lineas.join(' | '));
  assert.equal(sesion.ejecutar('que_veo').objeto, 'persona');

  // Una persona entera y de pie, sí.
  estado.detecciones = [det('persona', 130, 40, 60, 160)];
  await mostrar(5);
  assert.match(hud().lineas[0], /^A ≈ [\d,]+ m$/);

  // Se va todo.
  estado.detecciones = [];
  await mostrar(5);
  assert.equal(sesion.hay, null);
  assert.equal(sesion.medida, null);
});

test('el detector manda en el centro; al costado, mandan las redes del recuadro', async () => {
  // Una «banana» al costado (era una mano) y las redes seguras de que en el centro hay un celular.
  const a = armar({ detecciones: [det('banana', 5, 20, 90, 80, 0.93)], clasificador: 'celular' });
  await a.mostrar(5);
  assert.equal(a.hud().pie, 'creo: celular 95%');
  // La misma detección, pero EN el centro de la mirada: ahí manda el detector.
  const b = armar({ detecciones: [det('banana', 110, 80, 100, 90, 0.93)], clasificador: 'celular' });
  await b.mostrar(5);
  assert.equal(b.hud().pie, 'creo: banana 93%');
  // En el borde de la mirada (no contiene el centro) y con las redes diciendo «persona»: vale lo del detector.
  const c = armar({ detecciones: [det('taza', 30, 60, 90, 80, 0.93)], clasificador: 'persona' });
  await c.mostrar(5);
  assert.equal(c.hud().pie, 'creo: taza 93%');
  // Al costado, fuera de la mirada: no se muestra, por seguro que esté el detector.
  const d = armar({ detecciones: [det('taza', 5, 20, 90, 80, 0.99)], clasificador: 'nada' });
  await d.mostrar(5);
  assert.equal(d.hud().pie, 'veo: -');
  assert.equal(d.json.filter(m => m.t === 'cajas').at(-1).mirado, null);
});

test('lo que el detector marca sin estar seguro vale sólo si las redes propias dicen lo mismo', async () => {
  const persona = det('persona', 250, 40, 380, 430, 0.99);
  const celular = det('celular', 150, 150, 110, 200, 0.62);      // en la mano, tocando a la persona, dudoso
  const lejos = det('taza', 10, 10, 80, 80, 0.6), chico = det('reloj', 300, 300, 20, 20, 0.6);
  // Candidatos a segunda opinión: dudosos, en la mirada, de tamaño razonable y que no sean «persona».
  assert.deepEqual(dudosasDe([persona, celular, lejos, chico, det('persona', 300, 200, 80, 80, 0.6)], W, H), [celular]);
  assert.deepEqual(dudosasDe([{ ...celular, confianza: 0.95 }], W, H), []);

  const img = { width: W, height: H };
  const redes = (nombre, confianza = 0.85) => ({ predecir: async () => ({ nombre, confianza }) });
  // Coinciden: vale, con el nombre del detector y la confianza de las redes.
  const ok = await confirmar([persona, celular], img, redes('celular'));
  assert.deepEqual(ok, [{ nombre: 'celular', confianza: 0.85, caja: celular.caja, confirmado: true }]);
  assert.equal(principalDe([persona, celular], W, H).nombre, 'persona');
  assert.equal(principalDe([persona, celular, ...ok], W, H).nombre, 'celular');
  // Las redes dicen otra cosa, o lo mismo sin estar seguras: no vale. Medido: cuando
  // no coinciden aciertan 1 de cada 3, por seguras que estén.
  assert.deepEqual(await confirmar([celular], img, redes('control remoto', 0.99)), []);
  assert.deepEqual(await confirmar([celular], img, redes('celular', 0.6)), []);
});

test('en la sesión: un celular dudoso junto a la cara aparece si las redes lo confirman', async () => {
  const persona = det('persona', 125, 20, 190, 215, 0.99), celular = det('celular', 75, 75, 55, 100, 0.62);
  // Las redes ven «persona» en el recuadro del centro y «celular» en el recorte angosto.
  const mira = (region) => region.ancho < 80 ? 'celular' : 'persona';
  const a = armar({ detecciones: [persona, celular], clasificador: mira });
  await a.mostrar(5);
  assert.equal(a.hud().pie, 'creo: celular 95%');
  assert.equal(a.json.filter(m => m.t === 'cajas').at(-1).mirado.nombre, 'celular');
  // Sin que coincidan, el dudoso no existe.
  const b = armar({ detecciones: [persona, celular], clasificador: 'persona' });
  await b.mostrar(5);
  assert.equal(b.hud().pie, 'creo: persona 99%');
});

test('la captura de Martín: cara al centro, cama al fondo y oreja tomada por cepillo → una sola cosa, y quieta', async () => {
  const cara = det('persona', 65, 0, 255, 235, 1);
  const cama = (c) => det('cama', 108, 45, 32, 12, c), cepillo = (c) => det('cepillo dental', 175, 80, 20, 60, c);
  const { estado, json, mostrar, hud } = armar({ detecciones: [cara, cama(0.66), cepillo(0.52)] });
  await mostrar(5);
  assert.equal(hud().pie, 'creo: persona 100%');
  // El detector cambia de opinión a cada cuadro sobre lo del fondo: la pantalla no se entera.
  const antes = json.filter(m => m.t === 'hud').length;
  for (let i = 0; i < 12; i++) {
    estado.detecciones = i % 2 ? [cara, cama(0.5 + i / 40), cepillo(0.7)] : [cara, cepillo(0.6), det('silla', 5, 150, 60, 80, 0.75)];
    await mostrar(1);
  }
  assert.equal(json.filter(m => m.t === 'hud').length, antes);    // ni un redibujo del OLED
  const cajas = json.filter(m => m.t === 'cajas');
  assert.ok(cajas.slice(-12).every(m => m.mirado?.nombre === 'persona'));
});

test('un vehículo en el cuadro se mide y se anota una vez por segundo', async () => {
  const { estado, mediciones, mostrar, hud } = armar({ detecciones: [det('auto', 100, 100, 120, 60)], clasificador: 'nada' });
  await mostrar(8, 500);
  assert.equal(hud().titulo, 'auto 1/3');
  assert.equal(hud().lineas[0], 'A ≈ 9,5 m');                    // 60 px de alto en un cuadro de 320×240
  assert.equal(hud().lineas[1], 'Quieto');
  assert.equal(hud().pie, 'creo: auto 95%');
  // 8 cuadros en 4 segundos, estable desde el tercero: entre 2 y 3 mediciones, no 6.
  assert.ok(mediciones.length >= 2 && mediciones.length <= 3, `mediciones: ${mediciones.length}`);
  assert.equal(mediciones[0].objeto, 'auto');
  assert.ok(mediciones[0].distanciaM > 5);
  estado.detecciones = [];
});

test('marca y modelo con detector: viaja el recorte del APARATO, y con sólo una persona se niega', async () => {
  const pedidos = [];
  const identificar = async (cuadro, pista, caja) => { pedidos.push({ pista, caja }); return normalizar({ tipo: 'celular', modelo: 'X', seguridad: 'baja', caracteristicas: [], partes: [] }); };
  const persona = det('persona', 80, 10, 200, 225), celular = det('celular', 90, 80, 60, 110, 0.93);

  // Hay una persona en el cuadro, pero el detector localizó el celular: se manda SU recuadro.
  const a = armar({ detecciones: [persona, celular], identificar });
  await a.mostrar(5);
  assert.equal((await a.sesion.ejecutar('identificar_dispositivo')).ok, true);
  assert.deepEqual(pedidos, [{ pista: 'celular', caja: celular.caja }]);

  // Sólo una persona: no se manda nada.
  const b = armar({ detecciones: [persona], identificar });
  await b.mostrar(5);
  const r = await b.sesion.ejecutar('identificar_dispositivo');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /persona/);
  assert.equal(pedidos.length, 1);

  // El recorte que viaja es el de la caja (con margen), no el cuadro ni el centro.
  const cuadro = cuadroJpeg('taza', azar(72));
  const recorte = jpeg.decode(recorteDelRecuadro(cuadro, { x0: 100, y0: 50, ancho: 50, alto: 100 }), { useTArray: true });
  assert.deepEqual([recorte.width, recorte.height], [58, 116]);
});

const real = await crearDetector();
test('el detector de verdad carga y contesta', { skip: real ? false : 'no está modelos/yolos-tiny o falta onnxruntime-node' }, async () => {
  const r = await real.detectar(imagen('nada', azar(73)));
  assert.ok(Array.isArray(r));
  assert.ok(r.every(d => d.confianza >= 0.5 && CLASES_DEL_DETECTOR.includes(d.nombre)));
});

test('sin el modelo no hay detector y nadie se cae', async () => {
  assert.equal(await crearDetector({ ruta: 'modelos/no-existe.onnx' }), null);
});
