import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { crearVerificadorGoogle } from '../src/google.js';

// Un «Google» de mentira: un par de claves RSA generado acá y el JWKS que publicaría.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otro = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'clave-1', alg: 'RS256', use: 'sig' };
const CLIENTE = '1234-abc.apps.googleusercontent.com';
const AHORA = 1_790_000_000_000;

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function firmar(datos, { kid = 'clave-1', alg = 'RS256', clave = privateKey } = {}) {
  const cabecera = b64({ alg, kid, typ: 'JWT' }), cuerpo = b64(datos);
  const firma = alg === 'none' ? '' : sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), clave).toString('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}
const datos = (cambios = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENTE, sub: '1098765432', email: 'Martin@Gmail.com', email_verified: true,
  name: 'Martín', picture: 'https://foto', iat: AHORA / 1000 - 10, exp: AHORA / 1000 + 3600, ...cambios,
});

function armar() {
  let bajadas = 0;
  const verificar = crearVerificadorGoogle({
    clientId: CLIENTE, reloj: () => AHORA,
    traerClaves: async () => { bajadas++; return { claves: [jwk], vigenciaMs: 3600_000 }; },
  });
  return { verificar, bajadas: () => bajadas };
}

test('una constancia firmada por Google para esta aplicación: quién es, y nada más', async () => {
  const { verificar, bajadas } = armar();
  assert.deepEqual(await verificar(firmar(datos())), { sub: '1098765432', correo: 'martin@gmail.com', nombre: 'Martín' });
  await verificar(firmar(datos()));
  assert.equal(bajadas(), 1);                                // las claves se guardan el tiempo que dice Google
  assert.equal((await verificar(firmar(datos({ aud: [CLIENTE, 'otra'] })))).sub, '1098765432');
  assert.equal((await verificar(firmar(datos({ iss: 'accounts.google.com', email_verified: 'true' })))).sub, '1098765432');
});

test('lo que no se acepta', async () => {
  const { verificar, bajadas } = armar();
  const rechaza = (token, motivo) => assert.rejects(verificar(token), motivo);
  await rechaza(firmar(datos({ aud: 'otra-app.apps.googleusercontent.com' })), /otra aplicación/);
  await rechaza(firmar(datos({ iss: 'https://evil.example' })), /no la emitió Google/);
  await rechaza(firmar(datos({ exp: AHORA / 1000 - 120 })), /venció/);
  await rechaza(firmar(datos({ iat: AHORA / 1000 + 600 })), /del futuro/);
  await rechaza(firmar(datos({ email_verified: false })), /no confirmó ese correo/);
  await rechaza(firmar(datos({ sub: '' })), /quién es/);
  await rechaza(firmar(datos(), { clave: otro.privateKey }), /no es de Google/);   // firmado con otra clave
  await rechaza(firmar(datos(), { alg: 'none' }), /no está firmada como firma Google/);
  await rechaza(firmar(datos(), { alg: 'HS256' }), /no está firmada como firma Google/);
  // Cambiar el contenido después de firmar rompe la firma.
  const [c, , f] = firmar(datos()).split('.');
  await rechaza(`${c}.${b64(datos({ sub: 'otro' }))}.${f}`, /no es de Google/);
  await rechaza('basura', /mal formada/);
  await rechaza(undefined, /mal formada/);
  // Una clave que Google no publica: se vuelve a buscar, pero no a cada pedido.
  await rechaza(firmar(datos(), { kid: 'clave-rara' }), /no publica/);
  await rechaza(firmar(datos(), { kid: 'clave-rara' }), /no publica/);
  assert.ok(bajadas() <= 2, `bajó las claves ${bajadas()} veces`);
});
