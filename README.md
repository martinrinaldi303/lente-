# lente-

Gafas de realidad aumentada caseras (opción A: XIAO ESP32-S3 Sense + OLED de 128×64).
Este repo es el **cerebro**, un **emulador** que corre en el navegador y el **firmware**
de las gafas (compilado, sin probar: todavía no hay hardware). In English: [`README.en.md`](README.en.md). El detalle, las mediciones y lo que falta están en [`PLAN.md`](PLAN.md).
Si algo de acá no coincide con el código, **gana el código**.

## Qué hace hoy

- **Reconoce objetos** con la cámara: 67 clases (casa, taller, electrónica, vehículos,
  «persona»). DINOv2-small convierte la imagen en números y deciden `class23` y
  `class24`, portadas de MIIA a C++. Medido el 2-oct-2026 sobre 1.948 fotos que no vio:
  **91,2 % ± 1,3** (azar: 5,9 %). Sin DINOv2 bajado, votan dos extractores hechos a mano.
- **Aprende objetos tuyos** con 12 cuadros («Enseñar») y los guarda en MySQL.
- **Muestra en el HUD** datos y partes del aparato reconocido, y su color.
- **Lee tarjetas en código QR** que una persona muestra.
- **Guía paso a paso** para armar o desarmar, y **voz** con Gemini Live o DeepSeek (piden clave).
- **«¿Dónde dejé…?»**: recuerda cuándo y dónde vio cada objeto (nunca personas).
- **Avisa si un vehículo está por llegar**, con pitido o vibración. Es una ayuda, no reemplaza mirar.
- **Lee texto** (carteles, etiquetas, vencimientos) y lo traduce, con el LLM. No lee documentos personales.
- **Guías guardadas** que andan sin internet: primeros auxilios y hogar, y un importador
  de los manuales de iFixit (MyFixit, uso no comercial).
- **Mide objetos** con el sensor láser VL53L1X y estima su peso.
- **Pruebas reales**: «acertó / se equivocó» con la webcam, y `npm run pruebas-reales` da el acierto.

No identifica personas por la cara ni busca sus datos. Está trabado en el código a
propósito (`src/identificar.js`).

## Levantarlo

```bash
npm install
```

```bash
npm start
```

y abrir `http://127.0.0.1:8787`. Las pruebas en frío:

```bash
npm test
```

## Lo que NO está en el repo y hay que conseguir aparte

| Qué | Dónde va | Cómo se consigue |
|---|---|---|
| Claves y contraseña de la base | `.env` | Copiar `.env.example` y completar. **No se sube nunca** |
| DINOv2-small (24,5 MB) | `modelos/dinov2-small/model_quantized.onnx` | Repo `Xenova/dinov2-small` de Hugging Face. Sin él las gafas andan con los dos extractores propios |
| Caras: YuNet (232 KB, MIT) y SFace (38,7 MB, Apache 2.0) | `modelos/caras/face_detection_yunet_2023mar.onnx` y `modelos/caras/face_recognition_sface_2021dec.onnx` | Repos `opencv/face_detection_yunet` y `opencv/face_recognition_sface` de Hugging Face (OpenCV Zoo). Sin ellos no se reconoce a nadie: «Personas conocidas» queda apagado |
| Caltech-256 (1,2 GB) y COCO val2017 (1 GB) | `datos/` | Sólo para reentrenar. Ver `PLAN.md` |
| El entrenador compilado | `cpp/entrenar.exe` (`cpp/entrenar` en Linux) | `npm run compilar` (g++ de MSYS2 en Windows, el g++ del sistema en Linux) |
| La base `gafas` | MySQL de XAMPP | La crea sola al arrancar si hay usuario; el esquema está en `docs/esquema_gafas.sql`. Es opcional |
| Lo que le enseñaste | `estado/red_dino_s_384.json` y la base | Es tuyo: no se sube |
| Lo que recuerda y tus pruebas reales | `estado/memoria.json`, `estado/pruebas_reales.jsonl` | Se arman solos al usarlo |
| La configuración del firmware | `firmware/gafas_xiao/config.h` | Copiar `config.ejemplo.h` y completar |
| Manuales de iFixit | `guias/myfixit/` | `npm run importar-myfixit -- <archivo de MyFixit>` |

Las redes generales ya entrenadas (`estado/red_general_*.json`) **sí** están en el repo,
para no tener que bajar 2 GB y reentrenar. Se regeneran con `npm run entrenar`.

## Carpetas

| Carpeta | Qué hay |
|---|---|
| `servidor.js` | El cerebro: sirve el emulador y atiende a las gafas por WebSocket |
| `src/` | Extractores, redes, HUD, sesión, voz, QR, base de datos, mediciones |
| `publico/` | El emulador de gafas (cámara, micrófono, parlante y el OLED dibujado) |
| `cpp/` | `class23` y `class24` en C++ y el entrenador que mide contra el azar |
| `firmware/` | El programa del XIAO ESP32-S3 Sense: habla el mismo protocolo que el emulador |
| `guias/` | Guías paso a paso guardadas: primeros auxilios y hogar |
| `herramientas/` | Exportar rasgos, recortar COCO, entrenar, probar en vivo, hacer tarjetas QR |
| `pruebas/` | Pruebas en frío: no necesitan el servidor |
| `docs/` | El Word con la documentación, los planos, el esquema de la base y cómo correr el cerebro en una Raspberry Pi |
