// cliente_gafas.js — esta página hace de gafas: cámara, micrófono y parlante, hablando
// con el cerebro por el WebSocket (protocolo de src/protocolo.js). Lo usan Visión y
// Enseñar. Es lo que hacía el emulador viejo (publico/gafas.js, hoy en /emulador.html),
// separado de la pantalla: acá no se dibuja nada, se avisa con eventos.
//
// Eventos (cliente.on(nombre, fn)): hud, cajas, estado, aviso, dicho, decir, quien,
// alerta, conexion ({ estado, motivo }), camara (bool), mic (bool), enviados (cuadros/s).

(() => {
  const BIN_AUDIO_SUBE = 0x01, BIN_JPEG = 0x02, BIN_AUDIO_BAJA = 0x03, BIN_FOTO = 0x04;
  const MAX_FOTO = 480 * 1024;
  // La cámara, con el detalle que dé hasta 1280×960: el cerebro mira el centro con
  // zoom (detector.js) y ahí cada píxel de más es ver más lejos. El cuadro va con la
  // proporción de la cámara, sin recortar.
  const CAM_ANCHO_MAX = 1280, CAM_FPS = 2, CAM_CALIDAD = 0.7;
  const MIC_HZ = 16000, PARLANTE_HZ = 24000, MUESTRAS_POR_PAQUETE = 1600;
  const IDIOMA = 'es-AR';
  const TRABAJADOR_MIC = `registerProcessor('captura', class extends AudioWorkletProcessor {
    process(e) { const c = e[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } });`;
  const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;

  // El motivo de un permiso negado, dicho para que se entienda qué hacer.
  function motivoDelFallo(e, cosa) {
    switch (e.name) {
      case 'NotAllowedError': return `el navegador no tiene permiso para ${cosa}. Hacé clic en el candado junto a la dirección, elegí Permitir y recargá.`;
      case 'NotFoundError': return `no encontré ${cosa} en esta computadora.`;
      case 'NotReadableError': case 'AbortError': return `otra aplicación está usando ${cosa}. Cerrá Teams, Zoom o la app Cámara y probá de nuevo.`;
      default: return e.message || e.name;
    }
  }

  class ClienteGafas {
    constructor() {
      this.ws = null;
      this.oyentes = new Map();
      this.vozLista = false;
      this.modoVoz = 'audio';      // 'audio' (Gemini: escucha y habla él) o 'texto' (DeepSeek: transcribe y lee el navegador)
      this.cam = null;             // { flujo, reloj, video }
      this.mic = null;             // { contexto, flujo } o { reconocedor }
      this.parlante = null; this.proximo = 0; this.sonando = new Set();
      this.sensor = null;
      this.enviadosEnElSegundo = 0;
      setInterval(() => { this.emitir('enviados', this.enviadosEnElSegundo); this.enviadosEnElSegundo = 0; }, 1000);
    }

    on(nombre, fn) { if (!this.oyentes.has(nombre)) this.oyentes.set(nombre, []); this.oyentes.get(nombre).push(fn); return this; }
    emitir(nombre, dato) { for (const fn of this.oyentes.get(nombre) ?? []) { try { fn(dato); } catch (e) { console.error(e); } } }
    get conectado() { return this.ws?.readyState === WebSocket.OPEN; }

    // ── Conexión ──────────────────────────────────────────────────────────────
    conectar() {
      if (this.ws) return;
      this.emitir('conexion', { estado: 'conectando' });
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/gafas`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let abrio = false;
      ws.onopen = () => { abrio = true; this.emitir('conexion', { estado: 'conectado' }); };
      ws.onmessage = (ev) => (typeof ev.data === 'string' ? this._json(JSON.parse(ev.data)) : this._binario(new Uint8Array(ev.data)));
      ws.onclose = (ev) => {
        this.ws = null; this.vozLista = false;
        this.apagarMic(); this.callar();
        this.emitir('conexion', { estado: 'desconectado', motivo: !abrio ? 'No se pudo conectar con el cerebro: ¿está corriendo «npm start»?' : ev.reason || '' });
      };
    }

    desconectar() { this.ws?.close(1000, 'lo pidió el usuario'); }

    enviarJson(msg) { if (this.conectado) this.ws.send(JSON.stringify(msg)); return this.conectado; }

    _enviarBin(tipo, bytes) {
      if (!this.conectado || this.ws.bufferedAmount > 256 * 1024) return false;   // si la red no da abasto, no se apila
      const p = new Uint8Array(bytes.byteLength + 1);
      p[0] = tipo; p.set(new Uint8Array(bytes), 1);
      this.ws.send(p);
      return true;
    }

    _json(msg) {
      switch (msg.t) {
        case 'estado':
          if (msg.modo && msg.modo !== this.modoVoz) { this.apagarMic(); this.modoVoz = msg.modo; }
          this.vozLista = msg.voz === 'lista';
          if (!this.vozLista) this.apagarMic();
          break;
        case 'callar': this.callar(); break;
        case 'dicho': if (this.modoVoz === 'texto' && msg.quien === 'miia') this.decir(msg.texto); break;
        case 'decir': this.decir(msg.texto); break;
        case 'alerta': this.pitar(); break;
        case 'foto': this._mandarFoto(); break;
      }
      this.emitir(msg.t, msg);
    }

    // ── Cámara ────────────────────────────────────────────────────────────────
    async prenderCamara(video) {
      if (this.cam) return;
      let flujo;
      try { flujo = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 } } }); }
      catch (e) { throw new Error(`No se pudo prender la cámara: ${motivoDelFallo(e, 'la cámara')}`); }
      video.srcObject = flujo;
      await video.play();
      const lienzo = document.createElement('canvas');
      const escala = Math.min(1, CAM_ANCHO_MAX / (video.videoWidth || 640));
      lienzo.width = Math.round((video.videoWidth || 640) * escala); lienzo.height = Math.round((video.videoHeight || 480) * escala);
      const reloj = setInterval(() => {
        lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
        lienzo.toBlob(async (b) => { if (b && this._enviarBin(BIN_JPEG, await b.arrayBuffer())) this.enviadosEnElSegundo++; }, 'image/jpeg', CAM_CALIDAD);
      }, 1000 / CAM_FPS);
      this.cam = { flujo, reloj, video, nombre: flujo.getVideoTracks()[0]?.label || 'cámara', ancho: lienzo.width, alto: lienzo.height };
      this.emitir('camara', true);
    }

    apagarCamara() {
      if (!this.cam) return;
      clearInterval(this.cam.reloj);
      this.cam.flujo.getTracks().forEach(t => t.stop());
      this.cam.video.srcObject = null;
      this.cam = null;
      this.emitir('camara', false);
    }

    // La foto grande que pide el cerebro para leer texto. Sin cámara no se contesta.
    _mandarFoto() {
      const v = this.cam?.video;
      if (!v?.videoWidth) return;
      const l = document.createElement('canvas');
      l.width = v.videoWidth; l.height = v.videoHeight;
      l.getContext('2d').drawImage(v, 0, 0);
      const comprimir = (q) => l.toBlob(async (b) => {
        if (!b) return;
        if (b.size > MAX_FOTO && q > 0.5) return comprimir(q - 0.15);
        this._enviarBin(BIN_FOTO, await b.arrayBuffer());
      }, 'image/jpeg', q);
      comprimir(0.92);
    }

    // ── Micrófono ─────────────────────────────────────────────────────────────
    // Gemini escucha el audio crudo; con DeepSeek el navegador transcribe y se manda texto.
    async prenderMic() {
      if (this.mic) return;
      if (!this.vozLista) throw new Error('La voz está apagada: falta la clave del LLM en .env');
      if (this.modoVoz === 'texto') return this._prenderDictado();
      let flujo;
      try { flujo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { throw new Error(`No se pudo prender el micrófono: ${motivoDelFallo(e, 'el micrófono')}`); }
      const contexto = new AudioContext({ sampleRate: MIC_HZ });
      await contexto.audioWorklet.addModule(URL.createObjectURL(new Blob([TRABAJADOR_MIC], { type: 'text/javascript' })));
      const nodo = new AudioWorkletNode(contexto, 'captura');
      let acumulado = new Int16Array(MUESTRAS_POR_PAQUETE), n = 0;
      nodo.port.onmessage = ({ data }) => {
        for (let i = 0; i < data.length; i++) {
          const s = Math.max(-1, Math.min(1, data[i]));
          acumulado[n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          if (n === MUESTRAS_POR_PAQUETE) { this._enviarBin(BIN_AUDIO_SUBE, acumulado.buffer); acumulado = new Int16Array(MUESTRAS_POR_PAQUETE); n = 0; }
        }
      };
      contexto.createMediaStreamSource(flujo).connect(nodo);
      this.mic = { contexto, flujo };
      this.emitir('mic', true);
    }

    _prenderDictado() {
      if (!Reconocedor) throw new Error('Este navegador no transcribe la voz: usá Edge o Chrome, o escribile a MIIA.');
      const r = new Reconocedor();
      r.lang = IDIOMA; r.continuous = true; r.interimResults = false;
      r.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const texto = ev.results[i].isFinal ? ev.results[i][0].transcript.trim() : '';
          if (!texto || speechSynthesis.speaking) continue;          // mientras MIIA habla, se escucha a ella
          this.enviarJson({ t: 'texto', texto });
          this.emitir('dicho', { t: 'dicho', quien: 'yo', texto });
        }
      };
      r.onerror = (ev) => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') return;
        this.apagarMic();
        this.emitir('aviso', { texto: ev.error === 'not-allowed' ? 'El navegador no tiene permiso para el micrófono.' : `El reconocedor de voz se cortó: ${ev.error}` });
      };
      r.onend = () => { if (this.mic?.reconocedor === r) { try { r.start(); } catch { /* ya arrancó */ } } };
      r.start();
      this.mic = { reconocedor: r };
      this.emitir('mic', true);
    }

    apagarMic() {
      if (!this.mic) return;
      const m = this.mic;
      this.mic = null;
      if (m.reconocedor) { try { m.reconocedor.stop(); } catch { /* ya estaba */ } }
      else { m.flujo.getTracks().forEach(t => t.stop()); m.contexto.close(); }
      this.emitir('mic', false);
    }

    // ── Parlante ──────────────────────────────────────────────────────────────
    _binario(bytes) {
      if (bytes[0] !== BIN_AUDIO_BAJA || bytes.length < 3) return;
      this.parlante ??= new AudioContext({ sampleRate: PARLANTE_HZ });
      // Se copia: un Int16Array no puede empezar en el byte 1 del paquete (tira RangeError).
      const pcm = new Int16Array(bytes.slice(1, 1 + ((bytes.length - 1) & ~1)).buffer);
      const buf = this.parlante.createBuffer(1, pcm.length, PARLANTE_HZ);
      const canal = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 0x8000;
      const f = this.parlante.createBufferSource();
      f.buffer = buf; f.connect(this.parlante.destination);
      this.proximo = Math.max(this.proximo, this.parlante.currentTime + 0.05);
      f.start(this.proximo);
      this.proximo += buf.duration;
      this.sonando.add(f);
      f.onended = () => this.sonando.delete(f);
    }

    decir(texto) {
      if (!('speechSynthesis' in window) || !texto) return;
      const frase = new SpeechSynthesisUtterance(texto);
      frase.lang = IDIOMA;
      const voces = speechSynthesis.getVoices();
      frase.voice = voces.find(v => v.lang === IDIOMA) ?? voces.find(v => v.lang.startsWith('es')) ?? null;
      speechSynthesis.speak(frase);
    }

    callar() {
      for (const f of this.sonando) { try { f.stop(); } catch { /* terminó */ } }
      this.sonando.clear(); this.proximo = 0;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    }

    // Tres pitidos: un vehículo está por llegar. La pantalla sola no alcanza.
    pitar() {
      try {
        this.parlante ??= new AudioContext({ sampleRate: PARLANTE_HZ });
        this.parlante.resume();
        const t0 = this.parlante.currentTime + 0.02;
        for (let i = 0; i < 3; i++) {
          const o = this.parlante.createOscillator(), g = this.parlante.createGain();
          o.frequency.value = 1760;
          g.gain.setValueAtTime(0.25, t0 + i * 0.18); g.gain.setValueAtTime(0, t0 + i * 0.18 + 0.1);
          o.connect(g).connect(this.parlante.destination);
          o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 0.12);
        }
      } catch { /* sin audio */ }
    }

    // ── Sensor de distancia simulado (el VL53L1X de las gafas) ────────────────
    sensorDistancia(mm) {
      clearInterval(this.sensor);
      this.sensor = null;
      if (mm > 0) this.sensor = setInterval(() => this.enviarJson({ t: 'distancia', mm: this.mmSensor }), 500);
      else this.enviarJson({ t: 'distancia', mm: 0 });
      this.mmSensor = mm;
    }
  }

  // ── Dibujos ────────────────────────────────────────────────────────────────
  // La pantalla de 128×64 de las gafas, como la va a dibujar el ESP32.
  function dibujarHud(lienzo, { titulo = '', lineas = [], pie = '' }) {
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#9fe8ff'; ctx.font = '8px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    const renglon = (t, y) => { [...t].forEach((l, i) => ctx.fillText(l, i * 6, y)); };
    renglon(titulo, 1); ctx.fillRect(0, 11, 128, 1);
    lineas.slice(0, 3).forEach((l, i) => renglon(l, 15 + i * 11));
    ctx.fillRect(0, 51, 128, 1); renglon(pie, 55);
  }

  // «persona» → «Persona», pero «iPhone» queda «iPhone».
  const conMayuscula = (t = '') => /^\p{Ll}(?!\p{Lu})/u.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
  const porciento = (n) => `${n}%`;
  const metros = (m) => `${String(m).replace('.', ',')} m`;

  // El pie del HUD por partes: «veo: taza 96%» (lo que le enseñaste), «creo: celular 90%»
  // o «~reproductor mp3 90%» (la red general), u otra cosa.
  function leerPie(pie = '') {
    const m = /^(veo: |creo: |~)(.+) (\d+)%$/.exec(pie);
    if (m) return { nombre: m[2], confianza: Number(m[3]), fuente: m[1] === 'veo: ' ? 'Lo que le enseñaste' : 'Red general' };
    if (pie === 'veo: -') return { texto: 'Nada reconocido en la mirada' };
    if (pie === 'veo: ?') return { texto: 'Algo que no conozco: preguntá «¿qué es?»' };
    if (pie === 'veo: sin entrenar') return { texto: 'Todavía no aprendió nada' };
    return { texto: pie };
  }

  // Lo que dice la pantalla de las gafas, para leerlo sobre la imagen de la cámara.
  // El OLED de 128×64 agrandado se lee mal ahí: letras de 6 px estiradas, y como es
  // aditivo, sobre una pared clara desaparecen. Esto muestra LO MISMO que manda el
  // cerebro, en una tarjeta con fondo. El OLED tal cual sigue en dibujarHud.
  function montarTarjetaHud(caja) {
    caja.innerHTML = `
      <div class="flex items-center justify-between gap-space-sm min-w-0">
        <span data-titulo class="font-headline-sm text-headline-sm sm:font-headline-md sm:text-headline-md text-on-surface truncate"></span>
        <span data-confianza class="hidden shrink-0 font-data-mono text-data-mono font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary"></span>
      </div>
      <div data-lineas class="flex flex-col font-body-sm text-body-sm sm:font-body-md sm:text-body-md text-on-surface-variant"></div>
      <div data-pie class="flex items-center justify-between gap-space-lg pt-space-xs border-t border-outline-variant/50 font-data-mono text-[11px] leading-4 text-outline">
        <span data-fuente class="truncate"></span><span data-pagina class="shrink-0"></span>
      </div>`;
    const $ = (s) => caja.querySelector(s);
    const base = caja.className;
    return {
      pintar({ titulo = '', lineas = [], pie = '' } = {}) {
        // «celular 1/4»: el número de página va abajo, no pegado al nombre.
        const pag = /\s(\d+\/\d+)$/.exec(titulo);
        const nombre = pag ? titulo.slice(0, pag.index) : titulo;
        const p = leerPie(pie), alerta = titulo === '¡CUIDADO!';
        const mismo = p.nombre && p.nombre.toLowerCase() === nombre.toLowerCase();
        caja.className = `${base} ${alerta ? 'ring-2 ring-error bg-error-container/80' : 'ring-1 ring-primary-container/40 bg-surface-container-lowest/85'}`;
        $('[data-titulo]').textContent = conMayuscula(nombre);
        $('[data-titulo]').classList.toggle('text-error', alerta);
        $('[data-confianza]').textContent = mismo ? porciento(p.confianza) : '';
        $('[data-confianza]').classList.toggle('hidden', !mismo);
        $('[data-lineas]').replaceChildren(...lineas.filter(Boolean).map(l => Object.assign(document.createElement('span'), { textContent: l })));
        const fuente = mismo ? p.fuente : p.nombre ? `${p.fuente}: ${p.nombre} · ${porciento(p.confianza)}` : p.texto;
        $('[data-fuente]').textContent = fuente;
        $('[data-pagina]').textContent = pag ? `pág. ${pag[1]} · ▶ sigue` : '';
        $('[data-pie]').classList.toggle('hidden', !fuente && !pag);
      },
    };
  }

  // A cuántos píxeles del punto queda el recuadro (0 si lo contiene), como en seguimiento.js.
  const aPx = (c, x, y) => Math.hypot(Math.max(c.x0 - x, 0, x - c.x0 - c.ancho), Math.max(c.y0 - y, 0, y - c.y0 - c.alto));
  const superpuestos = (a, b) => {
    const w = Math.min(a.x0 + a.ancho, b.x0 + b.ancho) - Math.max(a.x0, b.x0), h = Math.min(a.y0 + a.alto, b.y0 + b.alto) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 && (w * h) / (a.ancho * a.alto + b.ancho * b.alto - w * h) > 0.5;
  };
  const CONFIANZA_PRINCIPAL = 90;   // la de src/seguimiento.js: por debajo, el detector se equivoca más de lo que acierta

  // EL recuadro de lo que se está mirando. Con «ver todo», también lo que marcó el
  // detector y NO se usa, punteado y con el motivo: dudoso o fuera de la mirada. Con
  // «ver escena», todo lo seguro a la vez, con su distancia y lo que tiene cada persona.
  function dibujarCajas(lienzo, { ancho = 640, alto = 480, radio = 0, mirado = null, lista = [], escena = null } = {}, { verTodo = false, verEscena = false } = {}) {
    if (lienzo.width !== ancho || lienzo.height !== alto) { lienzo.width = ancho; lienzo.height = alto; }
    const ctx = lienzo.getContext('2d');
    ctx.clearRect(0, 0, ancho, alto);
    // Las etiquetas, de unos 14 px en la pantalla: el lienzo es de 640 y en un celular se ve a la mitad.
    const escala = lienzo.clientWidth ? ancho / lienzo.clientWidth : 1;
    const tam = Math.round(Math.min(32, Math.max(12, 14 * escala)));
    ctx.textBaseline = 'middle';
    const caja = (c, { trazo, grosor, punteado = false, esquinas = false, texto, fondo, tinta, negrita = false }) => {
      ctx.strokeStyle = trazo; ctx.lineWidth = grosor; ctx.setLineDash(punteado ? [6, 5] : []);
      ctx.strokeRect(c.x0, c.y0, c.ancho, c.alto);
      ctx.setLineDash([]);
      // Las esquinas, como los retículos del diseño.
      if (esquinas) {
        ctx.fillStyle = trazo;
        for (const [x, y] of [[c.x0, c.y0], [c.x0 + c.ancho - 8, c.y0], [c.x0, c.y0 + c.alto - 8], [c.x0 + c.ancho - 8, c.y0 + c.alto - 8]]) ctx.fillRect(x, y, 8, 8);
      }
      ctx.font = `${negrita ? 600 : 500} ${tam}px Inter, system-ui, sans-serif`;
      // Si no entra a la derecha, la etiqueta se corre a la izquierda (no se aplasta).
      const h = tam + 10, w = Math.min(ctx.measureText(texto).width + 14, ancho);
      const x = Math.max(0, Math.min(c.x0, ancho - w)), y = c.y0 >= h + 2 ? c.y0 - h - 2 : c.y0 + 2;
      ctx.fillStyle = fondo; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.fillStyle = tinta; ctx.fillText(texto, x + 7, y + h / 2 + 1, w - 14);
    };
    if (verTodo) {
      if (radio) { ctx.strokeStyle = 'rgba(0,227,253,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ancho / 2, alto / 2, radio, 0, 2 * Math.PI); ctx.stroke(); }
      for (const c of lista) {
        if (mirado && c.nombre === mirado.nombre && superpuestos(c, mirado)) continue;     // ya está, en grande
        const motivo = c.corregido ? 'corregido: no es' : c.confianza < CONFIANZA_PRINCIPAL ? 'descartado' : radio && aPx(c, ancho / 2, alto / 2) > radio ? 'fuera de la mirada' : '';
        caja(c, { trazo: motivo ? 'rgba(190,200,210,.7)' : 'rgba(255,223,154,.85)', grosor: 1, punteado: Boolean(motivo),
                  texto: `${c.nombre} ${porciento(c.confianza)}${motivo ? ` · ${motivo}` : ''}`, fondo: 'rgba(11,14,19,.8)', tinta: motivo ? '#bec8d2' : '#ffdf9a' });
      }
    }
    if (verEscena && escena?.objetos?.length) {
      const centro = (o) => ({ x: o.x0 + o.ancho / 2, y: o.y0 + o.alto / 2 });
      const porId = new Map(escena.objetos.map(o => [o.id, o]));
      // Primero las líneas, para que las etiquetas queden encima.
      for (const r of escena.relaciones ?? []) {
        const a = porId.get(r.a), b = porId.get(r.b);
        if (!a || !b) continue;
        const pa = centro(a), pb = centro(b), tiene = r.tipo === 'tiene';
        ctx.strokeStyle = tiene ? 'rgba(47,227,120,.9)' : 'rgba(189,244,255,.7)'; ctx.lineWidth = tiene ? 2 : 1;
        ctx.setLineDash(tiene ? [] : [4, 4]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
        const texto = tiene ? 'tiene' : `≈${r.metros} m`;
        ctx.font = `600 ${tam}px Inter, system-ui, sans-serif`;
        const w = ctx.measureText(texto).width + 10, mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        ctx.fillStyle = 'rgba(11,14,19,.85)'; ctx.fillRect(mx - w / 2, my - (tam + 6) / 2, w, tam + 6);
        ctx.fillStyle = tiene ? '#2fe378' : '#bdf4ff'; ctx.fillText(texto, mx - w / 2 + 5, my + 1);
      }
      // Lo que se está mirando va aparte, en celeste y encima: acá no se repite.
      for (const o of escena.objetos.filter(o => !(mirado && o.nombre === mirado.nombre && superpuestos(o, mirado))))
        caja(o, { trazo: 'rgba(47,227,120,.85)', grosor: 1.5, fondo: 'rgba(11,14,19,.85)', tinta: '#2fe378',
                  texto: `${conMayuscula(o.nombre)} · ${porciento(o.confianza)}${o.metros !== null && o.metros !== undefined ? ` · ≈${o.metros} m` : ''}` });
    }
    // Su distancia: la medida del seguimiento, o con «ver escena», la estimada.
    const enEscena = verEscena && mirado ? escena?.objetos?.find(o => o.nombre === mirado.nombre && superpuestos(o, mirado)) : null;
    const lejos = mirado?.metros !== undefined ? metros(mirado.metros) : enEscena?.metros ? `≈${enEscena.metros} m` : '';
    // Algo en la mirada que no se parece a nada conocido: se marca, sin nombre ni porcentaje.
    if (mirado?.desconocido) caja(mirado, { trazo: '#ffb74d', grosor: 2, esquinas: true, negrita: true, fondo: '#ffb74d', tinta: '#3d2400',
                                            texto: `${mirado.nombre} · ¿qué es?` });
    else if (mirado) caja(mirado, { trazo: '#00e3fd', grosor: 2, esquinas: true, negrita: true, fondo: '#00e3fd', tinta: '#00363d',
                                    texto: `${conMayuscula(mirado.nombre)} · ${porciento(mirado.confianza)}${lejos ? ` · ${lejos}` : ''}` });
  }

  window.ClienteGafas = ClienteGafas;
  window.dibujarHud = dibujarHud;
  window.dibujarCajas = dibujarCajas;
  window.montarTarjetaHud = montarTarjetaHud;
  window.conMayuscula = conMayuscula;
  window.leerPie = leerPie;
})();
