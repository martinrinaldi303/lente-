// extractores.js — la lista de fuentes. Es el equivalente de la capa vectorial de
// MIIA (class10, class18): cada extractor convierte la imagen en un vector de SU
// dimensión, y cada dimensión tiene SUS redes. La clave es «fuente|dim», igual
// que en class23 y class24.
//
// Agregar un extractor es sumar una entrada acá: nada de lo que ya está entrenado
// se toca.
//
// `extraer` puede devolver el vector o una promesa del vector: los propios son
// una cuenta y contestan en el momento; el de la red ya entrenada no. Quien los
// usa tiene que esperar con `await` en los dos casos.

import * as v0 from './rasgos.js';
import * as v1 from './rasgos_v1.js';
import { crearExtractorDino } from './rasgos_dino.js';

// Los hechos a mano. Siempre están: no dependen de ningún archivo bajado.
export const EXTRACTORES = {
  [v0.FUENTE]: { fuente: v0.FUENTE, dim: v0.DIM, extraer: v0.extraerRasgos },
  [v1.FUENTE]: { fuente: v1.FUENTE, dim: v1.DIM, extraer: v1.extraerRasgos },
};

// Los propios más los que dependen de un modelo bajado, si están.
export async function extractoresDisponibles() {
  const lista = Object.values(EXTRACTORES);
  const dino = await crearExtractorDino();
  if (dino) lista.push(dino);
  return lista;
}

export function extractor(fuente) {
  const e = EXTRACTORES[fuente];
  if (!e) throw new Error(`extractor desconocido: ${fuente} (hay: ${Object.keys(EXTRACTORES).join(', ')})`);
  return e;
}
