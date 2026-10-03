// conjunto.js — varios extractores a la vez, cada uno con sus redes, votando.
//
// Es la capa 2 de class25A: un voto por módulo. Acá un «módulo» es un extractor
// con su par de redes (class23 + class24). Sumar un extractor nuevo —propio o una
// red convolucional ya entrenada— es sumar un votante; los demás no se tocan.
//
// El peso de cada votante sale de su acierto de VALIDACIÓN (ver pesoDe), medido por
// el entrenador sobre fotos que no usó para entrenar. No el de la prueba: elegir
// los pesos mirando la prueba sería hacer trampa con el número final.
//
// ⚠️ Lo que esto no arregla: dos votantes que se equivocan en las mismas fotos no
// suman nada. El voto sirve cuando los extractores miran cosas DISTINTAS.

import { join } from 'node:path';
import { EXTRACTORES } from './extractores.js';
import { regionCentral } from './imagen.js';
import { FUENTE as DINO } from './rasgos_dino.js';
import { RedGeneral } from './red_general.js';

// Qué extractores votan en vivo. Medido el 2-oct-2026 (estado/medicion_conjunto.json,
// 67 clases, 1.948 fotos de prueba): DINOv2 solo acierta 91,2 % ± 1,3 y los tres
// votando, 91,3 % ± 1,3. Es lo mismo. Los dos hechos a mano no suman y cuestan dos
// extracciones más por cuadro y por cada recorte dudoso. Con DINOv2 vota sólo él;
// sin el modelo bajado votan los hechos a mano, que quedan de respaldo.
// `todos` (VOTANTES=todos en .env) vuelve al voto de los tres, para comparar.
export function votantes(extractores, { todos = false } = {}) {
  const dino = extractores.find(e => e.fuente === DINO);
  return todos || !dino ? extractores : [dino];
}

export function archivoDeRed(dir, e) {
  return join(dir, `red_general_${e.fuente}_${e.dim}.json`);
}

export class Conjunto {
  // `miembros` es [{ extractor, red, peso }]. Todas las redes con las mismas clases.
  constructor(miembros) {
    if (!miembros.length) throw new Error('un conjunto necesita al menos un miembro');
    const clases = JSON.stringify(miembros[0].red.clases);
    if (miembros.some(m => JSON.stringify(m.red.clases) !== clases))
      throw new Error('las redes del conjunto no se entrenaron con las mismas clases');
    this.miembros = miembros;
    this.clases = miembros[0].red.clases;
  }

  // Carga las redes que haya en `dir` para esos extractores. null si no hay ninguna
  // entrenada. Un extractor sin red entrenada, o una red sin su extractor, no entra.
  static cargar(dir, { parejo = false, extractores = Object.values(EXTRACTORES) } = {}) {
    const miembros = [];
    for (const e of extractores) {
      const red = RedGeneral.cargar(archivoDeRed(dir, e), e.dim, e.fuente);
      if (red) miembros.push({ extractor: e, red, peso: parejo ? 1 : pesoDe(red) });
    }
    return miembros.length ? new Conjunto(miembros) : null;
  }

  // `vectores` va en el mismo orden que `miembros`: uno por extractor.
  votar(vectores) {
    const voto = new Float64Array(this.clases.length);
    let total = 0;
    this.miembros.forEach((m, k) => {
      const p = m.red.probabilidades(vectores[k]);
      if (!p) return;
      for (let c = 0; c < voto.length; c++) voto[c] += m.peso * p[c];
      total += m.peso;
    });
    if (!total) return null;
    let mejor = 0;
    for (let c = 0; c < voto.length; c++) { voto[c] /= total; if (voto[c] > voto[mejor]) mejor = c; }
    return { indice: mejor, nombre: this.clases[mejor], confianza: voto[mejor] };
  }

  // En vivo: la imagen de la cámara, mirando el recuadro del centro. `yaCalculados`
  // evita sacar dos veces un vector que quien llama ya tiene ({ fuente: vector }).
  async predecir(img, region = regionCentral(img), yaCalculados = {}) {
    return this.votar(await Promise.all(this.miembros.map(m =>
      yaCalculados[m.extractor.fuente] ?? m.extractor.extraer(img, region))));
  }
}

// Cuánto pesa el voto de un extractor: su VENTAJA sobre el azar en validación, al cubo.
//
// La primera versión pesaba con el acierto a secas (0,34 · 0,38 · 0,92). Acertaba
// igual, pero los dos votantes flojos se llevaban el 44 % del voto y, como casi
// siempre dudan, aplastaban la confianza del conjunto contra 0,55: fotos que el
// votante bueno tenía clarísimas quedaban debajo del umbral y el HUD se callaba
// (medido el 2-oct-2026: notebook y reproductor mp3 no aparecían).
//
// Al cubo, un votante que apenas le gana al azar casi no cuenta y uno bueno manda,
// sin dejar a nadie en cero: los flojos siguen desempatando.
const EXPONENTE = 3;

export function pesoDe(red) {
  const v = red.medicion?.validacion_por_red;
  const valores = v ? Object.values(v) : [];
  if (!valores.length) return 1;
  const validacion = valores.reduce((a, b) => a + b, 0) / valores.length;
  return Math.max(1e-6, validacion - (red.medicion.azar ?? 0)) ** EXPONENTE;
}
