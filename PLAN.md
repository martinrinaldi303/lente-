# Gafas MIIA — opción A (armado propio)

Escrito el 1-oct-2026. Si algo de acá no coincide con el código, **gana el código**.

## Qué hay hoy

Un prototipo que corre en la PC, sin hardware. El navegador hace de gafas.

```bash
npm install
```

```bash
npm start
```

y abrir `http://127.0.0.1:8787`. Las pruebas en frío (no necesitan el servidor):

```bash
npm test
```

| Archivo | Qué hace |
|---|---|
| `servidor.js` | El cerebro. Sirve el emulador y atiende `/ws/gafas` |
| `src/protocolo.js` | Lo que viaja entre gafas y cerebro. Es el mismo para el emulador y el ESP32 |
| `src/sesion.js` | Un par de gafas conectado: cuadros, HUD, guía paso a paso, herramientas del LLM |
| `src/red_objetos.js` | La red propia, portada de `class24`: 168 → 64 (relu) → softmax |
| `src/rasgos.js` | De una imagen a un vector de 168 números (color + bordes), sin modelos bajados |
| `src/medir.js` | Dimensiones por distancia y peso estimado por volumen × densidad |
| `src/voz_live.js` | La voz con Gemini Live API (escucha y habla él) |
| `src/voz_deepseek.js` | La conversación con DeepSeek (por escrito; ver la novena pasada) |
| `src/hud.js` | Corta el texto a la medida del OLED: 21 columnas, 5 renglones |
| `src/cola_acotada.js` | Copiada de MIIA: se queda con el cuadro más nuevo |
| `publico/` | El emulador: micrófono, cámara, parlante y un OLED de 128×64 dibujado |

Para prender la voz: copiar `.env.example` a `.env` y poner una clave de DeepSeek
(`DEEPSEEK_API_KEY`) o una clave de Gemini
**nueva** (no la de MIIA: comparten cuota y la corrida sigue hasta el 12-oct).

### Probado y sin probar

- **Probado:** las 82 pruebas en frío (una usa la base MySQL real); el emulador contra el servidor real, enseñando
  y reconociendo tres objetos con cuadros sintéticos; el rechazo por token y por
  origen; que el servidor no arranque abierto a la red sin token; que las redes en
  C++ aprenden una base de juguete y que el cerebro predice lo mismo que el
  entrenador, imagen por imagen.
- **Sin probar:** la voz (no había clave), y el micrófono y la cámara reales del
  navegador: el panel de la app los bloquea, así que la vista de cámara se probó
  con una cámara de mentira (un lienzo). Con la Logi C270 lo tiene que probar Martín. El SDK instalado tiene los métodos que usa `voz_live.js`, pero no se
  hizo ninguna llamada real.

## Lista de compras

Precios aproximados en USD de afuera; en Argentina hay que sumar envío e impuestos.

| Pieza | Para qué | USD |
|---|---|---|
| Seeed XIAO ESP32-S3 Sense | Cerebro de las gafas. Ya trae cámara, micrófono, WiFi, Bluetooth y cargador de batería | ~14 |
| OLED SSD1306 0,96" 128×64, I2C | La pantalla | ~3 |
| Lente + lámina semiespejada (o acrílico a 45°) | Llevar la imagen al ojo y que se vea a través | ~5 |
| MAX98357A + parlante chico de 8 Ω | Que MIIA hable | ~4 |
| Batería LiPo 3,7 V, 500–1000 mAh | Autonomía | ~6 |
| VL53L1X (sensor láser de distancia) | Para medir dimensiones | ~5 |
| MPU6050 (sensor de movimiento) | Gestos de cabeza. Opcional | ~2 |
| Marco impreso en 3D o un armazón viejo | Soporte | — |

Total: unos 40 USD. **Lo difícil no es la electrónica, es la óptica**: que un OLED
a 3 cm del ojo se vea en foco requiere probar lentes y distancias. Reflejada en la
lámina la imagen queda al revés, y para eso está el tilde «Espejar» del emulador.

Se puede empezar todavía más barato: sin parlante ni micrófono en las gafas, usando
los del celular (unos auriculares Bluetooth). Las gafas quedan con cámara y pantalla.

## Cómo se conecta todo

```
 gafas (ESP32)  ──WiFi, WebSocket──▶  cerebro (Node)  ──▶  LLM de afuera: DeepSeek o Gemini (sólo conversar)
   cámara, mic, OLED                   red propia, HUD, guías
        ▲                                   ▲
        └────── reloj: botones y avisos ────┘   (por el celular)
```

- **Gafas ↔ cerebro por WiFi**, con el celular haciendo de punto de acceso. Audio y
  cámara no entran por Bluetooth de bajo consumo: es demasiado lento.
- **El cerebro** corre hoy en la PC. El celular es un iPhone, donde Node no corre:
  el cerebro se queda en la PC (gratis, sirve en casa) o va a un servidor (para
  usar las gafas afuera). **No al server de MIIA antes del 12-oct.** En un servidor
  hace falta HTTPS/WSS y el `TOKEN_GAFAS`; el iPhone queda como punto de acceso
  WiFi y, si hace falta, como panel abriendo la página del cerebro.
- **El reloj no puede ser el puente** entre gafas y celular. Sirve de control
  remoto (siguiente paso, enseñar, silenciar) y de segunda pantalla. Qué puede
  hacer depende del modelo:

| Modelo | Zepp OS | Mini-apps | Conectarse por Bluetooth al ESP32 |
|---|---|---|---|
| GTR 3, GTR 3 Pro, GTS 3 | 1.0 | sí, hablan con el celular | no (hace falta API 3.0) |
| Bip 3 | no figura en la lista de Zepp OS | no | no |
| T-Rex 3, Active, Balance, GTR 4 | 3.5 o más | sí | sí |

Fuente: la lista de dispositivos y la referencia de `mstBuildProfile` en
docs.zepp.com, leídas el 1-oct-2026.

## Las redes de MIIA para ver: qué se puede y qué no

Las redes de MIIA (`class23`, `class24`) son perceptrones chicos que reciben un
vector de 22 a 64 números ya calculado. No miran píxeles. Lo que se puede portar
es **la red y sus lecciones** (dimensión fija en la clave, normalización por
feature, no entrenar sin etiqueta real), y eso es `src/red_objetos.js`.

