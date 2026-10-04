// servidor.js — el cerebro de las gafas.
//
// Sirve el emulador (publico/) y atiende el WebSocket /ws/gafas, que es por donde
// entran las gafas: hoy el emulador del navegador, mañana el ESP32. Los dos hablan
// el mismo protocolo (src/protocolo.js).
//
// Con la base prendida hay cuentas (src/cuentas.js): el panel en /cuenta.html y
// /panel.html, y cada conexión de gafas es de un usuario y usa LO QUE ÉL enseñó.
// Quién es cada conexión:
//   · el emulador con la sesión del panel abierta → ese usuario, «Emulador»;
//   · unas gafas que saludan con la llave de un par vinculado → el dueño de ese par;
//   · el TOKEN_GAFAS del .env, o el emulador sin sesión (sólo en esta PC) → «sin cuenta»,
//     que es lo de siempre: lo aprendido antes de las cuentas.
//
//   node servidor.js          y abrir http://localhost:8787 (Google sólo acepta ese origen)

import express from 'express';
import jpeg from 'jpeg-js';
import { timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { abrirBase, sincronizarRed } from './src/base.js';
import { Cuentas, SIN_CUENTA, leerCookie, rutasDeCuentas } from './src/cuentas.js';
import { crearVerificadorGoogle } from './src/google.js';
import { rutasDeApp } from './src/rutas_app.js';
import { crearCaras } from './src/caras.js';
import { Conocidos, rutasDeConocidos } from './src/conocidos.js';
import { Correcciones, cargarPositivos, leerCategorias } from './src/correcciones.js';
import { Ejemplos } from './src/parecido.js';
import { cargarVocabulario, crearClip } from './src/clip.js';
import { VOCABULARIO } from './src/vocabulario_clip.js';
import { Conjunto, votantes } from './src/conjunto.js';
import { crearDetector } from './src/detector.js';
import { extractoresDisponibles } from './src/extractores.js';
import { cargarGuias, resumenDeGuias } from './src/guias.js';
import { Memoria } from './src/memoria.js';
import { Muestras } from './src/muestras.js';
import { FUENTE } from './src/rasgos.js';
import { FUENTE as DINO } from './src/rasgos_dino.js';
import { RedObjetos } from './src/red_objetos.js';
import { Sesion } from './src/sesion.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(RAIZ, '.env')); } catch { /* sin .env: valores por defecto */ }

const HOST   = process.env.HOST || '127.0.0.1';
const PUERTO = Number(process.env.PUERTO) || 8787;
const TOKEN  = process.env.TOKEN_GAFAS || '';
// Qué LLM conversa. Dos posibles, y se usa uno:
//   deepseek → conversa por escrito y mira el aparato para «marca y modelo». No tiene audio.
//   gemini   → Gemini Live: escucha y habla él.
// Si no se dice con LLM=…, gana DeepSeek cuando está su clave.
const CLAVE_GEMINI   = process.env.GEMINI_API_KEY || '';
const CLAVE_DEEPSEEK = process.env.DEEPSEEK_API_KEY || '';
const PEDIDO = (process.env.LLM || '').trim().toLowerCase();
const LLM = PEDIDO === 'gemini'   ? (CLAVE_GEMINI ? 'gemini' : '')
          : PEDIDO === 'deepseek' ? (CLAVE_DEEPSEEK ? 'deepseek' : '')
          : CLAVE_DEEPSEEK ? 'deepseek' : CLAVE_GEMINI ? 'gemini' : '';
const CLAVE  = LLM === 'deepseek' ? CLAVE_DEEPSEEK : LLM === 'gemini' ? CLAVE_GEMINI : '';
const MODELO = LLM === 'deepseek' ? (process.env.DEEPSEEK_MODEL || 'deepseek-flash') : (process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live');
const MODELO_VISION = LLM === 'deepseek' ? (process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash') : (process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash');
// Si el modelo de visión de Gemini está saturado (pasó el 2-oct-2026: 503), se prueba con éste.
const RESERVA_VISION = process.env.GEMINI_VISION_RESERVA || 'gemini-3.5-flash-lite';
const BASE_DEEPSEEK = process.env.DEEPSEEK_BASE_URL || undefined;
const FALTA_CLAVE = PEDIDO === 'gemini' ? 'LLM=gemini y falta GEMINI_API_KEY en .env'
                  : PEDIDO === 'deepseek' ? 'LLM=deepseek y falta DEEPSEEK_API_KEY en .env'
                  : 'falta DEEPSEEK_API_KEY o GEMINI_API_KEY en .env';
const VISION_AL_LLM = process.env.VISION_AL_LLM === '1';
// Crear cuentas: por defecto sólo desde esta PC. Con REGISTRO=abierto, desde cualquier
// equipo que llegue al cerebro (con HOST=0.0.0.0, cualquiera de la red WiFi).
const REGISTRO_ABIERTO = (process.env.REGISTRO || '').trim().toLowerCase() === 'abierto';
// «Continuar con Google»: con el ID de cliente alcanza (el secreto no se usa).
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const verificarGoogle = GOOGLE_CLIENT_ID ? crearVerificadorGoogle({ clientId: GOOGLE_CLIENT_ID }) : null;
const DIR_ESTADO = join(RAIZ, 'estado');
const MS_PARA_SALUDAR = 5000;

const LOCALES = new Set(['127.0.0.1', 'localhost', '::1']);
if (!LOCALES.has(HOST) && TOKEN.length < 16) {
  // Mismo criterio que el JWT_SECRET de MIIA: abierto a la red y sin llave, no arranca.
  console.error(`❌ HOST=${HOST} abre el cerebro a la red y TOKEN_GAFAS tiene menos de 16 caracteres.`);
  console.error('   Por ese puerto entran micrófono y cámara. Poné un TOKEN_GAFAS largo en .env.');
  process.exit(1);
}

const extractores = await extractoresDisponibles();
// La red personal (la del botón Enseñar) usa el extractor ya entrenado si está, y
// si no, rasgos_v0. Cada extractor tiene SU archivo de red: cambiar de uno a otro
// no pisa lo aprendido con el anterior, pero tampoco lo traduce.
const extractorPersonal = extractores.find(e => e.fuente === DINO) ?? extractores.find(e => e.fuente === FUENTE);
const red = RedObjetos.cargar(DIR_ESTADO, extractorPersonal.dim, extractorPersonal.fuente);
// Las redes entrenadas con la base pública. null si todavía no se corrió `npm run entrenar`.
//
// Si un entrenamiento se corta a la mitad, quedan redes de corridas distintas con
// listas de clases distintas (pasó el 2-oct-2026: una con 55 clases y dos con 40).
// Eso no tiene que tumbar el cerebro: se avisa y se sigue sin red general.
let conjunto = null;
try { conjunto = Conjunto.cargar(DIR_ESTADO, { extractores: votantes(extractores, { todos: process.env.VOTANTES === 'todos' }) }); }
catch (e) { console.warn(`⚠️ red general no cargada: ${e.message}. Corré «npm run entrenar» hasta el final.`); }
// El detector dice dónde está cada objeto. Si falta el modelo, las gafas siguen
// con las redes del recuadro del centro, como antes.
const detector = await crearDetector();
// Personas conocidas: sólo las que se cargaron ellas mismas y le dieron permiso a una
// cuenta (src/caras.js). Sin los modelos, las gafas andan igual, sin reconocer a nadie.
const caras = await crearCaras().catch((e) => { console.warn(`⚠️ modelos de caras: ${e.message}`); return null; });
const FOV_DIAGONAL = Number(process.env.CAMARA_FOV_DIAGONAL) || 55;   // la Logi C270

// La base (MySQL de XAMPP) es opcional: sin ella lo aprendido vive sólo en estado/.
const base = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
});
let ejemplosDeLaBase = null;
if (base) {
  try { ejemplosDeLaBase = await sincronizarRed(base, red); }
  catch (e) { console.warn(`⚠️ no se pudo leer lo aprendido de la base: ${e.message}`); }
}
// Lo aprendido SIN CUENTA se guarda en los dos lados: el archivo, que no depende de
// nada, y la base, que es la que manda al arrancar. Lo de cada cuenta, sólo en la base.
const guardarRedDe = (usuarioId) => (r) => {
  if (usuarioId === SIN_CUENTA) {
    try { r.guardar(DIR_ESTADO); }
    catch (e) { console.warn(`⚠️ no se pudo guardar la red: ${e.message}`); }
  }
  base?.guardarEjemplos(r, usuarioId).catch(e => console.warn(`⚠️ no se pudo guardar lo aprendido en la base: ${e.message}`));
};

