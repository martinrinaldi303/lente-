// identificar.js — marca, modelo, características y partes de UN dispositivo.
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
import { regionCentral } from './imagen.js';

const INSTRUCCION = `Sos un técnico que reconoce dispositivos electrónicos y aparatos por una foto. \
Contestás en castellano rioplatense, en frases de 21 letras como mucho, sin puntos finales.

Describí SOLAMENTE el aparato. Si en la foto aparece una persona (una cara, una mano, un cuerpo), \
ignorala por completo: no la describas, no digas quién puede ser ni nada sobre ella.

Si no ves ningún aparato, devolvé "tipo" vacío. Si no podés distinguir el modelo exacto, decí la \
familia más probable y poné "seguridad" en "baja": es mejor eso que inventar un modelo.`;

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    tipo:            { type: 'STRING', description: 'Qué aparato es, en una o dos palabras. Vacío si no hay ninguno' },
    marca:           { type: 'STRING' },
    modelo:          { type: 'STRING', description: 'El modelo o la familia más probable' },
    seguridad:       { type: 'STRING', enum: ['alta', 'media', 'baja'] },
    por_que:         { type: 'STRING', description: 'En qué te fijaste: el logo, las cámaras, los puertos' },
    caracteristicas: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Hasta 6: pantalla, cámaras, puerto de carga, año aproximado' },
    partes:          { type: 'ARRAY', items: { type: 'STRING' }, description: 'Hasta 8 partes, en el orden en que se desarma' },
  },
  required: ['tipo', 'seguridad', 'caracteristicas', 'partes'],
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

// Lo que contestó el modelo, saneado. null si no vio ningún aparato.
export function normalizar(crudo) {
  const tipo = limpiar(crudo?.tipo, 21);
  if (!tipo) return null;
  const lista = (v, max) => (Array.isArray(v) ? v : []).map(x => limpiar(x)).filter(Boolean).slice(0, max);
  return {
    tipo,
    marca: limpiar(crudo.marca, 21),
    modelo: limpiar(crudo.modelo, 40),
    seguridad: ['alta', 'media', 'baja'].includes(crudo.seguridad) ? crudo.seguridad : 'baja',
    por_que: limpiar(crudo.por_que, 80),
    caracteristicas: lista(crudo.caracteristicas, 6),
    partes: lista(crudo.partes, 8),
  };
}

const pregunta = (pista) => pista ? `La red de las gafas cree que es: ${pista}. ¿Qué aparato es, de qué marca y modelo?`
                                  : '¿Qué aparato es, de qué marca y modelo?';

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
{"tipo": "qué aparato es, en una o dos palabras; vacío si no hay ninguno",
 "marca": "", "modelo": "el modelo o la familia más probable",
 "seguridad": "alta, media o baja",
 "por_que": "en qué te fijaste: el logo, las cámaras, los puertos",
 "caracteristicas": ["hasta 6: pantalla, cámaras, puerto de carga, año aproximado"],
 "partes": ["hasta 8 partes, en el orden en que se desarma"]}`;

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
