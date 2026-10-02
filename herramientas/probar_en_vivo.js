// probar_en_vivo.js — le muestra al cerebro, por el WebSocket de verdad, fotos de
// prueba ubicadas DENTRO del recuadro, como las pondría alguien frente a la cámara.
//
//   node herramientas/probar_en_vivo.js            (con «npm start» corriendo)
//
// Por qué existe: hay dos maneras de equivocarse al medir lo que pasa en vivo.
//   · Mandar la foto de prueba tal cual: el cerebro mira sólo el recuadro del
//     centro y le corta el objeto. Mide de menos.
//   · Medir sobre los .bin de prueba: ahí la foto entra entera. Mide de más.
// Acá cada foto se achica hasta entrar en el recuadro y se pega en un cuadro gris
// de 640×480: el objeto llena el recuadro, que es lo que hay que hacer al usarlo.
//
// ⚠️ Sigue sin ser la cámara: el fondo es gris liso y la luz es la de la foto.

import jpeg from 'jpeg-js';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { aTamano, regionCentral, regionCompleta } from '../src/imagen.js';
import { BIN_JPEG } from '../src/protocolo.js';
import { vaAPrueba } from './exportar_rasgos.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ANCHO = 640, ALTO = 480, GRIS = 128;
const CUADROS_POR_FOTO = 5, MS_ENTRE_CUADROS = 170;

// La foto, entera y sin deformar, dentro del recuadro de un cuadro gris.
export function cuadroConLaFotoEnElRecuadro(jpegFoto) {
  const foto = jpeg.decode(jpegFoto, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 });
  const data = new Uint8Array(ANCHO * ALTO * 4).fill(GRIS);
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const caja = regionCentral({ width: ANCHO, height: ALTO });
  const escala = Math.min(caja.ancho / foto.width, caja.alto / foto.height);
  const w = Math.max(1, Math.round(foto.width * escala)), h = Math.max(1, Math.round(foto.height * escala));
  // aTamano devuelve un cuadrado: se pide del lado mayor y se toma lo que hace falta.
  const lado = Math.max(w, h);
  const rgb = aTamano(foto, regionCompleta(foto), lado);
  const x0 = caja.x0 + Math.floor((caja.ancho - w) / 2), y0 = caja.y0 + Math.floor((caja.alto - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (Math.min(lado - 1, Math.floor(y * lado / h)) * lado + Math.min(lado - 1, Math.floor(x * lado / w))) * 3;
    const d = ((y0 + y) * ANCHO + x0 + x) * 4;
    for (let c = 0; c < 3; c++) data[d + c] = Math.round(rgb[o + c] * 255);
  }
  return jpeg.encode({ width: ANCHO, height: ALTO, data }, 85).data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2] ?? 'ws://127.0.0.1:8787/ws/gafas';
  const porCarpeta = Number(process.argv[3] ?? 6);
  const base = join(RAIZ, 'datos', '256_ObjectCategories');
  const categorias = JSON.parse(readFileSync(join(RAIZ, 'herramientas', 'categorias.json'), 'utf8'));

  const ws = new WebSocket(url);
  let pie = '';
  ws.on('message', (d, binario) => { if (!binario) { const m = JSON.parse(d); if (m.t === 'hud') pie = m.pie; } });
  await new Promise((ok, mal) => { ws.on('open', ok); ws.on('error', () => mal(new Error(`no hay cerebro en ${url}: ¿corre «npm start»?`))); });
  const espera = (ms) => new Promise(r => setTimeout(r, ms));

  const porClase = new Map();
  for (const [carpeta, clase] of Object.entries(categorias)) {
    const fotos = readdirSync(join(base, carpeta)).filter(a => /\.jpe?g$/i.test(a)).sort().slice(0, 200)
      .filter(a => vaAPrueba(`${carpeta}/${a}`)).slice(0, porCarpeta);
    for (const a of fotos) {
      let cuadro;
      try { cuadro = cuadroConLaFotoEnElRecuadro(readFileSync(join(base, carpeta, a))); } catch { continue; }
      for (let i = 0; i < CUADROS_POR_FOTO; i++) { ws.send(Buffer.concat([Buffer.from([BIN_JPEG]), cuadro])); await espera(MS_ENTRE_CUADROS); }
      await espera(220);
      const m = pie.match(/^(?:creo: |~)(.+) \d+%$/);
      const dijo = m ? m[1] : null;
      const c = porClase.get(clase) ?? { n: 0, bien: 0, callo: 0, mal: [] };
      c.n++;
      const esperado = clase === 'nada' ? null : clase;
      if (dijo === esperado) c.bien++; else if (dijo === null) c.callo++; else c.mal.push(dijo);
      porClase.set(clase, c);
    }
  }
  ws.close();

  let n = 0, bien = 0, callo = 0;
  console.log('clase             bien  calló  se equivocó');
  for (const [clase, c] of porClase) {
    n += c.n; bien += c.bien; callo += c.callo;
    console.log(`${clase.padEnd(16)} ${String(c.bien).padStart(2)}/${String(c.n).padEnd(3)} ${String(c.callo).padStart(4)}   ${c.mal.join(', ')}`);
  }
  const mal = n - bien - callo;
  console.log(`\nEN TOTAL: ${bien} de ${n} bien (${(100 * bien / n).toFixed(0)}%), calló en ${callo}, se equivocó en ${mal}.`);
  console.log(`Cuando opinó, acertó ${(100 * (bien - (porClase.get('nada')?.bien ?? 0)) / Math.max(1, n - callo - (porClase.get('nada')?.bien ?? 0))).toFixed(0)}% de las veces.`);
}