// Una red personal por usuario, armada con SUS ejemplos de la base. Todas las conexiones
// del mismo usuario comparten la misma: lo que se enseña con un par lo ve el otro.
const redes = new Map([[SIN_CUENTA, Promise.resolve(red)]]);
function redDe(usuarioId) {
  if (!redes.has(usuarioId)) redes.set(usuarioId, (async () => {
    const r = new RedObjetos(extractorPersonal.dim, extractorPersonal.fuente);
    for (const { nombre, vectores } of await base.cargarEjemplos(r.fuente, r.inDim, usuarioId))
      for (const v of vectores) r.agregarEjemplo(nombre, v);
    if (r.clases.length) r.entrenar();
    return r;
  })().catch(e => { redes.delete(usuarioId); throw e; }));
  return redes.get(usuarioId);
}

// «¿Dónde dejé…?» (src/memoria.js): sólo nombres de objetos, hora y lugar. Una por
// usuario: nadie pregunta por las llaves de otro. No se sube a git.
const memorias = new Map();
const memoriaDe = (usuarioId) => {
  if (!memorias.has(usuarioId)) memorias.set(usuarioId, new Memoria({
    archivo: join(DIR_ESTADO, usuarioId === SIN_CUENTA ? 'memoria.json' : `memoria_u${usuarioId}.json`),
  }));
  return memorias.get(usuarioId);
};
const memoria = memoriaDe(SIN_CUENTA);

