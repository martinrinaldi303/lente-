// identificar.js — qué es lo del recuadro: marca, modelo, características y partes de
// UN dispositivo; función y diseño de una pieza; especie y peligro de un animal.
//
// La red propia dice el tipo («celular»). Para la marca y el modelo hace falta
// conocer miles de aparatos, y eso no se entrena acá: se le manda al LLM el recorte
// del recuadro, A PEDIDO (un botón o «¿qué modelo es?»), nunca cuadro por cuadro.
// Es la segunda cosa, después de la voz, que sale de la máquina.
//
// ── Sólo dispositivos. Nunca personas. ───────────────────────────────────────
// Esta función existe para objetos. No se usa, ni se va a usar, para averiguar
// quién es alguien por la cara: identificar a una persona sin que lo sepa, y
// juntar su nombre y sus redes, es exactamente lo que la privacidad protege, por
// más que cada dato suelto sea público. Tres trabas, a propósito redundantes:
//   1 · sesion.js no llama acá si lo reconocido en el recuadro es «persona».
//   2 · Se manda sólo el recorte del recuadro, no el cuadro entero.
//   3 · La instrucción le prohíbe al modelo describir o identificar personas, y la
//       respuesta tiene un esquema fijo donde no hay dónde poner un nombre.
//
// Dos LLM posibles, con el mismo recorte, la misma instrucción y la misma respuesta
// saneada: Gemini (crearIdentificador) y DeepSeek (crearIdentificadorDeepSeek).
//
// Probado contra Gemini de verdad el 2-oct-2026: `gemini-3.8-flash` contestaba 503
// (saturado) y `gemini-3.5-flash-lite` devolvió la ficha en 2,4 s. De ahí el modelo
// de reserva y el plazo por intento: sin ellos la pantalla quedaba más de 40 s en
// «Mirando el aparato...».
// ⚠️ Con DeepSeek, SIN PROBAR contra la API real: la cuenta no tenía saldo (402).

import jpeg from 'jpeg-js';
import { MODELO as MODELO_DEEPSEEK, pedirChat } from './deepseek.js';
import { fichaDe } from './fichas.js';
import { NIVELES, pisoDePeligro } from './fichas_animales.js';
import { regionCentral } from './imagen.js';

// Desde el 3-oct-2026 no son sólo aparatos: también piezas de computadoras y de
// celulares, y animales (cualquiera: la red propia conoce unos 60, el LLM miles).
// Las trabas de arriba siguen iguales: un animal tampoco es una persona.
const INSTRUCCION = `Sos un técnico y naturalista que reconoce por una foto tres cosas: aparatos \
electrónicos, piezas de computadoras y de celulares, y animales. Contestás en castellano \
rioplatense, en frases de 21 letras como mucho, sin puntos finales.

Describí SOLAMENTE el aparato, la pieza o el animal. Si en la foto aparece una persona (una cara, \
una mano, un cuerpo), ignorala por completo: no la describas, no digas quién puede ser ni nada sobre ella.

Aparato: marca y modelo. Si no podés distinguir el modelo exacto, decí la familia más probable y \
poné "seguridad" en "baja": es mejor eso que inventar un modelo.

Pieza (memoria RAM, fuente, placa de video, batería, flex, módulo de cámara…): qué pieza es, para \
qué sirve ("funcion"), cómo es y dónde va ("diseno"), y qué mirar ("caracteristicas"): tipo, \
capacidad, conector. Si tocarla tiene un riesgo (capacitores, batería hinchada), decilo primero.

Animal: la especie más probable, cómo es ("caracteristicas"), el "peligro" para una persona que \
se lo cruza sin molestarlo, y "que_hacer", lo más importante primero. Ante la duda entre una \
especie peligrosa y una inofensiva, tomá la peligrosa: toda víbora se trata como venenosa. Nunca \
digas que un animal es inofensivo si no estás seguro de la especie.

Si no ves ninguna de las tres cosas, devolvé "tipo" vacío.`;

