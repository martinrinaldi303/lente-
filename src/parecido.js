// parecido.js — ¿lo que veo se parece a lo que sé de esa clase?
//
// La red general y el detector eligen SIEMPRE una de sus clases: no tienen la opción
// «ninguna». Con algo que nunca vieron dicen la clase más cercana, y muchas veces muy
// seguros: una lata de desodorante salió «celular 93 %» y un marcador naranja
// «zanahoria» (Martín, 3-oct-2026). La confianza de la red no sirve para darse cuenta:
// es cuánto le gana esa clase a las OTRAS, no cuánto se parece a la clase.
//
// Esto sí: el vector de DINOv2 de lo que se ve, contra los ejemplos de verdad de la
// clase que se dijo (los de entrenamiento de la red general, y los recortes de COCO de
// cada clase del detector, herramientas/ejemplos_del_detector.js). El parecido es el
// promedio del coseno con los 5 ejemplos más parecidos. Si no llega al umbral, lo que
// se ve no es eso: es algo que no se conoce.
//
// Medido el 3-oct-2026 con la red de 129 clases (ver PLAN.md, «No sé qué es»), con
// fotos que ni la red ni los ejemplos vieron: las 4.998 de prueba de la red, y 2.115
// de 141 categorías de Caltech-256 que la red no tiene (armónica, yo-yo, dados…).
//
//   la red, segura (≥ 0,9), sin chequeo:  nombra el 85,8 % de las conocidas (acierta 95,8 %)
//                                         y le inventa nombre al 15,1 % de las desconocidas
//   + parecido ≥ 0,5:                      nombra el 81,2 % (acierta 96,4 %); inventa en el 5,9 %
//
// Los recortes del detector son más sucios (fondo, tapados, borrosos): con 0,5 se
// rechazaba el 24 % de los recortes de COCO de su propia clase; con 0,4, el 11 %. Por
// eso el detector tiene su umbral. La lata de desodorante que salía «celular» se parece
// 0,25 a los celulares.
//
// Sin datos/ en la PC (no se suben al repo) no hay ejemplos y no se rechaza nada.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerRasgos } from './formato_rasgos.js';

export const UMBRAL_CONOCIDO = 0.5;   // lo que dice la red general del centro de la mirada
export const UMBRAL_DETECTOR = 0.4;   // un recuadro del detector
const VECINOS = 5;

function normalizado(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const u = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) u[i] = v[i] / n;
  return u;
}

export class Ejemplos {
  // `porClase`: Map nombre → lista de vectores. Todos de la misma dimensión.
  constructor(porClase, { fuente = 'dino_s', dim } = {}) {
    this.fuente = fuente;
    this.dim = dim ?? [...porClase.values()][0]?.[0]?.length ?? 0;
    this.porClase = new Map();
    for (const [clase, lista] of porClase) {
      const plano = new Float32Array(lista.length * this.dim);
      lista.forEach((v, k) => plano.set(normalizado(v), k * this.dim));
      this.porClase.set(clase, { n: lista.length, plano });
    }
  }

  get total() { return [...this.porClase.values()].reduce((s, c) => s + c.n, 0); }
  tiene(clase) { return this.porClase.has(clase); }

  // Promedio del coseno con los VECINOS ejemplos más parecidos. null si no hay ejemplos.
  parecido(vector, clase) {
    const c = this.porClase.get(clase);
    if (!c || vector.length !== this.dim) return null;
    const u = normalizado(vector), mejores = new Array(Math.min(VECINOS, c.n)).fill(-1);
    for (let k = 0; k < c.n; k++) {
      let s = 0;
      const base = k * this.dim;
      for (let i = 0; i < this.dim; i++) s += u[i] * c.plano[base + i];
      if (s <= mejores[mejores.length - 1]) continue;
      let j = mejores.length - 1;
      while (j > 0 && mejores[j - 1] < s) { mejores[j] = mejores[j - 1]; j--; }
      mejores[j] = s;
    }
    return mejores.reduce((a, b) => a + b, 0) / mejores.length;
  }

  // ¿Se parece lo suficiente? Sin ejemplos de la clase no se puede saber: se acepta.
  conoce(vector, clase, umbral = UMBRAL_CONOCIDO) {
    const p = this.parecido(vector, clase);
    return p === null || p >= umbral;
  }

  // Los ejemplos de entrenamiento de la red general (una fila por foto, sin el espejo)
  // y los del detector. null si no hay ninguno.
  static cargar(dirRasgos, { fuente = 'dino_s' } = {}) {
    const porClase = new Map();
    let dim;
    const sumar = (archivo, filasPorFoto = 1) => {
      if (!existsSync(archivo)) return;
      const r = leerRasgos(archivo);
      if (r.fuente !== fuente) return;
      dim = r.dim;
      for (let k = 0; k < r.filas.length; k += filasPorFoto) {
        const clase = r.clases[r.filas[k].etiqueta];
        (porClase.get(clase) ?? porClase.set(clase, []).get(clase)).push(r.filas[k].vector);
      }
    };
    let filasPorFoto = 1;
    try { filasPorFoto = JSON.parse(readFileSync(join(dirRasgos, 'exportacion.json'), 'utf8')).filasPorFoto ?? 1; } catch { /* sin exportación */ }
    sumar(join(dirRasgos, fuente, 'entrenamiento.bin'), filasPorFoto);
    sumar(join(dirRasgos, 'ejemplos_detector', 'entrenamiento.bin'));
    return porClase.size ? new Ejemplos(porClase, { fuente, dim }) : null;
  }
}
