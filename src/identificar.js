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
// ⚠️ SIN PROBAR contra la API real: el 2-oct-2026 no había GEMINI_API_KEY. Lo que
// está probado es todo lo de alrededor, con un cliente de mentira.

import jpeg from 'jpeg-js';
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

// El recuadro del centro del cuadro, como JPEG: es lo único que viaja.
export function recorteDelRecuadro(cuadroJpeg) {
  const img = jpeg.decode(cuadroJpeg, { useTArray: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 });
  const r = regionCentral(img);
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

// `ia` es un cliente de @google/genai. Devuelve una función (cuadroJpeg, pista) → ficha | null.
export function crearIdentificador({ ia, modelo }) {
  return async (cuadroJpeg, pista = '') => {
    const recorte = recorteDelRecuadro(cuadroJpeg);
    const respuesta = await ia.models.generateContent({
      model: modelo,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(recorte).toString('base64') } },
          { text: pista ? `La red de las gafas cree que es: ${pista}. ¿Qué aparato es, de qué marca y modelo?`
                        : '¿Qué aparato es, de qué marca y modelo?' },
        ],
      }],
      config: { systemInstruction: INSTRUCCION, responseMimeType: 'application/json', responseSchema: ESQUEMA, temperature: 0.2 },
    });
    return normalizar(JSON.parse(respuesta.text));
  };
}