| Pedido | Qué se puede hacer | Dónde |
|---|---|---|
| Reconocer objetos | Sí, **los que vos le enseñes**, mostrándoselos. No reconoce cosas que nunca vio ni dice dónde están en la imagen | `red_objetos.js` + `rasgos.js` |
| Reconocer cualquier objeto sin enseñarle | No con rasgos hechos a mano. Hace falta una red convolucional ya entrenada que entregue el vector; se cambia `rasgos.js` y la red propia queda igual | pendiente |
| Detectar personas | No con `rasgos.js`: clasifica por color y bordes del centro de la imagen, y la gente cambia de ropa y de pose. Hace falta un detector ya entrenado corriendo en el cerebro (sin API, pero bajado). Saber QUIÉN es cada persona es otra cosa: guarda datos biométricos de terceros | pendiente |
| Dimensiones | Sí, con el sensor de distancia o una tarjeta de referencia en la imagen. Falta recortar el objeto para saber cuántos píxeles ocupa | `medir.js` (la cuenta está; el recorte no) |
| Peso | Sólo estimado: volumen × densidad del material. Una cámara no pesa | `medir.js` |
| Armar y desarmar a pedido | Guía paso a paso por voz y en el HUD. La guía la redacta el LLM, así que puede equivocarse con un modelo que no conoce | `sesion.js` |
| Despiece 3D flotando, como en la película | No en un OLED monocromo de 128×64. Sí en la pantalla del celular, si existe el modelo 3D de ese objeto | no empezado |

`rasgos.js` tiene un techo bajo y está dicho en su cabecera: distingue un puñado
de objetos de color y forma distintos, con luz parecida a la del día que se
enseñaron. Las pruebas usan figuras sintéticas; con objetos reales el acierto va
a ser menor y hay que medirlo.

## Las redes de MIIA en C++ y la base pública

Además de la red que aprende tus objetos en el momento, hay un segundo camino:
entrenar una vez, con una base pública, para reconocer categorías generales
(cosas y «persona», nunca quién es).

| Archivo | Qué hace |
|---|---|
| `cpp/redes.hpp` | `class23` (in → in/2 → in/4 → salida) y `class24` (in → 64 → salida), con softmax. Un solo encabezado, sin Redis: el mismo va a compilar en el ESP32 |
| `cpp/entrenar.cpp` | Entrena las dos, vota parejo y **mide contra el azar** sobre imágenes que no vio |
| `herramientas/exportar_rasgos.js` | De una base con una carpeta por clase a los `.bin` del entrenador. Pasa cada foto por todos los extractores |
| `herramientas/entrenar_todo.js` | `npm run entrenar`: entrena las redes de cada extractor y mide el voto conjunto |
| `src/extractores.js` | La lista de extractores. Cada uno es una fuente con su dimensión: `rasgos_v0\|168`, `rasgos_v1\|1060`, `dino_s\|384` |
| `src/rasgos_v1.js` | Segundo extractor propio: bordes orientados por bloques y color por cuadrante |
| `src/rasgos_dino.js` | Tercer extractor: DINOv2-small, una red ya entrenada que corre en la PC |
| `src/imagen.js` | Recortar, achicar, agrandar y espejar; lo comparten los tres |
| `src/red_general.js` | Carga en el cerebro los pesos de un extractor y predice igual que el C++ |
| `src/conjunto.js` | Hace votar a las redes de todos los extractores. Sumar uno nuevo es sumar un votante |

```bash
npm run compilar
```

El compilador es el `g++` de MSYS2 (`C:\msys64`); `compilar.js` lo encuentra solo.

**Base elegida para empezar: Caltech-256.** 30.607 imágenes en 256 categorías más
una de fondo, 1,2 GB, licencia CC BY 4.0, en data.caltech.edu. Un objeto centrado
por imagen, que es como miran las gafas. Tiene una categoría de gente y otra de
fondo. Bajada el 1-oct-2026 a `datos/` (no va a git). Para gente en escenas reales,
el paso siguiente es COCO 2017 (80 categorías; 1 GB la parte de validación, 18 GB
la de entrenamiento).

### Primera medición con fotos reales — 1-oct-2026

40 clases elegidas en `herramientas/categorias.json` (casa, taller,
electrónica, «persona» y «nada»), hasta 200 fotos por carpeta: 3.622 de
entrenamiento, 402 de validación, 970 de prueba. 60 épocas, lr 0,01, semilla 24.

| | Acierto en la prueba |
|---|---|
| Azar (la clase más frecuente) | 8,4 % |
| `class23` sola | 30,9 % |
| `class24` sola | 32,0 % |
| **Ensamble, voto parejo** | **34,7 % ± 3,0** |
| Ventaja sobre el azar | +26,4 pp, significativa |

**Lectura: ve algo, pero no alcanza para usarlo.** Se equivoca dos de cada tres
veces. «Persona» acierta 54 de 81, y cuando dice «persona» tiene razón el 61 % de
las veces. Hay clases casi ciegas: clip 0/16, destornillador 1/23, lata 1/24.

**El cuello de botella es el extractor, no las redes.** La pérdida de entrenamiento
baja a 0,005 mientras la validación se queda en ~30 %: las redes memorizan los
ejemplos porque color y bordes no alcanzan para generalizar. Agregar épocas o
capas no lo arregla.

**La confianza es informativa** (lo mismo que encontró CONCLUSION.md de MIIA con
el Random Forest): si la red sólo opina cuando está segura, acierta mucho más.

| Opina sólo si la confianza es | Opina en | Acierta |
|---|---|---|
| ≥ 0,5 | 29 % de las fotos | 70 % |
| ≥ 0,7 | 16 % | 82 % |
| ≥ 0,9 | 8 % | 93 % |

⚠️ Esos umbrales se miraron sobre la misma prueba, así que están algo inflados; y
son fotos de Caltech, no lo que ve una webcam en una mesa.

### Segunda medición: dos extractores votando — 1-oct-2026

Tres cambios respecto de la primera, medidos sobre las mismas 970 fotos de prueba:

1. **Se entrena con la foto entera**, no con el recorte del centro. En Caltech el
   objeto ya llena la foto; recortarla era mirar un pedazo. (Era un error mío de
   la primera medición.)
2. **Espejo:** cada foto de entrenamiento entra también dada vuelta (8.048 filas).
   La validación se sortea por pares, para que una foto y su espejo no queden una
   de cada lado.
