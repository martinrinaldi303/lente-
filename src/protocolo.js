// protocolo.js — lo que viaja por el WebSocket entre las gafas y el cerebro.
//
// Es el MISMO para el emulador del navegador y para el ESP32: por eso el binario
// lleva un solo byte de cabecera y nada de base64, que en un microcontrolador
// cuesta memoria y tiempo.
//
//   Binario, gafas → cerebro
//     0x01 + PCM 16 bits, 16 kHz, mono, little-endian   (micrófono)
//     0x02 + un JPEG entero                              (cámara)
//   Binario, cerebro → gafas
//     0x03 + PCM 16 bits, 24 kHz, mono, little-endian   (parlante)
//
//   Texto (JSON), gafas → cerebro
//     {t:"hola", token}            primer mensaje si el cerebro pide token
//     {t:"ensenar", nombre}        «lo que tengo delante se llama así»
//     {t:"olvidar", nombre}
//     {t:"paso", hacia:1|-1}       botón de siguiente / anterior
//     {t:"guia", titulo, pasos}    cargar una guía a mano, sin pasar por el LLM
//     {t:"identificar"}            marca y modelo del APARATO del recuadro (usa el LLM)
//     {t:"guardar_tarjeta"}        guardar la tarjeta QR que está a la vista
//     {t:"texto", texto}           consulta escrita (para probar sin micrófono)
//   Texto (JSON), cerebro → gafas
//     {t:"hud", titulo, lineas, pie}   lo que se dibuja; ya viene cortado a medida
//     {t:"callar"}                     el usuario interrumpió: vaciar el parlante
//     {t:"estado", voz, detalle}
//     {t:"aviso", texto}               un pedido que no se pudo hacer, y por qué
//     {t:"estado", voz, modo, detalle}  cómo está la voz; modo "audio" (el LLM escucha y habla) o
//                                       "texto" (sólo lee y escribe: transcribir y leer es de las gafas)
//     {t:"cajas", ancho, alto, radio, mirado, lista}  el recuadro del objeto mirado (uno, o null),
//                                       el radio de la mirada y lo crudo del detector; sólo para el emulador
//     {t:"dicho", quien, texto}        transcripción, sólo para el emulador

export const BIN_AUDIO_SUBE = 0x01;
export const BIN_JPEG       = 0x02;
export const BIN_AUDIO_BAJA = 0x03;

export const MAX_AUDIO_BYTES = 64 * 1024;
export const MAX_JPEG_BYTES  = 300 * 1024;

export function empaquetar(tipo, cuerpo) {
  return Buffer.concat([Buffer.from([tipo]), cuerpo]);
}

// Devuelve null si el paquete no es válido: tipo desconocido, vacío o pasado de tamaño.
export function desempaquetar(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null;
  const tipo = buf[0];
  const cuerpo = buf.subarray(1);
  if (tipo === BIN_AUDIO_SUBE) {
    if (cuerpo.length > MAX_AUDIO_BYTES || cuerpo.length % 2 !== 0) return null;
    return { tipo, cuerpo };
  }
  if (tipo === BIN_JPEG) {
    if (cuerpo.length > MAX_JPEG_BYTES) return null;
    if (cuerpo[0] !== 0xff || cuerpo[1] !== 0xd8) return null;   // no empieza como JPEG
    return { tipo, cuerpo };
  }
  return null;
}
