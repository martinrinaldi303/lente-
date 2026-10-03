// leer.js — leer el texto que se tiene delante: carteles, etiquetas, envases,
// vencimientos, instrucciones. Y, si se pide, traducirlo.
//
// Leer letras no lo hacen las redes propias: clasifican objetos, no texto. Se le
// manda al LLM el centro de una foto, A PEDIDO (el botón «Leer texto» o «¿qué dice
// acá?»), nunca cuadro por cuadro. Es la tercera cosa que sale de la máquina, después
// de la voz y de «marca y modelo».
//
// Para que se lea, la foto tiene que ser más grande que los cuadros de siempre: la
// sesión le pide a las gafas una foto ({t:"foto"} → paquete 0x04). Las gafas que no
// saben sacarla no contestan, y se usa el último cuadro.
//
// Privacidad, igual que en identificar.js:
//   1 · sesion.js no llama acá si en el recuadro hay una persona.
//   2 · Viaja el CENTRO de la foto, no la foto entera.
//   3 · La instrucción le prohíbe al modelo describir personas, y le pide que NO
//       transcriba documentos de identidad, tarjetas ni datos personales de otro: en
//       ese caso contesta «documento personal» y el texto vuelve vacío.
//
// Con Gemini, igual que marca y modelo: si el modelo principal está saturado (503,
// pasó el 2-oct-2026) o tarda más de 12 s, se prueba una vez con el de reserva, y el
// error que se muestra se puede leer.
// ⚠️ Con DeepSeek, sin probar contra la API real: la cuenta no tenía saldo.

import jpeg from 'jpeg-js';
import { MODELO as MODELO_DEEPSEEK, pedirChat } from './deepseek.js';
import { conPlazo, motivoLegible, MS_POR_INTENTO } from './identificar.js';
import { COLS, envolver, LINEAS_TEXTO } from './hud.js';

const LARGO_MAXIMO = 600;
const LADO_MAXIMO = 1600;
export const DOCUMENTO_PERSONAL = 'documento personal';

const INSTRUCCION = `Sos los ojos de una persona que usa unas gafas con cámara. Transcribís el texto \
que se ve en la foto: carteles, etiquetas, envases, instrucciones, pantallas, menús.

Reglas:
- Transcribí sólo lo que se lee con claridad. Si una parte no se lee, poné […]. No inventes.
- Si hay mucho texto, empezá por lo más importante (el título, lo más grande, una fecha de \
vencimiento) y resumí el resto.
- Si es un documento de identidad, una tarjeta bancaria o datos personales de alguien (un DNI, \
un recibo con nombre y dirección), NO lo transcribas: poné "${DOCUMENTO_PERSONAL}" en "tipo" y \
dejá "texto" vacío.
- No describas personas ni digas quiénes son.`;

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    tipo:       { type: 'STRING', description: `cartel, etiqueta, envase, pantalla, ${DOCUMENTO_PERSONAL} u otro` },
    texto:      { type: 'STRING', description: 'Lo que dice, tal cual. Vacío si no hay texto legible' },
    idioma:     { type: 'STRING', description: 'En qué idioma está' },
    traduccion: { type: 'STRING', description: 'La traducción, sólo si se pidió' },
  },
  required: ['tipo', 'texto'],
};

const FORMATO_JSON = `Contestá SOLAMENTE con un objeto json con esta forma, sin texto alrededor:
{"tipo": "cartel, etiqueta, envase, pantalla, ${DOCUMENTO_PERSONAL} u otro",
 "texto": "lo que dice, tal cual; vacío si no hay texto legible",
 "idioma": "en qué idioma está",
 "traduccion": "la traducción, sólo si se pidió"}`;

const pregunta = (traducirA) => traducirA
  ? `Leé el texto de la foto y traducilo al ${traducirA}.`
  : 'Leé el texto de la foto.';