3. **Un segundo extractor propio**, `rasgos_v1|1060` (bordes orientados por
   bloques, color por cuadrante), con su propio par de redes. Los dos votan en
   `src/conjunto.js`.

| | Acierto en la prueba |
|---|---|
| Azar | 8,4 % |
| `rasgos_v0` solo (antes 34,7 %) | 39,8 % ± 3,1 |
| `rasgos_v1` solo | 46,5 % ± 3,1 |
| **Los dos, voto parejo** | **49,7 % ± 3,1** |
| Los dos, voto pesado por validación | 49,2 % ± 3,1 |

| Opina sólo si la confianza es | Opina en | Acierta |
|---|---|---|
| ≥ 0,5 | 46 % de las fotos | 79 % |
| ≥ 0,7 | 28 % | 92 % |
| ≥ 0,9 | 16 % | 96 % |

**Lectura.** Usar los dos a la vez sirve: el voto le gana a cada uno por separado.
Pero la mejora sobre `rasgos_v1` solo (3 puntos) está en el borde del margen de
error, y pesar el voto no cambió nada. El techo de lo hecho a mano quedó cerca del
50 %: sigue equivocándose una de cada dos si opina siempre.

**Conectado al HUD desde el 1-oct**, sólo con confianza ≥ 0,7 y por mayoría de 5
cuadros. Aparece como `creo: reloj 85%`; lo que vos le enseñaste sigue saliendo
como `veo:` y tiene prioridad.

⚠️ **Depende mucho del encuadre.** Mirando las mismas fotos de prueba por el
recuadro del centro (como mira en vivo) en vez de enteras, el acierto cae de 49,2 %
a 20,2 %, y con confianza ≥ 0,7 acierta sólo el 51 %. En vivo el objeto tiene que
**llenar el recuadro**, como llena la foto en Caltech. Con la webcam real no está
medido.

### Tercera medición: se suma un extractor ya entrenado — 1-oct-2026

Tercer votante: **DINOv2-small** (Meta, Apache 2.0), fuente `dino_s|384`, en
`src/rasgos_dino.js`. Corre entero en la PC con `onnxruntime-node`, sin API ni
internet: ~28 ms por imagen. Encima van `class23` y `class24`, entrenadas acá.

- Modelo: `modelos/dinov2-small/model_quantized.onnx`, 24,5 MB, del repo
  `Xenova/dinov2-small` de Hugging Face. sha256 `3afdc8bc…a29d917`, verificado.
- `onnxruntime-node` ocupa 288 MB en `node_modules`.
- Si falta el modelo o la biblioteca, ese votante no aparece y el resto anda igual.

| | Acierto en la prueba (970 fotos, 40 clases) |
|---|---|
| Azar | 8,4 % |
| `rasgos_v0` solo | 39,8 % ± 3,1 |
| `rasgos_v1` solo | 46,5 % ± 3,1 |
| `dino_s` solo | 94,2 % ± 1,5 |
| Los tres, voto parejo | 86,8 % ± 2,1 |
| **Los tres, voto pesado por validación** | **94,0 % ± 1,5** |

| Opina sólo si la confianza es | Opina en | Acierta |
|---|---|---|
| ≥ 0,5 | 90 % de las fotos | 98 % |
| ≥ 0,7 | 44 % | 99 % |
| ≥ 0,9 | 21 % | 100 % |

**Lectura, sin adornos.** El salto lo da el extractor ya entrenado, solo. Los dos
hechos a mano **no suman**: con voto parejo le restan 7 puntos, y con voto pesado
el conjunto queda igual que `dino_s` solo (94,0 contra 94,2, dentro del margen).
Quedan como votantes porque son lo único que podría correr en el ESP32 sin
servidor, no porque mejoren el número. El voto parejo de `class25A` sirve cuando
los votantes son parecidos; con uno muy superior hay que pesar, y por eso el
cerebro usa el voto pesado.

**El encuadre dejó de ser un problema grave.** Mirando las fotos de prueba por el
recuadro del centro (como mira en vivo): 88,0 %, contra 20,2 % de antes. Con
confianza ≥ 0,5 opina en el 81 % y acierta el 97 %.

**En el HUD:** el umbral bajó de 0,7 a 0,5. Por el servidor de verdad, con 25 fotos
de prueba mandadas como cuadros de cámara, el pie del HUD quedó bien en 22.

⚠️ Sigue sin medirse con la webcam real y con objetos reales sobre una mesa. Las
fotos de Caltech son de catálogo; una taza tuya, con tu luz, puede salir distinta.
Y los umbrales se eligieron mirando la prueba.

### Cuarta pasada: más dispositivos, voto corregido y «Enseñar» con DINOv2 — 2-oct-2026

**15 clases más de dispositivos**, todas de Caltech-256 (no se bajó nada nuevo):
reproductor mp3, agenda digital, teléfono, radiograbador, videocasetera, proyector,
fotocopiadora, joystick, disquete, trituradora, lavarropas, panificadora,
microscopio, binoculares y megáfono. Total: **55 clases**, 10.654 filas de
entrenamiento y 1.284 fotos de prueba.

| | Acierto en la prueba (1.284 fotos, 55 clases) |
|---|---|
| Azar | 6,3 % |
| `rasgos_v0` solo | 35,8 % ± 2,6 |
| `rasgos_v1` solo | 42,7 % ± 2,7 |
| `dino_s` solo | 94,5 % ± 1,2 |
| Los tres, voto parejo | 88,9 % ± 1,7 |
| **Los tres, voto pesado** | **94,5 % ± 1,3** |

**El voto estaba mal pesado, y se notaba en vivo.** Pesando con el acierto a secas,
los dos votantes flojos se llevaban el 44 % del voto y aplastaban la confianza
contra 0,55: el acierto era el mismo, pero fotos que `dino_s` tenía clarísimas
quedaban bajo el umbral y el HUD se callaba (notebook y reproductor mp3 no
aparecían). Ahora el peso es la ventaja sobre el azar en validación, **al cubo**
(`src/conjunto.js`): `dino_s` se lleva el 92,5 % del voto.

