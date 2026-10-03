// sesion.js — un par de gafas conectado al cerebro.
//
// No sabe nada de WebSocket ni de qué LLM hay detrás: recibe paquetes, devuelve paquetes. Así
// se prueba en frío (pruebas/sesion.test.js) y sirve igual para el emulador del
// navegador y para el ESP32.

import jpeg from 'jpeg-js';
import { encolarAcotado } from './cola_acotada.js';
import { componerHud, envolver, COLS } from './hud.js';
import { interpretarTarjeta, leerQr } from './qr.js';
import { Permanencia } from './permanencia.js';
import { RADIO_DE_MIRADA, Seguimiento, cajaEntera, confirmar, metrosRedondos, principalDe, renglonesDeMedida } from './seguimiento.js';
import { BIN_AUDIO_BAJA, BIN_AUDIO_SUBE, BIN_FOTO, BIN_JPEG, desempaquetar, empaquetar } from './protocolo.js';
import { Vigia, renglonesDeAlerta } from './alertas.js';
import { EXTRACTORES } from './extractores.js';
import { FICHAS, paginasDe } from './fichas.js';
import { buscarGuia, resumenDeGuias } from './guias.js';
import { colorDominante, regionCentral } from './imagen.js';
import { DOCUMENTO_PERSONAL, paginar } from './leer.js';
import { focalDesdeFovDiagonal, pesoEstimadoG, renglonDeTamano, tamanoDeCajaCm } from './medir.js';
import { lugarDeQr } from './memoria.js';
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
const MS_ENTRE_MEDICIONES = 1000;  // al registro va una medición por segundo, no una por cuadro
const PASO_CAJA_PX       = 4;      // el recuadro del emulador se mueve de a 4 px: sin esto tiembla
const CUADROS_DE_TARJETA = 10;     // una tarjeta leída sigue en pantalla 10 cuadros (5 s) sin el QR a la vista
const TEXTO_LEYENDO      = 'Leyendo...';
const MS_MENSAJE         = 8000;   // una respuesta corta («llaves: hace 5 min») se va sola a los 8 s
const MS_ALERTA          = 3000;   // lo que dura en pantalla el aviso de un vehículo
const MS_DISTANCIA_VALIDA = 1500;  // una lectura del sensor láser vale esto; después se da por vieja
const MS_ESPERA_FOTO     = 2500;   // si las gafas no mandan la foto grande, se lee el último cuadro
const CONFIANZA_MEMORIA  = 0.9;    // lo que el detector marca en el resto del cuadro se recuerda si está así de seguro

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
  {
    name: 'donde_esta',
    description: 'Dice cuándo y en qué lugar vieron las gafas un OBJETO por última vez («¿dónde dejé las llaves?»). Nunca personas.',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' } }, required: ['nombre'] },
  },
  {
    name: 'lugar_actual',
    description: 'Anota en qué lugar está el usuario («estoy en la cocina»), para recordar dónde ve cada cosa. Vacío lo borra.',
    parameters: { type: 'OBJECT', properties: { lugar: { type: 'STRING' } }, required: ['lugar'] },
  },
  {
    name: 'leer_texto',
    description: 'Lee el texto que el usuario tiene delante (cartel, etiqueta, envase, vencimiento) y lo deja en pantalla. Tarda unos segundos. No lee documentos personales.',
    parameters: { type: 'OBJECT', properties: { traducir_a: { type: 'STRING', description: 'Idioma al que traducirlo, si lo pide' } } },
  },
  {
    name: 'buscar_guia',
    description: 'Busca entre las guías guardadas (primeros auxilios, hogar, reparaciones) y carga la que coincida. Usala ANTES de inventar una guía con pasos_cargar.',
    parameters: { type: 'OBJECT', properties: { consulta: { type: 'STRING' } }, required: ['consulta'] },
  },
  {
    name: 'medir_objeto',
    description: 'Mide el ancho y el alto del objeto del centro de la mirada con el sensor de distancia. Con material y forma estima el peso.',
    parameters: {
      type: 'OBJECT',
      properties: {
        material: { type: 'STRING', description: 'acero, aluminio, madera, vidrio, abs, pla, carton…' },
        forma: { type: 'STRING', enum: ['caja', 'cilindro', 'esfera'] },
        fondo_cm: { type: 'NUMBER', description: 'La profundidad, para una caja' },
      },
    },
  },
];