// El centro de la foto (80 % de ancho y 70 % de alto), como JPEG y a lo sumo de
// LADO_MAXIMO de ancho. Un cartel no tiene por qué llenar el recuadro de enseñar.
export function recorteParaLeer(fotoJpeg) {
  const img = jpeg.decode(fotoJpeg, { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 128 });
  const ancho = Math.max(16, Math.floor(img.width * 0.8)), alto = Math.max(16, Math.floor(img.height * 0.7));
  const x0 = Math.floor((img.width - ancho) / 2), y0 = Math.floor((img.height - alto) / 2);
  const k = Math.max(1, ancho / LADO_MAXIMO);
  const w = Math.round(ancho / k), h = Math.round(alto / k);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y0 + Math.min(alto - 1, Math.floor(y * k));
    for (let x = 0; x < w; x++) {
      const desde = (sy * img.width + x0 + Math.min(ancho - 1, Math.floor(x * k))) * 4;
      data.set(img.data.subarray(desde, desde + 4), (y * w + x) * 4);
    }
  }
  return jpeg.encode({ width: w, height: h, data }, 90).data;
}

const limpiar = (s, largo) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);

// Lo que contestó el modelo, saneado. null si no hay nada que leer.
export function normalizarLectura(crudo) {
  const tipo = limpiar(crudo?.tipo, 24).toLowerCase() || 'otro';
  if (tipo === DOCUMENTO_PERSONAL) return { tipo, texto: '', idioma: '', traduccion: '' };
  const texto = limpiar(crudo?.texto, LARGO_MAXIMO), traduccion = limpiar(crudo?.traduccion, LARGO_MAXIMO);
  if (!texto && !traduccion) return null;
  return { tipo, texto, idioma: limpiar(crudo?.idioma, 24), traduccion };
}

// Un texto largo en páginas de 3 renglones de 21 letras, para recorrer con Siguiente.
export function paginar(texto, maxPaginas = 40) {
  const renglones = envolver(texto, COLS, Infinity);
  const paginas = [];
  for (let i = 0; i < renglones.length && paginas.length < maxPaginas; i += LINEAS_TEXTO)
    paginas.push(renglones.slice(i, i + LINEAS_TEXTO));
  return paginas;
}

// `ia` es un cliente de @google/genai. Devuelve (fotoJpeg, { traducirA }) → lectura | null.
export function crearLector({ ia, modelo, reserva = null, msPorIntento = MS_POR_INTENTO }) {
  return async (fotoJpeg, { traducirA = '' } = {}) => {
    const recorte = recorteParaLeer(fotoJpeg);
    let ultimo;
    for (const m of [modelo, ...(reserva && reserva !== modelo ? [reserva] : [])]) {
      try {
        const respuesta = await conPlazo(ia.models.generateContent({
          model: m,
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(recorte).toString('base64') } },
              { text: pregunta(traducirA) },
            ],
          }],
          config: { systemInstruction: INSTRUCCION, responseMimeType: 'application/json', responseSchema: ESQUEMA, temperature: 0.1 },
        }), msPorIntento);
        return normalizarLectura(JSON.parse(respuesta.text));
      } catch (e) { ultimo = e; }
    }
    throw new Error(motivoLegible(ultimo));
  };
}

// Lo mismo con DeepSeek. `traer` es fetch; se cambia por uno de mentira para probar.
export function crearLectorDeepSeek({ apiKey, modelo = MODELO_DEEPSEEK, base, traer }) {
  return async (fotoJpeg, { traducirA = '' } = {}) => {
    const recorte = recorteParaLeer(fotoJpeg);
    const m = await pedirChat({ apiKey, base, traer, cuerpo: {
      model: modelo, max_tokens: 900, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${INSTRUCCION}\n\n${FORMATO_JSON}` },
        { role: 'user', content: [
          { type: 'text', text: pregunta(traducirA) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(recorte).toString('base64')}` } },
        ] },
      ],
    } });
    const texto = String(m.content ?? '').trim();
    if (!texto) throw new Error('DeepSeek no contestó nada, probá de nuevo');
    return normalizarLectura(JSON.parse(texto));
  };
}