| Opina sólo si la confianza es | Antes (peso lineal) | Ahora (peso al cubo) |
|---|---|---|
| ≥ 0,5 | opina 89 %, acierta 99 % | opina 96 %, acierta 97 % |
| ≥ 0,7 | opina 38 %, acierta 99 % | opina 91 %, acierta 98 % |
| ≥ 0,9 | opina 15 %, acierta 99 % | opina 84 %, acierta 99 % |

El HUD usa 0,7. ⚠️ El exponente lo elegí después de ver la tabla de la izquierda,
o sea mirando la prueba: no cambia el acierto, pero la columna de la derecha está
algo favorecida.

**En vivo, por el servidor** (60 fotos de prueba de 15 tipos de dispositivo, mirando
sólo el recuadro del centro): opinó en 46 y acertó 42. Se equivoca: un teléfono de
disco salió como calculadora con 72 %.

**Características en el HUD** (`src/fichas.js`, `colorDominante` en `src/imagen.js`).
Con la pantalla libre, lo reconocido muestra dos renglones del TIPO de aparato y uno
medido: el color. Límites, los dos reales:

- La ficha es del tipo («un monitor: HDMI, DP o VGA»), no de la unidad. Marca y
  modelo piden leer el texto del aparato.
- El color es el que más hay en el medio del recuadro. Con un objeto fino gana el
  fondo.

**No hay celulares modernos en Caltech-256** (es de 2007: tiene iPod y Palm). Un
smartphone hoy no lo reconoce. Están en COCO 2017, que no se bajó.

**«Enseñar» ahora usa DINOv2** (`dino_s|384`; archivo `estado/red_dino_s_384.json`).
Medido enseñando 7 cosas que la red general nunca vio, con 12 fotos distintas de
cada una y 30 de prueba:

| Extractor de la red personal | Acierto (210 fotos) |
|---|---|
| `rasgos_v0` (antes) | 43,3 % |
| `dino_s` (ahora) | 96,2 % |

Por el servidor, con 4 clases: 28 de 32. ⚠️ En vivo los 12 cuadros son del MISMO
objeto casi sin moverse, que es más fácil que 12 fotos distintas pero generaliza
menos: conviene girarlo mientras aprende. Y sigue siendo softmax cerrado: lo que
no se le enseñó cae en alguna de las clases que sí. Por eso «nada» primero.

### Quinta pasada: celulares (COCO), partes y marca/modelo a pedido — 2-oct-2026

**COCO 2017, parte de validación**, bajada a `datos/coco/` desde cocodataset.org:
`val2017.zip` (778 MB, 5.000 fotos) y `annotations_trainval2017.zip` (241 MB).
`herramientas/recortar_coco.js` saca un recorte por objeto (lado mínimo 64 px, 10 %
de margen, hasta 300 por clase): **980 recortes** de 684 fotos.

| Recortes de COCO | Cantidad | Va a la clase |
|---|---|---|
| cell phone | 62 | celular (nueva) |
| tv | 193 | televisor (nueva) |
| remote | 31 | control remoto (nueva) |
| laptop · keyboard · mouse | 170 · 72 · 18 | notebook · teclado · mouse |
| microwave · refrigerator | 27 · 107 | microondas · heladera |
| person | 300 | persona |

Total al sumarlas: **58 clases**, 12.072 filas de entrenamiento y 1.455 fotos de prueba. La
lista pasó a llamarse `herramientas/categorias.json`; las carpetas de COCO entran
como `../coco_recortes/…` para no cambiar el reparto de las fotos de Caltech.

| | Acierto en la prueba (1.455 fotos, 58 clases) |
|---|---|
| Azar | 7,9 % |
| `rasgos_v0` solo | 36,4 % ± 2,5 |
| `rasgos_v1` solo | 41,9 % ± 2,5 |
| `dino_s` solo | 92,2 % ± 1,4 |
| Los tres, voto parejo | 85,9 % ± 1,8 |
| **Los tres, voto pesado** | **92,0 % ± 1,4** |

Con confianza ≥ 0,7 (el umbral del HUD) opina en el 91 % de las fotos y acierta el 96 %.

**Bajó de 94,5 % a 92,0 %, y es esperable.** Los recortes de COCO son más difíciles
que las fotos de catálogo de Caltech (objetos chicos, tapados, en escenas reales),
y hay clases que se parecen: lo que más confunde es televisor ↔ notebook (7 veces)
y teclado → notebook (4).

| Clase | Reconoce | Veces que la dijo |
|---|---|---|
| celular | 11 de 14 | 13 |
| control remoto | 4 de 6 | 4 |
| televisor | 29 de 40 | 37 |
| monitor | 25 de 25 | 28 |
| notebook | 39 de 48 | 50 |
| teclado | 27 de 34 | 30 |
| mouse | 16 de 17 | 17 |
| persona | 108 de 115 | 130 |

**Monitor y televisor se unieron en «pantalla»** el mismo día. COCO llama «tv» a
los dos, y separados la red repartía la confianza entre las dos clases: con un
monitor delante no llegaba al umbral con ninguna y el HUD se callaba. Quedaron
**57 clases**. Reentrenado: 91,8 % ± 1,4 (sin cambio real en el acierto; lo que
cambia es que vuelve a opinar). Con confianza ≥ 0,7: opina en el 90 %, acierta 96 %.

**Como en vivo, por el servidor** (`herramientas/probar_en_vivo.js`): cada foto de
prueba se ubica dentro del recuadro de un cuadro gris de 640×480 y se manda cinco
veces por el WebSocket, leyendo el pie del HUD. 5 fotos por carpeta, 329 en total:

| | |
|---|---|
| Bien | 286 (87 %) |
| Se calló | 34 |
| Se equivocó | 9 |
| Cuando opinó, acertó | 97 % |

Celular 3 de 5 (calló en 2), pantalla 8 de 10, notebook 9 de 10, control remoto 2
de 5. ⚠️ El fondo es gris liso y la luz es la de la foto: no es la cámara.

⚠️ **Son pocos celulares.** 62 recortes dan unos 50 para entrenar y una docena de
prueba: el número de «celular» tiene un margen enorme. Para más habría que bajar
la parte de entrenamiento de COCO (18 GB), que no se bajó.

**Partes en el HUD.** `src/fichas.js` ahora trae, por tipo de aparato, dos renglones
de datos y la lista de partes de afuera hacia adentro. Con un aparato reconocido y
la pantalla libre, «Siguiente» las pasa de a tres. Son las partes del TIPO.

