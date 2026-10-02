// deepseek.js — un pedido a la API de DeepSeek, y nada más.
//
// Formato compatible con OpenAI: POST {base}/chat/completions con la clave en la
// cabecera. Verificado el 2-oct-2026 en api-docs.deepseek.com:
//   · base https://api.deepseek.com
//   · modelos: deepseek-flash (DeepSeek-V4.1-Flash: herramientas, salida JSON e
//     IMÁGENES) y deepseek-v4-pro (más caro, sin imágenes). Se usa flash.
//   · el modo «thinking» viene PRENDIDO por defecto: razona antes de contestar y
//     tarda más. Para unas gafas que conversan se apaga con thinking.type=disabled.
//   · no tiene audio: ni escucha ni habla. Ver voz_deepseek.js.
//
// No se usa ningún SDK: es un fetch. Node 20 lo trae.

export const BASE = 'https://api.deepseek.com';
export const MODELO = 'deepseek-flash';
const MS_ESPERA = 30000;

// Un error de la API con su código HTTP, para que quien llama decida qué hacer.
export class ErrorDeApi extends Error {
  constructor(estado, detalle) {
    super(`DeepSeek contestó ${estado}${detalle ? `: ${detalle}` : ''}`);
    this.estado = estado;
  }
}

// Lo que conviene decirle al usuario según el código (códigos de la documentación).
export function motivoDe(e) {
  if (e instanceof ErrorDeApi) {
    if (e.estado === 401) return 'La clave de DeepSeek no es válida';
    if (e.estado === 402) return 'DeepSeek: no hay saldo en la cuenta';
    if (e.estado === 429) return 'DeepSeek: demasiados pedidos, probá en un rato';
    if (e.estado >= 500)  return 'DeepSeek está caído o saturado, probá en un rato';
    return e.message.slice(0, 120);
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'DeepSeek tardó demasiado en contestar';
  return `No pude llegar a DeepSeek: ${String(e?.message ?? e).slice(0, 80)}`;
}

// Devuelve el mensaje del asistente: { content, tool_calls?, reasoning_content? }.
// `traer` es fetch; se puede cambiar por uno de mentira para probar sin red.
export async function pedirChat({ apiKey, base = BASE, traer = fetch, cuerpo }) {
  const r = await traer(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ stream: false, thinking: { type: 'disabled' }, ...cuerpo }),
    signal: AbortSignal.timeout(MS_ESPERA),
  });
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.json())?.error?.message ?? ''; } catch { /* sin cuerpo legible */ }
    throw new ErrorDeApi(r.status, String(detalle).slice(0, 160));
  }
  const mensaje = (await r.json())?.choices?.[0]?.message;
  if (!mensaje) throw new Error('la respuesta no trae ningún mensaje');
  return mensaje;
}