export class Sesion {
  // `red` es la red personal (lo que el usuario enseña) y `extractorPersonal` el
  // extractor con el que se armó: tienen que ser de la misma fuente y dimensión.
  // `conjunto` es opcional: las redes entrenadas con la base pública (src/conjunto.js).
  // `detector` es opcional: src/detector.js, que dice DÓNDE está cada objeto.
  // `identificar` es opcional: la función de src/identificar.js, si hay clave del LLM.
  // `registro` es opcional: adónde se anota lo que pasa (src/base.js). La sesión no
  // sabe que existe una base de datos; sólo avisa.
  constructor({ enviarJson, enviarBin, red, extractorPersonal = EXTRACTORES[FUENTE_V0], conjunto = null,
                detector = null, fovDiagonalGrados = 55, reloj = Date.now,
                identificar = null, registro = null, guardarRed = () => {}, visionAlLlm = false,
                memoria = null, guias = [], leer = null, anotarEvaluacion = null, msEsperaFoto = MS_ESPERA_FOTO }) {
    if (red.inDim !== extractorPersonal.dim || red.fuente !== extractorPersonal.fuente)
      throw new Error(`la red personal es ${red.clave} y el extractor es ${extractorPersonal.fuente}|${extractorPersonal.dim}`);
    this.enviarJson  = enviarJson;
    this.enviarBin   = enviarBin;
    this.red         = red;
    this.extractorPersonal = extractorPersonal;
    this.conjunto    = conjunto;
    this.detector    = detector;
    this.seguimiento = new Seguimiento({ fovDiagonalGrados });
    this.reloj       = reloj;
    this.identificar = identificar;
    this.registro    = registro;
    this.guardarRed  = guardarRed;
    this.visionAlLlm = visionAlLlm;
    // Lo de la décima pasada, todo opcional (ver PLAN.md):
    this.memoria     = memoria;            // src/memoria.js: «¿dónde dejé…?»
    this.guias       = guias;              // src/guias.js: guías guardadas en disco
    this.leer        = leer;               // src/leer.js: leer texto con el LLM
    this.anotarEvaluacion = anotarEvaluacion;   // adónde va cada «acertó / se equivocó»
    this.msEsperaFoto = msEsperaFoto;
    this.fov         = fovDiagonalGrados;
    this.vigia       = new Vigia({ fovDiagonalGrados });

    this.voz        = null;
    this.vozEstado  = 'sin_clave';
    this.modoVoz    = undefined;  // 'audio' | 'texto', según el LLM conectado
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
    this.creo       = null;       // { nombre, confianza } — lo que se muestra como «creo:»
    this.votosGeneral = [];
    this.creoClasificador = null; // lo que dicen las redes sobre el recuadro del centro
    this.hay        = null;       // { nombre, confianza, caja } — el objeto principal del detector
    this.votosDetector = [];
    this.medida     = null;       // { distanciaM, velocidadKmh, llegadaS } del objeto principal
    this.ultimaMedicionAnotada = 0;
    this.ultimasCajas = '';
    // Lo que se muestra no cambia de tema a cada cuadro (src/permanencia.js).
    this.permanenciaVeo  = new Permanencia();
    this.permanenciaCreo = new Permanencia();
    this.cajaSuave  = null;       // { nombre, x0, y0, ancho, alto } — el recuadro que se dibuja, sin el temblor
    this.alerta     = null;       // { hasta, lineas } — un vehículo por llegar: le gana a todo en la pantalla
    this.distanciaSensor = null;  // { mm, cuando } — lo último que midió el sensor láser
    this.tamano     = null;       // { objeto, anchoCm, altoCm, distanciaMm } del objeto del centro
    this.esperandoFoto = null;    // la función que recibe la foto grande pedida con {t:"foto"}
    this.leyendo    = false;
    this.relojMensaje = null;

    this.cuadros = [];
    this.drenando = false;
    this.cuadrosDescartados = 0;
    this.ultimoCuadroLlm = 0;
    this.ultimoHud = '';
    this.cerrada = false;
  }