**Marca y modelo, a pedido** (`src/identificar.js`). El botón «Marca y modelo», o
preguntarlo por voz, le manda al LLM el recorte del recuadro y deja en pantalla
marca, modelo, qué tan seguro está, características y partes. Usa
`GEMINI_VISION_MODEL` (por defecto `gemini-3.8-flash`).
⚠️ **Sin probar contra la API real**: no había clave. Está probado todo lo de
alrededor con un cliente de mentira.

**Lo que NO se hizo, a propósito: identificar personas.** Martín pidió mandar la
foto de una persona al LLM para sacar su nombre y sus redes por la cara. No se
arma: reconocer a alguien por la cara y juntarle los datos es el daño a la
privacidad en sí, aunque cada dato suelto sea público; no hay forma de hacerlo
«sin violentar la privacidad». Y en el código quedó trabado: `identificar` se niega
si la red ve una persona en el recuadro (aun con confianza 0,3), manda sólo el
recorte, le prohíbe al modelo describir personas y el esquema de la respuesta no
tiene campo para un nombre. Lo que sí se puede: personas que aceptan y se cargan
ellas mismas, o un código QR que la persona muestra.

**Exportación con memoria.** `exportar_rasgos.js` guarda lo calculado por carpeta y
por extractor en `datos/rasgos/_cache/`. Agregar una clase calcula sólo lo nuevo
(re-exportar todo ya calculado: 1 minuto), y una corrida que se corta retoma.

Para repetirlo todo (exportar y entrenar por separado; la primera exportación
completa lleva unos 9 minutos, las siguientes 1):

```bash
node herramientas/exportar_rasgos.js datos/256_ObjectCategories herramientas/categorias.json datos/rasgos --max 200 --espejo
```

```bash
npm run entrenar
```

## Sexta pasada: vehículos, base MySQL, tarjetas QR y documento — 2-oct-2026

### Vehículos

De las dos bases que ya estaban en disco (no se bajó nada): auto, moto, colectivo,
camión, bicicleta, tren, avión, barco, helicóptero y topadora. **67 clases**, 16.002
filas de entrenamiento y 1.948 fotos de prueba.

| | Acierto en la prueba (1.948 fotos, 67 clases) |
|---|---|
| Azar | 5,9 % |
| `rasgos_v0` solo | 38,4 % ± 2,2 |
| `rasgos_v1` solo | 42,0 % ± 2,2 |
| `dino_s` solo | 91,2 % ± 1,3 |
| Los tres, voto parejo | 88,9 % ± 1,4 |
| **Los tres, voto pesado** | **91,3 % ± 1,3** |

Con confianza ≥ 0,7: opina en el 92 % y acierta el 95 %. Sólo vehículos: 446 de 493
(90 %). Lo que más confunde: camión → auto (12 veces) y auto → camión (6).

Como en vivo por el servidor (`probar_en_vivo.js`, 3 fotos por carpeta, 252): 223
bien (88 %), calló en 19, se equivocó en 10; cuando opinó acertó 96 %. Vehículos:
51 de 54. **Celular 1 de 3 y control remoto 0 de 3**: siguen flojos, son pocos datos.

### Distancia, velocidad y tiempo: están las cuentas, falta quién les dé los datos

`src/medir.js` tiene `distanciaPorAltoM`, `velocidadKmh`, `tiempoDeLlegadaS` y
`alcanceM`, con pruebas. **No están conectadas a nada**, y es a propósito: para
medir hace falta saber cuántos píxeles de alto ocupa el vehículo, y eso lo da un
DETECTOR (una red que marca el recuadro de cada objeto). Las redes de hoy
clasifican lo que hay en el recuadro del centro; no localizan.

- El mismo detector es lo que permitiría reconocer un vehículo LEJOS, chico en la
  imagen, en vez de exigir que llene el recuadro.
- Aun con detector, la distancia por tamaño aparente tiene ±15 % y la velocidad es
  peor. Para velocidad de verdad: radar Doppler de 24 GHz (CDM324, ~6 USD).
- Candidato de detector, **sin bajar**: YOLOS-tiny en ONNX (`Xenova/yolos-tiny`,
  9,7 MB), entrenado con COCO.

### La base de datos (MySQL de XAMPP)

`src/base.js` y `docs/esquema_gafas.sql`. Base `gafas`, usuario `gafas` limitado a
esa base (la clave está en `.env`, generada, no versionada). Seis tablas:
`objetos`, `ejemplos`, `reconocimientos`, `tarjetas_qr`, `identificaciones`,
`mediciones` (esta última vacía hasta que haya detector).

- **El aprendizaje son los ejemplos.** Los pesos no se guardan: se recalculan al
  arrancar. La base manda sobre el archivo de `estado/`.
- **Es opcional.** Con MySQL apagado el cerebro arranca, avisa y sigue con el archivo.
- **Probado de punta a punta:** se enseñaron 3 objetos por el servidor, se borró el
  archivo local, se reinició, y volvieron de MySQL (17 de 18 fotos nuevas bien).

⚠️ MySQL se arrancó con `mysqld --standalone` como proceso suelto: queda corriendo
hasta que se lo apague desde el panel de XAMPP (o `mysqladmin -u root shutdown`).
Escucha en todas las interfaces y `root` no tiene clave: es XAMPP de fábrica.

### Tarjetas QR

`src/qr.js` lee el código del cuadro entero (jsQR), entiende vCard, MECARD, enlaces
y texto, y muestra hasta tres renglones. No abre enlaces. Se guarda sólo si se
pide. `npm run tarjeta -- "Nombre" --org X --url https://…` arma el PNG en `tarjetas/`.

### El documento

`docs/Gafas MIIA - Documentación y planos.docx` (16 páginas), generado por
`npm run documento`. Los cinco planos salen de `python herramientas/dibujar_planos.py`
a `docs/planos/`. Se abrió con Word y se revisó página por página en PDF.

⚠️ Los planos de conexiones, óptica y marco son **de partida**: nada de eso se armó.

### El repositorio — 2-oct-2026

Martín pidió subir el proyecto a `github.com/martinrinaldi303/lente-` (privado). Va
en la rama `main`, encima del commit inicial que ya tenía el repo.