// Las cuentas necesitan la base: sin MySQL, el panel avisa y las gafas andan «sin cuenta».
const cuentas = base ? new Cuentas(base.pool) : null;
const conocidos = base ? new Conocidos(base.pool) : null;
const conocidosDe = async (usuarioId) => (usuarioId && conocidos && caras ? conocidos.deLector(usuarioId).catch(() => []) : []);
// Lo que cada cuenta le corrigió al detector («esto no es una persona», src/correcciones.js),
// y los ejemplos de verdad de cada clase para comparar (de datos/rasgos, si está).
const correcciones = base ? new Correcciones(base.pool) : null;
const positivos = cargarPositivos({ dirRasgos: join(RAIZ, 'datos', 'rasgos'), categorias: leerCategorias(join(RAIZ, 'herramientas', 'categorias.json')),
                                    fuente: extractorPersonal.fuente, dim: extractorPersonal.dim });
// Para decir «no sé qué es» (src/parecido.js): cómo se ve de verdad cada clase.
const ejemplos = Ejemplos.cargar(join(RAIZ, 'datos', 'rasgos'), { fuente: extractorPersonal.fuente });
// CLIP (src/clip.js): compara lo que se ve con nombres escritos. La tercera opinión, y
// «Parece: …» para lo que ninguna red conoce. Sin los modelos, las gafas andan igual.
const clip = await crearClip().catch((e) => { console.warn(`⚠️ CLIP: ${e.message}`); return null; });
const vocabularioBase = clip ? await cargarVocabulario(clip, VOCABULARIO, join(DIR_ESTADO, 'vocabulario_clip.json')) : null;
// Los nombres que suma cada cuenta («sabé que existen los marcadores»), en estado/.
const archivoNombres = (usuarioId) => join(DIR_ESTADO, `nombres_u${usuarioId}.json`);
async function vocabularioDe(usuarioId) {
  if (!vocabularioBase) return null;
  const v = vocabularioBase.copia();
  let propios = [];
  try { propios = JSON.parse(readFileSync(archivoNombres(usuarioId), 'utf8')); } catch { /* todavía no sumó ninguno */ }
  for (const n of propios) await v.sumar(clip, { es: n.es, en: n.en, clase: null, propio: true }).catch(() => {});
  return v;
}
// Lo que cada cuenta dijo que NO era (sus fotos de «se equivocó» y sus correcciones), como
// vectores del extractor personal: clase → [vector]. Se arma una vez por cuenta, y las
// sesiones de esa cuenta comparten el mismo Map (lo nuevo lo ven todas).
const negativos = new Map();
async function negativosDe(usuarioId) {
  if (negativos.has(usuarioId)) return negativos.get(usuarioId);
  const porClase = new Map(), indice = muestras.indice();
  negativos.set(usuarioId, porClase);
  for (const m of muestras.listar().filter(m => m.usuario === `u${usuarioId}`)) {
    const mostrado = indice.get(m.archivo)?.mostrado;
    const clase = m.noEs ? m.clase : mostrado && mostrado !== m.clase ? mostrado : null;
    if (!clase || clase === 'persona') continue;
    try {
      const img = jpeg.decode(readFileSync(m.ruta), { useTArray: true, maxResolutionInMP: 4 });
      const v = await extractorPersonal.extraer(img, { x0: 0, y0: 0, ancho: img.width, alto: img.height });
      if (!porClase.has(clase)) porClase.set(clase, []);
      porClase.get(clase).push(v);
    } catch { /* una foto rota no frena nada */ }
  }
  return porClase;
}
const guardarNombresDe = (usuarioId) => (lista) => {
  try { writeFileSync(archivoNombres(usuarioId), JSON.stringify(lista, null, 2)); }
  catch (e) { console.warn(`⚠️ no se pudieron guardar los nombres: ${e.message}`); }
};
const correccionesDe = async (usuarioId) => (correcciones
  ? correcciones.deUsuario(usuarioId, extractorPersonal.fuente, extractorPersonal.dim).catch(() => new Map()) : new Map());
