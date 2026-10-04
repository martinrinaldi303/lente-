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
import { RADIO_DE_MIRADA, Seguimiento, cajaEntera, confirmar, metrosRedondos, principalDe, renglonesDeMedida, tocaLaMirada } from './seguimiento.js';
import { BIN_AUDIO_BAJA, BIN_AUDIO_SUBE, BIN_FOTO, BIN_JPEG, desempaquetar, empaquetar } from './protocolo.js';
import { Vigia, renglonesDeAlerta } from './alertas.js';
import { describirEscena, escenaParaLlm, metrosLegibles, paginasDeEscena } from './escena.js';
import { LADO_MINIMO_CARA, Reconocedor } from './caras.js';
import { CLASES_DEL_DETECTOR, detectarConZoom } from './detector.js';
import { esCorregido, filtrarCorregidos, iou } from './correcciones.js';
import { UMBRAL_DETECTOR } from './parecido.js';
import { EXTRACTORES } from './extractores.js';
import { fichaDe, paginasDe, paginasSueltas, resumenDeFicha } from './fichas.js';
import { NIVELES, esEspecieDe, renglonDePeligro } from './fichas_animales.js';
import { buscarGuia, resumenDeGuias } from './guias.js';
import { colorDominante, regionCentral } from './imagen.js';
import { DOCUMENTO_PERSONAL, paginar } from './leer.js';
import { focalDesdeFovDiagonal, pesoEstimadoG, renglonDeTamano, tamanoDeCajaCm } from './medir.js';
import { lugarDeQr } from './memoria.js';
import { recorteJpeg } from './muestras.js';
import { FUENTE as FUENTE_V0 } from './rasgos.js';
import { CLASE_NADA, nombreDeClase } from './red_objetos.js';