| Va | No va |
|---|---|
| El código, las pruebas, las herramientas, `PLAN.md`, `README.md` | `.env` (claves y contraseña de la base) |
| El esquema de la base, los planos y el Word | `datos/` (Caltech-256 y COCO: 4 GB) |
| Las redes generales entrenadas, `estado/red_general_*.json` (20 MB) | `modelos/` (DINOv2), `node_modules/`, `cpp/entrenar.exe` |
| | La red personal y `tarjetas/`: son de cada uno |

Las redes generales van para que un clon ande sin bajar 2 GB y reentrenar. El
costo: cada reentrenamiento que se suba agrega 20 MB a la historia del repo.

⚠️ **Dos sesiones trabajaron a la vez en esta carpeta** esa madrugada: una terminó
la sexta pasada y escribió el Word; la otra subió el repo y, sin saber de la
primera, escribió un segundo generador de Word. Se borró el duplicado
(`herramientas/escribir_documento.js`) y quedó el de `npm run documento`. Si se
vuelve a abrir más de una sesión acá, que una sola toque los archivos.

## Séptima pasada: el detector — 2-oct-2026

**Por qué.** Las redes clasifican lo que llena el recuadro del centro. Con un
celular en la mano junto a la cara ganaba «persona»; un vehículo lejos no se veía;
y sin saber cuántos píxeles ocupa un objeto no se puede medir nada.

**Qué se sumó.** YOLOS-tiny (Hustvl, Apache 2.0), ONNX de `Xenova/yolos-tiny` en
Hugging Face: `modelos/yolos-tiny/model_quantized.onnx`, 9,7 MB, sha256
`82b5c1de…e86b6b` verificado. 80 clases de COCO. Corre en la PC con
`onnxruntime-node`, que ya estaba.

| Archivo | Qué hace |
|---|---|
| `src/detector.js` | Pasa el cuadro entero por la red y devuelve nombre, confianza y recuadro de cada objeto |
| `src/seguimiento.js` | Elige el objeto principal y le mide distancia, velocidad y tiempo de llegada |
| `herramientas/medir_detector.js` | Lo mide contra las anotaciones de COCO |
| `herramientas/probar_escenas.js` | Le muestra al cerebro escenas enteras por el WebSocket y lee la pantalla |

### Cuánto encuentra

Contra las anotaciones de la validación de COCO (que no se usó para entrenarlo),
objetos de 48 px o más, 60 fotos por clase, superposición ≥ 0,5:

| Lado menor | Encontrados | Tiempo por cuadro |
|---|---|---|
| **384 (el que se usa)** | 845 de 1.124 (75 %) | ~135 ms |
| 480 | 867 de 1.124 (77 %) | ~235 ms |

A 384: celular 54 de 70 (77 %), persona 88 %, auto 76 %, moto 81 %, colectivo 79 %,
camión 53 %, bicicleta 77 %, notebook 73 %, pantalla 80 %, teclado 79 %, mouse
81 %, control remoto 68 %, taza 63 %, botella 67 %. El lado 480 cuesta el doble
de tiempo por dos puntos: no vale la pena.

### Cuál de todos es «el» objeto, y quién manda

`principalDe()`: lo que está en el centro de la mirada (si hay varios, el recuadro
más chico); si es una persona con algo en la mano, el objeto.

Para la pantalla hay dos opiniones, el detector y las redes del recuadro del centro:

1. Lo que el detector encontró **en el centro**.
2. Lo que las redes dicen del recuadro del centro, si no es «persona».
3. Lo que el detector encontró al costado.
4. «Persona».

El paso 2 antes que el 3 salió de una foto real: el detector marcó una mano como
«banana 67 %» al costado mientras las redes decían «celular 93 %» del centro, y
tenían razón.

### Escenas reales por el servidor (`probar_escenas.js`)

Fotos enteras de COCO, con el objeto donde cayó, mandadas como cuadros de cámara:

| Clase | Escenas | El detector la marcó | La pantalla la nombró |
|---|---|---|---|
| celular | 40 | 33 | 26 |
| moto | 24 | 21 | 20 (17 con distancia en pantalla) |
| notebook | 24 | 21 | 7 |
| auto | 28 | 25 | 6 |

Que la pantalla nombre otra cosa no siempre es un error: en una escena con una
notebook y un gato en el centro, dice «gato». Antes del detector, en estas escenas
el celular no salía nunca.

### Distancia, velocidad y tiempo

Ya no son sólo cuentas: `Seguimiento` las alimenta con el alto del recuadro del
objeto principal, y salen en la pantalla («A ≈ 12 m», «Se acerca ≈ 20 km/h»,
«Llega en ≈ 2 s») y a la tabla `mediciones`, una por segundo. Para auto, moto,
bicicleta, colectivo, camión y persona.

⚠️ **Sin probar con vehículos reales.** Lo probado es un auto simulado que viene a
36 km/h (da 36 ± 5) y el camino completo con fotos fijas (dan «Quieto»). El error
de la distancia es de al menos 15 %, depende de `CAMARA_FOV_DIAGONAL` (55 para la
Logi C270) y, si el objeto está cortado por el borde, no se mide.

### En el emulador

Los recuadros se dibujan sobre la imagen; el grueso y celeste es el elegido, con su
distancia si se pudo medir. Es una ayuda del emulador: un OLED de 128×64 no puede
dibujar sobre el mundo.

### Marca y modelo, con detector

Si el detector localizó un aparato, al LLM va el recorte **de ese aparato** (con
8 % de margen), aunque haya una persona en el cuadro. Si lo único que hay es una
persona, se sigue negando.

### Lo que apareció en la base durante las pruebas

A las 02:00 del 2-oct apareció en `objetos` una clase **`martin`** con 12 ejemplos:
la enseñó Martín desde su navegador, no las pruebas. Sobrevivió a cuatro reinicios
del cerebro, que es la primera prueba real de la persistencia. No se tocó.
⚠️ Las pruebas de esta sesión sí borraron varias veces las tablas `reconocimientos`
y `mediciones` para limpiar lo que ellas mismas escribían: si en ese rato había
filas del uso real de Martín, se fueron con las de prueba.

## Octava pasada: la mirada — 2-oct-2026

**Por qué.** Martín lo probó con su cámara: la pantalla saltaba entre varias cosas y
el emulador dibujaba un recuadro por cada una («persona», «cama», «cepillo dental»
sobre la oreja), todos a la vez y cambiando a cada cuadro. En unas gafas eso cansa
la vista y saca la atención de la calle.