// Las conexiones de gafas abiertas, con su dueño: { ws, dueno }. Sirve para mostrar en el
// panel qué anteojos están conectados y para cortar los de una llave revocada.
const conexiones = new Set();
const anteojosConectados = () => new Set([...conexiones].map(c => c.dueno?.anteojos?.id).filter(Boolean));
const cortar = (cumple, motivo) => { for (const c of conexiones) if (cumple(c.dueno)) c.ws.close(4403, motivo); };
// Alguien dio o sacó un permiso, o cargó una foto: las gafas de esas cuentas, al día.
async function recargarConocidos(lectores) {
  const ids = new Set(lectores);
  for (const c of conexiones) {
    const id = c.dueno?.usuario?.id;
    if (id && ids.has(id)) c.sesion?.ponerConocidos(await conocidosDe(id));
  }
}

// Lo aprendido sin cuenta, otra vez desde la base (después de pasarlo a una cuenta). El
// archivo de estado/ se reescribe igual: si no, al arrancar volvería a subir lo que ya se fue.
async function recargarSinCuenta() {
  const guardados = await base.cargarEjemplos(red.fuente, red.inDim, SIN_CUENTA);
  for (const nombre of red.clases.slice()) red.olvidar(nombre);
  for (const { nombre, vectores } of guardados) for (const v of vectores) red.agregarEjemplo(nombre, v);
  if (red.clases.length) red.entrenar();
  red.guardar(DIR_ESTADO);
}
// Las fotos de esta cámara con su etiqueta, de cada «acertó / se equivocó» y de cada
// corrección (src/muestras.js): para reentrenar y para medir en la casa. Van a datos/propias.
const muestras = new Muestras();
const guardarMuestraDe = (usuarioId) => (m) => {
  try { return muestras.guardar({ ...m, usuarioId }); }
  catch (e) { console.warn(`⚠️ no se pudo guardar la foto: ${e.message}`); return null; }
};
// Las guías guardadas (guias/): primeros auxilios, hogar y lo importado de MyFixit.
const guias = cargarGuias(join(RAIZ, 'guias'));
// Cada «acertó / se equivocó» del emulador, un renglón JSON. Se resume con
// `npm run pruebas-reales`.
const PRUEBAS_REALES = join(DIR_ESTADO, 'pruebas_reales.jsonl');
const anotarEvaluacionDe = (usuarioId) => (fila) => {
  try { appendFileSync(PRUEBAS_REALES, JSON.stringify({ ...fila, usuario_id: usuarioId }) + '\n'); }
  catch (e) { console.warn(`⚠️ no se pudo anotar la prueba: ${e.message}`); }
};