const LISTA = (descripcion) => ({ type: 'ARRAY', items: { type: 'STRING' }, description: descripcion });
const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    categoria:       { type: 'STRING', enum: ['aparato', 'pieza', 'animal'] },
    tipo:            { type: 'STRING', description: 'Qué es, en una o dos palabras: el aparato, la pieza o la especie. Vacío si no hay nada de eso' },
    marca:           { type: 'STRING', description: 'Aparatos y piezas' },
    modelo:          { type: 'STRING', description: 'El modelo o la familia más probable. Aparatos y piezas' },
    seguridad:       { type: 'STRING', enum: ['alta', 'media', 'baja'] },
    por_que:         { type: 'STRING', description: 'En qué te fijaste: el logo, los conectores, las manchas, la forma' },
    caracteristicas: LISTA('Hasta 6: de un aparato, pantalla, cámaras, año; de una pieza, tipo, capacidad, conector; de un animal, cómo es'),
    partes:          LISTA('Aparatos: hasta 8 partes, en el orden en que se desarma'),
    funcion:         LISTA('Piezas: hasta 3, para qué sirve'),
    diseno:          LISTA('Piezas: hasta 3, cómo es y dónde va'),
    peligro:         { type: 'STRING', enum: NIVELES, description: 'Animales: para una persona que se lo cruza' },
    que_hacer:       LISTA('Animales: hasta 4, lo más importante primero'),
  },
  required: ['categoria', 'tipo', 'seguridad', 'caracteristicas'],
};

// Lo único que viaja, como JPEG: el recorte del APARATO si el detector lo localizó
// (`caja`, con un 8 % de margen), o si no el recuadro del centro del cuadro.
export function recorteDelRecuadro(cuadroJpeg, caja = null) {
  const img = jpeg.decode(cuadroJpeg, { useTArray: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 });
  let r = regionCentral(img);
  if (caja) {
    const mx = caja.ancho * 0.08, my = caja.alto * 0.08;
    const x0 = Math.max(0, Math.floor(caja.x0 - mx)), y0 = Math.max(0, Math.floor(caja.y0 - my));
    const x1 = Math.min(img.width, Math.ceil(caja.x0 + caja.ancho + mx)), y1 = Math.min(img.height, Math.ceil(caja.y0 + caja.alto + my));
    if (x1 - x0 >= 16 && y1 - y0 >= 16) r = { x0, y0, ancho: x1 - x0, alto: y1 - y0 };
  }
  const data = new Uint8Array(r.ancho * r.alto * 4);
  for (let y = 0; y < r.alto; y++) {
    const desde = ((r.y0 + y) * img.width + r.x0) * 4;
    data.set(img.data.subarray(desde, desde + r.ancho * 4), y * r.ancho * 4);
  }
  return jpeg.encode({ width: r.ancho, height: r.alto, data }, 90).data;
}

const limpiar = (s, largo = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);

// Lo que contestó el modelo, saneado. null si no vio nada de lo que reconoce.
// De un animal, el peligro nunca queda por debajo de:
//   · el piso de su grupo (toda víbora «alto»: ver pisoDePeligro),
//   · el de la ficha propia, si la especie tiene (fichas_animales.js),
//   · «medio», si el modelo no está seguro de la especie: «inofensivo» con una foto
//     dudosa es justo el error que no se puede cometer.
export function normalizar(crudo) {
  const tipo = limpiar(crudo?.tipo, 21);
  if (!tipo) return null;
  const lista = (v, max) => (Array.isArray(v) ? v : []).map(x => limpiar(x)).filter(Boolean).slice(0, max);
  const categoria = ['aparato', 'pieza', 'animal'].includes(crudo.categoria) ? crudo.categoria : 'aparato';
  const seguridad = ['alta', 'media', 'baja'].includes(crudo.seguridad) ? crudo.seguridad : 'baja';
  const f = {
    categoria, tipo, seguridad,
    marca: categoria === 'animal' ? '' : limpiar(crudo.marca, 21),
    modelo: categoria === 'animal' ? '' : limpiar(crudo.modelo, 40),
    por_que: limpiar(crudo.por_que, 80),
    caracteristicas: lista(crudo.caracteristicas, 6),
    partes: categoria === 'aparato' ? lista(crudo.partes, 8) : [],
  };
  if (categoria === 'pieza') Object.assign(f, { funcion: lista(crudo.funcion, 3), diseno: lista(crudo.diseno, 3) });
  if (categoria === 'animal') {
    const propia = fichaDe(tipo)?.tipo === 'animal' ? fichaDe(tipo).f : null;
    let i = Math.max(NIVELES.indexOf(crudo.peligro), NIVELES.indexOf('bajo'));
    if (propia) i = Math.max(i, NIVELES.indexOf(propia.peligro));
    if (seguridad === 'baja') i = Math.max(i, NIVELES.indexOf('medio'));
    const peligro = pisoDePeligro(tipo, NIVELES[i]);
    let queHacer = lista(crudo.que_hacer, 4);
    if (!queHacer.length && propia) queHacer = propia.hacer.slice();
    if (!queHacer.length && peligro !== 'bajo') queHacer = ['No te acerques'];
    Object.assign(f, { peligro, que_hacer: queHacer });
  }
  return f;
}

