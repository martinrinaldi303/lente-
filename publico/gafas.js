// gafas.js — el emulador: hace en el navegador lo que después va a hacer el ESP32.
//
// Habla el protocolo de src/protocolo.js. Todo lo que hay acá es entrada y salida
// (micrófono, cámara, parlante, pantalla): no decide nada. Si algo de lógica
// termina en este archivo, está en el lugar equivocado, porque el ESP32 no lo va
// a tener.
//
// Regla desde el 1-oct-2026: NINGÚN botón falla en silencio. La primera versión
// lo hacía (escribir sin voz, «Siguiente» sin guía, la cámara esperando un permiso
// que nadie veía) y desde afuera parecía que no andaba nada.

const BIN_AUDIO_SUBE = 0x01, BIN_JPEG = 0x02, BIN_AUDIO_BAJA = 0x03, BIN_FOTO = 0x04;
const MAX_FOTO = 480 * 1024;                                             // el tope de src/protocolo.js
const MS_SENSOR = 500;                                                   // el sensor simulado manda 2 lecturas por segundo
const CAM_ANCHO = 640, CAM_ALTO = 480, CAM_FPS = 2, CAM_CALIDAD = 0.7;   // VGA: lo que da un OV2640 a pocos cuadros por segundo
const MIC_HZ = 16000, PARLANTE_HZ = 24000;
const MUESTRAS_POR_PAQUETE = 1600;                                       // 100 ms
const MS_AVISO = 9000, MS_PERMISO_LENTO = 4000;

const GUIA_DE_EJEMPLO = {
  titulo: 'Cambiar pilas',
  pasos: [
    'Dar vuelta el control remoto',
    'Correr la tapa hacia abajo con el pulgar',
    'Sacar las dos pilas viejas',
    'Poner las nuevas mirando el signo + de cada lado',
    'Cerrar la tapa hasta que haga clic',
  ],
};

const $ = (id) => document.getElementById(id);
const lienzo = $('hud'), ctx = lienzo.getContext('2d');

const FALTA_CLAVE = 'falta DEEPSEEK_API_KEY o GEMINI_API_KEY en .env';
const IDIOMA = 'es-AR';

let ws = null;
let vozLista = false;
// Cómo conversa el LLM que tiene el cerebro (lo dice en {t:"estado"}):
//   'audio' → escucha y habla él (Gemini Live): se le manda el micrófono crudo.
//   'texto' → sólo lee y escribe (DeepSeek): acá se transcribe lo que decís y se lee
//             en voz alta lo que contesta, con lo que trae el navegador.
let modoVoz = 'audio';
let micActivo = null;      // { contexto, flujo } en modo audio; { reconocedor } en modo texto
let camActiva = null;      // { flujo, reloj }
let parlante = null, proximoInicio = 0, sonando = new Set();
let ultimoDicho = null;
let relojAviso = null;