// La voz, el identificador de aparatos y el lector de texto se cargan sólo si hay
// clave, y sólo los del LLM elegido: sin clave de Gemini no hace falta ni importar su SDK.
let fabricaVoz = null, identificar = null, leer = null;
if (LLM === 'deepseek') {
  const { conectarVozDeepSeek } = await import('./src/voz_deepseek.js');
  fabricaVoz = (manejadores) => conectarVozDeepSeek({ apiKey: CLAVE, modelo: MODELO, base: BASE_DEEPSEEK, ...manejadores });
  fabricaVoz.modo = 'texto';
  const { crearIdentificadorDeepSeek } = await import('./src/identificar.js');
  identificar = crearIdentificadorDeepSeek({ apiKey: CLAVE, modelo: MODELO_VISION, base: BASE_DEEPSEEK });
  const { crearLectorDeepSeek } = await import('./src/leer.js');
  leer = crearLectorDeepSeek({ apiKey: CLAVE, modelo: MODELO_VISION, base: BASE_DEEPSEEK });
} else if (LLM === 'gemini') {
  const { conectarVoz } = await import('./src/voz_live.js');
  fabricaVoz = (manejadores) => conectarVoz({ apiKey: CLAVE, modelo: MODELO, ...manejadores });
  fabricaVoz.modo = 'audio';
  const { GoogleGenAI } = await import('@google/genai');
  const ia = new GoogleGenAI({ apiKey: CLAVE });
  const { crearIdentificador } = await import('./src/identificar.js');
  identificar = crearIdentificador({ ia, modelo: MODELO_VISION, reserva: RESERVA_VISION });
  const { crearLector } = await import('./src/leer.js');
  leer = crearLector({ ia, modelo: MODELO_VISION, reserva: RESERVA_VISION });
}

