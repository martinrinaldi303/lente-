// sesion.js — un par de gafas conectado al cerebro.
//
// No sabe nada de WebSocket ni de Gemini: recibe paquetes, devuelve paquetes. Así
// se prueba en frío (pruebas/sesion.test.js) y sirve igual para el emulador del
// navegador y para el ESP32.

import jpeg from 'jpeg-js';
import { encolarAcotado } from './cola_acotada.js';
import { componerHud, envolver, COLS } from './hud.js';
import { interpretarTarjeta, leerQr } from './qr.js';
import { BIN_AUDIO_BAJA, BIN_AUDIO_SUBE, BIN_JPEG, desempaquetar, empaquetar } from './protocolo.js';
import { EXTRACTORES } from './extractores.js';
import { FICHAS, paginasDe } from './fichas.js';
import { colorDominante, regionCentral } from './imagen.js';
import { FUENTE as FUENTE_V0 } from './rasgos.js';
import { CLASE_NADA, nombreDeClase } from './red_objetos.js';

const TOPE_CUADROS       = 2;     // sólo importa el cuadro más nuevo
const EJEMPLOS_POR_TANDA = 12;    // cuadros que se guardan cada vez que se enseña algo
const VOTOS              = 5;     // la etiqueta sale por mayoría de los últimos 5 cuadros
const VOTOS_MINIMOS      = 3;
const CONFIANZA_MINIMA   = 0.7;
// Con los tres votantes y el voto pesado al cubo (55 clases, 1.284 fotos de prueba):
// con 0,7 opina en el 91 % de las fotos y acierta 98 %; con 0,5, en el 96 % y acierta 97 %.
const CONFIANZA_GENERAL  = 0.7;
const MAX_PASOS          = 40;
const MS_ENTRE_CUADROS_LLM = 1000;
const MS_ESPERA_CAMARA   = 3000;
const TEXTO_REPOSO       = 'Lista.';
const TEXTO_MIRANDO      = 'Mirando el aparato...';
const CLASE_PERSONA      = 'persona';
const SOSPECHA_DE_PERSONA = 0.3;   // con esta confianza de «persona» ya no se manda nada al LLM
const CUADROS_DE_TARJETA = 10;     // una tarjeta leída sigue en pantalla 10 cuadros (5 s) sin el QR a la vista

