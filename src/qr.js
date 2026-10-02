// qr.js — leer la tarjeta que una persona MUESTRA en un código QR.
//
// Es la forma de saber quién es alguien sin violar su privacidad: lo decide esa
// persona. Ella arma su tarjeta con lo que quiere compartir (herramientas/
// hacer_tarjeta.js), la muestra, y las gafas la leen. Lo contrario —averiguarlo
// por la cara— no se hace (ver src/identificar.js).
//
// Se entienden cuatro formatos, que son los que generan los teléfonos y las apps:
//   vCard   BEGIN:VCARD … FN:Ana Pérez … END:VCARD
//   MECARD  MECARD:N:Pérez,Ana;URL:…;;
//   enlace  https://instagram.com/ana
//   texto   cualquier otra cosa
//
// ⚠️ Un QR es texto que escribió otro. Acá sólo se MUESTRA: no se abre ningún
// enlace ni se ejecuta nada de lo que diga.

import jsQR from 'jsqr';

const MAX_CONTENIDO = 2000;

// El texto del QR que haya en la imagen, o null. `img` es lo que da jpeg-js.
export function leerQr(img) {
  const datos = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const r = jsQR(datos, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return r?.data ? r.data.slice(0, MAX_CONTENIDO) : null;
}

const REDES = [
  [/^(?:www\.)?instagram\.com$/, 'Instagram', (p) => '@' + p[0]],
  [/^(?:www\.)?(?:x|twitter)\.com$/, 'X', (p) => '@' + p[0]],
  [/^(?:www\.)?tiktok\.com$/, 'TikTok', (p) => p[0]],
  [/^(?:www\.)?facebook\.com$/, 'Facebook', (p) => p[0]],
  [/^(?:www\.)?github\.com$/, 'GitHub', (p) => p[0]],
  [/^(?:[a-z]{2,3}\.)?linkedin\.com$/, 'LinkedIn', (p) => p[0] === 'in' ? p[1] : p[0]],
  [/^wa\.me$/, 'WhatsApp', (p) => '+' + p[0]],
];

// Un enlace, dicho en corto: «Instagram: @ana» o «ejemplo.com/ana».
export function resumirEnlace(texto) {
  let u;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const partes = u.pathname.split('/').filter(Boolean);
  for (const [host, red, usuario] of REDES) {
    if (host.test(u.hostname) && partes.length) return `${red}: ${usuario(partes)}`;
  }
  return (u.hostname.replace(/^www\./, '') + (partes.length ? '/' + partes.join('/') : '')).slice(0, 60);
}

const limpiar = (s) => String(s ?? '').replace(/\\([,;:\\])/g, '$1').replace(/\s+/g, ' ').trim();

function deVcard(texto) {
  const campos = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Za-z]+)(?:;[^:]*)?:(.*)$/);
    if (m) (campos[m[1].toUpperCase()] ??= []).push(limpiar(m[2]));
  }
  const nombre = campos.FN?.[0] || (campos.N?.[0] ?? '').split(';').filter(Boolean).reverse().join(' ');
  return { nombre, org: campos.ORG?.[0]?.replace(/;+$/, ''), cargo: campos.TITLE?.[0], urls: campos.URL ?? [], nota: campos.NOTE?.[0] };
}

function deMecard(texto) {
  const campos = {};
  for (const m of texto.slice(7).matchAll(/([A-Za-z]+):((?:\\.|[^;])*);/g)) (campos[m[1].toUpperCase()] ??= []).push(limpiar(m[2]));
  const nombre = (campos.N?.[0] ?? '').split(',').map(s => s.trim()).filter(Boolean).reverse().join(' ');
  return { nombre, org: campos.ORG?.[0], urls: campos.URL ?? [], nota: campos.NOTE?.[0] };
}

// Lo que se muestra de una tarjeta: { tipo, nombre, lineas (hasta 3), contenido }.
export function interpretarTarjeta(texto) {
  const contenido = String(texto ?? '').slice(0, MAX_CONTENIDO);
  const t = contenido.trim();
  let tipo = 'texto', d = null;
  if (/^BEGIN:VCARD/i.test(t)) { tipo = 'vcard'; d = deVcard(t); }
  else if (/^MECARD:/i.test(t)) { tipo = 'mecard'; d = deMecard(t); }
  if (d) {
    const lineas = [d.nombre, [d.cargo, d.org].filter(Boolean).join(', '), ...d.urls.map(u => resumirEnlace(u) ?? u), d.nota].filter(Boolean);
    return { tipo, nombre: d.nombre || '', lineas: lineas.slice(0, 3), contenido };
  }
  const enlace = resumirEnlace(t);
  if (enlace) return { tipo: 'enlace', nombre: '', lineas: [enlace], contenido };
  return { tipo, nombre: '', lineas: [limpiar(t)].filter(Boolean), contenido };
}
