// servidor.js — el cerebro de las gafas.
//
// Sirve el emulador (publico/) y atiende el WebSocket /ws/gafas, que es por donde
// entran las gafas: hoy el emulador del navegador, mañana el ESP32. Los dos hablan
// el mismo protocolo (src/protocolo.js).
//
//   node servidor.js          y abrir http://127.0.0.1:8787

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { abrirBase, sincronizarRed } from './src/base.js';
import { Conjunto } from './src/conjunto.js';
import { extractoresDisponibles } from './src/extractores.js';
import { FUENTE } from './src/rasgos.js';
import { FUENTE as DINO } from './src/rasgos_dino.js';
import { RedObjetos } from './src/red_objetos.js';
import { Sesion } from './src/sesion.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(RAIZ, '.env')); } catch { /* sin .env: valores por defecto */ }

const HOST   = process.env.HOST || '127.0.0.1';
const PUERTO = Number(process.env.PUERTO) || 8787;
const TOKEN  = process.env.TOKEN_GAFAS || '';
const CLAVE  = process.env.GEMINI_API_KEY || '';
const MODELO = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const MODELO_VISION = process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash';
const VISION_AL_LLM = process.env.VISION_AL_LLM === '1';
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
try { conjunto = Conjunto.cargar(DIR_ESTADO, { extractores }); }
catch (e) { console.warn(`⚠️ red general no cargada: ${e.message}. Corré «npm run entrenar» hasta el final.`); }
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
// Lo aprendido se guarda en los dos lados: el archivo, que no depende de nada, y la
// base, que es la que manda al arrancar.
const guardarRed = (r) => {
  try { r.guardar(DIR_ESTADO); }
  catch (e) { console.warn(`⚠️ no se pudo guardar la red: ${e.message}`); }
  base?.guardarEjemplos(r).catch(e => console.warn(`⚠️ no se pudo guardar lo aprendido en la base: ${e.message}`));
};

// La voz y el identificador de aparatos se cargan sólo si hay clave: sin ella no
// hace falta ni importar el SDK.
let fabricaVoz = null, identificar = null;
if (CLAVE) {
  const { conectarVoz } = await import('./src/voz_live.js');
  fabricaVoz = (manejadores) => conectarVoz({ apiKey: CLAVE, modelo: MODELO, ...manejadores });
  const { GoogleGenAI } = await import('@google/genai');
  const { crearIdentificador } = await import('./src/identificar.js');
  identificar = crearIdentificador({ ia: new GoogleGenAI({ apiKey: CLAVE }), modelo: MODELO_VISION });
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(join(RAIZ, 'publico')));
app.get('/salud', (_req, res) => res.json({
  ok: true, voz: Boolean(CLAVE), modelo: CLAVE ? MODELO : null,
  red: red.clave, objetos: red.resumen(), pide_token: Boolean(TOKEN), base: Boolean(base),
  red_general: conjunto && {
    clases: conjunto.clases.length,
    votantes: conjunto.miembros.map(m => ({ fuente: `${m.extractor.fuente}|${m.extractor.dim}`, peso: Number(m.peso.toFixed(3)), acierto_prueba: m.red.medicion?.acierto })),
  },
}));

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
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

function tokenOk(recibido) {
  const a = Buffer.from(String(recibido ?? '')), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

wss.on('connection', (ws) => {
  const abierto = () => ws.readyState === ws.OPEN;
  const sesion = new Sesion({
    enviarJson: (msg) => { if (abierto()) ws.send(JSON.stringify(msg)); },
    enviarBin:  (buf) => { if (abierto()) ws.send(buf, { binary: true }); },
    red, extractorPersonal, conjunto, identificar, registro: base, guardarRed, visionAlLlm: VISION_AL_LLM,
  });

  let saludo = !TOKEN;
  const arrancar = () => { saludo = true; sesion.conectarVoz(fabricaVoz); };
  const plazo = TOKEN ? setTimeout(() => { if (!saludo) ws.close(4401, 'falta el token'); }, MS_PARA_SALUDAR) : null;
  if (saludo) arrancar();

  ws.on('message', (datos, esBinario) => {
    if (esBinario) {
      if (saludo) sesion.alBinario(datos);
      return;
    }
    let msg;
    try { msg = JSON.parse(datos.toString('utf8')); } catch { return; }
    if (!saludo) {
      if (msg?.t === 'hola' && tokenOk(msg.token)) arrancar();
      else ws.close(4401, 'token inválido');
      return;
    }
    if (msg?.t !== 'hola') sesion.alJson(msg);
  });

  ws.on('close', () => { clearTimeout(plazo); sesion.cerrar(); });
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
  console.log(`✅ Cerebro de las gafas en http://${HOST}:${PUERTO}`);
  console.log(`   voz: ${CLAVE ? MODELO : 'APAGADA (falta GEMINI_API_KEY en .env)'}`);
  console.log(`   red propia: ${red.clave} — ${red.clases.length} objeto(s) aprendido(s)`);
  console.log(`   base de datos: ${base
    ? `${process.env.DB_NAME} en MySQL` + (ejemplosDeLaBase === null ? '' : ` — ${ejemplosDeLaBase} ejemplos recuperados`)
    : 'APAGADA (lo aprendido queda sólo en estado/)'}`);
  console.log(`   red general: ${conjunto
    ? `${conjunto.clases.length} clases, votan ${conjunto.miembros.map(m => m.extractor.fuente).join(' + ')}`
    : 'sin entrenar (npm run entrenar)'}`);
  console.log(`   marca y modelo de aparatos: ${CLAVE ? `a pedido, con ${MODELO_VISION}` : 'APAGADO (falta la clave)'}`);
  console.log(`   cuadros al LLM: ${VISION_AL_LLM ? 'sí, 1 por segundo' : 'no'}`);
});

function apagar() {
  for (const ws of wss.clients) ws.close(1001, 'el cerebro se apaga');
  base?.cerrar().catch(() => {});
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