  // `fabrica` conecta con el LLM ya con la clave puesta (voz_live.js o voz_deepseek.js),
  // o es null si no hay clave. `fabrica.modo` dice cómo conversa ese LLM:
  //   'audio' → escucha y habla él (Gemini Live): las gafas mandan y reciben sonido.
  //   'texto' → sólo lee y escribe (DeepSeek): las gafas transcriben lo que se dice,
  //             lo mandan como {t:"texto"} y leen en voz alta cada {t:"dicho"}.
  async conectarVoz(fabrica) {
    if (!fabrica) { this._estado('sin_clave'); this._pintar(); return; }
    this.modoVoz = fabrica.modo ?? 'audio';
    this._estado('conectando');
    try {
      const voz = await fabrica({
        herramientas: HERRAMIENTAS,
        ejecutar: (nombre, args) => this.ejecutar(nombre, args),
        alAudio: pcm => this.enviarBin(empaquetar(BIN_AUDIO_BAJA, pcm)),
        alInterrumpir: () => this.enviarJson({ t: 'callar' }),
        alDicho: (quien, texto) => this.enviarJson({ t: 'dicho', quien, texto }),
        alEstado: (voz, detalle) => this._estado(voz, detalle),
        alAviso: (texto) => this._avisar(texto),
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
    } else if (paquete.tipo === BIN_FOTO) {
      this.esperandoFoto?.(paquete.cuerpo);     // una foto que nadie pidió se ignora
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
      // Lo que se pide con un botón, sin el LLM de por medio, también se dice en voz
      // alta: para quien ve poco, la pantalla sola no alcanza.
      case 'donde': {
        const r = this.ejecutar('donde_esta', { nombre: msg.nombre });
        if (r.frase || r.motivo) this.enviarJson({ t: 'decir', texto: r.frase ?? r.motivo });
        return r.ok === false ? r : { ok: true, ...r };
      }
      case 'lugar': return this.ejecutar('lugar_actual', { lugar: msg.nombre });
      case 'leer':
        this._leer({ traducirA: msg.traducir_a, enVozAlta: true }).then(r => { if (r.ok === false && r.motivo) this._avisar(r.motivo); });
        return { ok: true, pendiente: true };
      case 'guia_local': return this.ejecutar('buscar_guia', { consulta: msg.consulta });
      case 'distancia': {
        const mm = Number(msg.mm);
        this.distanciaSensor = mm > 0 && mm < 10000 ? { mm, cuando: this.reloj() } : null;
        return { ok: true };
      }
      case 'evaluar': return this._evaluar(msg);
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
    if (!this.identificar) return { ok: false, motivo: 'Para el modelo hace falta la clave del LLM' };
    if (!this.ultimoCuadro) return { ok: false, motivo: 'No hay imagen: prendé la cámara' };
    const visto = this.veo ?? this.creo;
    const general = this.ultimoGeneral;
    // Con detector y un aparato localizado, lo que se manda es el recorte DE ESE
    // APARATO, no el recuadro del centro: aunque haya una persona en el cuadro, ella
    // no viaja. Sin aparato localizado vale la regla de siempre: ante la sospecha de
    // una persona en el recuadro, no se manda nada.
    const aparato = this.hay && this.hay.nombre !== CLASE_PERSONA && this.hay.caja ? this.hay : null;
    if (!aparato && (visto?.nombre === CLASE_PERSONA || (general?.nombre === CLASE_PERSONA && general.confianza >= SOSPECHA_DE_PERSONA)))
      return { ok: false, motivo: 'Hay una persona en el recuadro: sólo identifico aparatos' };
    if (this.identificando) return { ok: false, motivo: 'Ya estoy mirando ese aparato' };

    this.identificando = true;
    this.texto = TEXTO_MIRANDO;
    this.mostrando = 'texto';
    this._pintar();
    try {
      const f = await this.identificar(this.ultimoCuadro, aparato?.nombre ?? visto?.nombre ?? '', aparato?.caja);
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
        const extra = (nombre) => ({ color: this.color ?? undefined, datos_del_tipo: FICHAS[nombre]?.datos, partes_del_tipo: FICHAS[nombre]?.partes,
                                     tamano: this.tamano?.objeto === nombre ? renglonDeTamano(this.tamano) : undefined });
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
        if (ok) { this.red.entrenar(); this.guardarRed(this.red); this.votos = []; this.veo = null; this.permanenciaVeo.reiniciar(); }
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

      case 'donde_esta': {
        if (!this.memoria) return { ok: false, motivo: 'La memoria de objetos está apagada' };
        const r = this.memoria.dondeEsta(args.nombre);
        this._mostrarUnRato(r.visto ? r.frase : r.motivo);
        return r;
      }

      case 'lugar_actual': {
        if (!this.memoria) return { ok: false, motivo: 'La memoria de objetos está apagada' };
        const lugar = this.memoria.marcarLugar(args.lugar);
        this._mostrarUnRato(lugar ? `Lugar: ${lugar}` : 'Lugar borrado');
        return { ok: true, lugar };
      }

      case 'leer_texto':
        return this._leer({ traducirA: args.traducir_a });

      case 'buscar_guia': {
        const g = buscarGuia(this.guias, args.consulta);
        if (!g) return { ok: false, motivo: `No tengo una guía de «${String(args.consulta ?? '').trim()}»`,
                         hay: resumenDeGuias(this.guias).slice(0, 12).map(x => x.titulo) };
        this.pasos = { titulo: g.titulo, lista: g.pasos, i: 0 };
        this.mostrando = 'pasos';
        return { ok: true, titulo: g.titulo, pasos: g.pasos.length, primer_paso: g.pasos[0], fuente: g.fuente, aviso: g.aviso || undefined };
      }

      case 'medir_objeto':
        return this._medirObjeto(args);

      default:
        return { ok: false, motivo: `herramienta desconocida: ${nombre}` };
    }
  }

  // Una respuesta corta que se va sola: no queda tapando la ficha para siempre.
  _mostrarUnRato(texto, ms = MS_MENSAJE) {
    this.texto = texto;
    this.mostrando = 'texto';
    clearTimeout(this.relojMensaje);
    this.relojMensaje = setTimeout(() => {
      if (this.texto !== texto) return;
      this.texto = TEXTO_REPOSO;
      this._pintar();
    }, ms);
    this.relojMensaje.unref?.();
  }

  // ¿Hay una persona en el centro de la mirada? Antes de mandarle una foto al LLM.
  _hayPersonaEnElCentro() {
    const visto = this.veo ?? this.creo, general = this.ultimoGeneral;
    return visto?.nombre === CLASE_PERSONA
        || (general?.nombre === CLASE_PERSONA && general.confianza >= SOSPECHA_DE_PERSONA)
        || (this.hay?.nombre === CLASE_PERSONA && this.hay.alCentro === true);
  }

  // Le pide a las gafas una foto grande ({t:"foto"}). null si no llega a tiempo.
  _pedirFoto() {
    return new Promise((resolver) => {
      const plazo = setTimeout(() => { this.esperandoFoto = null; resolver(null); }, this.msEsperaFoto);
      this.esperandoFoto = (foto) => { clearTimeout(plazo); this.esperandoFoto = null; resolver(foto); };
      this.enviarJson({ t: 'foto' });
    });
  }

  // Leer el texto del recuadro con el LLM. `enVozAlta`: si lo pidió un botón, las
  // gafas lo dicen con su voz; si lo pidió el LLM, lo dice él.
  async _leer({ traducirA = '', enVozAlta = false } = {}) {
    if (!this.leer) return { ok: false, motivo: 'Para leer hace falta la clave del LLM' };
    if (!this.ultimoCuadro) return { ok: false, motivo: 'No hay imagen: prendé la cámara' };
    if (this._hayPersonaEnElCentro()) return { ok: false, motivo: 'Hay una persona en el recuadro: apuntá sólo al texto' };
    if (this.leyendo) return { ok: false, motivo: 'Ya estoy leyendo' };
    this.leyendo = true;
    this.texto = TEXTO_LEYENDO;
    this.mostrando = 'texto';
    this._pintar();
    try {
      const foto = (await this._pedirFoto()) ?? this.ultimoCuadro;
      if (this.cerrada) return { ok: false };
      const destino = String(traducirA ?? '').trim().slice(0, 20);
      const r = await this.leer(foto, { traducirA: destino });
      if (this.cerrada) return { ok: false };
      if (!r) return { ok: false, motivo: 'No veo texto que se pueda leer' };
      if (r.tipo === DOCUMENTO_PERSONAL) return { ok: false, motivo: 'Es un documento personal: no lo leo' };
      const dicho = r.traduccion || r.texto;
      this.pasos = { titulo: r.traduccion ? `Texto (${destino})` : 'Texto', lista: paginar(dicho), i: 0 };
      this.mostrando = 'pasos';
      if (enVozAlta) this.enviarJson({ t: 'decir', texto: dicho });
      return { ok: true, ...r, nota: 'Ya está en pantalla.' };
    } catch (e) {
      return { ok: false, motivo: `No pude leer: ${String(e.message).slice(0, 80)}` };
    } finally {
      this.leyendo = false;
      if (this.texto === TEXTO_LEYENDO) this.texto = TEXTO_REPOSO;
      this._pintar();
    }
  }

  _distanciaVigente() {
    const d = this.distanciaSensor;
    return d && this.reloj() - d.cuando <= MS_DISTANCIA_VALIDA ? d.mm : null;
  }

  // Tamaño (y, si se dice el material, peso estimado) del objeto del centro.
  _medirObjeto({ material, forma = 'caja', fondo_cm } = {}) {
    const t = this.tamano;
    if (!t) return { ok: false, motivo: !this.detector ? 'Para medir hace falta el detector'
                                       : !this._distanciaVigente() ? 'Falta el sensor de distancia'
                                       : 'Poné el objeto en el centro de la mirada' };
    const decima = (v) => Math.round(v * 10) / 10;
    const r = { ok: true, objeto: t.objeto, ancho_cm: decima(t.anchoCm), alto_cm: decima(t.altoCm),
                distancia_cm: Math.round(t.distanciaMm / 10), metodo: 'laser', nota: 'Aproximado: ±10 % o más' };
    let frase = `${t.objeto}: ${renglonDeTamano(t).replace('Mide ', '')}`;
    if (material) {
      const fondo = Number(fondo_cm);
      try {
        if (forma === 'caja' && !(fondo > 0)) throw new Error('para el peso de una caja falta la profundidad (fondo_cm)');
        const dims = forma === 'caja' ? { anchoMm: t.anchoCm * 10, altoMm: t.altoCm * 10, fondoMm: fondo * 10 }
                   : forma === 'cilindro' ? { diametroMm: t.anchoCm * 10, altoMm: t.altoCm * 10 }
                   : { diametroMm: (t.anchoCm + t.altoCm) * 5 };
        r.peso_estimado_g = Math.round(pesoEstimadoG({ material: String(material).toLowerCase(), forma, ...dims }));
        r.nota = 'El peso es una estimación: volumen × densidad, como si fuera macizo';
        frase += `, ≈ ${r.peso_estimado_g} g`;
      } catch (e) { r.motivo_peso = e.message; }
    }
    this._mostrarUnRato(frase);
    return r;
  }

  // Un vehículo por llegar: pantalla, pitido o vibración. Le gana a todo.
  _alertar(a) {
    this.alerta = { hasta: this.reloj() + MS_ALERTA, lineas: renglonesDeAlerta(a) };
    this.enviarJson({ t: 'alerta', tipo: 'vehiculo', objeto: a.objeto, llegada_s: Number(a.llegadaS.toFixed(1)) });
  }

  // Prueba real: el usuario dice si lo que muestra la pantalla es lo que tiene delante.
  _evaluar(msg) {
    if (!this.anotarEvaluacion) return { ok: false, motivo: 'No hay dónde anotar la prueba' };
    const objeto = this.veo ?? this.creo, acierto = Boolean(msg.acierto);
    const real = nombreDeClase(msg.real) || (acierto ? objeto?.nombre ?? CLASE_NADA : null);
    if (!acierto && !real) return { ok: false, motivo: 'Escribí qué era, así la prueba sirve' };
    const fila = {
      cuando: new Date(this.reloj()).toISOString(),
      mostrado: objeto?.nombre ?? null,
      confianza: objeto ? Number(objeto.confianza.toFixed(3)) : null,
      origen: objeto ? (this.veo ? 'ensenado' : 'general') : null,
      acierto, real,
    };
    this.anotarEvaluacion(fila);
    this._mostrarUnRato(acierto ? 'Anotado: acertó' : `Anotado: era ${real}`, 2500);
    return { ok: true, fila };
  }

  cerrar() {
    this.cerrada = true;
    clearTimeout(this.relojEnsenar);
    clearTimeout(this.relojMensaje);
    this.esperandoFoto?.(null);
    this.cuadros.length = 0;
    this.voz?.cerrar();
    this.voz = null;
  }

  _estado(voz, detalle) {
    this.vozEstado = voz;
    this.enviarJson({ t: 'estado', voz, modo: this.modoVoz, detalle: detalle ? String(detalle).slice(0, 200) : undefined });
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
    // Un QR que dice LUGAR:cocina no es una tarjeta: es el cartel del lugar (memoria.js).
    const qr = leerQr(img);
    const lugar = lugarDeQr(qr);
    if (lugar && this.memoria) {
      const antes = this.memoria.lugarActual();
      this.memoria.marcarLugar(lugar);
      if (antes !== lugar) this._mostrarUnRato(`Lugar: ${lugar}`, 3000);
    }
    if (qr && !lugar) {
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
        this.permanenciaVeo.reiniciar();
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
    this.veo = this.permanenciaVeo.actualizar(this._mayoria(this.votos));

    // La red general (base pública) opina aparte, y sólo cuando está segura. El
    // vector del extractor personal ya está calculado arriba: no se saca dos veces.
    if (this.conjunto) {
      const general = await this.conjunto.predecir(img, region, { [this.extractorPersonal.fuente]: vector });
      if (this.cerrada) return;
      this.ultimoGeneral = general;
      this.votosGeneral.push(general && general.confianza >= CONFIANZA_GENERAL ? general : null);
      if (this.votosGeneral.length > VOTOS) this.votosGeneral.shift();
      this.creoClasificador = this._mayoria(this.votosGeneral);
    }

    // El detector mira el cuadro ENTERO y dice dónde está cada cosa. De todas se
    // queda con UNA, la que está en la mirada (principalDe), y si es algo con alto
    // conocido, la mide. El resto del entorno no llega a la pantalla.
    let detecciones = null;
    if (this.detector) {
      detecciones = await this.detector.detectar(img);
      if (this.cerrada) return;
      // Lo que el detector marcó sin estar seguro no se tira: si está en la mirada,
      // el recorte se le muestra a las redes propias y deciden ellas.
      const confirmadas = this.conjunto ? await confirmar(detecciones, img, this.conjunto, { confianzaRedes: CONFIANZA_GENERAL }) : [];
      if (this.cerrada) return;
      const principal = principalDe([...detecciones, ...confirmadas], img.width, img.height);
      this.votosDetector.push(principal);
      if (this.votosDetector.length > VOTOS) this.votosDetector.shift();
      const estable = this._mayoria(this.votosDetector);
      const esElMismo = estable && principal?.nombre === estable.nombre;
      const caja = esElMismo ? principal.caja : this.hay?.caja;
      // ¿Contiene el centro de la mirada? Si no, está en el borde del círculo o en la mano.
      const alCentro = Boolean(caja) && img.width / 2 >= caja.x0 && img.width / 2 <= caja.x0 + caja.ancho &&
                       img.height / 2 >= caja.y0 && img.height / 2 <= caja.y0 + caja.alto;
      this.hay = estable ? { ...estable, caja, alCentro } : null;
      if (!estable) { this.medida = null; this.seguimiento.reiniciar(); }
      else if (esElMismo) this.medida = this.seguimiento.agregar(principal, img.width, img.height, this.reloj());
      if (esElMismo) this.color = colorDominante(img, cajaEntera(principal.caja, img)) ?? this.color;
      this._anotarMedida();

      // Los vehículos se vigilan en TODO el cuadro, no sólo en la mirada (alertas.js).
      const alerta = this.vigia.agregar(detecciones, img.width, img.height, this.reloj());
      if (alerta) this._alertar(alerta);

      // Con el sensor láser, el tamaño del objeto del centro de la mirada.
      const mm = this._distanciaVigente();
      this.tamano = mm && this.hay?.caja && this.hay.alCentro && this.hay.nombre !== CLASE_PERSONA
        ? { objeto: this.hay.nombre, distanciaMm: mm, ...tamanoDeCajaCm(this.hay.caja, mm, focalDesdeFovDiagonal(img.width, img.height, this.fov)) }
        : null;
    }

    // Qué se muestra como «creo:». Hay dos opiniones: el detector, sobre el objeto que
    // eligió, y las redes, sobre el recuadro del centro. En orden:
    //   1 · Lo que el detector encontró EN EL CENTRO de la mirada.
    //   2 · Lo que las redes dicen del recuadro del centro, si no es «persona».
    //   3 · Lo que el detector encontró en el borde de la mirada (el celular en la mano).
    //   4 · «Persona», que va última: casi siempre interesa lo que tiene en la mano.
    // El paso 2 antes que el 3 salió de una foto real (2-oct-2026): el detector marcó
    // una mano como «banana», al costado, mientras las redes decían «celular 93 %» de
    // lo que estaba en el centro, y tenían razón.
    const det = this.hay, cla = this.creoClasificador;
    const objeto = (x) => x && x.nombre !== CLASE_PERSONA;
    this.creo = this.permanenciaCreo.actualizar(
      (objeto(det) && det.alCentro) ? det
      : objeto(cla) ? cla
      : objeto(det) ? det
      : det ?? cla ?? null);
    if (detecciones) this._mandarCajas(detecciones, img);

    // «¿Dónde dejé…?»: lo que la pantalla nombra, y lo que el detector ve seguro en el
    // resto del cuadro. La memoria misma no deja entrar a «persona».
    if (this.memoria) {
      const visto = this.veo ?? this.creo;
      if (visto) this.memoria.vi(visto.nombre, visto.confianza);
      for (const d of detecciones ?? []) if (d.confianza >= CONFIANZA_MEMORIA) this.memoria.vi(d.nombre, d.confianza);
    }
    this._pintar();
  }

  // Al registro, una medición por segundo como mucho.
  _anotarMedida() {
    const m = this.medida, ahora = this.reloj();
    if (!m || !this.hay || ahora - this.ultimaMedicionAnotada < MS_ENTRE_MEDICIONES) return;
    this.ultimaMedicionAnotada = ahora;
    this.registro?.medicion?.({ objeto: this.hay.nombre, distanciaM: m.distanciaM, velocidadKmh: m.velocidadKmh, llegadaS: m.llegadaS });
  }

  // El recuadro, para que el emulador lo dibuje sobre la imagen. Unas gafas con un
  // OLED de 128×64 no pueden dibujarlo sobre el mundo: lo ignoran.
  //   mirado → EL recuadro: el del objeto que la pantalla está nombrando, o null. Uno
  //            solo, y sin el temblor del detector (promedio con el cuadro anterior,
  //            de a 4 px). Si la pantalla nombra una cosa y el detector sigue otra,
  //            no se dibuja ninguno: dos mensajes distintos a la vez es peor que uno.
  //   lista  → todo lo que marcó el detector en este cuadro, crudo. Sólo para probar:
  //            el emulador no lo dibuja si no se le pide.
  _mandarCajas(detecciones, img) {
    const tema = this.veo ?? this.creo, hay = this.hay;
    let mirado = null;
    if (hay?.caja && tema?.nombre === hay.nombre) {
      const antes = this.cajaSuave?.nombre === hay.nombre ? this.cajaSuave : null;
      const suave = (k) => Math.round((antes ? (antes[k] + hay.caja[k]) / 2 : hay.caja[k]) / PASO_CAJA_PX) * PASO_CAJA_PX;
      this.cajaSuave = { nombre: hay.nombre, x0: suave('x0'), y0: suave('y0'), ancho: suave('ancho'), alto: suave('alto') };
      mirado = { ...this.cajaSuave, confianza: Math.round(tema.confianza * 100),
                 metros: this.medida ? metrosRedondos(this.medida.distanciaM) : undefined };
    } else {
      this.cajaSuave = null;
    }
    const msg = {
      t: 'cajas', ancho: img.width, alto: img.height,
      radio: Math.round(RADIO_DE_MIRADA * Math.min(img.width, img.height)),
      mirado,
      lista: detecciones.slice(0, 12).map(d => ({
        nombre: d.nombre, confianza: Math.round(d.confianza * 100),
        x0: Math.round(d.caja.x0), y0: Math.round(d.caja.y0), ancho: Math.round(d.caja.ancho), alto: Math.round(d.caja.alto),
      })),
    };
    const firma = JSON.stringify(msg);
    if (firma === this.ultimasCajas) return;
    this.ultimasCajas = firma;
    this.enviarJson(msg);
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
    if (this.alerta && this.reloj() >= this.alerta.hasta) this.alerta = null;
    if (this.alerta) {
      titulo = '¡CUIDADO!';
      lineas = this.alerta.lineas;
    } else if (this.aprendiendo) {
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
      // Si el objeto es el que sigue el detector y se pudo medir, la medida va primero.
      const medida = this.hay && objeto.nombre === this.hay.nombre ? renglonesDeMedida(this.medida) : [];
      const tamano = this.tamano?.objeto === objeto.nombre ? [renglonDeTamano(this.tamano)] : [];
      lineas = i === 0
        ? [...tamano, ...medida, ...paginas[0].lineas, this.color ? `Color: ${this.color}` : ''].filter(Boolean).slice(0, 3)
        : paginas[i].lineas;
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