// ── Pantalla ──────────────────────────────────────────────────────────────
// Cinco renglones, como los va a dibujar el ESP32 con la fuente de 6×8:
// título, raya, tres de texto y el pie.
function dibujarHud({ titulo = '', lineas = [], pie = '' }) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#9fe8ff';
  ctx.font = '8px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'top';
  const renglon = (texto, y) => { [...texto].forEach((letra, i) => ctx.fillText(letra, i * 6, y)); };
  renglon(titulo, 1);
  ctx.fillRect(0, 11, 128, 1);
  lineas.slice(0, 3).forEach((l, i) => renglon(l, 15 + i * 11));
  ctx.fillRect(0, 51, 128, 1);
  renglon(pie, 55);
}
dibujarHud({ titulo: 'MIIA gafas', lineas: ['Sin conexion.'], pie: '' });
$('espejo').onchange = (e) => lienzo.classList.toggle('espejo', e.target.checked);
$('oscurecer').onchange = (e) => $('vista').classList.toggle('oscurecer', e.target.checked);
// El recuadro del objeto que se está mirando, sobre la imagen: UNO, el que la
// pantalla nombra. Es una ayuda del emulador: un OLED de 128×64 delante del ojo no
// puede dibujar sobre el mundo. Con «ver todo» se suma, más tenue, lo crudo del
// detector y el círculo de la mirada: sirve para probar, no para usar.
const lienzoCajas = $('cajas'), ctxCajas = lienzoCajas.getContext('2d');
let ultimasCajas = {};
$('verCajas').onchange = () => dibujarCajas(ultimasCajas);
function dibujarCajas(msg) {
  ultimasCajas = msg;
  const { ancho = 640, alto = 480, radio = 0, mirado = null, lista = [] } = msg;
  if (lienzoCajas.width !== ancho || lienzoCajas.height !== alto) { lienzoCajas.width = ancho; lienzoCajas.height = alto; }
  ctxCajas.clearRect(0, 0, ancho, alto);
  ctxCajas.font = '600 15px system-ui, sans-serif';
  ctxCajas.textBaseline = 'top';
  const caja = (c, color, grosor) => {
    ctxCajas.strokeStyle = color;
    ctxCajas.lineWidth = grosor;
    ctxCajas.strokeRect(c.x0, c.y0, c.ancho, c.alto);
    const texto = `${c.nombre} ${c.confianza}%` + (c.metros !== undefined ? ` · ${String(c.metros).replace('.', ',')} m` : '');
    const w = ctxCajas.measureText(texto).width + 10, y = c.y0 >= 22 ? c.y0 - 22 : c.y0 + 2;
    ctxCajas.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctxCajas.fillRect(c.x0, y, w, 20);
    ctxCajas.fillStyle = color;
    ctxCajas.fillText(texto, c.x0 + 5, y + 2);
  };
  if ($('verCajas').checked) {
    for (const c of lista) caja(c, 'rgba(255, 223, 154, 0.6)', 1);
    if (radio) {
      ctxCajas.strokeStyle = 'rgba(95, 208, 255, 0.5)';
      ctxCajas.lineWidth = 1;
      ctxCajas.beginPath();
      ctxCajas.arc(ancho / 2, alto / 2, radio, 0, 2 * Math.PI);
      ctxCajas.stroke();
    }
  }
  if (mirado) caja(mirado, '#5fd0ff', 3);
}

function anotar(clase, texto) {
  const r = $('registro');
  // La transcripción llega de a pedazos: se pegan al renglón del mismo hablante.
  if (ultimoDicho && ultimoDicho.clase === clase && clase !== 'sis') {
    ultimoDicho.nodo.textContent += texto;
  } else {
    const nodo = document.createElement('div');
    nodo.className = clase;
    nodo.textContent = (clase === 'yo' ? 'vos: ' : clase === 'miia' ? 'MIIA: ' : '· ') + texto;
    r.appendChild(nodo);
    ultimoDicho = { clase, nodo };
  }
  r.scrollTop = r.scrollHeight;
}

// Un pedido que no se pudo hacer: cartel a la vista y renglón en el registro.
function avisar(texto) {
  const a = $('aviso');
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { a.hidden = true; }, MS_AVISO);
  anotar('sis', texto);
}

function mostrarEstado(texto, resaltado = '') {
  const e = $('estado');
  e.textContent = texto;
  if (resaltado) { const b = document.createElement('b'); b.textContent = resaltado; e.append(' ', b); }
}

// ── Conexión ──────────────────────────────────────────────────────────────
function conectado() { return ws && ws.readyState === WebSocket.OPEN; }

function habilitar() {
  const si = conectado();
  // La cámara NO depende del cerebro: se puede prender siempre para ver la imagen.
  // Sin conexión los cuadros no van a ningún lado y la red no opina.
  for (const id of ['ensenar', 'olvidar', 'identificar', 'guardarTarjeta', 'demo', 'anterior', 'siguiente',
                    'buscarDonde', 'marcarLugar', 'leer', 'cargarGuia', 'acerto', 'fallo']) $(id).disabled = !si;
  // Lo que depende de la voz se apaga con ella, y dice por qué.
  for (const id of ['mic', 'enviar', 'texto']) $(id).disabled = !(si && vozLista);
  const motivo = !si ? 'sin conexión con el cerebro' : vozLista ? '' : `la voz está apagada: ${FALTA_CLAVE}`;
  $('mic').title = motivo;
  $('texto').placeholder = motivo ? `No disponible: ${motivo}` : 'escribirle a MIIA';
  $('conectar').textContent = si ? 'Desconectar' : 'Conectar';
  $('conectar').classList.toggle('activo', si);
}