// Lo que el LLM puede pedirle al cerebro. La voz es lo ÚNICO que hace el LLM: ver
// es trabajo de la red propia, y por eso existe `que_veo`.
export const HERRAMIENTAS = [
  {
    name: 'hud_mostrar',
    description: 'Escribe un texto corto en la pantalla de las gafas (3 renglones de 21 letras).',
    parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' } }, required: ['texto'] },
  },
  {
    name: 'que_veo',
    description: 'Devuelve el objeto que la red propia de las gafas reconoce ahora en el centro de la imagen, o null.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'objetos_conocidos',
    description: 'Lista los objetos que la red ya aprendió y con cuántos ejemplos.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'ensenar_objeto',
    description: 'Le enseña a la red el objeto que el usuario tiene delante. Usar «nada» para el fondo vacío.',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' } }, required: ['nombre'] },
  },
  {
    name: 'olvidar_objeto',
    description: 'Borra un objeto aprendido.',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' } }, required: ['nombre'] },
  },
  {
    name: 'pasos_cargar',
    description: 'Carga una guía paso a paso para armar o desarmar algo y muestra el primer paso. Cada paso, una sola acción, de 60 letras como mucho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        titulo: { type: 'STRING', description: 'Hasta 14 letras, por ejemplo «Desarmar grifo»' },
        pasos: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['titulo', 'pasos'],
    },
  },
  {
    name: 'pasos_ir',
    description: 'Avanza o retrocede en la guía cargada.',
    parameters: {
      type: 'OBJECT',
      properties: { hacia: { type: 'STRING', enum: ['siguiente', 'anterior', 'primero'] } },
      required: ['hacia'],
    },
  },
  {
    name: 'leer_tarjeta',
    description: 'Devuelve la tarjeta que una persona está MOSTRANDO en un código QR, con lo que ella eligió compartir. Es la única forma en que las gafas saben quién es alguien.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'guardar_tarjeta',
    description: 'Guarda la tarjeta QR que está en pantalla. Sólo si el usuario lo pide.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'identificar_dispositivo',
    description: 'Averigua marca, modelo, características y partes del APARATO que está en el recuadro, y lo deja en pantalla. Tarda unos segundos. Sólo aparatos: si en el recuadro hay una persona, se niega.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'pasos_terminar',
    description: 'Cierra la guía y vuelve a la pantalla normal.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

export class Sesion {
  // `red` es la red personal (lo que el usuario enseña) y `extractorPersonal` el
  // extractor con el que se armó: tienen que ser de la misma fuente y dimensión.
  // `conjunto` es opcional: las redes entrenadas con la base pública (src/conjunto.js).
  // `identificar` es opcional: la función de src/identificar.js, si hay clave del LLM.
  // `registro` es opcional: adónde se anota lo que pasa (src/base.js). La sesión no
  // sabe que existe una base de datos; sólo avisa.
  constructor({ enviarJson, enviarBin, red, extractorPersonal = EXTRACTORES[FUENTE_V0], conjunto = null,
                identificar = null, registro = null, guardarRed = () => {}, visionAlLlm = false }) {
    if (red.inDim !== extractorPersonal.dim || red.fuente !== extractorPersonal.fuente)
      throw new Error(`la red personal es ${red.clave} y el extractor es ${extractorPersonal.fuente}|${extractorPersonal.dim}`);
    this.enviarJson  = enviarJson;
    this.enviarBin   = enviarBin;
    this.red         = red;
    this.extractorPersonal = extractorPersonal;
    this.conjunto    = conjunto;
    this.identificar = identificar;
    this.registro    = registro;
    this.guardarRed  = guardarRed;
    this.visionAlLlm = visionAlLlm;

    this.voz        = null;
    this.vozEstado  = 'sin_clave';
    this.texto      = TEXTO_REPOSO;
    this.pasos      = null;       // { titulo, lista, i }; cada ítem es un texto o renglones ya armados
    this.fichaDe    = null;       // de qué objeto es la ficha en pantalla
    this.paginaFicha = 0;
    this.ultimoCuadro = null;     // el último JPEG que llegó, por si piden identificarlo
    this.ultimoGeneral = null;    // lo que opinó la red general de ese cuadro, sin umbral
    this.identificando = false;
    this.tarjeta    = null;       // { tipo, nombre, lineas, contenido, cuadros, guardada }
    this.anotado    = null;       // lo último que se anotó como reconocido, para no repetirlo
    this.colores    = [];         // el color del recuadro en los últimos cuadros
    this.color      = null;
    this.mostrando  = 'texto';    // 'texto' | 'pasos'
    this.aprendiendo = null;      // { nombre, faltan }
    this.veo        = null;       // { nombre, confianza } — la red personal
    this.votos      = [];
    this.creo       = null;       // { nombre, confianza } — la red general
    this.votosGeneral = [];

    this.cuadros = [];
    this.drenando = false;
    this.cuadrosDescartados = 0;
    this.ultimoCuadroLlm = 0;
    this.ultimoHud = '';
    this.cerrada = false;
  }

  // `fabrica` es conectarVoz de voz_live.js ya con la clave puesta, o null si no hay clave.
  async conectarVoz(fabrica) {
    if (!fabrica) { this._estado('sin_clave'); this._pintar(); return; }
    this._estado('conectando');
    try {
      const voz = await fabrica({
        herramientas: HERRAMIENTAS,
        ejecutar: (nombre, args) => this.ejecutar(nombre, args),
        alAudio: pcm => this.enviarBin(empaquetar(BIN_AUDIO_BAJA, pcm)),
        alInterrumpir: () => this.enviarJson({ t: 'callar' }),
        alDicho: (quien, texto) => this.enviarJson({ t: 'dicho', quien, texto }),
        alEstado: (voz, detalle) => this._estado(voz, detalle),
      });
      if (this.cerrada) voz.cerrar(); else this.voz = voz;
    } catch (e) {
      this._estado('error', e.message);
    }
    this._pintar();
  }

  alBinario(buf) {
    const paquete = desempaquetar(buf);
    if (!paquete) return false;
    if (paquete.tipo === BIN_AUDIO_SUBE) {
      this.voz?.audio(paquete.cuerpo);
    } else if (paquete.tipo === BIN_JPEG) {
      this.cuadrosDescartados += encolarAcotado(this.cuadros, paquete.cuerpo, TOPE_CUADROS);
      if (!this.drenando) { this.drenando = true; setImmediate(() => { this._drenar(); }); }
    }
    return true;
  }

  // Lo que piden las gafas (botones, el panel). Si no se puede hacer, se AVISA: en
  // la primera versión el pedido se perdía en silencio y parecía que nada andaba.
  alJson(msg) {
    const r = this._alJson(msg);
    if (r?.ok === false && r.motivo) this._avisar(r.motivo);
    return r;
  }

  _alJson(msg) {
    switch (msg?.t) {
      case 'ensenar': return this.ejecutar('ensenar_objeto', { nombre: msg.nombre });
      case 'olvidar': {
        const r = this.ejecutar('olvidar_objeto', { nombre: msg.nombre });
        if (r.ok) this._avisar(`Olvidé: ${nombreDeClase(msg.nombre)}`);
        return r.ok ? r : { ok: false, motivo: `No conozco «${nombreDeClase(msg.nombre)}»` };
      }
      case 'paso': {
        // Sin guía cargada, los mismos botones pasan las páginas de la ficha del aparato.
        if (!this.pasos && this._pasarPagina(msg.hacia < 0 ? -1 : 1)) return { ok: true };
        return this.ejecutar('pasos_ir', { hacia: msg.hacia < 0 ? 'anterior' : 'siguiente' });
      }
      case 'guardar_tarjeta': return this.ejecutar('guardar_tarjeta');
      case 'identificar':
        // Tarda: se contesta enseguida y el resultado (o el motivo) llega por el HUD.
        this._identificar().then(r => { if (r.ok === false && r.motivo) this._avisar(r.motivo); });
        return { ok: true, pendiente: true };
      case 'guia':    return this.ejecutar('pasos_cargar', { titulo: msg.titulo, pasos: msg.pasos });
      case 'texto': {
        const texto = String(msg.texto ?? '').slice(0, 500).trim();
        if (!texto) return { ok: false };
        if (!this.voz) return { ok: false, motivo: 'La voz está apagada: no hay quien conteste' };
        this.voz.texto(texto);
        return { ok: true };
      }
      default: return { ok: false, motivo: 'Mensaje desconocido' };
    }
  }

  // Un aviso va a los dos lados: al HUD, que es lo único que ven unas gafas de
  // verdad, y como mensaje aparte para el registro del emulador.
  _avisar(texto) {
    this.enviarJson({ t: 'aviso', texto });
    if (!this.aprendiendo) {
      this.texto = texto;
      this.mostrando = 'texto';
      this._pintar();
    }
  }

  // Devuelve el resultado, o una promesa del resultado si la herramienta tarda
  // (identificar_dispositivo consulta al LLM).
  ejecutar(nombre, args = {}) {
    const r = this._ejecutar(nombre, args);
    if (r instanceof Promise) return r.then(x => { this._pintar(); return x; });
    this._pintar();
    return r;
  }

  // Las páginas de la ficha en pantalla. false si no hay ficha que pasar.
  _pasarPagina(hacia) {
    const objeto = this.veo ?? this.creo;
    const paginas = objeto && this.texto === TEXTO_REPOSO ? paginasDe(objeto.nombre) : null;
    if (!paginas || paginas.length < 2) return false;
    this.paginaFicha = Math.max(0, Math.min(paginas.length - 1, this.paginaFicha + hacia));
    this._pintar();
    return true;
  }

  // Marca, modelo, características y partes del aparato del recuadro, con el LLM.
  // Las negativas están ANTES de mandar nada: lo que no sale de la máquina no se filtra.
  async _identificar() {
    if (!this.identificar) return { ok: false, motivo: 'Para el modelo hace falta la clave de Gemini' };
    if (!this.ultimoCuadro) return { ok: false, motivo: 'No hay imagen: prendé la cámara' };
    const visto = this.veo ?? this.creo;
    const general = this.ultimoGeneral;
    if (visto?.nombre === CLASE_PERSONA || (general?.nombre === CLASE_PERSONA && general.confianza >= SOSPECHA_DE_PERSONA))
      return { ok: false, motivo: 'Hay una persona en el recuadro: sólo identifico aparatos' };
    if (this.identificando) return { ok: false, motivo: 'Ya estoy mirando ese aparato' };

    this.identificando = true;
    this.texto = TEXTO_MIRANDO;
    this.mostrando = 'texto';
    this._pintar();
    try {
      const f = await this.identificar(this.ultimoCuadro, visto?.nombre ?? '');
      if (this.cerrada) return { ok: false };
      if (!f) return { ok: false, motivo: 'No veo ningún aparato en el recuadro' };
      const deATres = (lista) => { const out = []; for (let k = 0; k < lista.length; k += 3) out.push(lista.slice(k, k + 3)); return out; };
      this.registro?.identificacion(f);
      this.pasos = {
        titulo: f.tipo,
        lista: [
          [[f.marca, f.modelo].filter(Boolean).join(' ') || f.tipo, `Seguridad: ${f.seguridad}`, f.por_que],
          ...deATres(f.caracteristicas),
          ...deATres(f.partes.length ? ['Partes:', ...f.partes] : []),
        ].map(p => p.filter(Boolean)).filter(p => p.length),
        i: 0,
      };
      this.mostrando = 'pasos';
      return { ok: true, ...f, nota: 'Ya está en pantalla. Si la seguridad es baja, decilo.' };
    } catch (e) {
      return { ok: false, motivo: `No pude consultar el modelo: ${String(e.message).slice(0, 80)}` };
    } finally {
      this.identificando = false;
      if (this.texto === TEXTO_MIRANDO) this.texto = TEXTO_REPOSO;
      this._pintar();
    }
  }

  _ejecutar(nombre, args) {
    switch (nombre) {
      case 'hud_mostrar':
        this.texto = String(args.texto ?? '').slice(0, 200);
        this.mostrando = 'texto';
        return { ok: true };

      case 'que_veo': {
        const extra = (nombre) => ({ color: this.color ?? undefined, datos_del_tipo: FICHAS[nombre]?.datos, partes_del_tipo: FICHAS[nombre]?.partes });
        if (this.veo) return { objeto: this.veo.nombre, confianza: Number(this.veo.confianza.toFixed(2)),
                               fuente: 'enseñado por el usuario', ...extra(this.veo.nombre) };
        if (this.creo) return { objeto: this.creo.nombre, confianza: Number(this.creo.confianza.toFixed(2)),
                                fuente: 'red general', nota: 'Puede equivocarse: decilo como una suposición.', ...extra(this.creo.nombre) };
        if (!this.red.lista && !this.conjunto) return { objeto: null, motivo: 'la red todavía no aprendió dos objetos' };
        return { objeto: null, motivo: 'no reconozco nada de lo que aprendí' };
      }

      case 'objetos_conocidos':
        return { objetos: this.red.resumen() };

      case 'ensenar_objeto': {
        const clase = nombreDeClase(args.nombre);
        if (!clase) return { ok: false, motivo: 'Falta el nombre del objeto' };
        this.aprendiendo = { nombre: clase, faltan: EJEMPLOS_POR_TANDA };
        // Si la cámara está apagada no llega ningún cuadro, y sin esto la pantalla
        // quedaba en «Aprendiendo 0/12» para siempre.
        clearTimeout(this.relojEnsenar);
        this.relojEnsenar = setTimeout(() => {
          if (this.aprendiendo?.faltan !== EJEMPLOS_POR_TANDA) return;
          this.aprendiendo = null;
          this._avisar('No llegan imágenes: prendé la cámara');
        }, MS_ESPERA_CAMARA);
        this.relojEnsenar.unref?.();
        return { ok: true, nombre: clase, cuadros: EJEMPLOS_POR_TANDA,
                 nota: 'Pedile que lo mantenga en el centro y lo gire un poco. Necesita la cámara prendida.' };
      }

      case 'olvidar_objeto': {
        const ok = this.red.olvidar(args.nombre);
        if (ok) { this.red.entrenar(); this.guardarRed(this.red); this.votos = []; this.veo = null; }
        return { ok };
      }

      case 'pasos_cargar': {
        const lista = (Array.isArray(args.pasos) ? args.pasos : [])
          .map(p => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_PASOS);
        if (!lista.length) return { ok: false, motivo: 'La guía vino vacía' };
        this.pasos = { titulo: String(args.titulo ?? 'Guía'), lista, i: 0 };
        this.mostrando = 'pasos';
        return { ok: true, pasos: lista.length };
      }

      case 'identificar_dispositivo':
        return this._identificar();

      case 'leer_tarjeta':
        return this.tarjeta
          ? { hay: true, tipo: this.tarjeta.tipo, nombre: this.tarjeta.nombre, renglones: this.tarjeta.lineas, guardada: this.tarjeta.guardada }
          : { hay: false, motivo: 'nadie está mostrando un código QR' };

      case 'guardar_tarjeta': {
        if (!this.tarjeta) return { ok: false, motivo: 'No hay ninguna tarjeta QR a la vista' };
        if (!this.registro) return { ok: false, motivo: 'No hay base de datos donde guardarla' };
        if (!this.tarjeta.guardada) this.registro.tarjeta(this.tarjeta);
        this.tarjeta.guardada = true;
        return { ok: true, nombre: this.tarjeta.nombre || this.tarjeta.lineas[0] };
      }

      case 'pasos_ir': {
        if (!this.pasos) return { ok: false, motivo: 'No hay ninguna guía cargada' };
        const p = this.pasos, ultimo = p.lista.length - 1;
        if (args.hacia === 'primero') p.i = 0;
        else if (args.hacia === 'anterior') p.i = Math.max(0, p.i - 1);
        else p.i = Math.min(ultimo, p.i + 1);
        this.mostrando = 'pasos';
        return { ok: true, paso: p.i + 1, de: p.lista.length, texto: [].concat(p.lista[p.i]).join('. '), es_el_ultimo: p.i === ultimo };
      }

      case 'pasos_terminar':
        this.pasos = null;
        this.mostrando = 'texto';
        this.texto = TEXTO_REPOSO;
        return { ok: true };

      default:
        return { ok: false, motivo: `herramienta desconocida: ${nombre}` };
    }
  }

  cerrar() {
    this.cerrada = true;
    clearTimeout(this.relojEnsenar);
    this.cuadros.length = 0;
    this.voz?.cerrar();
    this.voz = null;
  }

  _estado(voz, detalle) {
    this.vozEstado = voz;
    this.enviarJson({ t: 'estado', voz, detalle: detalle ? String(detalle).slice(0, 200) : undefined });
  }

  // De a un cuadro por vez y en orden. Mientras uno se procesa (la red ya entrenada
  // tarda ~30 ms) los que llegan esperan en la cola acotada, que se queda con los
  // dos más nuevos. Entre cuadro y cuadro se le cede el turno al audio.
  async _drenar() {
    while (this.cuadros.length && !this.cerrada) {
      const cuadro = this.cuadros.shift();
      try { await this._procesar(cuadro); }
      catch (e) { console.warn(`[sesion] cuadro descartado: ${e.message}`); }
      await new Promise(r => setImmediate(r));
    }
    this.drenando = false;
  }

  async _procesar(cuadro) {
    this.ultimoCuadro = cuadro;
    if (this.visionAlLlm && this.voz && Date.now() - this.ultimoCuadroLlm >= MS_ENTRE_CUADROS_LLM) {
      this.ultimoCuadroLlm = Date.now();
      this.voz.frame(cuadro);
    }

    const img = jpeg.decode(cuadro, { useTArray: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 });
    // Un código QR se busca en el cuadro ENTERO, no sólo en el recuadro: la persona
    // lo muestra donde puede. Si se deja de ver, la tarjeta queda unos segundos.
    const qr = leerQr(img);
    if (qr) {
      if (qr !== this.tarjeta?.contenido) this.tarjeta = { ...interpretarTarjeta(qr), guardada: false };
      this.tarjeta.cuadros = 0;
    } else if (this.tarjeta && ++this.tarjeta.cuadros > CUADROS_DE_TARJETA) {
      this.tarjeta = null;
    }

    const region = regionCentral(img);
    const vector = await this.extractorPersonal.extraer(img, region);
    if (this.cerrada) return;

    if (this.aprendiendo) {
      const a = this.aprendiendo;
      this.red.agregarEjemplo(a.nombre, vector);
      if (--a.faltan <= 0) {
        this.aprendiendo = null;
        this.red.entrenar();
        this.guardarRed(this.red);
        this.votos = [];
        this.veo = null;
        this.texto = this.red.lista
          ? `Aprendí: ${a.nombre}`
          : `Aprendí: ${a.nombre}. Ahora mostrame otra cosa (o «nada»).`;
        this.mostrando = 'texto';
      }
      this._pintar();
      return;
    }

    this.colores.push(colorDominante(img, region));
    if (this.colores.length > VOTOS) this.colores.shift();
    this.color = masRepetido(this.colores);

    const pred = this.red.predecir(vector);
    this.votos.push(pred && pred.confianza >= CONFIANZA_MINIMA ? pred : null);
    if (this.votos.length > VOTOS) this.votos.shift();
    this.veo = this._mayoria(this.votos);

    // La red general (base pública) opina aparte, y sólo cuando está segura. El
    // vector del extractor personal ya está calculado arriba: no se saca dos veces.
    if (this.conjunto) {
      const general = await this.conjunto.predecir(img, region, { [this.extractorPersonal.fuente]: vector });
      if (this.cerrada) return;
      this.ultimoGeneral = general;
      this.votosGeneral.push(general && general.confianza >= CONFIANZA_GENERAL ? general : null);
      if (this.votosGeneral.length > VOTOS) this.votosGeneral.shift();
      this.creo = this._mayoria(this.votosGeneral);
    }
    this._pintar();
  }

  // Una fila en el registro cada vez que CAMBIA lo reconocido, no una por cuadro.
  _anotarReconocido() {
    const objeto = this.veo ?? this.creo;
    const clave = objeto ? `${this.veo ? 'ensenado' : 'general'}:${objeto.nombre}` : null;
    if (clave === this.anotado) return;
    this.anotado = clave;
    if (objeto) this.registro?.reconocimiento({
      nombre: objeto.nombre, confianza: Number(objeto.confianza.toFixed(3)),
      origen: this.veo ? 'ensenado' : 'general', color: this.color,
    });
  }

  _mayoria(votos) {
    const cuenta = new Map();
    for (const v of votos) {
      if (!v) continue;
      const c = cuenta.get(v.nombre) ?? { n: 0, suma: 0 };
      c.n++; c.suma += v.confianza;
      cuenta.set(v.nombre, c);
    }
    let mejor = null;
    for (const [nombre, c] of cuenta) {
      if (c.n >= VOTOS_MINIMOS && (!mejor || c.n > mejor.n)) mejor = { nombre, n: c.n, confianza: c.suma / c.n };
    }
    return mejor && mejor.nombre !== CLASE_NADA ? { nombre: mejor.nombre, confianza: mejor.confianza } : null;
  }

  _pintar() {
    if (this.cerrada) return;
    let titulo = 'MIIA gafas', texto = this.texto, lineas;
    if (this.aprendiendo) {
      const a = this.aprendiendo;
      titulo = 'Aprendiendo';
      lineas = [a.nombre, `${EJEMPLOS_POR_TANDA - a.faltan}/${EJEMPLOS_POR_TANDA}`, 'Giralo un poco'];
    } else if (this.mostrando === 'pasos' && this.pasos) {
      const p = this.pasos;
      const cuenta = ` ${p.i + 1}/${p.lista.length}`;
      titulo = p.titulo.slice(0, COLS - cuenta.length) + cuenta;
      lineas = Array.isArray(p.lista[p.i]) ? p.lista[p.i] : envolver(p.lista[p.i]);
    } else if (this.texto === TEXTO_REPOSO && this.tarjeta) {
      // Alguien muestra su tarjeta: va antes que cualquier objeto reconocido.
      titulo = this.tarjeta.guardada ? 'Tarjeta guardada' : 'Tarjeta QR';
      lineas = this.tarjeta.lineas;
    } else if (this.texto === TEXTO_REPOSO && (this.veo || this.creo)) {
      // La pantalla está libre y hay algo reconocido: se muestran sus características.
      // Primera página: dos renglones del TIPO de aparato (fichas.js) y uno medido en
      // este cuadro. Las siguientes, con «Siguiente»: las partes, de a tres.
      const objeto = this.veo ?? this.creo;
      if (objeto.nombre !== this.fichaDe) { this.fichaDe = objeto.nombre; this.paginaFicha = 0; }
      const paginas = paginasDe(objeto.nombre) ?? [{ titulo: objeto.nombre, lineas: [] }];
      const i = Math.min(this.paginaFicha, paginas.length - 1);
      const cuenta = paginas.length > 1 ? ` ${i + 1}/${paginas.length}` : '';
      titulo = paginas[i].titulo.slice(0, COLS - cuenta.length) + cuenta;
      lineas = i === 0 ? [...paginas[0].lineas, this.color ? `Color: ${this.color}` : ''].filter(Boolean) : paginas[i].lineas;
    }
    // «veo» es lo que vos le enseñaste; «creo» es la red general, que se equivoca más.
    // Lo tuyo tiene prioridad.
    // Si el nombre es largo se achica el rótulo, no el porcentaje: «~» quiere decir «creo».
    const rotulo = (largo, corto, v) => {
      const cola = `${v.nombre} ${Math.round(v.confianza * 100)}%`;
      return largo.length + cola.length <= COLS ? largo + cola : corto + cola;
    };
    const pie = this.veo ? rotulo('veo: ', '', this.veo)
      : this.creo ? rotulo('creo: ', '~', this.creo)
      : this.red.lista || this.conjunto ? 'veo: -' : 'veo: sin entrenar';

    this._anotarReconocido();
    const hud = componerHud({ titulo, texto, lineas, pie });
    const firma = JSON.stringify(hud);
    if (firma === this.ultimoHud) return;      // el OLED no se redibuja si no cambió nada
    this.ultimoHud = firma;
    this.enviarJson(hud);
  }
}

// El valor que más aparece en la lista, si aparece al menos VOTOS_MINIMOS veces.
function masRepetido(lista) {
  const cuenta = new Map();
  for (const v of lista) if (v) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor = null, veces = 0;
  for (const [v, c] of cuenta) if (c > veces) { mejor = v; veces = c; }
  return veces >= VOTOS_MINIMOS ? mejor : null;
}
