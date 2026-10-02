// voz_deepseek.js — la conversación, con la API de DeepSeek.
//
// Hace lo mismo que voz_live.js (Gemini) con una diferencia grande: DeepSeek NO
// tiene audio. Entra texto y sale texto. Escuchar y hablar quedan del lado de las
// gafas:
//   · el emulador usa el reconocimiento y la síntesis de voz del navegador
//     (publico/gafas.js): manda {t:"texto"} y lee en voz alta lo que vuelve.
//   · unas gafas de verdad (ESP32) no tienen eso. Para ellas falta poner en el
//     cerebro un transcriptor y un sintetizador. Hoy, con DeepSeek, la voz anda
//     sólo en el emulador.
//
// La conversación es por turnos: llega un texto, el modelo contesta o pide
// herramientas (las mismas HERRAMIENTAS de sesion.js), se le devuelven los
// resultados y sigue hasta que contesta. Un turno por vez, en orden.
//
// ⚠️ SIN PROBAR contra la API real: el 2-oct-2026 no había DEEPSEEK_API_KEY en .env.
// Probado con un fetch de mentira (pruebas/deepseek.test.js) contra el formato de
// la documentación.

import { ErrorDeApi, MODELO, motivoDe, pedirChat } from './deepseek.js';
import { INSTRUCCION_POR_ESCRITO } from './instruccion.js';

const MAX_VUELTAS  = 5;      // pedidos de herramientas encadenados en un mismo turno
const MAX_MENSAJES = 40;     // la historia que viaja en cada pedido
const MAX_TOKENS   = 400;

// Las herramientas están escritas como las pide Gemini (tipos en mayúscula). DeepSeek
// las quiere en JSON Schema corriente, envueltas en {type:"function", function}.
export function aEsquema(e) {
  if (Array.isArray(e)) return e.map(aEsquema);
  if (!e || typeof e !== 'object') return e;
  const out = {};
  for (const [k, v] of Object.entries(e)) out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : k === 'enum' ? v : aEsquema(v);
  return out;
}
export const herramientasDeepSeek = (herramientas) => herramientas.map(h => ({
  type: 'function',
  function: { name: h.name, description: h.description, parameters: aEsquema(h.parameters ?? { type: 'object', properties: {} }) },
}));

export async function conectarVozDeepSeek({ apiKey, modelo = MODELO, base, traer, herramientas, ejecutar,
                                            alInterrumpir = () => {}, alDicho, alEstado, alAviso = () => {} }) {
  const tools = herramientasDeepSeek(herramientas);
  const mensajes = [];
  let cola = Promise.resolve(), cerrada = false;

  // La historia no crece para siempre, y nunca empieza por la mitad de un turno.
  const recortar = () => {
    while (mensajes.length > MAX_MENSAJES) mensajes.shift();
    while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
  };

  async function turno(texto) {
    const desde = mensajes.length;
    mensajes.push({ role: 'user', content: texto });
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const m = await pedirChat({ apiKey, base, traer, cuerpo: {
          model: modelo, max_tokens: MAX_TOKENS, tools,
          messages: [{ role: 'system', content: INSTRUCCION_POR_ESCRITO }, ...mensajes],
        } });
        if (cerrada) return;
        const llamadas = m.tool_calls ?? [];
        // Si igual razonó, lo razonado tiene que volver en los pedidos siguientes: sin
        // eso, con herramientas, la API contesta 400.
        mensajes.push({ role: 'assistant', content: m.content ?? '',
                        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
                        ...(llamadas.length ? { tool_calls: llamadas } : {}) });
        if (!llamadas.length) {
          const dicho = String(m.content ?? '').trim();
          if (dicho) alDicho('miia', dicho);
          return;
        }
        for (const ll of llamadas) {
          let resultado;
          try { resultado = await ejecutar(ll.function.name, JSON.parse(ll.function.arguments || '{}')); }
          catch (e) { resultado = { ok: false, motivo: e.message }; }
          mensajes.push({ role: 'tool', tool_call_id: ll.id, content: JSON.stringify(resultado ?? null) });
        }
      }
      alAviso('MIIA se quedó dando vueltas y no llegó a contestar');
    } catch (e) {
      mensajes.length = desde;             // un turno que falló no queda a medias en la historia
      if (cerrada) return;
      // Con la clave mal no va a andar ningún pedido: la voz se da por caída. Lo demás
      // (sin saldo, saturado, sin red) puede pasar: se avisa y se sigue.
      if (e instanceof ErrorDeApi && e.estado === 401) alEstado('error', motivoDe(e));
      else alAviso(motivoDe(e));
    } finally {
      recortar();
    }
  }

  alEstado('lista');
  return {
    modo: 'texto',
    audio() { /* DeepSeek no escucha: el audio se transcribe en las gafas */ },
    frame() { /* ni mira cuadro por cuadro: ver es de las redes propias */ },
    // Devuelve la promesa del turno, para las pruebas; la sesión no la espera.
    texto(t) {
      alInterrumpir();                     // si estaba leyendo la respuesta anterior, se calla
      cola = cola.then(() => (cerrada ? undefined : turno(t)));
      return cola;
    },
    cerrar() { cerrada = true; },
  };
}