const pregunta = (pista) => pista ? `La red de las gafas cree que es: ${pista}. ¿Qué es: un aparato, una pieza o un animal?`
                                  : '¿Qué es: un aparato (marca y modelo), una pieza o un animal?';

export const MS_POR_INTENTO = 12000;
export function conPlazo(promesa, ms) {
  let reloj;
  const plazo = new Promise((_, mal) => { reloj = setTimeout(() => mal(new Error('tardó demasiado en contestar')), ms); });
  return Promise.race([promesa, plazo]).finally(() => clearTimeout(reloj));
}

// El error de Gemini llega como un JSON metido en el mensaje. Esto lo pasa a algo
// que se pueda leer en una pantalla de 21 letras por renglón.
export function motivoLegible(e) {
  let texto = String(e?.message ?? e), codigo = e?.status;
  try { const j = JSON.parse(texto); codigo = j.error?.code ?? codigo; texto = j.error?.message ?? texto; } catch { /* no era JSON */ }
  if (codigo === 503) return 'el modelo está saturado, probá en un rato';
  if (codigo === 429) return 'se acabó el cupo por ahora, probá en un rato';
  if (codigo === 401 || codigo === 403 || /API key/i.test(texto)) return 'la clave no es válida';
  return texto;
}

// `ia` es un cliente de @google/genai. Devuelve una función (cuadroJpeg, pista, caja) → ficha | null.
// Si `modelo` falla o tarda (saturado, sin cupo), se prueba una vez con `reserva`.
export function crearIdentificador({ ia, modelo, reserva = null, msPorIntento = MS_POR_INTENTO }) {
  return async (cuadroJpeg, pista = '', caja = null) => {
    const recorte = recorteDelRecuadro(cuadroJpeg, caja);
    let ultimo;
    for (const m of [modelo, ...(reserva && reserva !== modelo ? [reserva] : [])]) {
      try {
        const respuesta = await conPlazo(ia.models.generateContent({
          model: m,
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(recorte).toString('base64') } },
              { text: pregunta(pista) },
            ],
          }],
          config: { systemInstruction: INSTRUCCION, responseMimeType: 'application/json', responseSchema: ESQUEMA, temperature: 0.2 },
        }), msPorIntento);
        return normalizar(JSON.parse(respuesta.text));
      } catch (e) { ultimo = e; }
    }
    throw new Error(motivoLegible(ultimo));
  };
}

// DeepSeek no acepta un esquema de respuesta como Gemini: se le pide «un objeto json»
// con la forma escrita en la instrucción (así lo indica su documentación), y lo que
// vuelva pasa igual por normalizar(), que tira todo lo que no esté en la ficha. Tampoco
// acá hay dónde poner el nombre de una persona.
const FORMATO_JSON = `Contestá SOLAMENTE con un objeto json con esta forma, sin texto alrededor:
{"categoria": "aparato, pieza o animal",
 "tipo": "qué es, en una o dos palabras; vacío si no hay nada de eso",
 "marca": "", "modelo": "el modelo o la familia más probable (aparatos y piezas)",
 "seguridad": "alta, media o baja",
 "por_que": "en qué te fijaste: el logo, los conectores, las manchas, la forma",
 "caracteristicas": ["hasta 6"],
 "partes": ["aparatos: hasta 8 partes, en el orden en que se desarma"],
 "funcion": ["piezas: hasta 3, para qué sirve"], "diseno": ["piezas: hasta 3, cómo es y dónde va"],
 "peligro": "animales: bajo, medio, alto o muy alto",
 "que_hacer": ["animales: hasta 4, lo más importante primero"]}`;

// La misma función que crearIdentificador, con la API de DeepSeek: (cuadroJpeg, pista, caja) → ficha | null.
// `traer` es fetch; se cambia por uno de mentira para probar sin red.
export function crearIdentificadorDeepSeek({ apiKey, modelo = MODELO_DEEPSEEK, base, traer }) {
  return async (cuadroJpeg, pista = '', caja = null) => {
    const recorte = recorteDelRecuadro(cuadroJpeg, caja);
    const m = await pedirChat({ apiKey, base, traer, cuerpo: {
      model: modelo, max_tokens: 700, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${INSTRUCCION}\n\n${FORMATO_JSON}` },
        // Las imágenes van sólo en mensajes del usuario, como data: URL.
        { role: 'user', content: [
          { type: 'text', text: pregunta(pista) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(recorte).toString('base64')}` } },
        ] },
      ],
    } });
    // La documentación avisa que con salida JSON a veces vuelve vacío.
    const texto = String(m.content ?? '').trim();
    if (!texto) throw new Error('DeepSeek no contestó nada, probá de nuevo');
    return normalizar(JSON.parse(texto));
  };
}