const app = express();
app.disable('x-powered-by');
// La entrada es la pantalla Visión (diseño de Stitch, UI/). El emulador viejo sigue en
// /emulador.html para probar sin cuenta.
app.get('/', (_req, res) => res.redirect('/vision.html'));
app.use(express.static(join(RAIZ, 'publico')));
app.get(['/entrar', '/registro'], (_req, res) => res.redirect('/cuenta.html'));
app.get('/panel', (_req, res) => res.redirect('/panel.html'));
// Personas conocidas: va primero porque las fotos son más grandes que lo que aceptan
// las demás rutas (8 KB).
app.use('/api', rutasDeConocidos({ cuentas, conocidos, caras, alCambiar: recargarConocidos }));
// Historial y memoria de objetos de la cuenta (antes que las rutas de la cuenta, que
// exigen JSON en todo lo que no es GET).
app.use('/api', rutasDeApp({ cuentas, memoriaDe, muestras }));
app.use('/api', rutasDeCuentas({
  cuentas, registroAbierto: REGISTRO_ABIERTO, verificarGoogle, googleClientId: GOOGLE_CLIENT_ID || null,
  // Lo que el panel muestra del cerebro: la red de ese usuario y qué anteojos están conectados.
  estadoDe: async (usuarioId) => {
    const r = await redDe(usuarioId);
    return { conectados: anteojosConectados(), red: { clave: r.clave, objetos: r.resumen() } };
  },
  // Algo cambió desde el panel, fuera de las gafas.
  alCambiar: async (usuarioId, que = {}) => {
    if (que.adoptado) {
      // Lo aprendido sin cuenta pasó a esta cuenta: las dos redes se rearman de la base.
      redes.delete(usuarioId);
      await recargarSinCuenta().catch(e => console.warn(`⚠️ no se pudo recargar lo aprendido sin cuenta: ${e.message}`));
      cortar(d => (d?.usuario?.id ?? SIN_CUENTA) === SIN_CUENTA || d?.usuario?.id === usuarioId, 'lo aprendido cambió de dueño: reconectá');
    }
    if (que.borrado) {
      // Si alguien le había dado permiso a esta cuenta, o ella a otras, ya no vale.
      await recargarConocidos([...conexiones].map(c => c.dueno?.usuario?.id).filter(Boolean));
      redes.delete(usuarioId);
      memorias.delete(usuarioId);
      const archivo = join(DIR_ESTADO, `memoria_u${usuarioId}.json`);
      if (existsSync(archivo)) rmSync(archivo);
      cortar(d => d?.usuario?.id === usuarioId, 'la cuenta se borró');
    }
    // Un par desvinculado, o con la llave cambiada: la llave vieja ya no entra.
    if (que.anteojos) cortar(d => d?.anteojos?.id === que.anteojos, 'la llave de estos anteojos ya no vale');
  },
}));
app.get('/salud', (_req, res) => res.json({
  ok: true, voz: Boolean(CLAVE), llm: LLM || null, modo: fabricaVoz?.modo ?? null, modelo: CLAVE ? MODELO : null,
  red: red.clave, objetos: red.resumen(), pide_token: Boolean(TOKEN), base: Boolean(base), cuentas: Boolean(cuentas), detector: Boolean(detector),
  detector_nombre: detector?.nombre ?? null, clip: Boolean(clip),
  guias: guias.length, objetos_recordados: memoria.vistos.size, leer: Boolean(leer), caras: Boolean(caras),
  red_general: conjunto && {
    clases: conjunto.clases.length,
    votantes: conjunto.miembros.map(m => ({ fuente: `${m.extractor.fuente}|${m.extractor.dim}`, peso: Number(m.peso.toFixed(3)), acierto_prueba: m.red.medicion?.acierto })),
  },
}));
// La lista de guías, para el selector del emulador.
app.get('/guias', (_req, res) => res.json(resumenDeGuias(guias)));

const http = createServer(app);
const wss  = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

