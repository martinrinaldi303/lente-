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

const BIN_AUDIO_SUBE = 0x01, BIN_JPEG = 0x02, BIN_AUDIO_BAJA = 0x03;
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

let ws = null;
let vozLista = false;
let micActivo = null;      // { contexto, flujo }
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
  for (const id of ['ensenar', 'olvidar', 'identificar', 'guardarTarjeta', 'demo', 'anterior', 'siguiente']) $(id).disabled = !si;
  // Lo que depende de la voz se apaga con ella, y dice por qué.
  for (const id of ['mic', 'enviar', 'texto']) $(id).disabled = !(si && vozLista);
  const motivo = !si ? 'sin conexión con el cerebro' : vozLista ? '' : 'la voz está apagada: falta GEMINI_API_KEY en .env';
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
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return alBinario(new Uint8Array(ev.data));
    const msg = JSON.parse(ev.data);
    if (msg.t === 'hud') dibujarHud(msg);
    else if (msg.t === 'callar') callar();
    else if (msg.t === 'dicho') anotar(msg.quien, msg.texto);
    else if (msg.t === 'aviso') avisar(msg.texto);
    else if (msg.t === 'estado') {
      const nombres = { sin_clave: 'apagada (falta GEMINI_API_KEY en .env)', conectando: 'conectando…', lista: 'lista', cerrada: 'cerrada', error: 'error' };
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

function apagarMic() {
  if (!micActivo) return;
  micActivo.flujo.getTracks().forEach(t => t.stop());
  micActivo.contexto.close();
  micActivo = null;
  $('mic').classList.remove('activo');
}

$('mic').onclick = () => (micActivo ? apagarMic() : pedir($('mic'), 'el micrófono', prenderMic));

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

// El usuario habló encima: se tira lo que quedaba por sonar.
function callar() {
  for (const f of sonando) { try { f.stop(); } catch { /* ya terminó */ } }
  sonando.clear();
  proximoInicio = 0;
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