function conectar() {
  if (location.protocol === 'file:') {
    // Abierta con doble clic sobre el archivo: no hay servidor del otro lado.
    mostrarEstado('Sin cerebro: esta página se abrió como archivo.');
    return avisar('Para que las gafas piensen, abrí http://127.0.0.1:8787/ con «npm start» corriendo. Así suelta sólo se puede prender la cámara.');
  }
  const esquema = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${esquema}://${location.host}/ws/gafas`);
  ws.binaryType = 'arraybuffer';
  let abrio = false;
  ws.onopen = () => {
    abrio = true;
    // El token, si el cerebro lo pide, va en el #fragmento de la dirección: no
    // viaja en el pedido HTTP ni queda en los registros del servidor.
    const token = decodeURIComponent(location.hash.slice(1));
    if (token) ws.send(JSON.stringify({ t: 'hola', token }));
    habilitar();
    mostrarEstado('Conectado al cerebro.');
    anotar('sis', 'conectado al cerebro');
    cargarListaDeGuias();
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return alBinario(new Uint8Array(ev.data));
    const msg = JSON.parse(ev.data);
    if (msg.t === 'hud') dibujarHud(msg);
    else if (msg.t === 'callar') callar();
    else if (msg.t === 'dicho') { anotar(msg.quien, msg.texto); if (modoVoz === 'texto' && msg.quien === 'miia') decir(msg.texto); }
    else if (msg.t === 'aviso') avisar(msg.texto);
    else if (msg.t === 'cajas') dibujarCajas(msg);
    else if (msg.t === 'decir') { anotar('miia', msg.texto); ultimoDicho = null; decir(msg.texto); }
    else if (msg.t === 'alerta') alertar(msg);
    else if (msg.t === 'foto') mandarFoto();
    else if (msg.t === 'estado') {
      const nombres = { sin_clave: `apagada (${FALTA_CLAVE})`, conectando: 'conectando…', lista: 'lista', cerrada: 'cerrada', error: 'error' };
      if (msg.modo && msg.modo !== modoVoz) { apagarMic(); modoVoz = msg.modo; }
      if (msg.voz === 'lista' && modoVoz === 'texto') nombres.lista = 'lista, por escrito (escucha y habla el navegador)';
      vozLista = msg.voz === 'lista';
      if (!vozLista) apagarMic();
      habilitar();
      mostrarEstado('Conectado. Voz:', (nombres[msg.voz] ?? msg.voz) + (msg.detalle ? ` — ${msg.detalle}` : ''));
      if (msg.voz === 'error' || msg.voz === 'cerrada') avisar(`La voz se cortó${msg.detalle ? `: ${msg.detalle}` : ''}. Reconectá para volver a intentar.`);
    }
  };
  ws.onclose = (ev) => {
    ws = null; vozLista = false;
    habilitar();
    apagarMic(); callar();
    mostrarEstado(`Desconectado${ev.reason ? ` (${ev.reason})` : ''}.`);
    if (!abrio) avisar('No se pudo conectar con el cerebro. ¿Está corriendo «npm start»?');
    else if (ev.code === 1000 || ev.code === 1005) anotar('sis', 'desconectado');
    else avisar(`Se cortó la conexión con el cerebro${ev.reason ? `: ${ev.reason}` : ''}.`);
  };
}

function enviarBin(tipo, bytes) {
  if (!conectado()) return;
  // Si la red no da abasto, no se apila: el cuadro o el audio viejo ya no sirve.
  if (ws.bufferedAmount > 256 * 1024) return;
  const paquete = new Uint8Array(bytes.byteLength + 1);
  paquete[0] = tipo;
  paquete.set(new Uint8Array(bytes), 1);
  ws.send(paquete);
}

$('conectar').onclick = () => (ws ? ws.close() : conectar());

