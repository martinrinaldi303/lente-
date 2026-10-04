// protocolo.js — lo que viaja por el WebSocket entre las gafas y el cerebro.
//
// Es el MISMO para el emulador del navegador y para el ESP32: por eso el binario
// lleva un solo byte de cabecera y nada de base64, que en un microcontrolador
// cuesta memoria y tiempo.
//
//   Binario, gafas → cerebro
//     0x01 + PCM 16 bits, 16 kHz, mono, little-endian   (micrófono)
//     0x02 + un JPEG entero                              (cámara)
//     0x04 + un JPEG entero, de la resolución más alta   (la foto que pidió {t:"foto"}, para leer texto)
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
//     {t:"donde", nombre}          ¿dónde vi este objeto por última vez?
//     {t:"lugar", nombre}          «estoy en la cocina» (vacío lo borra)
//     {t:"leer", traducir_a}       leer el texto del recuadro (usa el LLM); traducir_a es opcional
//     {t:"guia_local", consulta}   cargar una guía guardada en guias/ (sin LLM, sin internet)
//     {t:"distancia", mm}          lo que mide el sensor láser (VL53L1X), unas veces por segundo; 0 = no ve nada
//     {t:"evaluar", acierto, real} prueba real: ¿acertó lo que muestra la pantalla? y si no, qué era
//     {t:"escena"}                 todo lo seguro del cuadro a la vez, con distancias («¿qué hay?»)
//     {t:"corregir", nombre, caja} «eso no es una persona»: un recuadro del detector (caja en
//                                  píxeles del cuadro); con todas:true en vez de caja, todos los de
//                                  esa clase sin cara y fuera del centro («la ropa no es persona»)
//     {t:"olvidar_correcciones"}   borra todo lo que esta cuenta le corrigió al detector
//     {t:"nombre", nombre, en}     «sabé que existen los marcadores»: un nombre nuevo para CLIP (en: en inglés)
//   Texto (JSON), cerebro → gafas
//     {t:"hud", titulo, lineas, pie}   lo que se dibuja; ya viene cortado a medida
//     {t:"callar"}                     el usuario interrumpió: vaciar el parlante
//     {t:"aviso", texto}               un pedido que no se pudo hacer, y por qué (o que se hizo)
//     {t:"estado", voz, modo, detalle}  cómo está la voz; modo "audio" (el LLM escucha y habla) o
//                                       "texto" (sólo lee y escribe: transcribir y leer es de las gafas)
//     {t:"quien", usuario, anteojos}   con qué cuenta y qué par quedó la conexión (null: sin cuenta)
//     {t:"cajas", ancho, alto, radio, mirado, lista, escena}  el recuadro del objeto mirado (uno, o
//                                       null; con desconocido:true si no se parece a nada conocido),
//                                       el radio de la mirada, lo crudo del detector y la escena;
//                                       sólo para el panel: un OLED no los dibuja
//     {t:"dicho", quien, texto}        transcripción, sólo para el emulador
//     {t:"decir", texto}               leerlo en voz alta con la voz de las gafas (no la del LLM)
//     {t:"alerta", tipo, objeto, llegada_s|peligro}  un vehículo por llegar o un animal peligroso:
//                                       pitar o vibrar YA
//     {t:"foto"}                       mandame una foto 0x04 lo más grande que puedas

export const BIN_AUDIO_SUBE = 0x01;
export const BIN_JPEG       = 0x02;
export const BIN_AUDIO_BAJA = 0x03;
export const BIN_FOTO       = 0x04;

export const MAX_AUDIO_BYTES = 64 * 1024;
export const MAX_JPEG_BYTES  = 300 * 1024;
export const MAX_FOTO_BYTES  = 480 * 1024;   // por debajo del maxPayload de 512 KB del servidor

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
  if (tipo === BIN_JPEG || tipo === BIN_FOTO) {
    if (cuerpo.length > (tipo === BIN_FOTO ? MAX_FOTO_BYTES : MAX_JPEG_BYTES)) return null;
    if (cuerpo[0] !== 0xff || cuerpo[1] !== 0xd8) return null;   // no empieza como JPEG
    return { tipo, cuerpo };
  }
  return null;
}
