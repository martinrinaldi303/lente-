# lente-

Gafas de realidad aumentada caseras (opción A: XIAO ESP32-S3 Sense + OLED de 128×64).
Este repo es el **cerebro** y un **emulador** que corre en el navegador: todavía no hay
hardware. El detalle, las mediciones y lo que falta están en [`PLAN.md`](PLAN.md).
Si algo de acá no coincide con el código, **gana el código**.

## Qué hace hoy

- **Reconoce objetos** con la cámara: 67 clases (casa, taller, electrónica, vehículos,
  «persona»). Tres extractores votan —dos hechos a mano y DINOv2-small— y encima de cada
  uno deciden `class23` y `class24`, portadas de MIIA a C++. Medido el 2-oct-2026 sobre
  1.948 fotos que no vio: **91,3 % ± 1,3** (azar: 5,9 %).
- **Aprende objetos tuyos** con 12 cuadros («Enseñar») y los guarda en MySQL.
- **Muestra en el HUD** datos y partes del aparato reconocido, y su color.
- **Lee tarjetas en código QR** que una persona muestra.
- **Guía paso a paso** para armar o desarmar, y **voz** con Gemini Live (pide clave).

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
| Caltech-256 (1,2 GB) y COCO val2017 (1 GB) | `datos/` | Sólo para reentrenar. Ver `PLAN.md` |
| El entrenador compilado | `cpp/entrenar.exe` | `npm run compilar` (g++ de MSYS2) |
| La base `gafas` | MySQL de XAMPP | La crea sola al arrancar si hay usuario; el esquema está en `docs/esquema_gafas.sql`. Es opcional |
| Lo que le enseñaste | `estado/red_dino_s_384.json` y la base | Es tuyo: no se sube |

Las redes generales ya entrenadas (`estado/red_general_*.json`) **sí** están en el repo,
para no tener que bajar 2 GB y reentrenar. Se regeneran con `npm run entrenar`.

## Carpetas

| Carpeta | Qué hay |
|---|---|
| `servidor.js` | El cerebro: sirve el emulador y atiende a las gafas por WebSocket |
| `src/` | Extractores, redes, HUD, sesión, voz, QR, base de datos, mediciones |
| `publico/` | El emulador de gafas (cámara, micrófono, parlante y el OLED dibujado) |
| `cpp/` | `class23` y `class24` en C++ y el entrenador que mide contra el azar |
| `herramientas/` | Exportar rasgos, recortar COCO, entrenar, probar en vivo, hacer tarjetas QR |
| `pruebas/` | Pruebas en frío: no necesitan el servidor |
| `docs/` | El Word con la documentación, los planos de las gafas y el esquema de la base |