**La causa, medida** (`herramientas/medir_confianza.js`, 400 fotos de validación de
COCO, las 80 clases). De cada recuadro que marca el detector, ¿hay ahí un objeto
anotado de esa clase?

| Confianza que dice tener | Recuadros | Ciertos |
|---|---|---|
| 0,5 a 0,6 | 1.014 | 22 % |
| 0,6 a 0,7 | 863 | 25 % |
| 0,7 a 0,8 | 818 | 28 % |
| 0,8 a 0,9 | 852 | 38 % |
| 0,9 a 1,0 | 1.425 | 77 % |

Marca 12 recuadros por foto y más de la mitad no son nada. El umbral era 0,6.

**Qué cambió.**

1. **Sólo cuenta la mirada.** Las gafas no tienen un sensor que mire el ojo: «lo que
   se mira» es el centro de la imagen, adonde apunta la cabeza. `principalDe()`
   descarta todo lo que no toque un círculo en el centro (radio: 22 % del lado menor)
   y de lo que queda elige UNO. Lo que está alrededor no llega a la pantalla.
2. **Umbral 0,9.** El objeto elegido, uno por foto, sobre las mismas 400:

   | Umbral | Opina en | De ésas, cierto |
   |---|---|---|
   | 0,6 (el viejo) | 376 | 276 (73 %) |
   | 0,8 | 354 | 296 (84 %) |
   | **0,9** | 335 | **305 (91 %)** |
   | 0,95 | 302 | 283 (94 %) |

   Con 0,9 acierta en MÁS fotos que con 0,6, no sólo se calla más: antes una cosa
   dudosa le sacaba el lugar a una cierta.
3. **La pantalla no cambia de tema antes de 4 cuadros** (2 segundos a 2 cuadros por
   segundo): `src/permanencia.js`, para «veo» y para «creo». El porcentaje no se
   mueve por menos de 5 puntos, la distancia va de a medio metro y la velocidad de a
   5 km/h: un dígito que baila redibuja la pantalla sin decir nada.
4. **Un solo recuadro en el emulador:** el del objeto que la pantalla nombra, sin el
   temblor del detector. Lo demás se ve sólo tildando «Ver todo lo que marca el
   detector», que es para probar.

Esto reemplaza la regla de la séptima pasada: «lo que el detector encontró al
costado» ya no existe.

**La captura de Martín, pasada por el detector con la regla nueva:** marca «persona
99 %» y «frisbee 67 %» sobre la oreja; la mirada elige «persona» y nada más.

### La segunda opinión (el mismo día, más tarde)

Martín lo probó con el celular en la mano, de atrás y al costado de la cara: la
pantalla decía sólo «persona», y «A ≈ 3,5 m» estando a medio metro. Pasando su
captura por el detector: lo marcó, pero como «pantalla 67 %», y por debajo de 0,9
ya no contaba.

**Lo que se probó y NO sirve.** Recortar cada recuadro dudoso y creerle a las redes
propias lo que digan del recorte. En su captura dicen «celular 83 %» y tienen razón,
pero en general no: las redes sólo conocen 67 clases, y de algo que no conocen dicen
con toda confianza «notebook» o «colectivo». Medido sobre 1.200 fotos de COCO, 336
recuadros dudosos donde las redes (≥ 0,7) dicen otra cosa que el detector: «notebook»
4 de 63, «camión» 2 de 50, «auto» 10 de 34, «celular» 0 de 6. Con eso el objeto
elegido bajaba de 90 % a 81 % de aciertos.

**Lo que quedó** (`confirmar()` en `src/seguimiento.js`): un recuadro dudoso que
toca la mirada vale sólo si las redes propias, mirando el recorte, dicen **lo mismo**
que el detector. Sobre 390 fotos con aparatos, 1.283 recuadros dudosos: cuando
coinciden es cierto 191 de 287 (67 %); el detector dudoso solo, menos de 4 de 10.
Cuesta hasta dos pasadas más de las redes por cuadro (unos 40 ms cada una).

El objeto elegido, sobre las 400 fotos: 305 ciertos de 338 (90 %); sin la segunda
opinión, 305 de 335 (91 %). En general no suma ni resta. Donde suma es en lo que
se tiene en la mano:

| Escenas reales por el servidor | Séptima pasada | Sólo mirada y 0,9 | Con segunda opinión |
|---|---|---|---|
| celular | 26 de 40 | 20 de 40 | **25 de 40** |
| moto | 20 de 24 | 18 de 23 | 19 de 23 |
| notebook | 7 de 24 | 9 de 23 | 7 de 23 |
| auto | 6 de 28 | 8 de 26 | 9 de 26 |

Nunca hubo más de un recuadro.

⚠️ **La captura de Martín sigue dando «persona»:** ahí el detector dijo «pantalla» y
las redes «celular», no coinciden. Para su celular visto de atrás, lo que queda es
mirarlo (ponerlo en el centro) o enseñárselo con «Enseñar».

**La distancia a una persona** sólo se mide si se la ve entera: recuadro al menos
1,5 veces más alto que ancho y a más del 2 % del borde. Un busto ya no dice «3,5 m».

También cambió «en la mano»: antes el centro del objeto tenía que caer dentro del
recuadro de la persona; ahora alcanza con que los dos recuadros se toquen.

⚠️ **Un vehículo que viene de costado ya no se anuncia:** sólo se mide lo que se
mira. Es la consecuencia directa de lo pedido, y hay que saberla antes de salir a la
calle. Un aviso de peligro fuera de la mirada es otra función, con su propia prueba.

⚠️ **Sin probar con la cámara de Martín:** el panel de la app no deja usarla. Lo
probado son las pruebas en frío (73, 2 salteadas porque MySQL estaba apagado), sus
dos capturas y las escenas de COCO.

**Seguir el ojo de verdad** pide una cámara infrarroja apuntando al ojo y su propia
red: no entra en la opción A.

## Novena pasada: DeepSeek — 2-oct-2026

**Por qué.** Martín pidió que ande con la API de DeepSeek.