// ── Permisos de cámara y micrófono ────────────────────────────────────────
function motivoDelFallo(e, cosa) {
  switch (e.name) {
    case 'NotAllowedError': return `el navegador no tiene permiso para ${cosa}. Hacé clic en el candado (o en el ícono de ${cosa}) a la izquierda de la dirección, elegí Permitir y recargá la página.`;
    case 'NotFoundError':   return `no encontré ${cosa} en esta computadora.`;
    case 'NotReadableError':
    case 'AbortError':      return `otra aplicación está usando ${cosa}. Cerrá Teams, Zoom o la app Cámara y volvé a probar.`;
    default:                return e.message || e.name;
  }
}

// Mientras el navegador muestra su cartel de permiso, el pedido queda colgado sin
// error ni resultado. Si tarda, se le dice al usuario dónde mirar.
async function pedir(boton, cosa, prender) {
  // Un pedido por vez. «Prender la cámara» y «Cámara» piden lo mismo: con dos clics
  // seguidos se abrían DOS cámaras (el doble de cuadros al cerebro) y el botón
  // quedaba para siempre en «Cámara…», que era el nombre que leyó el segundo pedido.
  if (boton.dataset.pidiendo) return;
  boton.dataset.pidiendo = '1';
  const nombre = boton.textContent;
  boton.disabled = true;
  boton.textContent = `${nombre}…`;
  const lento = setTimeout(() => avisar(`El navegador está esperando que permitas ${cosa}: mirá el cartel arriba, junto a la dirección.`), MS_PERMISO_LENTO);
  try {
    await prender();
    $('aviso').hidden = true;
  } catch (e) {
    avisar(`No se pudo prender ${cosa}: ${motivoDelFallo(e, cosa)}`);
  } finally {
    clearTimeout(lento);
    delete boton.dataset.pidiendo;
    boton.textContent = nombre;
    boton.disabled = false;      // habilitar() vuelve a apagar el que no corresponda
    habilitar();
  }
}

// ── Micrófono: PCM 16 bits, 16 kHz ────────────────────────────────────────
const TRABAJADOR_MIC = `
registerProcessor('captura', class extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0][0];
    if (canal) this.port.postMessage(canal.slice(0));
    return true;
  }
});`;

async function prenderMic() {
  const flujo = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const contexto = new AudioContext({ sampleRate: MIC_HZ });
  await contexto.audioWorklet.addModule(URL.createObjectURL(new Blob([TRABAJADOR_MIC], { type: 'text/javascript' })));
  const nodo = new AudioWorkletNode(contexto, 'captura');
  let acumulado = new Int16Array(MUESTRAS_POR_PAQUETE), n = 0;
  nodo.port.onmessage = ({ data }) => {
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      acumulado[n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (n === MUESTRAS_POR_PAQUETE) { enviarBin(BIN_AUDIO_SUBE, acumulado.buffer); acumulado = new Int16Array(MUESTRAS_POR_PAQUETE); n = 0; }
    }
  };
  contexto.createMediaStreamSource(flujo).connect(nodo);
  micActivo = { contexto, flujo };
  $('mic').classList.add('activo');
  anotar('sis', 'micrófono prendido: hablale a MIIA');
}

// ── Micrófono en modo texto: lo transcribe el navegador ───────────────────
// El LLM no escucha, así que lo dicho tiene que llegarle escrito. Edge y Chrome
// traen un reconocedor de voz (Web Speech API). ⚠️ No es local: el audio va al
// servicio de voz de Microsoft o de Google. Firefox no lo tiene.
// Unas gafas de verdad no tienen navegador: para ellas, con un LLM de texto, el
// transcriptor tendría que estar en el cerebro. Todavía no está.
const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;

