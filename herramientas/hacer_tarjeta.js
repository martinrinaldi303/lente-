// hacer_tarjeta.js — arma el código QR con TU tarjeta, para mostrárselo a otras gafas.
//
//   npm run tarjeta -- "Martín Rinaldi" --org "MIIA" --cargo "Backend" --url https://github.com/usuario --nota "Mendoza"
//
// Deja un PNG en tarjetas/. En la tarjeta va lo que vos pongas y nada más: es la
// forma de decir quién sos sin que nadie lo tenga que averiguar.
//
// También arma el cartel de un LUGAR, para pegar en la pared (ver src/memoria.js):
//
//   npm run tarjeta -- --lugar cocina

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

const escapar = (s) => String(s).replace(/([\\,;])/g, '\\$1');

// El texto vCard 3.0 que entienden los teléfonos y src/qr.js.
export function vcard({ nombre, org, cargo, urls = [], nota }) {
  return [
    'BEGIN:VCARD', 'VERSION:3.0', `FN:${escapar(nombre)}`,
    org && `ORG:${escapar(org)}`, cargo && `TITLE:${escapar(cargo)}`,
    ...urls.map(u => `URL:${u}`), nota && `NOTE:${escapar(nota)}`,
    'END:VCARD',
  ].filter(Boolean).join('\n');
}

// El texto del cartel de un lugar, el que entiende lugarDeQr().
export const cartelDeLugar = (lugar) => `LUGAR:${String(lugar).replace(/\s+/g, ' ').trim()}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const uno = (clave) => { const i = args.indexOf(clave); return i >= 0 ? args[i + 1] : undefined; };
  const lugar = uno('--lugar');
  const nombre = lugar ? `lugar ${lugar}` : args[0] && !args[0].startsWith('--') ? args[0] : null;
  if (!nombre) { console.error('uso: npm run tarjeta -- "Tu nombre" [--org X] [--cargo X] [--url https://…]… [--nota X]\n     npm run tarjeta -- --lugar cocina'); process.exit(2); }
  const urls = args.flatMap((a, i) => a === '--url' && args[i + 1] ? [args[i + 1]] : []);
  const texto = lugar ? cartelDeLugar(lugar) : vcard({ nombre, org: uno('--org'), cargo: uno('--cargo'), urls, nota: uno('--nota') });
  const dir = join(RAIZ, 'tarjetas');
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, nombre.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '_').replace(/^_|_$/g, '') + '.png');
  await QRCode.toFile(archivo, texto, { errorCorrectionLevel: 'M', margin: 4, scale: 10 });
  console.log(`✅ ${archivo}`);
  console.log(texto);
}