const TOPE_CUADROS       = 2;     // sólo importa el cuadro más nuevo
const EJEMPLOS_POR_TANDA = 12;    // cuadros que se guardan cada vez que se enseña algo
const VOTOS              = 5;     // la etiqueta sale por mayoría de los últimos 5 cuadros
const VOTOS_MINIMOS      = 3;
const CONFIANZA_MINIMA   = 0.7;
// Con los tres votantes y el voto pesado al cubo (55 clases, 1.284 fotos de prueba):
// con 0,7 opina en el 91 % de las fotos y acierta 98 %; con 0,5, en el 96 % y acierta 97 %.
export const CONFIANZA_GENERAL  = 0.7;
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
const MS_ENTRE_AVISOS_DE_ANIMAL = 60000;   // un animal peligroso se avisa una vez por minuto
const MS_ESCENA = 12000;           // la escena («¿qué hay?») se va sola de la pantalla
const CONFIANZA_REDES_SOLAS = 0.95; // las redes sin el detector, de algo que el detector conoce (ver _redesSolasValen)
const MAX_CARAS_POR_CUADRO = 3;    // las tres más grandes: más cerca, más detalle
const CUADROS_CON_PERSONA = 3;     // al enseñar, tres cuadros con una persona en el recuadro cortan
const NO_SE_APRENDEN_PERSONAS = 'A las personas no las aprendo por su cara. Para que las gafas sepan quién es alguien, que muestre su tarjeta QR.';
const MS_DISTANCIA_VALIDA = 1500;  // una lectura del sensor láser vale esto; después se da por vieja
const MS_ESPERA_FOTO     = 2500;   // si las gafas no mandan la foto grande, se lee el último cuadro
const CONFIANZA_MEMORIA  = 0.9;    // lo que el detector marca en el resto del cuadro se recuerda si está así de seguro
const CUADROS_ENTRE_VERIFICACIONES = 8;       // el mismo recuadro se vuelve a comparar cada tantos cuadros
const NO_LO_CONOZCO = ['No lo conozco', 'Preguntame «¿qué es?»', 'o enseñámelo'];
const CONFIANZA_PARA_CORREGIR = 0.6;  // «ninguna es una persona»: los recuadros que se corrigen de una vez
const MAX_CORRECCIONES_DE_UNA = 8;
// CLIP (src/clip.js), medido con herramientas/medir_clip.js (ver PLAN.md, «Decimoquinta pasada»):
//   · veta lo que dice la red si su primer nombre es OTRO con probabilidad ≥ CLIP_VETO_OTRO
//     y al de la red le da menos de CLIP_VETO_RED;
//   · nombra lo que nadie conoce («Parece: lata de aerosol») con ≥ CLIP_NOMBRAR;
//   · nunca si en la mirada hay una persona, ni si CLIP mismo ve una (≥ CLIP_SOSPECHA_PERSONA).
export const CLIP_VETO_OTRO = 0.5;
export const CLIP_VETO_RED = 0.05;
export const CLIP_NOMBRAR = 0.5;
export const CLIP_SOSPECHA_PERSONA = 0.1;
// Lo que no se puede sumar como nombre: CLIP sabe asociar nombres propios con caras
// (gente famosa), y eso sería reconocer personas por la cara. Ver identificar.js.
const NOMBRES_DE_GENTE = /(?<!\p{L})(person|people|man|men|woman|women|boy|girl|kid|child|baby|face|guy|lady|persona|personas|gente|hombre|mujer|chic[oa]s?|nen[ea]s?|beb[eé]|cara|señor[a]?|se[ñn]ora?|amig[oa]s?|novi[oa]|herman[oa]|pap[aá]|mam[aá]|hij[oa])(?!\p{L})/iu;

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
    name: 'identificar',
    description: 'Averigua qué es lo que está en el recuadro, mirando la foto: un APARATO (marca, modelo, características y partes), una PIEZA de computadora o celular (función, diseño y características) o un ANIMAL de cualquier especie (características, nivel de peligro y qué hacer). Lo deja en pantalla. Tarda unos segundos. Nunca personas: si en el recuadro hay una persona, se niega.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'no_es',
    description: 'El usuario dice que algo que marcaron las gafas NO es lo que dicen («eso no es una persona», es ropa colgada). Guarda la corrección para no volver a marcarlo. `nombre` es lo que dijeron las gafas. Con `todas` en true («ninguna de esas es una persona», «la ropa no es gente»), corrige todos los recuadros de esa clase que no tienen una cara y no están en el centro de la mirada.',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' }, todas: { type: 'BOOLEAN' } }, required: ['nombre'] },
  },
  {
    name: 'que_hay',
    description: 'Devuelve TODAS las cosas que el detector ve seguras en la imagen (no sólo la del centro): de qué lado están, a qué distancia aproximada, qué tiene cada persona («persona tiene celular»), la distancia entre las cosas, y qué es cada una. Lo deja en pantalla. Para «¿qué hay?», «¿qué tiene en la mano?», «¿qué tan lejos está la taza de la botella?».',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'mostrar_ficha',
    description: 'Muestra en pantalla la ficha guardada de un animal (nivel de peligro, qué hacer, cómo es), de una pieza de computadora o celular (función, diseño, características) o de un aparato, y la devuelve para contarla. No mira la cámara: es para preguntas como «¿para qué sirve la memoria RAM?» o «¿es peligroso un alacrán?».',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' } }, required: ['nombre'] },
  },
  {
    name: 'sumar_nombre',
    description: 'Le enseña a las gafas el NOMBRE de una cosa sin mostrarla («sabé que existen los marcadores»): desde ahí, si ven algo que no conocen y se parece a eso, dicen «Parece: marcador». `nombre` en castellano y `en_ingles` su traducción (el reconocedor sólo entiende inglés). Nunca nombres de personas ni nada sobre gente: se niega.',
    parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING' }, en_ingles: { type: 'STRING' } }, required: ['nombre', 'en_ingles'] },
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
    description: 'Mide el ancho y el alto del objeto del centro de la mirada con el sensor de distancia. Para el tamaño se llama SIN argumentos; material, forma y fondo_cm sólo hacen falta si pide el peso.',
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
                memoria = null, guias = [], leer = null, anotarEvaluacion = null, msEsperaFoto = MS_ESPERA_FOTO,
                caras = null, conocidos = [], zoom = false,
                correcciones = new Map(), positivos = new Map(), guardarCorreccion = null, olvidarCorrecciones = null,
                ejemplos = null, guardarMuestra = null, clip = null, vocabulario = null, guardarNombres = null,
                negativos = new Map() }) {
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
    // Adónde va el recorte de cada prueba y de cada corrección, para entrenar y medir con
    // fotos de esta cámara (src/muestras.js). null: no se guarda ninguna foto.
    this.guardarMuestra = guardarMuestra;
    // Lo que el usuario dijo que NO era («se equivocó: era una lata», de lo que se mostró
    // como «celular»): clase → vectores. Vale desde ese momento, sin reentrenar nada.
    this.negativos   = negativos;
    this.msEsperaFoto = msEsperaFoto;
    this.zoom        = zoom;               // mirar dos veces: el cuadro y el centro (ver detector.js)
    // Lo que el usuario le corrigió al detector (src/correcciones.js): clase → vectores.
    this.correcciones = correcciones;
    this.positivos   = positivos;           // los ejemplos de verdad de cada clase, para comparar
    this.guardarCorreccion = guardarCorreccion;
    this.olvidarCorrecciones = olvidarCorrecciones;
    this.tiradas     = [];                  // lo que se descartó en este cuadro por una corrección
    this.pistasCorreccion = [];             // dónde se corrigió algo en esta sesión (fracción del cuadro)
    this.ultimasDetecciones = null;         // lo que marcó el detector en el último cuadro, sin filtrar
    this.imgDetecciones = null;             // ese cuadro, ya decodificado: para corregir uno de sus recuadros
    this.imgActual   = null;                // el último cuadro, ya decodificado
    // Para decir «no sé qué es» (src/parecido.js). Compara vectores del extractor
    // personal: si es otro, no sirve.
    this.ejemplos    = ejemplos?.fuente === extractorPersonal.fuente && ejemplos?.dim === extractorPersonal.dim ? ejemplos : null;
    this.votosNoSe   = [];                  // ¿había algo desconocido en la mirada? (últimos cuadros)
    // CLIP (src/clip.js): compara lo que se ve con nombres escritos. Opcional.
    this.clip        = clip && vocabulario ? clip : null;
    this.vocabulario = this.clip ? vocabulario : null;
    this.guardarNombres = guardarNombres;  // adónde van los nombres que suma el usuario
    this.clipCache   = null;                // { clave, caja, cuadros, ranking }: una pasada cada tantos cuadros
    this.noSe        = null;                // { caja } si lo hay, de forma estable
    this.verificado  = null;                // el último recuadro del detector comparado con sus ejemplos
    // Personas conocidas (src/caras.js): sólo las que le dieron permiso a esta cuenta.
    this.caras       = caras;
    this.reconocedor = new Reconocedor();
    this.reconocedor.ponerConocidos(conocidos);
    this.quienes     = [];                 // [{ id, nombre, caja }] de este cuadro
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
    this.avisados   = new Map();  // animal peligroso → cuándo se avisó por última vez
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
      case 'corregir':
        // Sin el catch, un error del detector de caras o de DINOv2 acá era una promesa
        // rechazada sin dueño, y eso tumba el cerebro entero, no sólo esta conexión.
        (msg.todas ? this._corregirTodas(String(msg.nombre ?? '')) : this._corregir(String(msg.nombre ?? ''), msg.caja ?? null))
          .catch(e => ({ ok: false, motivo: `No pude corregir: ${String(e.message).slice(0, 80)}` }))
          .then(r => this._avisar(r.ok ? r.frase : r.motivo));
        return { ok: true, pendiente: true };
      case 'olvidar_correcciones': {
        const n = [...this.correcciones.values()].reduce((s, l) => s + l.length, 0);
        this.correcciones = new Map();
        this.pistasCorreccion = [];
        this.olvidarCorrecciones?.();
        // Lo pide un botón: sin el aviso, no se enteraba nadie de que se hizo.
        const frase = `Olvidé ${n} ${n === 1 ? 'corrección' : 'correcciones'}`;
        this._avisar(frase);
        return { ok: true, frase };
      }
      case 'escena': {
        const r = this.ejecutar('que_hay');
        if (r.ok && r.frase) this.enviarJson({ t: 'decir', texto: r.frase });
        return r;
      }
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
      case 'nombre':
        this._sumarNombre({ nombre: msg.nombre, en_ingles: msg.en })
          .catch(e => ({ ok: false, motivo: `No pude sumarlo: ${String(e.message).slice(0, 80)}` }))
          .then(r => this._avisar(r.ok ? `Sumé «${r.nombre}»` : r.motivo));
        return { ok: true, pendiente: true };
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
  // (identificar consulta al LLM).
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

  // Qué es lo del recuadro, con el LLM: un aparato (marca, modelo, características y
  // partes), una pieza (función y diseño) o un animal (especie, peligro y qué hacer).
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
      return { ok: false, motivo: 'Hay una persona en el recuadro: identifico aparatos, piezas y animales, nunca personas' };
    if (this.identificando) return { ok: false, motivo: 'Ya estoy mirando eso' };

    this.identificando = true;
    this.texto = TEXTO_MIRANDO;
    this.mostrando = 'texto';
    this._pintar();
    try {
      const f = await this.identificar(this.ultimoCuadro, aparato?.nombre ?? visto?.nombre ?? '', aparato?.caja);
      if (this.cerrada) return { ok: false };
      if (!f) return { ok: false, motivo: 'No veo ningún aparato, pieza ni animal en el recuadro' };
      const deATres = (lista) => { const out = []; for (let k = 0; k < lista.length; k += 3) out.push(lista.slice(k, k + 3)); return out; };
      const seccion = (titulo, lista = []) => deATres(lista.length ? [`${titulo}:`, ...lista] : []);
      this.registro?.identificacion(f);
      // Un animal: el peligro y lo primero que hay que hacer, en la primera página.
      const primera = f.categoria === 'animal'
        ? [renglonDePeligro(f.peligro), f.que_hacer[0], `Seguridad: ${f.seguridad}`]
        : [[f.marca, f.modelo].filter(Boolean).join(' ') || f.tipo, `Seguridad: ${f.seguridad}`, f.por_que];
      this.pasos = {
        titulo: f.tipo,
        lista: [
          primera,
          ...(f.categoria === 'animal' ? seccion('Qué hacer', f.que_hacer.slice(1)) : []),
          ...(f.categoria === 'pieza' ? [...seccion('Función', f.funcion), ...seccion('Diseño', f.diseno)] : []),
          ...(f.categoria === 'aparato' ? deATres(f.caracteristicas) : seccion(f.categoria === 'animal' ? 'Cómo es' : 'Características', f.caracteristicas)),
          ...seccion('Partes', f.partes),
        ].map(p => p.filter(Boolean)).filter(p => p.length),
        i: 0,
      };
      this.mostrando = 'pasos';
      if (f.categoria === 'animal' && NIVELES.indexOf(f.peligro) >= 2)
        this.enviarJson({ t: 'alerta', tipo: 'animal', objeto: f.tipo, peligro: f.peligro });
      return { ok: true, ...f, nota: f.categoria === 'animal'
        ? 'Ya está en pantalla. Decí primero el peligro y qué hacer; si la seguridad es baja, decilo.'
        : 'Ya está en pantalla. Si la seguridad es baja, decilo.' };
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
        // Con la ficha: datos y partes de un aparato; peligro, qué hacer y cómo es de un
        // animal; función, diseño y características de una pieza.
        const extra = (nombre) => ({ color: this._colorDe(nombre) ?? undefined, ...resumenDeFicha(nombre),
                                     tamano: this.tamano?.objeto === nombre ? renglonDeTamano(this.tamano) : undefined });
        if (this.veo) return { objeto: this.veo.nombre, confianza: Number(this.veo.confianza.toFixed(2)),
                               fuente: 'enseñado por el usuario', ...extra(this.veo.nombre) };
        if (this.noSe) return { objeto: null, desconocido: true, parece: this.noSe.parece?.es,
                                nota: this.noSe.parece
                                  ? `La red no lo conoce; otro modelo, sin entrenar, cree que parece «${this.noSe.parece.es}». Decilo como posibilidad y ofrecé identificar para estar seguros.`
                                  : 'Hay algo en el centro de la mirada que no se parece a nada de lo que la red conoce. No adivines qué es: ' +
                                    'ofrecé usar identificar (le pregunta al modelo con una foto), o que el usuario se lo enseñe.' };
        const quien = this.creo?.nombre === CLASE_PERSONA && this.hay?.nombre === CLASE_PERSONA ? this._quienEn(this.hay.caja) : null;
        if (quien) return { objeto: CLASE_PERSONA, quien, nota: 'Es alguien que le dio permiso a esta cuenta para que las gafas lo reconozcan: podés decir su nombre.' };
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
        if (clase === CLASE_PERSONA || (this.hay?.nombre === CLASE_PERSONA && this.hay.alCentro && this.ultimoGeneral?.nombre === CLASE_PERSONA))
          return { ok: false, motivo: NO_SE_APRENDEN_PERSONAS };
        this.aprendiendo = { nombre: clase, faltan: EJEMPLOS_POR_TANDA, conPersona: 0 };
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

      case 'identificar':
        return this._identificar();

      case 'no_es':
        return args.todas ? this._corregirTodas(String(args.nombre ?? '')) : this._corregir(String(args.nombre ?? ''));

      case 'que_hay': {
        if (!this.detector) return { ok: false, motivo: 'Para ver varias cosas a la vez hace falta el detector' };
        if (!this.escena) return { ok: false, motivo: 'No hay imagen: prendé la cámara' };
        this.pasos = { titulo: 'Escena', lista: paginasDeEscena(this.escena), i: 0 };
        // Es una foto de ese momento: a los 12 s se va sola (si no, quedaba vieja en pantalla).
        clearTimeout(this.relojEscena);
        this.relojEscena = setTimeout(() => {
          if (this.pasos?.titulo !== 'Escena' || this.cerrada) return;
          this.pasos = null; this.mostrando = 'texto'; this._pintar();
        }, MS_ESCENA);
        this.relojEscena.unref?.();
        this.mostrando = 'pasos';
        const e = escenaParaLlm(this.escena);
        const frase = e.objetos.length
          ? `Veo ${e.objetos.map(o => o.nombre + (o.metros_aprox !== null ? ` a unos ${metrosLegibles(o.metros_aprox)} metros` : '')).join(', ')}.` +
            e.relaciones.filter(t => / tiene /.test(t)).map(t => ` ${t[0].toUpperCase()}${t.slice(1)}.`).join('')
          : 'No veo nada seguro.';
        return { ok: true, ...e, frase: frase.trim(), nota: 'Ya está en pantalla.' };
      }

      case 'mostrar_ficha': {
        const nombre = String(args.nombre ?? '').trim().slice(0, 40);
        const ficha = nombre ? fichaDe(nombre) : null;
        if (!ficha) return { ok: false, motivo: `No tengo ficha de «${nombre}». Si es un animal, contalo con prudencia.` };
        this.pasos = { titulo: ficha.clave, lista: paginasSueltas(ficha.clave), i: 0 };
        this.mostrando = 'pasos';
        return { ok: true, nombre: ficha.clave, ...resumenDeFicha(ficha.clave), nota: 'Ya está en pantalla.' };
      }

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

      case 'sumar_nombre':
        return this._sumarNombre(args);

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

  // Lo que las redes propias dicen del recuadro del centro, si vale. Con detector, de
  // un OBJETO que el detector también conoce (notebook, pantalla, auto…) y que él no
  // ve en la mirada, sólo si están muy seguras. Medido en 1.500 fotos de COCO
  // (3-oct-2026): con el detector de acuerdo, cierto 406 de 407; sin él, 37 de 100, y
  // con ≥ 0,95, 24 de 40. Un notebook sin el detector: 0 de 5 (la caja negra del Ryzen
  // de Martín salía «notebook» con 85 % a 93 %). Los animales sin el detector aciertan
  // 36 de 40, y lo que el detector no conoce (una pinza) sólo lo pueden decir ellas.
  _redesSolasValen(cla, detecciones, img) {
    if (!cla || !this.detector || !CLASES_DEL_DETECTOR.includes(cla.nombre) || fichaDe(cla.nombre)?.tipo === 'animal') return cla;
    const loVe = (detecciones ?? []).some(d => d.nombre === cla.nombre && d.confianza >= 0.9 && tocaLaMirada(d.caja, img.width, img.height));
    return loVe || cla.confianza >= CONFIANZA_REDES_SOLAS - 1e-9 ? cla : null;     // el promedio de 0,95 da 0,9499…
  }

  // ¿El recuadro que el detector nombra en la mirada NO se parece a los ejemplos de esa
  // clase? Cuesta una pasada de DINOv2, así que se recuerda la respuesta mientras sea
  // el mismo recuadro (misma clase, casi el mismo lugar) por unos cuadros.
  async _noSeParece(d, img) {
    if (d.nombre === CLASE_PERSONA || !((this.ejemplos?.tiene(d.nombre)) || this.negativos.has(d.nombre))) return false;
    const v = this.verificado;
    if (v && v.nombre === d.nombre && v.cuadros < CUADROS_ENTRE_VERIFICACIONES && iou(v.caja, d.caja) >= 0.6) {
      v.cuadros++;
      return v.noSe;
    }
    const vector = await this.extractorPersonal.extraer(img, cajaEntera(d.caja, img));
    const noSe = (this.ejemplos ? !this.ejemplos.conoce(vector, d.nombre, UMBRAL_DETECTOR) : false) || this._esNegativo(vector, d.nombre);
    this.verificado = { nombre: d.nombre, caja: d.caja, cuadros: 0, noSe };
    return noSe;
  }

  // Lo que dice CLIP de una región: el ranking de nombres. Cuesta ~50 ms, así que se
  // recuerda mientras sea lo mismo (misma clave, casi el mismo lugar) por unos cuadros.
  async _clipDe(img, region, clave) {
    if (!this.clip) return null;
    const c = this.clipCache;
    if (c && c.clave === clave && c.cuadros < CUADROS_ENTRE_VERIFICACIONES && iou(c.caja, region) >= 0.6) { c.cuadros++; return c.ranking; }
    const ranking = this.vocabulario.ranking(await this.clip.imagen(img, region), 500);
    this.clipCache = { clave, caja: region, cuadros: 0, ranking };
    return ranking;
  }

  // ¿Se parece mucho a algo que el usuario dijo que NO era `clase`, y más que a los
  // ejemplos de verdad de esa clase? La misma cuenta que las correcciones al detector.
  _esNegativo(vector, clase) {
    const negs = this.negativos.get(clase);
    return Boolean(negs?.length) && esCorregido(vector, negs, this.positivos.get(clase));
  }

  // ¿CLIP dice con claridad que es OTRA cosa que `nombre`?
  _clipVeta(ranking, nombre) {
    const top = ranking?.[0];
    return Boolean(top) && top.es !== nombre && top.clase !== nombre && top.p >= CLIP_VETO_OTRO &&
           this.vocabulario.probabilidadDe(ranking, nombre) < CLIP_VETO_RED;
  }

  // Lo que CLIP cree que es algo que las redes no conocen, o null. Nunca una persona.
  _pareceDe(ranking) {
    const top = ranking?.[0];
    if (!top || top.p < CLIP_NOMBRAR || top.clase === CLASE_PERSONA || this.personaEnLaMirada) return null;
    if (this.vocabulario.probabilidadDe(ranking, CLASE_PERSONA) >= CLIP_SOSPECHA_PERSONA) return null;
    return { es: top.es, p: top.p };
  }

  // «Sabé que existen los marcadores»: un nombre nuevo para CLIP, de esta cuenta.
  async _sumarNombre({ nombre, en_ingles: en } = {}) {
    const es = String(nombre ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    const ingles = String(en ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
    if (!this.clip) return { ok: false, motivo: 'Para sumar nombres hace falta CLIP (modelos/clip-b32)' };
    if (!es || !ingles) return { ok: false, motivo: 'Falta el nombre, o su traducción al inglés' };
    if (NOMBRES_DE_GENTE.test(es) || NOMBRES_DE_GENTE.test(ingles))
      return { ok: false, motivo: 'Nombres de personas no: las gafas no reconocen a la gente por la cara. Sí cosas («marcador», «llaves»).' };
    await this.vocabulario.sumar(this.clip, { es, en: ingles, clase: null, propio: true });
    this.clipCache = null;
    this.guardarNombres?.(this.vocabulario.entradas.filter(e => e.propio).map(({ es, en }) => ({ es, en })));
    return { ok: true, nombre: es, nota: 'Listo. Si ve algo que no conoce y se parece, va a decir «Parece: ' + es + '». No es tan seguro como enseñárselo con la cámara.' };
  }

  // «Esto no es una persona»: guarda cómo se ve ese recuadro, para no volver a marcarlo
  // (src/correcciones.js). Con `caja` (tocaron un recuadro en el panel), ése. Sin caja
  // (por voz), el de esa clase más cercano al centro que NO tenga una cara: «eso no es
  // una persona» nunca se lleva puesta a una persona de verdad.
  async _corregir(nombre, caja = null) {
    const clase = nombreDeClase(nombre).replace(/^(una?|el|la|los|las) /, '');
    const falta = this._faltaParaCorregir(clase);
    if (falta) return { ok: false, motivo: falta };
    const img = this.imgDetecciones;
    // Un recuadro tocado que llega roto no se cambia por otro: se corregiría algo que
    // nadie señaló (y podría ser una persona de verdad).
    const valida = caja && ['x0', 'y0', 'ancho', 'alto'].every(k => Number.isFinite(caja[k])) && caja.ancho > 4 && caja.alto > 4;
    if (caja && !valida) return { ok: false, motivo: 'El recuadro que tocaste no llegó bien: tocalo otra vez' };
    let c = valida ? caja : null;
    if (!c) {
      const medio = { x: img.width / 2, y: img.height / 2 };
      const lejos = (d) => Math.hypot(d.caja.x0 + d.caja.ancho / 2 - medio.x, d.caja.y0 + d.caja.alto / 2 - medio.y);
      for (const d of (this.ultimasDetecciones ?? []).filter(d => d.nombre === clase).sort((a, b) => lejos(a) - lejos(b)))
        if (!(await this._hayCaraEn(img, d.caja))) { c = d.caja; break; }
      if (!c) return { ok: false, motivo: `No veo ningún «${clase}» para corregir. En la pantalla de la PC podés tocar el recuadro.` };
    }
    if (clase === CLASE_PERSONA && await this._hayCaraEn(img, c)) return { ok: false, motivo: 'Ahí hay una cara: es una persona. Eso no lo corrijo.' };
    try { await this._guardarCorreccion(clase, c, img); }
    catch (e) { return { ok: true, frase: `Listo por ahora, pero no se pudo guardar: ${e.message}` }; }
    return { ok: true, frase: `Listo: eso no es «${clase}». No lo marco más.` };
  }

  // «Ninguna de esas es una persona»: de una vez, todos los recuadros de esa clase del
  // último cuadro que no tienen una cara adentro y no contienen el centro de la mirada
  // (ahí suele estar el que usa las gafas, o lo que se está mirando). Para la ropa del
  // placar: con un recuadro por vez no la corrigió nadie (0 correcciones, 3-oct-2026).
  async _corregirTodas(nombre) {
    const clase = nombreDeClase(nombre).replace(/^(una?|el|la|los|las) /, '');
    const falta = this._faltaParaCorregir(clase);
    if (falta) return { ok: false, motivo: falta };
    const img = this.imgDetecciones;
    const centro = { x0: img.width / 2, y0: img.height / 2, ancho: 0, alto: 0 };
    const caras = this.caras ? (await this.caras.detectar(img)).filter(c => c.confianza >= 0.9) : [];
    const elegidas = (this.ultimasDetecciones ?? [])
      .filter(d => d.nombre === clase && d.confianza >= CONFIANZA_PARA_CORREGIR && !contieneCentro(d.caja, centro) && !caras.some(c => contieneCentro(d.caja, c.caja)))
      .sort((a, b) => b.confianza - a.confianza).slice(0, MAX_CORRECCIONES_DE_UNA);
    if (!elegidas.length) return { ok: false, motivo: `No veo ningún «${clase}» sin cara y fuera del centro para corregir.` };
    try { for (const d of elegidas) await this._guardarCorreccion(clase, d.caja, img); }
    catch (e) { return { ok: true, n: elegidas.length, frase: `Listo por ahora, pero no se pudo guardar: ${e.message}` }; }
    const n = elegidas.length;
    return { ok: true, n, frase: `Listo: ${n === 1 ? 'ese recuadro no era' : `esos ${n} recuadros no eran`} «${clase}». No los marco más.` };
  }

  // Lo que impide corregir, o null. Se le corrige al DETECTOR, así que sólo valen sus
  // clases: «No lo conozco», el nombre de una persona conocida o una especie («picaflor»)
  // guardaban una corrección que nunca se iba a usar. Y la imagen tiene que ser la del
  // cuadro en que el detector vio esos recuadros: el último que llegó puede ser otro (la
  // cabeza se movió) y el recorte saldría corrido.
  _faltaParaCorregir(clase) {
    if (!clase) return 'Falta qué es lo que no es';
    if (!this.detector) return 'Para corregir hace falta el detector';
    if (!CLASES_DEL_DETECTOR.includes(clase)) return `Sólo le corrijo al detector lo que él marca, y «${clase}» no es de sus clases`;
    if (!this.imgDetecciones) return 'No hay imagen: prendé la cámara';
    return null;
  }

  async _guardarCorreccion(clase, c, img) {
    const v = await this.extractorPersonal.extraer(img, cajaEntera(c, img));
    // Dónde estaba: en esta sesión ese lugar se revisa primero (ver filtrarCorregidos).
    this.pistasCorreccion.push({ x0: c.x0 / img.width, y0: c.y0 / img.height, ancho: c.ancho / img.width, alto: c.alto / img.height });
    if (this.pistasCorreccion.length > 20) this.pistasCorreccion.shift();
    if (!this.correcciones.has(clase)) this.correcciones.set(clase, []);
    this.correcciones.get(clase).push(v);
    this._guardarMuestra({ clase, noEs: true, origen: 'correccion', caja: c, img });
    await this.guardarCorreccion?.(clase, this.extractorPersonal.fuente, v);
  }

  // ¿Hay una cara (cualquiera: no se mira de quién) dentro de esa caja?
  async _hayCaraEn(img, caja) {
    if (!this.caras) return false;
    return (await this.caras.detectar(img)).some(c => c.confianza >= 0.9 && contieneCentro(caja, c.caja));
  }

  // Las caras de quienes le dieron permiso a esta cuenta (src/caras.js). Sin conocidos
  // no se busca ninguna cara; sólo se miran las que caen dentro de una persona que el
  // detector ve segura. De las que no se reconocen no queda nada.
  async _reconocerCaras(img, detecciones) {
    if (!this.caras || !this.reconocedor.activo) return [];
    const personas = detecciones.filter(d => d.nombre === CLASE_PERSONA && d.confianza >= 0.9);
    if (!personas.length) return this.reconocedor.agregar([]);
    const enAlguna = (c) => personas.some(p => contieneCentro(p.caja, c.caja));
    const caras = (await this.caras.detectar(img))
      .filter(c => Math.min(c.caja.ancho, c.caja.alto) >= LADO_MINIMO_CARA && enAlguna(c))
      .sort((a, b) => b.caja.ancho * b.caja.alto - a.caja.ancho * a.caja.alto).slice(0, MAX_CARAS_POR_CUADRO);
    for (const c of caras) c.plantilla = await this.caras.plantilla(img, c);
    return this.reconocedor.agregar(caras);
  }

  // El nombre de la persona conocida cuya cara cae dentro de esa caja, o null.
  _quienEn(caja) {
    if (!caja) return null;
    return this.quienes.find(q => contieneCentro(caja, q.caja))?.nombre ?? null;
  }

  // Las gafas de esta cuenta recargan a quienes les dieron permiso (cambió en el panel).
  ponerConocidos(lista) {
    this.reconocedor.ponerConocidos(lista);
    this.quienes = [];
  }

  // ¿Lo que se está por aprender es una persona? Sólo si el detector la ve en el centro
  // (y no algo en su mano) Y las redes propias dicen «persona» del recuadro.
  async _personaEnElRecuadro(img, region) {
    if (!this.detector || !this.conjunto) return false;
    const p = principalDe(await this.detector.detectar(img), img.width, img.height);
    if (p?.nombre !== CLASE_PERSONA) return false;
    const x = img.width / 2, y = img.height / 2;
    if (x < p.caja.x0 || x > p.caja.x0 + p.caja.ancho || y < p.caja.y0 || y > p.caja.y0 + p.caja.alto) return false;
    const g = await this.conjunto.predecir(img, region);
    return g?.nombre === CLASE_PERSONA && g.confianza >= SOSPECHA_DE_PERSONA;
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

  // Un animal de peligro alto o muy alto en la mirada: tres pitidos y la pantalla de
  // cuidado con lo primero que hay que hacer. Una vez por minuto por animal, para que
  // una foto de una víbora en un libro no pite sin parar. Un vehículo que llega le
  // gana: si ya hay un aviso en pantalla, éste espera al cuadro siguiente.
  _avisarAnimal(objeto) {
    const ficha = objeto ? fichaDe(objeto.nombre) : null;
    if (ficha?.tipo !== 'animal' || NIVELES.indexOf(ficha.f.peligro) < 2) return;
    const ahora = this.reloj(), antes = this.avisados.get(ficha.clave);
    if ((antes !== undefined && ahora - antes < MS_ENTRE_AVISOS_DE_ANIMAL) || (this.alerta && ahora < this.alerta.hasta)) return;
    this.avisados.set(ficha.clave, ahora);
    this.alerta = { hasta: ahora + MS_ALERTA, lineas: [objeto.nombre, renglonDePeligro(ficha.f.peligro), ficha.f.hacer[0]] };
    this.enviarJson({ t: 'alerta', tipo: 'animal', objeto: objeto.nombre, peligro: ficha.f.peligro });
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
    // La foto de lo que estaba en la mirada, con lo que ERA: es lo que más le enseña a la
    // red general (src/muestras.js). De una persona, nunca.
    const foto = this._guardarMuestra({ clase: real, mostrado: objeto?.nombre ?? null, origen: acierto ? 'acerto' : 'se_equivoco' });
    // Lo que se mostró y no era: desde ya, eso no se nombra más así (_esNegativo).
    if (!acierto && objeto && objeto.nombre !== real && objeto.nombre !== CLASE_PERSONA && !this.personaEnLaMirada) this._sumarNegativo(objeto.nombre);
    const cola = foto ? ` · foto ${foto.prueba ? 'de prueba' : 'para entrenar'}` : '';
    this._mostrarUnRato(`${acierto ? 'Anotado: acertó' : `Anotado: era ${real}`}${cola}`, 2500);
    this._pintar();
    return { ok: true, fila, foto };
  }

  // El vector de lo que está en la mirada, como ejemplo de lo que NO es `clase`.
  _sumarNegativo(clase) {
    const delDetector = Boolean(this.hay?.caja && this.hay.alCentro && this.imgDetecciones);
    const img = delDetector ? this.imgDetecciones : this.imgActual;
    if (!img) return;
    Promise.resolve(this.extractorPersonal.extraer(img, delDetector ? cajaEntera(this.hay.caja, img) : regionCentral(img)))
      .then(v => {
        if (!this.negativos.has(clase)) this.negativos.set(clase, []);
        this.negativos.get(clase).push(v);
        this.verificado = null; this.votosGeneral = [];
      })
      .catch(e => console.warn(`[sesion] no se pudo guardar lo que no era: ${e.message}`));
  }

  // Guarda el recorte de lo que está en la mirada (o de `caja`, en el cuadro del detector).
  // Devuelve { archivo, prueba } o null. Nada con una persona, salvo una corrección de algo
  // que el usuario dice que NO es una persona (la ropa del placar).
  _guardarMuestra({ clase, mostrado = null, origen, noEs = false, caja = null, img = null }) {
    if (!this.guardarMuestra || !clase) return null;
    if (!noEs && (clase === CLASE_PERSONA || mostrado === CLASE_PERSONA || this.personaEnLaMirada)) return null;
    let foto = img, recuadro = caja, delDetector = Boolean(caja);
    if (!foto) {
      // Lo que se está mirando: el recuadro del detector si contiene el centro, si no el
      // recuadro del centro (el mismo que miran las redes).
      delDetector = Boolean(this.hay?.caja && this.hay.alCentro && this.imgDetecciones);
      foto = delDetector ? this.imgDetecciones : this.imgActual;
      recuadro = delDetector ? this.hay.caja : foto ? regionCentral(foto) : null;
    }
    if (!foto) return null;
    try { return this.guardarMuestra({ clase, mostrado, origen, noEs, jpeg: recorteJpeg(foto, recuadro, { margen: delDetector ? 0.08 : 0 }) }); }
    catch (e) { console.warn(`[sesion] no se pudo guardar la foto: ${e.message}`); return null; }
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
    this.imgActual = img;
    // Un código QR se busca en el cuadro ENTERO, no sólo en el recuadro: la persona
    // lo muestra donde puede. Si se deja de ver, la tarjeta queda unos segundos.
    // Un QR que dice LUGAR:cocina no es una tarjeta: es el cartel del lugar (memoria.js).
    // Un cuadro sí y uno no (~60 ms cada vez): la tarjeta igual queda 10 cuadros en pantalla.
    this.cuadrosVistos = (this.cuadrosVistos ?? 0) + 1;
    const qr = this.cuadrosVistos % 2 || this.tarjeta ? leerQr(img) : null;
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
      // A una persona no se la aprende con un nombre: eso sería reconocerla por la cara
      // (ver identificar.js). Si lo que hay en el recuadro es una persona, el cuadro no
      // se usa, y si siguen llegando así, se corta. Un objeto que se sostiene delante
      // de la cara sí se aprende: el detector lo ve a él, o las redes no ven una persona.
      if (await this._personaEnElRecuadro(img, region)) {
        if (this.cerrada) return;
        if (++a.conPersona >= CUADROS_CON_PERSONA) { this.aprendiendo = null; this._avisar(NO_SE_APRENDEN_PERSONAS); }
        this._pintar();
        return;
      }
      if (this.cerrada) return;
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
    this.colorCaja = null;
    let personaEnLaMirada = false, hayDesconocido = null;

    const pred = this.red.predecir(vector);
    this.votos.push(pred && pred.confianza >= CONFIANZA_MINIMA ? pred : null);
    if (this.votos.length > VOTOS) this.votos.shift();
    this.veo = this.permanenciaVeo.actualizar(this._mayoria(this.votos));

    // La red general (base pública) opina aparte, y sólo cuando está segura. El
    // vector del extractor personal ya está calculado arriba: no se saca dos veces.
    if (this.conjunto) {
      let general = await this.conjunto.predecir(img, region, { [this.extractorPersonal.fuente]: vector });
      if (this.cerrada) return;
      // Segura no quiere decir que sea eso: si no se parece a sus ejemplos de verdad, es
      // algo que la red no conoce (parecido.js). A «persona» no se la descarta así.
      const segura = general && general.confianza >= CONFIANZA_GENERAL && general.nombre !== CLASE_PERSONA && general.nombre !== CLASE_NADA;
      if (segura && ((this.ejemplos && !this.ejemplos.conoce(vector, general.nombre)) || this._esNegativo(vector, general.nombre))) {
        general = { ...general, desconocido: true };
        hayDesconocido = { caja: null };
      }
      // La tercera opinión: CLIP, mirando lo mismo, ¿dice claramente otra cosa? (Y si
      // ya es desconocido, CLIP dice qué le parece.)
      if (segura && this.clip) {
        const ranking = await this._clipDe(img, region, `centro:${general.nombre}`);
        if (this.cerrada) return;
        if (!general.desconocido && this._clipVeta(ranking, general.nombre)) {
          general = { ...general, desconocido: true };
          hayDesconocido = { caja: null };
        }
        if (hayDesconocido) hayDesconocido.ranking = ranking;
      }
      this.ultimoGeneral = general;
      this.votosGeneral.push(general && !general.desconocido && general.confianza >= CONFIANZA_GENERAL ? general : null);
      if (this.votosGeneral.length > VOTOS) this.votosGeneral.shift();
      this.creoClasificador = this._mayoria(this.votosGeneral);
      personaEnLaMirada = general?.nombre === CLASE_PERSONA && general.confianza >= SOSPECHA_DE_PERSONA;
    }

    // El detector mira el cuadro ENTERO y dice dónde está cada cosa. De todas se
    // queda con UNA, la que está en la mirada (principalDe), y si es algo con alto
    // conocido, la mide. El resto del entorno no llega a la pantalla.
    let detecciones = null;
    if (this.detector) {
      // Con zoom, el detector mira además el centro con todo su detalle: ve lo de la
      // mirada hasta el doble de lejos (detector.js, detectarConZoom).
      // El zoom es una pasada más del detector (~180 ms con D-FINE): se hace sólo si en el
      // centro todavía no hay nada seguro. Si ya lo hay, mirar de cerca no cambia lo que se
      // nombra, y así el cuadro entra en los 500 ms que da la cámara (3-oct-2026).
      detecciones = await this.detector.detectar(img);
      if (this.zoom && !detecciones.some(d => d.confianza >= 0.9 && contieneCentro(d.caja, { x0: img.width / 2, y0: img.height / 2, ancho: 0, alto: 0 })))
        detecciones = await detectarConZoom(this.detector, img, { entero: detecciones });
      if (this.cerrada) return;
      this.ultimasDetecciones = detecciones;
      this.imgDetecciones = img;
      // Lo que el usuario ya corrigió («esto no es una persona») no se marca más.
      const revisadas = await filtrarCorregidos(detecciones, img, { negativos: this.correcciones, positivos: this.positivos,
                                                                    extractor: this.extractorPersonal, caras: this.caras, pistas: this.pistasCorreccion });
      detecciones = revisadas.quedan;
      this.tiradas = revisadas.tiradas;
      if (this.cerrada) return;
      // Lo que el detector marcó sin estar seguro no se tira: si está en la mirada,
      // el recorte se le muestra a las redes propias y deciden ellas.
      const confirmadas = this.conjunto ? await confirmar(detecciones, img, this.conjunto, { confianzaRedes: CONFIANZA_GENERAL }) : [];
      if (this.cerrada) return;
      this.quienes = await this._reconocerCaras(img, detecciones);
      if (this.cerrada) return;
      let candidatas = [...detecciones, ...confirmadas];
      let principal = principalDe(candidatas, img.width, img.height);
      // Lo que el detector nombra en la mirada, ¿se parece a eso? Si no, es algo que no
      // conoce (el marcador naranja que salía «zanahoria»): no se nombra, ni en la
      // pantalla, ni en la escena, ni en la memoria.
      for (let intento = 0; principal && intento < 2 && await this._noSeParece(principal, img); intento++) {
        if (this.cerrada) return;
        hayDesconocido = { caja: principal.caja, ranking: this.clip ? await this._clipDe(img, principal.caja, `caja:${principal.nombre}`) : null };
        if (this.cerrada) return;
        const fuera = principal;
        candidatas = candidatas.filter(d => d !== fuera);
        detecciones = detecciones.filter(d => d !== fuera);
        principal = principalDe(candidatas, img.width, img.height);
      }
      if (this.cerrada) return;
      // Todo lo seguro del cuadro, no sólo lo de la mirada: para «¿qué hay?» y el panel.
      this.escena = describirEscena(candidatas, img.width, img.height,
                                    { fovDiagonalGrados: this.fov, nombrar: (caja) => this._quienEn(caja) });
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
      // El color de un objeto se mide en SU recuadro, y vale sólo para él.
      if (esElMismo && principal.nombre !== CLASE_PERSONA)
        this.colorCaja = { nombre: principal.nombre, color: colorDominante(img, cajaEntera(principal.caja, img)) };
      const centro = { x0: img.width / 2, y0: img.height / 2, ancho: 0, alto: 0 };
      personaEnLaMirada ||= detecciones.some(d => d.nombre === CLASE_PERSONA && d.confianza >= 0.5 && contieneCentro(d.caja, centro));
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
    //       Y sólo si la vio el detector, que está hecho para eso. Medido en 600 fotos
    //       de COCO (3-oct-2026): cuando las redes dicen «persona» del centro y el
    //       detector no ve una persona segura en la mirada, hay una de verdad en 48 de
    //       90 (53 %, una moneda). La ropa colgada del placar de Martín era eso.
    // El paso 2 antes que el 3 salió de una foto real (2-oct-2026): el detector marcó
    // una mano como «banana», al costado, mientras las redes decían «celular 93 %» de
    // lo que estaba en el centro, y tenían razón.
    // Y si el detector dice algo genérico («pajaro») y las redes reconocen cuál es
    // («picaflor»), vale el nombre más específico.
    this.personaEnLaMirada = personaEnLaMirada;
    const det = this.hay, cla = this._redesSolasValen(this.creoClasificador, detecciones, img);
    const objeto = (x) => x && x.nombre !== CLASE_PERSONA;
    this.creo = this.permanenciaCreo.actualizar(
      (objeto(det) && det.alCentro) ? (cla && esEspecieDe(cla.nombre, det.nombre) ? cla : det)
      : objeto(cla) ? cla
      : objeto(det) ? det
      : det ?? (this.detector ? null : cla) ?? null);
    // Algo desconocido en la mirada, varios cuadros seguidos, y nada mejor que nombrar
    // (una persona no cuenta: casi siempre interesa lo que tiene en la mano).
    this.votosNoSe.push(hayDesconocido);
    if (this.votosNoSe.length > VOTOS) this.votosNoSe.shift();
    const noSe = this.votosNoSe.filter(Boolean).length >= VOTOS_MINIMOS && !this.veo && (!this.creo || this.creo.nombre === CLASE_PERSONA)
      ? this.votosNoSe.findLast(Boolean) : null;
    // Lo que le parece a CLIP, si está claro (y no es una persona).
    this.noSe = noSe ? { caja: noSe.caja, parece: this._pareceDe(noSe.ranking) } : null;
    if (detecciones) this._mandarCajas(detecciones, img);
    this._avisarAnimal(this.veo ?? this.creo);

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
    if (!this.noSe && hay?.caja && tema && (tema.nombre === hay.nombre || esEspecieDe(tema.nombre, hay.nombre))) {
      const antes = this.cajaSuave?.nombre === hay.nombre ? this.cajaSuave : null;
      const suave = (k) => Math.round((antes ? (antes[k] + hay.caja[k]) / 2 : hay.caja[k]) / PASO_CAJA_PX) * PASO_CAJA_PX;
      this.cajaSuave = { nombre: hay.nombre, x0: suave('x0'), y0: suave('y0'), ancho: suave('ancho'), alto: suave('alto') };
      const quien = hay.nombre === CLASE_PERSONA ? this._quienEn(hay.caja) : null;
      mirado = { ...this.cajaSuave, nombre: quien ?? tema.nombre, confianza: Math.round(tema.confianza * 100),
                 metros: this.medida ? metrosRedondos(this.medida.distanciaM) : undefined };
    } else if (this.noSe?.caja) {
      const c = this.noSe.caja, redondo = (k) => Math.round(c[k] / PASO_CAJA_PX) * PASO_CAJA_PX;
      this.cajaSuave = null;
      mirado = { x0: redondo('x0'), y0: redondo('y0'), ancho: redondo('ancho'), alto: redondo('alto'),
                 nombre: this.noSe.parece ? `Parece: ${this.noSe.parece.es}` : NO_LO_CONOZCO[0], desconocido: true };
    } else {
      this.cajaSuave = null;
    }
    const msg = {
      t: 'cajas', ancho: img.width, alto: img.height,
      radio: Math.round(RADIO_DE_MIRADA * Math.min(img.width, img.height)),
      mirado,
      lista: [...detecciones.slice(0, 12), ...this.tiradas.map(d => ({ ...d, corregido: true }))].map(d => ({
        nombre: d.nombre, confianza: Math.round(d.confianza * 100),
        x0: Math.round(d.caja.x0), y0: Math.round(d.caja.y0), ancho: Math.round(d.caja.ancho), alto: Math.round(d.caja.alto),
        ...(d.corregido ? { corregido: true } : {}),
      })),
      // Varias cosas a la vez, para el panel (las gafas no lo dibujan): de a 4 px y de
      // a 10 cm, para que no tiemble.
      escena: this.escena ? {
        objetos: this.escena.objetos.map(o => ({
          id: o.id, nombre: o.nombre, confianza: Math.round(o.confianza * 100), metros: o.metros === null ? null : metrosLegibles(o.metros),
          x0: Math.round(o.caja.x0 / PASO_CAJA_PX) * PASO_CAJA_PX, y0: Math.round(o.caja.y0 / PASO_CAJA_PX) * PASO_CAJA_PX,
          ancho: Math.round(o.caja.ancho / PASO_CAJA_PX) * PASO_CAJA_PX, alto: Math.round(o.caja.alto / PASO_CAJA_PX) * PASO_CAJA_PX,
        })),
        relaciones: this.escena.relaciones.map(r => ({ a: r.a, b: r.b, tipo: r.tipo, metros: r.metros === undefined ? undefined : metrosLegibles(r.metros) })),
      } : null,
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
      origen: this.veo ? 'ensenado' : 'general', color: this._colorDe(objeto.nombre),
    });
  }

  // El color medido de lo que se nombra. De una persona, nunca: lo que se mide ahí es
  // la piel, el pelo o la ropa, y «persona marrón» no describe nada útil y ofende (lo
  // vio Martín en su propia cara, 3-oct-2026). No se muestra, no se le pasa al LLM y
  // no se anota.
  // Y no alcanza con mirar el NOMBRE: lo que se le enseñó a la red personal puede ser
  // una persona con otro nombre («Martin, color: marrón», otra vez en su cara, 3-oct).
  // Por eso: el color del recuadro de un objeto vale para ese objeto; si no, el del
  // centro, y sólo si ahí no hay una persona (ni para el detector ni para las redes).
  _colorDe(nombre) {
    if (nombre === CLASE_PERSONA) return null;
    if (this.colorCaja?.nombre === nombre) return this.colorCaja.color;
    return this.personaEnLaMirada ? null : this.color;
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
    } else if (this.texto === TEXTO_REPOSO && this.noSe) {
      // Algo en la mirada que no se parece a nada conocido: mejor decirlo que inventar.
      // Si CLIP cree saber qué es, se dice como posibilidad.
      if (this.noSe.parece) {
        titulo = this.noSe.parece.es.slice(0, COLS);
        lineas = ['Parece; no es seguro', 'Preguntame «¿qué es?»'];
      } else {
        titulo = NO_LO_CONOZCO[0];
        lineas = NO_LO_CONOZCO.slice(1);
      }
    } else if (this.texto === TEXTO_REPOSO && (this.veo || this.creo)) {
      // La pantalla está libre y hay algo reconocido: se muestran sus características.
      // Primera página: dos renglones del TIPO de aparato (fichas.js) y uno medido en
      // este cuadro. Las siguientes, con «Siguiente»: las partes, de a tres.
      const objeto = this.veo ?? this.creo;
      if (objeto.nombre !== this.fichaDe) { this.fichaDe = objeto.nombre; this.paginaFicha = 0; }
      // Una persona que le dio permiso a esta cuenta se nombra; cualquier otra es «persona».
      const quien = objeto.nombre === CLASE_PERSONA && this.hay?.nombre === CLASE_PERSONA ? this._quienEn(this.hay.caja) : null;
      const paginas = quien ? [{ titulo: quien, fijas: ['Persona conocida'], lineas: [] }]
        : paginasDe(objeto.nombre) ?? [{ titulo: objeto.nombre, lineas: [] }];
      const i = Math.min(this.paginaFicha, paginas.length - 1);
      const cuenta = paginas.length > 1 ? ` ${i + 1}/${paginas.length}` : '';
      titulo = paginas[i].titulo.slice(0, COLS - cuenta.length) + cuenta;
      // Si el objeto es el que sigue el detector y se pudo medir, la medida va primero.
      const medida = this.hay && objeto.nombre === this.hay.nombre ? renglonesDeMedida(this.medida) : [];
      const tamano = this.tamano?.objeto === objeto.nombre ? [renglonDeTamano(this.tamano)] : [];
      // Lo fijo (el peligro de un animal, el aviso de una pieza) va antes que todo.
      lineas = i === 0
        ? [...(paginas[0].fijas ?? []), ...tamano, ...medida, ...paginas[0].lineas, this._colorDe(objeto.nombre) ? `Color: ${this._colorDe(objeto.nombre)}` : ''].filter(Boolean).slice(0, 3)
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
      : this.noSe ? 'veo: ?'
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

// ¿El centro de `chica` cae dentro de `grande`?
function contieneCentro(grande, chica) {
  const x = chica.x0 + chica.ancho / 2, y = chica.y0 + chica.alto / 2;
  return x >= grande.x0 && x <= grande.x0 + grande.ancho && y >= grande.y0 && y <= grande.y0 + grande.alto;
}