async function prenderDictado() {
  if (!Reconocedor) throw new Error('este navegador no transcribe la voz. Usá Edge o Chrome, o escribile a MIIA en el cuadro de abajo.');
  const reconocedor = new Reconocedor();
  reconocedor.lang = IDIOMA;
  reconocedor.continuous = true;
  reconocedor.interimResults = false;
  reconocedor.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const texto = ev.results[i].isFinal ? ev.results[i][0].transcript.trim() : '';
      // Mientras MIIA habla, el micrófono la escucha a ella: eso no es un pedido.
      if (!texto || speechSynthesis.speaking) continue;
      enviarJson({ t: 'texto', texto });
      anotar('yo', texto);
      ultimoDicho = null;
    }
  };
  reconocedor.onerror = (ev) => {
    if (ev.error === 'no-speech' || ev.error === 'aborted') return;      // silencio: sigue escuchando
    apagarMic();
    avisar(ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
      ? 'El navegador no tiene permiso para el micrófono. Hacé clic en el candado junto a la dirección, elegí Permitir y recargá.'
      : ev.error === 'network' ? 'El reconocedor de voz del navegador necesita internet y no pudo conectarse.'
      : `El reconocedor de voz se cortó: ${ev.error}`);
  };
  // El navegador lo apaga solo después de un silencio largo: mientras el botón siga
  // prendido, se vuelve a arrancar.
  reconocedor.onend = () => { if (micActivo?.reconocedor === reconocedor) { try { reconocedor.start(); } catch { /* ya arrancó */ } } };
  reconocedor.start();
  micActivo = { reconocedor };
  $('mic').classList.add('activo');
  anotar('sis', 'micrófono prendido: hablale a MIIA (el navegador transcribe lo que decís)');
}

function apagarMic() {
  if (!micActivo) return;
  const m = micActivo;
  micActivo = null;                         // antes de frenar: así onend no lo vuelve a arrancar
  if (m.reconocedor) { try { m.reconocedor.stop(); } catch { /* ya estaba frenado */ } }
  else { m.flujo.getTracks().forEach(t => t.stop()); m.contexto.close(); }
  $('mic').classList.remove('activo');
}

$('mic').onclick = () => (micActivo ? apagarMic() : pedir($('mic'), 'el micrófono', modoVoz === 'texto' ? prenderDictado : prenderMic));

// ── Cámara: JPEG de 320×240, 2 por segundo ────────────────────────────────
const cuadro = document.createElement('canvas');
cuadro.width = CAM_ANCHO; cuadro.height = CAM_ALTO;

async function prenderCam() {
  if (camActiva) return;
  const flujo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  $('video').srcObject = flujo;
  await $('video').play();
  const reloj = setInterval(() => {
    cuadro.getContext('2d').drawImage($('video'), 0, 0, CAM_ANCHO, CAM_ALTO);
    cuadro.toBlob(async (blob) => { if (blob) enviarBin(BIN_JPEG, await blob.arrayBuffer()); }, 'image/jpeg', CAM_CALIDAD);
  }, 1000 / CAM_FPS);
  camActiva = { flujo, reloj };
  $('cam').classList.add('activo');
  $('vista').classList.add('con-camara');
  anotar('sis', `cámara prendida (${flujo.getVideoTracks()[0]?.label || 'sin nombre'})` +
                (conectado() ? `: ${CAM_FPS} cuadros por segundo al cerebro` : ', pero sin conexión con el cerebro'));
}

function apagarCam() {
  if (!camActiva) return;
  clearInterval(camActiva.reloj);
  camActiva.flujo.getTracks().forEach(t => t.stop());
  $('video').srcObject = null;
  camActiva = null;
  dibujarCajas({});
  $('cam').classList.remove('activo');
  $('vista').classList.remove('con-camara');
}

$('cam').onclick = () => (camActiva ? apagarCam() : pedir($('cam'), 'la cámara', prenderCam));
$('prender').onclick = () => pedir($('cam'), 'la cámara', prenderCam);

// ── Parlante: PCM 16 bits, 24 kHz ─────────────────────────────────────────
function alBinario(bytes) {
  if (bytes[0] !== BIN_AUDIO_BAJA || bytes.length < 3) return;
  parlante ??= new AudioContext({ sampleRate: PARLANTE_HZ });
  const pcm = new Int16Array(bytes.buffer, 1, (bytes.length - 1) >> 1);
  const buffer = parlante.createBuffer(1, pcm.length, PARLANTE_HZ);
  const canal = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 0x8000;
  const fuente = parlante.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(parlante.destination);
  proximoInicio = Math.max(proximoInicio, parlante.currentTime + 0.05);
  fuente.start(proximoInicio);
  proximoInicio += buffer.duration;
  sonando.add(fuente);
  fuente.onended = () => sonando.delete(fuente);
}

