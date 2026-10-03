// google.js — «Continuar con Google»: verificar que la constancia que manda la página
// la firmó Google, y para esta aplicación.
//
// Cómo funciona: la página muestra el botón de Google (Google Identity Services). Cuando
// la persona elige su cuenta, Google le da a la página un «ID token»: un JWT firmado con
// las claves de Google que dice quién es (sub, correo, nombre). La página se lo pasa al
// cerebro, y acá se verifica TODO antes de creerle:
//   · la firma (RS256) con las claves públicas de Google, que se bajan y se guardan el
//     tiempo que Google dice (Cache-Control);
//   · que lo emitió Google (iss), que es para ESTA aplicación (aud = el ID de cliente),
//     que no venció (exp) y que Google verificó el correo (email_verified).
//
// Sólo hace falta el ID de cliente (GOOGLE_CLIENT_ID en .env), que no es secreto: igual
// viaja en la página. El «secreto de cliente» no se usa en este camino.
//
// No se usa ninguna biblioteca de Google: con node:crypto alcanza.

import { createPublicKey, verify } from 'node:crypto';

const CLAVES_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES = new Set(['accounts.google.com', 'https://accounts.google.com']);
const TOLERANCIA_S = 60;                 // relojes un poco desfasados
const MS_ENTRE_BUSQUEDAS = 60 * 1000;   // una clave desconocida no hace bajar las claves a cada pedido

export class ErrorDeGoogle extends Error {}

const deBase64Url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Baja las claves públicas de Google: { claves: [jwk...], vigenciaMs }.
async function bajarClaves() {
  const r = await fetch(CLAVES_GOOGLE, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new ErrorDeGoogle(`Google no dio sus claves (${r.status})`);
  const edad = /max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '');
  return { claves: (await r.json()).keys ?? [], vigenciaMs: edad ? Number(edad[1]) * 1000 : 60 * 60 * 1000 };
}

// Devuelve verificar(token) → { sub, correo, nombre }, o tira ErrorDeGoogle con el motivo.
// `traerClaves` y `reloj` se cambian en las pruebas.
export function crearVerificadorGoogle({ clientId, traerClaves = bajarClaves, reloj = Date.now }) {
  let cache = { claves: [], vence: 0 }, ultimaBusqueda = 0;

  async function claveDe(kid) {
    const ahora = reloj();
    let jwk = ahora < cache.vence ? cache.claves.find(k => k.kid === kid) : undefined;
    if (!jwk && (ahora >= cache.vence || ahora - ultimaBusqueda > MS_ENTRE_BUSQUEDAS)) {
      ultimaBusqueda = ahora;
      const { claves, vigenciaMs } = await traerClaves();
      cache = { claves, vence: ahora + vigenciaMs };
      jwk = claves.find(k => k.kid === kid);
    }
    if (!jwk) throw new ErrorDeGoogle('La constancia está firmada con una clave que Google no publica');
    return createPublicKey({ key: jwk, format: 'jwk' });
  }

  return async function verificar(token) {
    const partes = String(token ?? '').split('.');
    if (partes.length !== 3) throw new ErrorDeGoogle('La constancia de Google está mal formada');
    let cabecera, datos;
    try { cabecera = JSON.parse(deBase64Url(partes[0])); datos = JSON.parse(deBase64Url(partes[1])); }
    catch { throw new ErrorDeGoogle('La constancia de Google está mal formada'); }
    // Sólo RS256: «none» o un HMAC con la clave pública como secreto son los trucos de siempre.
    if (cabecera.alg !== 'RS256' || !cabecera.kid) throw new ErrorDeGoogle('La constancia no está firmada como firma Google');
    const firmaOk = verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), await claveDe(cabecera.kid), deBase64Url(partes[2]));
    if (!firmaOk) throw new ErrorDeGoogle('La firma de la constancia no es de Google');

    const ahora = Math.floor(reloj() / 1000);
    if (!EMISORES.has(datos.iss)) throw new ErrorDeGoogle('La constancia no la emitió Google');
    const aud = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
    if (!aud.includes(clientId)) throw new ErrorDeGoogle('La constancia es para otra aplicación');
    if (!(datos.exp + TOLERANCIA_S > ahora)) throw new ErrorDeGoogle('La constancia de Google venció: probá de nuevo');
    if (datos.iat && datos.iat - TOLERANCIA_S > ahora) throw new ErrorDeGoogle('La constancia de Google viene del futuro');
    if (!datos.sub) throw new ErrorDeGoogle('La constancia no dice quién es');
    if (!datos.email || !(datos.email_verified === true || datos.email_verified === 'true'))
      throw new ErrorDeGoogle('Google no confirmó ese correo');
    // Sólo esto: ni la foto ni nada más del perfil de Google.
    return { sub: String(datos.sub), correo: String(datos.email).toLowerCase(), nombre: String(datos.name ?? '').trim() };
  };
}
