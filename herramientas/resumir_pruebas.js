// resumir_pruebas.js — cuánto acierta la pantalla con la cámara real.
//
//   npm run pruebas-reales
//
// Lee estado/pruebas_reales.jsonl, donde el cerebro anota cada «Acertó» o «Se
// equivocó» que se aprieta en el emulador (src/sesion.js, _evaluar), y cuenta:
// acierto total con su margen, por clase, y las confusiones más repetidas.
//
// ⚠️ Lo que mide es lo que VOS probaste: si sólo le mostrás tazas, dice cuánto
// acierta con tazas. Para comparar con las mediciones de PLAN.md, mostrale de todo.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ARCHIVO = join(RAIZ, 'estado', 'pruebas_reales.jsonl');

// Margen al 95 % de una proporción (Wilson): con pocas pruebas, el número solo engaña.
export function margenWilson(aciertos, n, z = 1.96) {
  if (!n) return { desde: 0, hasta: 0 };
  const p = aciertos / n, d = 1 + z * z / n;
  const centro = (p + z * z / (2 * n)) / d, ancho = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { desde: Math.max(0, centro - ancho), hasta: Math.min(1, centro + ancho) };
}

export function resumir(filas) {
  const n = filas.length, aciertos = filas.filter(f => f.acierto).length;
  const porClase = new Map(), confusiones = new Map();
  for (const f of filas) {
    const clase = f.real ?? '(sin decir)';
    const c = porClase.get(clase) ?? { n: 0, aciertos: 0 };
    c.n++; if (f.acierto) c.aciertos++;
    porClase.set(clase, c);
    if (!f.acierto) {
      const clave = `${f.real ?? '?'} → ${f.mostrado ?? 'nada'}`;
      confusiones.set(clave, (confusiones.get(clave) ?? 0) + 1);
    }
  }
  return {
    n, aciertos, acierto: n ? aciertos / n : 0, margen: margenWilson(aciertos, n),
    porClase: [...porClase].map(([clase, c]) => ({ clase, ...c })).sort((a, b) => b.n - a.n),
    confusiones: [...confusiones].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(ARCHIVO)) {
    console.log('Todavía no hay pruebas: en el emulador, apretá «Acertó» o «Se equivocó» mientras mirás objetos.');
    process.exit(0);
  }
  const filas = readFileSync(ARCHIVO, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const r = resumir(filas);
  const pc = (x) => `${(x * 100).toFixed(1)} %`;
  console.log(`Pruebas reales: ${r.n}. Acierta ${r.aciertos} (${pc(r.acierto)}; al 95 %, entre ${pc(r.margen.desde)} y ${pc(r.margen.hasta)}).`);
  console.log('\nPor clase (lo que era de verdad):');
  for (const c of r.porClase) console.log(`  ${c.clase.padEnd(18)} ${c.aciertos}/${c.n}`);
  if (r.confusiones.length) {
    console.log('\nConfusiones más repetidas (era → dijo):');
    for (const [clave, veces] of r.confusiones) console.log(`  ${clave}: ${veces}`);
  }
}