// En modo texto el LLM no manda audio: lo que escribe lo lee la voz del navegador.
function decir(texto) {
  if (!('speechSynthesis' in window)) return;
  const frase = new SpeechSynthesisUtterance(texto);
  frase.lang = IDIOMA;
  const voces = speechSynthesis.getVoices();
  frase.voice = voces.find(v => v.lang === IDIOMA) ?? voces.find(v => v.lang.startsWith('es')) ?? null;
  speechSynthesis.speak(frase);
}

// El usuario habló encima: se tira lo que quedaba por sonar.
function callar() {
  for (const f of sonando) { try { f.stop(); } catch { /* ya terminó */ } }
  sonando.clear();
  proximoInicio = 0;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ── El aviso de un vehículo: tres pitidos y el borde rojo ──────────────────
// Unas gafas de verdad pitan con un buzzer o vibran: la pantalla sola no alcanza,
// porque quien está por cruzar no está mirando el HUD.
function alertar(msg) {
  anotar('sis', `¡cuidado! ${msg.objeto} llega en ≈ ${msg.llegada_s} s`);
  $('vista').classList.remove('alerta');
  void $('vista').offsetWidth;                  // para que la animación vuelva a arrancar
  $('vista').classList.add('alerta');
  try {
    parlante ??= new AudioContext({ sampleRate: PARLANTE_HZ });
    parlante.resume();
    const t0 = parlante.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const osc = parlante.createOscillator(), vol = parlante.createGain();
      osc.frequency.value = 1760;
      vol.gain.setValueAtTime(0.25, t0 + i * 0.18);
      vol.gain.setValueAtTime(0, t0 + i * 0.18 + 0.1);
      osc.connect(vol).connect(parlante.destination);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + 0.12);
    }
  } catch { /* sin audio: queda el borde rojo y el HUD */ }
}

// ── La foto grande, para leer texto ───────────────────────────────────────
// El cerebro la pide con {t:"foto"}. Va a la resolución que da la cámara (con la
// C270, 640×480) y con más calidad que los cuadros de siempre. El ESP32 la puede
// sacar de 1600×1200. Si no hay cámara no se contesta: el cerebro usa el último cuadro.
function mandarFoto() {
  const v = $('video');
  if (!camActiva || !v.videoWidth) return;
  const lienzoFoto = document.createElement('canvas');
  lienzoFoto.width = v.videoWidth; lienzoFoto.height = v.videoHeight;
  lienzoFoto.getContext('2d').drawImage(v, 0, 0);
  const comprimir = (calidad) => lienzoFoto.toBlob(async (blob) => {
    if (!blob) return;
    if (blob.size > MAX_FOTO && calidad > 0.5) return comprimir(calidad - 0.15);
    enviarBin(BIN_FOTO, await blob.arrayBuffer());
  }, 'image/jpeg', calidad);
  comprimir(0.92);
}

// ── Sensor de distancia simulado (el VL53L1X de las gafas) ────────────────
let relojSensor = null;
const mmDelSensor = () => Number($('sensorMm').value);
$('sensorMm').oninput = () => { $('sensorTexto').textContent = `${Math.round(mmDelSensor() / 10)} cm`; };
$('sensor').onchange = (e) => {
  clearInterval(relojSensor);
  relojSensor = null;
  if (e.target.checked) {
    relojSensor = setInterval(() => enviarJson({ t: 'distancia', mm: mmDelSensor() }), MS_SENSOR);
    anotar('sis', 'sensor de distancia simulado: prendido. Con un objeto al centro, la pantalla muestra cuánto mide.');
  } else {
    enviarJson({ t: 'distancia', mm: 0 });
  }
};

// ── Guías guardadas ───────────────────────────────────────────────────────
async function cargarListaDeGuias() {
  try {
    const guias = await (await fetch('/guias')).json();
    const sel = $('guiaLocal');
    sel.length = 1;
    const grupos = new Map();
    for (const g of guias) {
      if (!grupos.has(g.tema)) {
        const og = document.createElement('optgroup');
        og.label = g.tema.replace(/_/g, ' ') || 'otras';
        grupos.set(g.tema, og);
        sel.append(og);
      }
      grupos.get(g.tema).append(new Option(g.titulo, g.id));
    }
  } catch { /* sin lista: la guía se puede pedir igual por voz */ }
}

