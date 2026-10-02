// rasgos_dino.js — el tercer extractor: una red ya entrenada por otros.
//
// DINOv2-small (Meta, licencia Apache 2.0), en la conversión a ONNX del repo
// Xenova/dinov2-small de Hugging Face. 22 millones de pesos, entrenada sin
// etiquetas con 142 millones de imágenes. Bajada el 1-oct-2026 a
// modelos/dinov2-small/model_quantized.onnx (24,5 MB, sha256 3afdc8bc…a29d917).
//
// Corre ENTERA en esta máquina, con onnxruntime-node: no llama a ninguna API ni
// necesita internet. Tarda ~28 ms por imagen en el Ryzen 5 5600GT.
//
// Qué es propio y qué no, para no confundirse:
//   · NO es propio: este extractor. Convierte la imagen en 384 números.
//   · SÍ es propio: lo que decide. Esos 384 números van a class23 y class24,
//     entrenadas acá con las clases de acá, y votan con los otros dos extractores.
//
// Es la fuente `dino_s|384`. Si el modelo o la biblioteca no están, el extractor
// simplemente no aparece y las gafas siguen andando con los otros dos.
//
// ⚠️ No corre en el ESP32: es para el cerebro. rasgos_v0 y v1 sí podrían.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aTamano, regionCentral } from './imagen.js';

export const FUENTE = 'dino_s';
export const DIM    = 384;
export const RUTA_MODELO = join(dirname(dirname(fileURLToPath(import.meta.url))), 'modelos', 'dinov2-small', 'model_quantized.onnx');

const LADO  = 224;
// Los de preprocessor_config.json del modelo: los mismos con los que se entrenó.
const MEDIA = [0.485, 0.456, 0.406];
const DESVIO = [0.229, 0.224, 0.225];

// Devuelve el extractor, o null si falta el modelo o onnxruntime-node.
export async function crearExtractorDino(ruta = RUTA_MODELO) {
  if (!existsSync(ruta)) return null;
  let ort;
  try { ort = (await import('onnxruntime-node')).default; }
  catch { return null; }
  const sesion = await ort.InferenceSession.create(ruta);
  const entrada = sesion.inputNames[0], salida = sesion.outputNames[0];

  return {
    fuente: FUENTE,
    dim: DIM,
    async extraer(img, region = regionCentral(img)) {
      // La región se lleva a 224×224 sin recortar: lo que está en el recuadro es
      // lo que se quiere mirar, entero.
      const rgb = aTamano(img, region, LADO);
      const plano = new Float32Array(3 * LADO * LADO);          // canal, fila, columna
      for (let t = 0; t < LADO * LADO; t++)
        for (let c = 0; c < 3; c++) plano[c * LADO * LADO + t] = (rgb[t * 3 + c] - MEDIA[c]) / DESVIO[c];
      const r = await sesion.run({ [entrada]: new ort.Tensor('float32', plano, [1, 3, LADO, LADO]) });
      // La salida trae 257 vectores: el primero resume la imagen entera, los otros
      // 256 son un parche cada uno. Se usa el resumen.
      return Float32Array.from(r[salida].data.subarray(0, DIM));
    },
  };
}