http.on('upgrade', (req, socket, head) => {
  const ruta = new URL(req.url, 'http://x').pathname;
  // Un navegador manda Origin; el ESP32 no. Si viene, tiene que ser esta misma
  // página: si no, cualquier sitio abierto en el navegador podría conectarse al
  // cerebro local y escuchar el micrófono.
  const origen = req.headers.origin;
  let origenOk = !origen;
  if (origen) {
    try { origenOk = new URL(origen).host === req.headers.host; } catch { origenOk = false; }
  }
  if (ruta !== '/ws/gafas' || !origenOk) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function tokenOk(recibido) {
  if (!TOKEN) return false;
  const a = Buffer.from(String(recibido ?? '')), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SIN_DUENO = { usuario: null, anteojos: null };

// Quién saluda con esa llave: el TOKEN_GAFAS del .env es «sin cuenta»; la llave de un
// par vinculado, su dueño. null si no es ninguna.
async function quienDeLlave(token) {
  if (tokenOk(token)) return SIN_DUENO;
  return cuentas ? cuentas.deLlave(token).catch(() => null) : null;
}

wss.on('connection', (ws, req) => {
  const abierto = () => ws.readyState === ws.OPEN;
  const enviarJson = (msg) => { if (abierto()) ws.send(JSON.stringify(msg)); };
  let sesion = null, cerrado = false;
  const conexion = { ws, dueno: null };
  conexiones.add(conexion);

  // Arma la sesión para ese dueño. Si ya había una (otro saludo), la reemplaza.
  async function arrancar(quien) {
    const usuarioId = quien.usuario?.id ?? SIN_CUENTA;
    let redUsuario;
    try { redUsuario = await redDe(usuarioId); }
    catch (e) { console.warn(`⚠️ no se pudo cargar lo aprendido del usuario ${usuarioId}: ${e.message}`); ws.close(1011, 'no se pudo cargar lo aprendido'); return; }
    if (cerrado) return;
    sesion?.cerrar();
    conexion.dueno = quien;
    if (quien.anteojos) cuentas?.marcarConexion(quien.anteojos.id).catch(() => {});
    sesion = new Sesion({
      enviarJson, enviarBin: (buf) => { if (abierto()) ws.send(buf, { binary: true }); },
      red: redUsuario, extractorPersonal, conjunto, detector, fovDiagonalGrados: FOV_DIAGONAL,
      identificar, registro: base?.para({ usuarioId, anteojosId: quien.anteojos?.id ?? null }),
      guardarRed: guardarRedDe(usuarioId), visionAlLlm: VISION_AL_LLM,
      memoria: memoriaDe(usuarioId), guias, leer, anotarEvaluacion: anotarEvaluacionDe(usuarioId),
      caras, conocidos: await conocidosDe(usuarioId), zoom: true,
      correcciones: await correccionesDe(usuarioId), positivos, ejemplos, guardarMuestra: guardarMuestraDe(usuarioId),
      clip, vocabulario: await vocabularioDe(usuarioId), guardarNombres: guardarNombresDe(usuarioId),
      negativos: await negativosDe(usuarioId),
      guardarCorreccion: correcciones ? (clase, fuente, v) => correcciones.agregar(usuarioId, clase, fuente, v) : null,
      olvidarCorrecciones: correcciones ? () => correcciones.olvidar(usuarioId).catch(() => 0) : null,
    });
    conexion.sesion = sesion;
    enviarJson({ t: 'quien', usuario: quien.usuario?.nombre ?? null, anteojos: quien.anteojos?.nombre ?? null });
    sesion.conectarVoz(fabricaVoz);
  }

  // ¿Viene del panel con la sesión abierta? Entonces es el emulador de ese usuario.
  // Si no, sin TOKEN_GAFAS (sólo en esta PC) arranca «sin cuenta»; con TOKEN_GAFAS,
  // espera el saludo con una llave.
  // Un error con UNA conexión la cierra a ella, nunca tumba el cerebro.
  const fallo = (e) => { console.warn(`⚠️ conexión de gafas: ${e.message}`); if (!cerrado) ws.close(1011, 'error del cerebro'); };
  const plazo = setTimeout(() => { if (!sesion && !cerrado) ws.close(4401, 'falta el token'); }, MS_PARA_SALUDAR);
  (async () => {
    const usuario = cuentas ? await cuentas.usuarioDeSesion(leerCookie(req?.headers?.cookie)).catch(() => null) : null;
    if (cerrado) return;
    if (usuario) await arrancar({ usuario, anteojos: await cuentas.emuladorDe(usuario.id).catch(() => null) });
    else if (!TOKEN && !sesion) await arrancar(SIN_DUENO);
  })().catch(fallo);

  ws.on('message', (datos, esBinario) => { alMensaje(datos, esBinario).catch(fallo); });
  async function alMensaje(datos, esBinario) {
    if (esBinario) { sesion?.alBinario(datos); return; }
    let msg;
    try { msg = JSON.parse(datos.toString('utf8')); } catch { return; }
    if (msg?.t === 'hola') {
      const quien = await quienDeLlave(msg.token);
      if (cerrado) return;
      if (!quien) {
        if (!sesion) ws.close(4401, 'token inválido');
        else enviarJson({ t: 'aviso', texto: 'Esa llave no es de ningún anteojo: sigo como estaba' });
        return;
      }
      // Con sesión abierta, sólo un saludo de unos anteojos vinculados la cambia.
      if (!sesion || (quien.anteojos && quien.anteojos.id !== conexion.dueno?.anteojos?.id)) await arrancar(quien);
      return;
    }
    sesion?.alJson(msg);
  }

  ws.on('close', () => { cerrado = true; clearTimeout(plazo); sesion?.cerrar(); conexiones.delete(conexion); });
  ws.on('error', (e) => console.warn(`[ws] ${e.message}`));
});

http.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Pasa cuando se corre `npm start` dos veces. No falta nada por instalar.
  console.error(`❌ El puerto ${PUERTO} ya está ocupado: lo más probable es que el cerebro YA esté corriendo.`);
  console.error(`   Abrí http://${HOST}:${PUERTO}/ — o cerrá la otra ventana y volvé a correr «npm start».`);
  process.exit(1);
});

http.listen(PUERTO, HOST, () => {
  // Las pantallas se abren con «localhost»: es el origen que Google acepta para entrar.
  const panel = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PUERTO}`;
  console.log(`✅ Cerebro de las gafas en http://${HOST}:${PUERTO}`);
  console.log(`   voz: ${!CLAVE ? `APAGADA (${FALTA_CLAVE})`
    : LLM === 'deepseek' ? `${MODELO} (DeepSeek), por escrito: en el emulador escucha y habla el navegador`
    : `${MODELO} (Gemini Live)`}`);
  console.log(`   red propia: ${red.clave} — ${red.clases.length} objeto(s) aprendido(s)`);
  console.log(`   base de datos: ${base
    ? `${process.env.DB_NAME} en MySQL` + (ejemplosDeLaBase === null ? '' : ` — ${ejemplosDeLaBase} ejemplos recuperados`)
    : 'APAGADA (lo aprendido queda sólo en estado/)'}`);
  console.log(`   pantallas: ${panel}/ (Visión, Enseñar, Historial…) · emulador viejo en /emulador.html`);
  console.log(`   cuentas: ${cuentas ? `panel en ${panel}/cuenta.html${REGISTRO_ABIERTO ? ' (cualquiera de la red puede crear cuenta)' : ''}` : 'APAGADAS (necesitan la base)'}`);
  console.log(`   entrar con Google: ${GOOGLE_CLIENT_ID ? `sí (abrí el panel con http://localhost:${PUERTO}, que es el origen que conoce Google)` : 'no (falta GOOGLE_CLIENT_ID en .env)'}`);
  console.log(`   red general: ${conjunto
    ? `${conjunto.clases.length} clases, votan ${conjunto.miembros.map(m => m.extractor.fuente).join(' + ')}`
    : 'sin entrenar (npm run entrenar)'}`);
  console.log(`   detector: ${detector ? `${detector.nombre}${detector.calibrado ? ', con un umbral por clase' : ' (sin calibrar)'}, ${detector.clases.length} clases, con zoom en la mirada; mide con FOV diagonal de ${FOV_DIAGONAL}°` : 'APAGADO (falta el modelo en modelos/)'}`);
  console.log(`   marca y modelo de aparatos: ${CLAVE ? `a pedido, con ${MODELO_VISION}` : 'APAGADO (falta la clave)'}`);
  console.log(`   leer texto: ${leer ? `a pedido, con ${MODELO_VISION}` : 'APAGADO (falta la clave)'}`);
  console.log(`   guías guardadas: ${guias.length} · objetos recordados: ${memoria.vistos.size}`);
  console.log(`   correcciones al detector: con ${[...positivos.values()].reduce((s, l) => s + l.length, 0)} ejemplos de verdad de ${positivos.size} clases para comparar`);
  console.log(`   «no lo conozco»: ${ejemplos ? `compara con ${ejemplos.total} ejemplos de ${ejemplos.porClase.size} clases` : 'no (faltan los ejemplos en datos/rasgos)'}`);
  console.log(`   CLIP: ${clip ? `sí, ${vocabularioBase.entradas.length} nombres (tercera opinión y «Parece: …»)` : 'no (faltan los modelos en modelos/clip-b32)'}`);
  console.log(`   fotos propias para entrenar: ${Object.values(muestras.resumen()).reduce((s, c) => s + c.entrenamiento + c.prueba, 0)} en datos/propias`);
  console.log(`   personas conocidas: ${caras ? 'sí, sólo las que se cargaron solas y dieron permiso (YuNet + SFace)' : 'no (faltan los modelos en modelos/caras)'}`);
  console.log(`   cuadros al LLM: ${VISION_AL_LLM && LLM === 'gemini' ? 'sí, 1 por segundo' : 'no (a propósito: los objetos le llegan con que_veo y que_hay)'}`);
});

function apagar() {
  for (const ws of wss.clients) ws.close(1001, 'el cerebro se apaga');
  for (const m of memorias.values()) m.guardar();
  base?.cerrar().catch(() => {});
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
