// medir_propias.js — cuánto acierta con fotos de TU cámara, que es lo que importa.
//
//   npm run medir-propias
//
// Usa sólo las fotos propias de PRUEBA (src/muestras.js: una de cada tres, siempre las
// mismas), que nunca entran al entrenamiento. Para cada una hace lo que haría la
// pantalla con lo que estaba en la mirada: la red general, el «no lo conozco» de
// parecido.js y la tercera opinión de CLIP. Cuenta:
//   bien     → nombró lo que era (o, si era algo que la red no tiene, no lo nombró)
//   mal      → nombró otra cosa
//   se calló → era algo que la red tiene y no lo nombró
// Con el margen al 95 % (Wilson): con 30 fotos, ±15 puntos; con 300, ±5.

import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarVocabulario, crearClip } from '../src/clip.js';
import { Conjunto, votantes } from '../src/conjunto.js';
import { extractoresDisponibles } from '../src/extractores.js';
import { regionCompleta } from '../src/imagen.js';
import { Muestras } from '../src/muestras.js';
import { Ejemplos } from '../src/parecido.js';
import { CLIP_VETO_OTRO, CLIP_VETO_RED, CONFIANZA_GENERAL } from '../src/sesion.js';
import { VOCABULARIO } from '../src/vocabulario_clip.js';
import { margenWilson } from './resumir_pruebas.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fotos = new Muestras().listar().filter(m => m.prueba && !m.noEs);
  if (!fotos.length) {
    console.log('Todavía no hay fotos propias de prueba. Se juntan solas con «✓ Acertó» y «✗ Se equivocó» en Visión:');
    console.log('una de cada tres queda para medir. Con unas 30 ya se puede leer algo; con 300, bastante.');
    process.exit(0);
  }
  const extractores = await extractoresDisponibles();
  const dino = extractores.find(e => e.fuente === 'dino_s');
  const conjunto = Conjunto.cargar(join(RAIZ, 'estado'), { extractores: votantes(extractores) });
  const ejemplos = Ejemplos.cargar(join(RAIZ, 'datos', 'rasgos'));
  const clip = await crearClip();
  const vocabulario = clip ? await cargarVocabulario(clip, VOCABULARIO, join(RAIZ, 'estado', 'vocabulario_clip.json')) : null;

  const porClase = new Map();
  let bien = 0, mal = 0, callo = 0;
  for (const f of fotos) {
    let img;
    try { img = jpeg.decode(readFileSync(f.ruta), { useTArray: true }); } catch { continue; }
    const region = regionCompleta(img);
    const v = dino ? await dino.extraer(img, region) : null;
    const red = await conjunto.predecir(img, region, v ? { dino_s: v } : {});
    let dijo = red.confianza >= CONFIANZA_GENERAL && red.nombre !== 'nada' ? red.nombre : null;
    if (dijo && ejemplos && v && !ejemplos.conoce(v, dijo)) dijo = null;
    if (dijo && clip) {
      const r = vocabulario.ranking(await clip.imagen(img, region), 500);
      if (r[0].es !== dijo && r[0].clase !== dijo && r[0].p >= CLIP_VETO_OTRO && vocabulario.probabilidadDe(r, dijo) < CLIP_VETO_RED) dijo = null;
    }
    const conocida = conjunto.clases.includes(f.clase) && f.clase !== 'nada';
    const c = porClase.get(f.clase) ?? { bien: 0, mal: 0, callo: 0, confusiones: new Map() };
    if (conocida ? dijo === f.clase : dijo === null) { bien++; c.bien++; }
    else if (dijo === null) { callo++; c.callo++; }
    else { mal++; c.mal++; c.confusiones.set(dijo, (c.confusiones.get(dijo) ?? 0) + 1); }
    porClase.set(f.clase, c);
  }
  const n = bien + mal + callo, { desde: lo, hasta: hi } = margenWilson(bien, n);
  console.log(`${n} fotos propias de prueba, ${porClase.size} clases:`);
  console.log(`  bien ${bien} (${(100 * bien / n).toFixed(0)} %, entre ${(100 * lo).toFixed(0)} y ${(100 * hi).toFixed(0)} %) · mal ${mal} · se calló ${callo}\n`);
  for (const [clase, c] of [...porClase].sort((a, b) => (b[1].mal + b[1].callo) - (a[1].mal + a[1].callo))) {
    const conf = [...c.confusiones].sort((a, b) => b[1] - a[1]).map(([k, m]) => `${k} ×${m}`).join(', ');
    console.log(`  ${clase.padEnd(20)} bien ${c.bien}, mal ${c.mal}, se calló ${c.callo}${conf ? `   (dijo: ${conf})` : ''}`);
  }
}