**Qué ofrece** (leído ese día en api-docs.deepseek.com): formato compatible con
OpenAI, `POST https://api.deepseek.com/chat/completions`. Dos modelos:
`deepseek-flash` (DeepSeek-V4.1-Flash: herramientas, salida JSON **e imágenes**) y
`deepseek-v4-pro` (más caro, sin imágenes). El modo «thinking» viene prendido por
defecto y se apaga con `thinking: {type: "disabled"}`. **No tiene audio.**

**Qué se hizo.**

| Archivo | Qué hace |
|---|---|
| `src/deepseek.js` | Un pedido a la API con `fetch` (sin SDK) y los errores traducidos |
| `src/voz_deepseek.js` | La conversación por turnos, con las mismas herramientas que Gemini |
| `src/instruccion.js` | Quién es MIIA para el LLM, común a los dos |
| `src/identificar.js` | Suma `crearIdentificadorDeepSeek`: marca y modelo con el recorte como imagen |
| `pruebas/deepseek.test.js` | 9 pruebas con una API de mentira |

Con `DEEPSEEK_API_KEY` en `.env` el cerebro usa DeepSeek; con `GEMINI_API_KEY`,
Gemini; con las dos, DeepSeek, salvo que `LLM=gemini`.

**La diferencia que importa: DeepSeek conversa por escrito.** Gemini Live escucha
y habla él. Con DeepSeek, escuchar y hablar quedan del lado de las gafas:

- En el **emulador** lo hace el navegador (Edge o Chrome): transcribe lo que se
  dice, lo manda como texto y lee en voz alta la respuesta. ⚠️ Ese reconocedor no
  es local: el audio va al servicio de voz de Microsoft o de Google.
- En unas **gafas de verdad** (ESP32) no hay navegador. Con DeepSeek, hoy, no
  pueden conversar por voz: falta poner en el cerebro un transcriptor y un
  sintetizador (por ejemplo whisper.cpp y Piper, que corren en la PC). Sin eso, las
  gafas reales necesitan Gemini para la voz.

Las trabas de privacidad son las mismas: a DeepSeek va sólo el recorte del aparato,
nunca con una persona en el recuadro, y la instrucción le prohíbe describir personas.

**Qué sale de la máquina con DeepSeek:** el texto de lo que se le dice, lo que
devuelven las herramientas (qué objeto ve la red, la lista de objetos enseñados) y,
sólo al pedir marca y modelo, el recorte del aparato. Los servidores son de DeepSeek.

**Probado.** Las 9 pruebas con una API de mentira (pedido, herramientas encadenadas,
errores 401/402/429, argumentos rotos, el recorte como imagen). El cerebro de verdad
contra una API de mentira local con el formato de la documentación: conectó, pidió
una herramienta, recibió el resultado y contestó. El emulador en modo texto, con el
mensaje de estado simulado.

⚠️ **Sin probar contra la API real de DeepSeek:** no había `DEEPSEEK_API_KEY`. Ni
el reconocedor ni la voz del navegador con un micrófono real: el panel de la app no
deja usarlo. Lo primero que hay que mirar con la clave puesta: que el modelo llame a
las herramientas y que el JSON de marca y modelo venga bien formado.

## Desarmar, código y matemática — bases encontradas el 1-oct-2026

Ninguna de las tres se bajó. Lo que hay que saber antes: **las redes de MIIA
clasifican un vector en una categoría**. Sirven para decir «esto es un
destornillador» o «este símbolo es un 7». No pueden escribir una guía, arreglar un
programa ni resolver una ecuación: eso es generar texto, y pide un modelo de
lenguaje.

| Para qué | Base | Qué trae | Licencia | Cómo se usaría |
|---|---|---|---|---|
| Desarmar | **MyFixit** (guías de iFixit) | 31.601 manuales de reparación en 15 categorías de aparatos; cada paso con texto, foto, herramientas y piezas | CC BY-NC-SA 3.0: **no comercial** | Sin entrenar nada: la red reconoce el aparato, se busca su manual y los pasos van al HUD |
| Desarmar | IKEA-Manual | 102 muebles con manual y piezas 3D | de investigación | Sólo muebles |
| Desarmar | Fusion 360 Gallery Assembly | 8.251 ensambles CAD, 154.468 piezas con sus uniones | **sólo investigación no comercial** | Despieces 3D; no entran en el OLED |
| Desarmar | PartNet | 26.671 modelos 3D de 24 categorías, con sus piezas | con registro | Qué piezas tiene un objeto, no en qué orden se saca |
| Código | CodeXGLUE (refinement) | 58.350 + 65.465 pares de método Java con error y corregido | — | Entrenar un modelo de lenguaje; no un perceptrón |
| Código | TSSB-3M | 3 millones de arreglos de una sola línea en Python | — | Ídem |
| Código | DeepFix | ~7.000 programas en C de estudiantes | — | Ídem |
| Matemática | MathWriting | 230.000 expresiones manuscritas con su LaTeX, 1,25 GB | CC BY-NC-SA 4.0: **no comercial** | Aprender a LEER fórmulas escritas a mano |
| Matemática | CROHME | Expresiones manuscritas, 130–230 MB | CC BY-NC-SA 3.0 | Ídem |
| Matemática | GSM8K | 8.792 problemas de primaria con solución | MIT | Entrenar un modelo de lenguaje |
| Matemática | DeepMind Mathematics | Preguntas y respuestas generadas | Apache 2.0 | Ídem |

Lo que sí se puede hacer propio y sin entrenar un modelo de lenguaje:

- **Código:** leer el texto de la imagen (OCR) y pasárselo al compilador o al
  analizador de verdad (`node --check`, `g++ -fsyntax-only`, `python -m py_compile`).
  Da el renglón exacto del error de sintaxis. Los errores de lógica no los ve.
- **Matemática:** una vez leída la cuenta, comprobarla es una calculadora, no una
  red. Y leer dígitos y signos sueltos sí es trabajo para `class23`/`class24`.
- **En los dos casos** la cámara de 320×240 no alcanza para leer texto: hace falta
  una foto de alta resolución a pedido.

## Lo que sigue

1. Probar el emulador con la webcam real y objetos reales, y anotar cuánto acierta.
2. Prender la voz con una clave nueva y probar una guía de desarme.
3. Comprar el XIAO y el OLED; escribir el firmware que habla `src/protocolo.js`.
4. Óptica y marco.
5. Sensor de distancia y recorte del objeto, para medir de verdad.
6. Después del 12-oct: que las gafas le consulten a MIIA (`/api/ask`).
