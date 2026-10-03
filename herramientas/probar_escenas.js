// probar_escenas.js — le muestra al cerebro ESCENAS enteras de COCO, por el WebSocket
// de verdad, y cuenta qué pone en la pantalla.
//
//   node herramientas/probar_escenas.js [clase de COCO] [cuántas]      (con «npm start» corriendo)
//
// Es la prueba que le faltaba a probar_en_vivo.js: ahí el objeto está solo y llena
// el recuadro. Acá son fotos de la calle o de una casa, con el objeto donde cayó:
// en una mano, al costado, lejos. Se eligen fotos donde la clase pedida es de 64 px
// o más. Se cuenta si el HUD la nombra, si nombra otra cosa o si se calla.
//
// ⚠️ Que el HUD nombre OTRA cosa no siempre es un error: en una foto con una persona
// y un celular chico al costado, «persona» es una respuesta razonable.

import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { BIN_JPEG } from '../src/protocolo.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const NOMBRE = { 'cell phone': 'celular', car: 'auto', motorcycle: 'moto', bus: 'colectivo', truck: 'camion', bicycle: 'bicicleta',
                 laptop: 'notebook', tv: 'pantalla', person: 'persona', keyboard: 'teclado', cup: 'taza', bottle: 'botella' };

const clase = process.argv[2] ?? 'cell phone', cuantas = Number(process.argv[3] ?? 30);
const esperado = NOMBRE[clase];
if (!esperado) { console.error(`clases: ${Object.keys(NOMBRE).join(', ')}`); process.exit(2); }

const dirCoco = join(RAIZ, 'datos', 'coco');
const a = JSON.parse(readFileSync(join(dirCoco, 'annotations', 'instances_val2017.json'), 'utf8'));
const id = a.categories.find(c => c.name === clase).id;
const archivoDe = new Map(a.images.map(i => [i.id, i.file_name]));
const fotos = [...new Set(a.annotations.filter(an => an.category_id === id && !an.iscrowd && an.bbox[2] >= 64 && an.bbox[3] >= 64).map(an => an.image_id))].slice(0, cuantas);

const ws = new WebSocket(process.env.CEREBRO ?? 'ws://127.0.0.1:8787/ws/gafas');
let hud = {}, cajas = { lista: [] };
ws.on('message', (d, binario) => { if (!binario) { const m = JSON.parse(d); if (m.t === 'hud') hud = m; if (m.t === 'cajas') cajas = m; } });
await new Promise((ok, mal) => { ws.on('open', ok); ws.on('error', () => mal(new Error('no hay cerebro: ¿corre «npm start»?'))); });
const espera = (ms) => new Promise(r => setTimeout(r, ms));
// Un cuadro gris liso de 640×480: entre escena y escena, para que no arrastre los votos de la anterior.
const GRIS = jpeg.encode({ width: 640, height: 480, data: new Uint8Array(640 * 480 * 4).fill(128) }, 80).data;

let bien = 0, otra = 0, callo = 0, loVio = 0, n = 0, conMedida = 0, conRecuadro = 0;
const otras = new Map();
for (const idImagen of fotos) {
  const jpg = readFileSync(join(dirCoco, 'val2017', archivoDe.get(idImagen)));
  if (jpg.length > 300 * 1024) continue;
  n++;
  for (let i = 0; i < 5; i++) { ws.send(Buffer.concat([Buffer.from([BIN_JPEG]), jpg])); await espera(330); }
  await espera(350);
  const m = (hud.pie || '').match(/^(?:creo: |~)(.+) \d+%$/);
  const dijo = m ? m[1] : null;
  if (cajas.lista.some(c => c.nombre === esperado)) loVio++;
  if (cajas.mirado) conRecuadro++;
  if (dijo === esperado) { bien++; if ((hud.lineas ?? []).some(l => l.startsWith('A ≈'))) conMedida++; }
  else if (dijo === null) callo++;
  else { otra++; otras.set(dijo, (otras.get(dijo) ?? 0) + 1); }
  // Entre foto y foto, cinco cuadros grises: que no arrastre los votos de la anterior.
  for (let i = 0; i < 5; i++) { ws.send(Buffer.concat([Buffer.from([BIN_JPEG]), GRIS])); await espera(330); }
}
ws.close();
console.log(`${esperado}: en ${n} escenas, el detector lo marcó en ${loVio}.`);
console.log(`  El HUD dijo «${esperado}» en ${bien}, otra cosa en ${otra}, y se calló en ${callo}.`);
if (otra) console.log('  Otra cosa: ' + [...otras].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} (${v})`).join(', '));
if (conMedida) console.log(`  Con distancia en pantalla: ${conMedida}.`);
console.log(`  Con un recuadro dibujado (nunca más de uno): ${conRecuadro}.`);