// ── Botones ───────────────────────────────────────────────────────────────
function enviarJson(msg) { if (conectado()) ws.send(JSON.stringify(msg)); }

function ensenar() {
  const nombre = $('nombre').value.trim();
  if (!nombre) { avisar('Escribí primero cómo se llama el objeto.'); return $('nombre').focus(); }
  if (!camActiva) return avisar('Prendé la cámara antes de enseñar: el botón está sobre la imagen.');
  enviarJson({ t: 'ensenar', nombre });
  anotar('sis', `enseñando «${nombre}»: 12 cuadros`);
}
$('ensenar').onclick = ensenar;
$('nombre').onkeydown = (e) => { if (e.key === 'Enter' && !$('ensenar').disabled) ensenar(); };
$('olvidar').onclick = () => {
  const nombre = $('nombre').value.trim();
  if (!nombre) return avisar('Escribí el nombre del objeto que querés borrar.');
  enviarJson({ t: 'olvidar', nombre });
};
$('demo').onclick = () => { enviarJson({ t: 'guia', ...GUIA_DE_EJEMPLO }); anotar('sis', `guía cargada: ${GUIA_DE_EJEMPLO.titulo}`); };
$('identificar').onclick = () => {
  if (!camActiva) return avisar('Prendé la cámara y poné el aparato en el recuadro.');
  enviarJson({ t: 'identificar' });
  anotar('sis', 'consultando marca y modelo del aparato…');
};
$('guardarTarjeta').onclick = () => enviarJson({ t: 'guardar_tarjeta' });

function buscarDonde() {
  const nombre = $('donde').value.trim();
  if (!nombre) return avisar('Escribí qué objeto buscás: llaves, celular, control…');
  enviarJson({ t: 'donde', nombre });
}
$('buscarDonde').onclick = buscarDonde;
$('donde').onkeydown = (e) => { if (e.key === 'Enter' && !$('buscarDonde').disabled) buscarDonde(); };
$('marcarLugar').onclick = () => {
  const nombre = $('lugar').value.trim();
  enviarJson({ t: 'lugar', nombre });
  anotar('sis', nombre ? `lugar: ${nombre}` : 'lugar borrado');
};
$('leer').onclick = () => {
  if (!camActiva) return avisar('Prendé la cámara y apuntá al texto.');
  const traducir_a = $('traducir').value;
  enviarJson({ t: 'leer', ...(traducir_a ? { traducir_a } : {}) });
  anotar('sis', traducir_a ? `leyendo y traduciendo al ${traducir_a}…` : 'leyendo el texto…');
};
$('cargarGuia').onclick = () => {
  const id = $('guiaLocal').value;
  if (!id) return avisar('Elegí una guía de la lista.');
  enviarJson({ t: 'guia_local', consulta: id });
  anotar('sis', `guía cargada: ${$('guiaLocal').selectedOptions[0].textContent}`);
};
$('acerto').onclick = () => enviarJson({ t: 'evaluar', acierto: true });
$('fallo').onclick = () => {
  const real = $('real').value.trim();
  if (!real) { avisar('Escribí qué era en realidad, así la prueba sirve.'); return $('real').focus(); }
  enviarJson({ t: 'evaluar', acierto: false, real });
  $('real').value = '';
};
$('anterior').onclick = () => enviarJson({ t: 'paso', hacia: -1 });
$('siguiente').onclick = () => enviarJson({ t: 'paso', hacia: 1 });

function enviarTexto() {
  const texto = $('texto').value.trim();
  if (!texto) return;
  enviarJson({ t: 'texto', texto });
  anotar('yo', texto);
  ultimoDicho = null;
  $('texto').value = '';
}
$('enviar').onclick = enviarTexto;
$('texto').onkeydown = (e) => { if (e.key === 'Enter') enviarTexto(); };

habilitar();
conectar();
