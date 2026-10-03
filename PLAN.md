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

- **Probado:** las pruebas en frío (105 desde la décima pasada; una usa la base MySQL real); el emulador contra el servidor real, enseñando
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

### Con las claves puestas (el mismo día, más tarde)

Martín cargó las dos claves, pero en `.env.example` en vez de `.env`: el cerebro no
las veía, y ese archivo es el que se sube a GitHub. No llegaron a subirse. Se pasaron
a `.env` y `.env.example` quedó sin claves. **Las claves van sólo en `.env`.**

Preguntándole a cada API:

| | Clave | Resultado |
|---|---|---|
| Gemini | válida | Anda con el cupo gratuito, sin facturación |
| DeepSeek | válida | Saldo 0: contesta 402 «Insufficient Balance». Hay que cargar saldo |

Por eso en `.env` quedó `LLM=gemini`. Cuando DeepSeek tenga saldo, `LLM=deepseek`.

**Probado contra Gemini de verdad, por el cerebro** (era lo que venía «sin probar»
desde el primer día):

- **La voz:** conectó con `gemini-3.8-live`; a «¿me escuchás?» contestó «Te escucho
  fuerte y claro. ¿En qué te ayudo?» con 2,4 s de audio.
- **Las herramientas:** a «¿qué objetos te enseñé?» llamó a `objetos_conocidos` y
  contestó «Hasta ahora me enseñaste a Martín».
- **Marca y modelo:** `gemini-3.8-flash` contestaba 503 (saturado) y la pantalla
  quedaba más de 40 s en «Mirando el aparato...». Se sumó un plazo de 12 s por
  intento y un modelo de reserva (`GEMINI_VISION_RESERVA`, `gemini-3.5-flash-lite`).
  Con eso devolvió la ficha de una foto de un celular («genérica smartphone,
  seguridad baja»: la foto era borrosa y lo dijo).

⚠️ Sigue sin probar: el micrófono y el parlante reales del navegador (lo probado
entra como texto), y DeepSeek contra su API (sin saldo).

## Décima pasada: memoria de objetos, aviso de vehículos, leer texto, guías, medir y firmware — 3-oct-2026

**Por qué.** Martín pidió sumar todas las mejoras que quedaron listadas al revisar el
proyecto. Todo es opcional: sin clave del LLM, sin detector o sin sensor, el cerebro
arranca igual y cada cosa avisa qué le falta.

| Qué | Dónde | Necesita |
|---|---|---|
| «¿Dónde dejé…?» | `src/memoria.js` | Nada: anda sin LLM |
| Aviso de vehículo que se acerca | `src/alertas.js` | El detector |
| Leer texto (y traducirlo) | `src/leer.js` | La clave del LLM |
| Guías guardadas: primeros auxilios y hogar | `src/guias.js`, `guias/` | Nada: anda sin LLM y sin internet |
| Importar manuales de iFixit (MyFixit) | `herramientas/importar_myfixit.js` | Bajar el archivo de la categoría |
| Medir objetos con el sensor láser | `tamanoDeCajaCm` en `src/medir.js` | El detector y el VL53L1X |
| Pruebas reales: «acertó / se equivocó» | `_evaluar` en `src/sesion.js`, `herramientas/resumir_pruebas.js` | La webcam y objetos reales |
| Firmware del XIAO ESP32-S3 | `firmware/gafas_xiao/` | El hardware |
| El cerebro en una Raspberry Pi | `docs/raspberry.md` | Una Pi 5 |

### «¿Dónde dejé…?»

Las gafas recuerdan, de cada **objeto**, la última vez que lo vieron: la hora, la
confianza y el lugar. Entra lo que la pantalla nombra y lo que el detector marca con
confianza ≥ 0,9 en cualquier parte del cuadro (el control remoto en el sillón, aunque
no se lo esté mirando). **Nunca personas**: «persona» no entra, venga de donde venga.
No se guarda ninguna imagen. Vive en `estado/memoria.json` (no va a git).

Las gafas no saben dónde están. El lugar es una etiqueta que pone el usuario: «estoy
en la cocina» (herramienta `lugar_actual`), el botón del emulador, o un **cartel QR**
pegado en la pared que diga `LUGAR:cocina` (`npm run tarjeta -- --lugar cocina`). La
etiqueta vale 15 minutos y después se da por vencida.

⚠️ Sólo encuentra lo que alguna red conoce. Unas llaves, si no se le enseñaron con
«Enseñar», no las ve nadie.

### Aviso de vehículo

La pantalla sigue atendiendo sólo lo que se mira (octava pasada), pero el auto que
importa es el que viene de costado. `Vigia` (`src/alertas.js`) mira el cuadro
**entero**: a cada clase de vehículo le sigue el recuadro más grande con su propio
`Seguimiento` y avisa si alguno llega en menos de 4 s a más de 8 km/h. El aviso le
gana a todo en la pantalla («¡CUIDADO!» durante 3 s), va a las gafas como
`{t:"alerta"}` (pitido o vibración) y no se repite antes de 4 s.

⚠️ **Es una ayuda, no un sistema de seguridad.** A 2 cuadros por segundo la velocidad
aparece recién después de ~1,5 s de ver el vehículo: un auto rápido y cerca puede
llegar antes del aviso. Sólo cuenta lo que viene hacia la cámara. Probado con un auto
simulado que viene a 18 km/h desde 25 m (avisa a ~3,5 s de llegar); sin probar con
vehículos reales.

### Leer texto

Carteles, etiquetas, envases, vencimientos. Leer letras no lo hacen las redes propias:
se le manda al LLM el **centro** de una foto (80 % × 70 %), a pedido. Para que se lea,
el cerebro le pide a las gafas una foto grande (`{t:"foto"}` → paquete `0x04`, hasta
480 KB); el ESP32 la saca de 1600×1200. Si no llega en 2,5 s se usa el último cuadro.
El texto queda en la pantalla en páginas de 3 renglones y, si lo pidió un botón, las
gafas lo dicen en voz alta (`{t:"decir"}`; en el emulador lo lee el navegador).

Privacidad, igual que marca y modelo: no se manda nada con una persona en el centro de
la mirada, y la instrucción le pide al modelo que **no transcriba documentos de
identidad, tarjetas ni datos personales de otros** (contesta «documento personal» y
las gafas dicen que no lo leen).

Probado contra Gemini de verdad al bajar la rama (ver «Al probarla en la PC», abajo).
⚠️ Con DeepSeek, sin probar contra la API real: la cuenta no tiene saldo.

### Guías guardadas

Las guías que arma el LLM pueden equivocarse. Las de `guias/` las escribió alguien y
se pueden revisar; andan sin LLM y sin internet. El LLM tiene la instrucción de
buscarlas (`buscar_guia`) antes de inventar una.

- **Primeros auxilios:** RCP en un adulto, atragantamiento, quemadura y sangrado
  fuerte. Cada una empieza o sigue por «llamá al 107 o 911» y dice de dónde sale.
  ⚠️ Están escritas a partir de las pautas generales (ILCOR 2020, Cruz Roja), **no
  copiadas de la guía oficial**: antes de confiar en ellas hay que compararlas con la
  de Cruz Roja Argentina. No reemplazan un curso.
- **Hogar:** cambiar las pilas del control remoto y limpiar el teclado.
- **MyFixit:** `npm run importar-myfixit -- datos/myfixit/Phone.json` convierte los
  manuales de iFixit de esa categoría (formato verificado el 3-oct-2026 con
  `jsons/Skills.json`: 53 manuales, todos convertidos y todos los pasos entran en la
  pantalla). Cada párrafo se parte por oraciones en pedazos de 3 renglones. Están en
  inglés y son **CC BY-NC-SA: sólo uso no comercial**; por eso `guias/myfixit/` no va
  a git.

La búsqueda compara palabras con el título y las palabras clave, sin las genéricas
(«cambiar el embrague» encontraba «Cambiar pilas del control»).

### Medir objetos

Con el VL53L1X, las gafas mandan `{t:"distancia", mm}` unas veces por segundo; una
lectura vale 1,5 s. Si el objeto del centro de la mirada tiene recuadro del
detector, la ficha muestra «Mide ≈ 15 × 8 cm» y `medir_objeto` lo devuelve. Con el
material y la forma estima el peso (volumen × densidad, como si fuera macizo). El
emulador tiene un sensor simulado con una barra. Error esperable: ±10 % o más.

### Pruebas reales

En el emulador, «✓ Acertó» o «✗ Se equivocó» (con qué era) anotan en
`estado/pruebas_reales.jsonl` lo que la pantalla mostraba. `npm run pruebas-reales`
da el acierto con su margen al 95 % (Wilson), por clase, y las confusiones más
repetidas. Es la forma de saber cuánto acierta con la webcam de verdad, que hasta
ahora sólo se midió con fotos de Caltech y COCO.

### Voto: con DINOv2, vota sólo él

`estado/medicion_conjunto.json` ya lo decía: DINOv2 solo acierta 91,2 % ± 1,3 y los
tres votando, 91,3 % ± 1,3. Los dos extractores hechos a mano no suman y cuestan dos
extracciones más por cuadro y por cada recorte dudoso. Desde ahora, si DINOv2 está
bajado vota sólo él (`votantes()` en `src/conjunto.js`); si no, votan los dos propios,
que quedan de respaldo. `VOTANTES=todos` en `.env` vuelve al voto de los tres.

### Firmware del XIAO ESP32-S3 Sense

`firmware/gafas_xiao/gafas_xiao.ino` hace lo mismo que el emulador y habla el mismo
protocolo: cámara a 640×480 y 2 cuadros por segundo, la foto grande a pedido, el OLED
(con espejado para la lámina), el VL53L1X, dos botones (siguiente/anterior; leer
texto/marca y modelo), el pitido del aviso y, con Gemini Live, micrófono y parlante.
Los pines son los de `docs/planos/plano2_conexiones.png`.

**Compilado** el 3-oct-2026 con el núcleo esp32 3.3.12 para `XIAO_ESP32S3` con PSRAM
OPI: 35 % de la memoria de programa, 19 % de la RAM, sin advertencias. **Sin probar
en una placa**: no hay hardware. La biblioteca de WebSocket manda `Origin: file://`
por defecto y el cerebro lo habría rechazado; el firmware la configura para no
mandar ninguno.

### Lo demás

- `npm test` corre en Linux y en Windows con Node 22 (`node --test "pruebas/*.test.js"`);
  `package.json` pide Node 22 o más. Antes, en Linux, no arrancaba.
- Pruebas automáticas en GitHub (`.github/workflows/pruebas.yml`): compilan el
  entrenador en C++ y corren todo en cada push.
- `README.en.md`: el README en inglés.

**Probado:** 103 pruebas en frío. Con el entrenador compilado pasan 99 y se saltean 4
(MySQL y los modelos bajados); sin compilarlo, se saltean también las 3 del C++. El emulador en un Chromium de verdad contra el servidor de verdad, con
cámara simulada: la lista de guías, cargar una y recorrerla, marcar el lugar,
«¿dónde está?» con su respuesta en voz alta, el sensor simulado, las dos pruebas
reales anotadas, la foto grande (sale por el paquete `0x04`) y el aviso con el borde
rojo.

**Sin probar:** todo lo que pide hardware (el firmware en una placa, el sensor, el
pitido), las API reales (leer texto) y el aviso con vehículos de verdad.

### Al probarla en la PC de Martín (el mismo día)

La décima pasada se escribió en otra sesión y llegó por la rama `mejoras-gafas`. Se
bajó, se corrió el cerebro con ella y se probó cada cosa por el WebSocket, con la
clave de Gemini:

| Qué | Resultado |
|---|---|
| Guías guardadas | «rcp» carga «RCP en un adulto» (12 pasos) y Siguiente avanza; «cambiar el embrague» dice que no hay guía |
| «¿Dónde dejé…?» | Por voz, «¿dónde dejé el celular?» → «Lo vi recién en la cocina». «Persona» no se recuerda |
| Emergencia por voz | «se está atragantando alguien» → «Llamá ya al 107 o al 911. No reemplazo a un médico» y cargó la guía de atragantamiento |
| Medir con el sensor | Con 600 mm simulados y una notebook al centro: «Mide ≈ 18 × 10 cm» |
| Leer texto | Un cartel de prueba: «LECHE ENTERA Vence: 14/10/2026 Conservar refrigerado entre 2 y 8 grados»; traducido: «WHOLE MILK. Expires: 14/10/2026…» |
| Marca y modelo | Un control remoto de COCO: «Toto Stick Remote, seguridad media» |
| Pruebas reales | El renglón llega a `estado/pruebas_reales.jsonl` |
| El emulador | Carga con los controles nuevos y sin errores |

⚠️ Lo de «¿dónde dejé el celular?» acertó por casualidad: el celular que recordaba era
el cartel de prueba, que la red general tomó por «celular 98 %».

**Lo que se arregló:**

1. **`npm test` no arrancaba en Node 20** (el de Martín): la rama lo cambió a
   `node --test "pruebas/*.test.js"`, y Node 20 no expande comodines. Ahora es
   `herramientas/correr_pruebas.js`, que arma la lista a mano y anda con Node 20 y 22.
2. **Leer texto fallaba igual que marca y modelo:** `gemini-3.8-flash` contestaba 503 y
   en la pantalla quedaba el JSON crudo del error. Ahora usa la misma reserva y el
   mismo plazo de 12 s (con el principal saturado, leyó en 13 s).
3. **Medir:** por voz, MIIA pedía material y forma antes de medir. La herramienta
   ahora dice que el tamaño se pide sin argumentos; material y forma son para el peso.

Las 105 pruebas: 103 pasan y 2 se saltean (MySQL apagado). Sigue sin probar: el
micrófono y el parlante reales, el firmware (no hay hardware), el aviso de vehículos
con autos de verdad y DeepSeek (sin saldo).

## Undécima pasada: cuentas y anteojos vinculados — 3-oct-2026

**Por qué.** Martín pidió que el usuario se registre, conecte sus anteojos y que la
base asocie el modelo con los anteojos y con el usuario. El diseño lo hizo en Stitch
(`UI/`: «Enseñar», «Historial», «Consola» y `DESIGN.md`), pero no traía la pantalla
de registro: la armé con el mismo estilo.

**Qué hay.**

| Qué | Dónde |
|---|---|
| Usuarios, sesiones del panel y anteojos | tablas `usuarios`, `sesiones_web`, `anteojos` en `docs/esquema_gafas.sql` |
| Todo lo demás con dueño | `usuario_id` en objetos, reconocimientos, identificaciones, mediciones y tarjetas (0 = sin cuenta) |
| Contraseñas, llaves, rutas `/api/...` | `src/cuentas.js` |
| Poner al día una base vieja sin perder nada | `migrar()` en `src/base.js` |
| Entrar / crear cuenta | `publico/cuenta.html` |
| Mis anteojos, modelo asociado, perfil, contraseña, borrar cuenta | `publico/panel.html` |
| El estilo de Stitch, en CSS propio | `publico/panel.css` |

**Cómo se asocian.** Cada conexión de gafas es de alguien:

- el emulador con la sesión del panel abierta → ese usuario («Emulador», se crea solo);
- unas gafas que saludan con la llave de un par vinculado → el dueño de ese par;
- el emulador sin sesión, o el `TOKEN_GAFAS` del .env → «sin cuenta», como antes.

Cada usuario tiene **su** red personal, armada con **sus** ejemplos: lo que enseña con un
par lo ven sus otros pares y nadie más. La memoria de «¿dónde dejé…?» también es por
usuario. Lo de antes de las cuentas (la clase `martin`) quedó «sin cuenta» y la
**primera** cuenta creada lo puede pasar a su nombre con un botón.

**Seguridad.** Contraseña con scrypt y sal propia; en la base, sólo la huella (sha256)
del token de la sesión y de la llave de cada par; la llave se muestra una sola vez.
Cookie HttpOnly y SameSite=Strict; los pedidos que cambian algo exigen JSON y que el
Origin sea la misma página. Tope de intentos fallidos de entrar y de cuentas nuevas.
Las cuentas se crean sólo desde la PC del cerebro salvo `REGISTRO=abierto`. Una llave
nueva, desvincular o borrar la cuenta cortan en el momento las conexiones afectadas.

Datos de la persona: nombre, correo y, si quiere, su edad. Son datos de ella **sobre sí
misma**; el panel no tiene dónde cargar datos de otra gente.

**Probado.** 113 pruebas en frío, con MySQL prendido y ninguna salteada; entre ellas
`pruebas/cuentas.test.js` contra la base real (crea cuentas `@prueba.invalid` y las
borra). De punta a punta con el cerebro real: crear cuenta; el emulador entra con la
sesión; unos XIAO de prueba entran con su llave; una llave inventada no cambia nada; el
panel los ve conectados; lo enseñado con los XIAO queda en la cuenta (`martin` sigue
sin cuenta); una llave nueva corta la conexión con la vieja; borrar la cuenta corta el
emulador y no deja nada suyo. En el navegador: crear cuenta, panel, vincular (con la
llave a la vista), el emulador diciendo con qué cuenta está, el panel a 375 px sin
desbordes, y borrar la cuenta desde el panel.

Se encontró y arregló un error al probar: el cerebro se caía al conectarse el emulador
(la conexión no recibía el pedido). Ahora, además, un error con una conexión la cierra
a ella y nunca tumba el cerebro.

### Entrar con Google

Botón oficial «Continuar con Google» (Google Identity Services) en `cuenta.html`, y
«Vincular con Google» en el panel. Google le da a la página una constancia firmada (ID
token); `src/google.js` le verifica la firma con las claves públicas de Google, que es
para esta aplicación, que no venció y que Google confirmó el correo. Sólo hace falta el
**ID de cliente** (`GOOGLE_CLIENT_ID`); el secreto no se usa. De Google se guarda el
número de cuenta (`google_sub`), el nombre y el correo: ni la foto ni nada más.

Una cuenta de Google **no se pega sola** a una cuenta con contraseña del mismo correo
(ese correo nunca se verificó: alguien podría registrarse antes con el correo de otro y
quedarse con la cuenta). Se entra con la contraseña y se vincula desde el panel. Una
cuenta creada con Google puede no tener contraseña: la primera se pone sin «actual», no
se puede desvincular Google sin poner una antes, y borrarla se confirma con el correo.

Probado: la verificación con un «Google» de mentira (claves RSA generadas en la prueba:
válida, vencida, para otra aplicación, de otro emisor, correo sin confirmar, firmada con
otra clave, sin firma, HS256, contenido cambiado); los caminos de cuenta contra la base
real; el botón dibujado con un ID de prueba. 116 pruebas, ninguna salteada.

⚠️ Sin probar con Google de verdad: falta el ID de cliente. Google sólo acepta los
orígenes cargados en su consola: el panel se abre con `http://localhost:8787` (con
127.0.0.1 la página avisa y ofrece el enlace).

⚠️ Sin probar: el firmware con una llave de verdad (no hay hardware) y las cuentas
desde otro equipo de la red. Las pantallas de Stitch (Enseñar, Historial, Consola)
**todavía no están conectadas**: son el paso siguiente. En la de Historial hay una fila
«Persona → Sujeto identificado como Usuario Registrado → Ver perfil» que no se va a
construir: una persona se muestra sólo como «persona».

## Duodécima pasada: las pantallas de Stitch, conectadas — 3-oct-2026

**Por qué.** Martín pidió desconectar el emulador y conectar las pantallas que diseñó
en Stitch (`UI/`). La entrada (`/`) ahora es **Visión**; el emulador viejo sigue en
`/emulador.html`, fuera del menú, para probar sin cuenta.

| Pantalla | Archivo | Sale de | Qué muestra, de verdad |
|---|---|---|---|
| Visión | `publico/vision.html` | `UI/8.html` (Consola) | Cámara con el HUD y EL recuadro mirado, interruptores (cerebro, cámara, micrófono, sensor), conversación con MIIA, marca y modelo, leer texto, guías, ¿dónde dejé?, prueba real y el registro de eventos |
| Objetos detectados | `publico/objetos.html` | (sin diseño: mismo estilo) | La memoria de objetos de la cuenta: qué, cuándo, dónde; buscar y vaciar |
| Enseñar objeto | `publico/ensenar.html` | `UI/code.html` | Cámara con el recuadro, el progreso real «n / 12», lo aprendido con «Olvidar», el modelo (DINOv2, 384) |
| Historial | `publico/historial.html` | `UI/5.html` | Reconocimientos, mediciones y marca/modelo de la cuenta, con filtros, páginas, exportar JSON/CSV y borrar |
| Configuración | `publico/panel.html` | (el panel de la undécima) | Anteojos, llaves, perfil, Google, contraseña, borrar cuenta |

Comunes: `publico/shell.js` (la barra lateral y la de arriba de Stitch, con el usuario y
el estado real), `publico/cliente_gafas.js` (la conexión que hacía el emulador:
cámara, micrófono, parlante, voz del navegador, foto para leer, sensor), y
`publico/tw-config.js` (los colores y letras de Stitch para Tailwind). En el cerebro,
`src/rutas_app.js`: `/api/historial` y `/api/objetos`, siempre de la cuenta con sesión.

**Lo que se cambió de los diseños, a propósito.** Stitch llenó las pantallas de
números de ejemplo que el sistema no tiene: batería, temperatura, VRAM, CUDA, 60 FPS,
«768-D» (son 384), YOLOv8-m, un «MIIA local 8B», Whisper, latencias, un simulador de
estados y miniaturas de las muestras. Se sacaron o se cambiaron por los reales. Las
miniaturas no van: de lo enseñado no se guardan fotos. Y en el Historial no se
construyó la fila «Persona → Sujeto identificado como Usuario Registrado → Ver perfil»:
una persona aparece sólo como «persona».

**Probado.** 119 pruebas (las nuevas: `pruebas/rutas_app.test.js`, contra la base real,
con dos usuarios que no ven lo del otro). En el navegador, con una cuenta de prueba:
`/` lleva a Visión y, sin sesión, a entrar; Visión conecta, muestra la cuenta y los
anteojos, y la conversación con Gemini contestó desde ahí; Enseñar, Historial (con
eventos de prueba), Objetos y Configuración cargan con la barra común; ninguna se
desborda a 375 px (Visión se desbordaba 21 px y se corrigió). La cuenta de prueba se
borró con todo lo suyo.

⚠️ Sin probar: la cámara y el micrófono en las pantallas nuevas (el panel de la app no
los deja usar; es el mismo código del emulador, reordenado), y enseñar de punta a
punta desde Enseñar. Las pantallas usan Tailwind, los íconos y las letras desde
internet (como las de Stitch): sin internet se ven sin estilo.

### Lo que salió al probarla con su cámara (3-oct-2026)

Martín se puso delante de su placar y mandó la captura: él salía «persona 1,00»
(bien), la ropa colgada salía «persona 0,62 / 0,51 / 0,76», y la pantalla decía
«persona · color: marrón».

- **«Persona marrón».** El color se medía de lo que estuviera nombrado, y en una
  persona eso es la piel, el pelo o la ropa. Ahora, de una persona, el color no se
  muestra, no se le pasa al LLM (`que_veo`) y no se guarda (`sesion.js`, `_colorDe`;
  `base.js`, `reconocimiento`). Lo que ya estaba anotado se borra al arrancar
  (`migrar`): eran 4 filas. La instrucción del LLM suma que de una persona no
  describa color de piel, origen, edad ni cuerpo.
- **La ropa tomada por persona.** Medido en 600 fotos de COCO: el «persona» del
  detector acierta 19 % a 40 % entre 0,5 y 0,9, y 83 % de 0,9 para arriba. Lo de la
  ropa (0,5 a 0,8) ya no contaba: se veía porque estaba tildado «Ver todo el
  detector». Lo que sí la podía colar: las redes propias diciendo «persona» del
  recuadro del centro sin que el detector viera una persona segura. Eso acierta 48 de
  90 (53 %, una moneda), y ahora, con detector, no cuenta. Prueba nueva en
  `pruebas/detector.test.js` con las tres cajas de la captura.
- **No se exige ver una cara.** Él pidió que reconozca a las personas «por rasgos
  faciales, no por la ropa». Exigir una cara dejaría de ver a quien camina de
  espaldas en la vereda, que es justo lo que no puede pasar. Un detector de caras
  (sólo «hay una cara acá», nunca de quién) serviría como segunda opinión para las
  personas dudosas; hace falta bajar un modelo, y no se bajó.
- **El texto sobre la cámara.** El OLED de 128×64 estirado no se leía sobre una
  pared clara (letras de 6 px y aditivas). Ahora es una tarjeta con fondo: nombre,
  porcentaje, renglones, de dónde sale («Red general» o «Lo que le enseñaste») y la
  página. Las etiquetas de los recuadros dicen «Persona · 100%», del mismo tamaño en
  el celular, y lo descartado se dibuja punteado con el motivo («dudoso», «fuera de
  la mirada»). El OLED tal cual se ve con «Pantalla OLED real».
- **La voz de MIIA no sonaba en el navegador** (ni en el emulador viejo): el audio
  que llega se leía con un `Int16Array` que empezaba en el byte 1, y eso tira
  `RangeError`. Arreglado; probado con Gemini: 7 paquetes, 1,6 s de voz, sin errores.
- **Google: «no registered origin», Error 401 invalid_client.** El cliente es de
  tipo web, pero no tiene orígenes de JavaScript autorizados (el JSON que bajó no
  trae `javascript_origins`). Se arregla en la consola de Google, no en el código.

## Decimotercera pasada: animales, piezas y varias cosas a la vez — 3-oct-2026

**Animales.** Pidió que reconozca «todo tipo de animales» con sus características y
su nivel de peligro.
- `src/fichas_animales.js`: 68 fichas con tipo, peligro (bajo, medio, alto, muy alto),
  qué hacer y cómo es. El peligro es el de un adulto que se lo cruza sin molestarlo, y
  cuando la cámara no distingue especies vale la más peligrosa: toda serpiente se trata
  como venenosa (yarará, coral, cascabel), todo alacrán como Tityus, toda araña como del
  rincón o viuda. Alacrán, serpiente y araña llevan el Centro Nacional de Intoxicaciones
  (0800-333-0160). `pisoDePeligro` no deja bajar ese nivel, lo diga quien lo diga.
- En la pantalla, el peligro y lo primero que hay que hacer van siempre arriba (lo
  medido no los empuja). Uno de peligro alto o muy alto: tres pitidos y «¡CUIDADO!»,
  una vez por minuto por animal.
- La red general pasa de 67 a 118 clases: 48 carpetas de animales de Caltech-256, los
  animales de COCO (gato, perro, caballo, oveja, vaca, elefante, oso, cebra, jirafa) y
  «oso de peluche» para que un peluche no salga «oso, peligro muy alto». «bird» de COCO
  no entra: allá patos y cisnes son «bird», y acá cada uno es su clase. Si el detector
  dice «pajaro» y las redes saben cuál («picaflor»), vale el más específico.
- Para «todo tipo»: el botón «Marca y modelo» pasó a ser **«¿Qué es?»** y la
  herramienta `identificar` (antes `identificar_dispositivo`) reconoce cualquier
  aparato, pieza o animal con el LLM, a pedido. Si no está seguro de la especie, el
  peligro no baja de «medio».

**Piezas de computadoras y celulares.** `src/fichas_piezas.js`: 26 piezas con función,
diseño y características (RAM, procesador, fuente, placa de video, SSD, batería, flex,
módulo de cámara…), con aviso cuando tocarlas tiene riesgo («No abrir: capacitores»,
«Hinchada: no la uses»). No hay fotos de piezas sueltas para entrenar: se ven si se las
enseña con su nombre (se buscan sin tildes y por alias: «ram», «Memoria RAM»), con
«¿Qué es?», o preguntándole a MIIA (`mostrar_ficha`: «¿para qué sirve la RAM?»).

**Varias cosas a la vez** (`src/escena.js`). Pidió ver varios objetos y la distancia
entre ellos, por ejemplo una persona y lo que tiene en la mano, con su definición.
- Todo lo seguro del cuadro (≥ 0,9 o confirmado), hasta 6: de qué lado está, a qué
  distancia aproximada (por el tamaño típico de cada cosa; ±30 % o más), qué tiene
  cada persona («persona tiene celular»), la distancia entre dos cosas, y qué es cada
  una (`definicionDe`: la ficha, o `DEFINICIONES` para las 70 clases sin ficha).
- La pantalla de las gafas sigue nombrando UNA cosa: la escena aparece cuando se pide
  («¿qué hay?», `que_hay`, el botón «Escena»), y en el panel con «Ver varios objetos».
- Una persona de busto (la webcam) no se mide; lo que tiene en la mano se dice igual.

**Guardar por voz.** «Guardá esto como mis llaves» ya andaba (`ensenar_objeto`) y la
instrucción ahora lo nombra. Pidió también «guardá a esta persona como Martín»: **no**.
Sería reconocer a alguien por la cara (lo mismo que se rechazó el 2-oct; ver la cabecera
de `src/identificar.js`). Quedó trabado en tres lugares: la
instrucción del LLM, `ensenar_objeto` (se niega si el detector ve una persona en el
centro y las redes dicen «persona» del recuadro, o si el nombre es «persona»), y cada
cuadro mientras aprende (tres con una persona en el recuadro cortan). Un objeto que se
sostiene delante de la cara sí se aprende. Para saber quién es alguien sigue estando la
tarjeta QR que esa persona elige mostrar.

**Personas conocidas, con permiso** (`src/caras.js`, `src/conocidos.js`,
`publico/conocidos.html`). Martín insistió en «guardá a esta persona como Martín» y
después en guardar «una foto desarmada» con el nombre que pone el usuario: no, por lo
de arriba. De las alternativas eligió ésta: la persona se carga ELLA MISMA, con su
cuenta, frente a la cámara de la PC (de frente y de los dos costados, para que haga
falta que colabore), y pone el correo de las cuentas que la pueden reconocer.
- Se guardan los 128 números de SFace por foto, no la foto (tablas `rostros` y
  `permisos_rostro`, que se borran solas con la cuenta). Ella lo saca o lo borra
  cuando quiere; el que reconoce también puede dejar de hacerlo. Las gafas se
  enteran al toque, sin reconectar.
- Las gafas sólo buscan caras si la cuenta tiene a alguien con permiso, y sólo dentro
  de una persona que el detector ve segura. De una cara desconocida no queda nada. Al
  historial va «persona», nunca el nombre: aceptó que la reconozcan, no que la sigan.
- Umbral 0,50 de coseno, en 2 de 3 cuadros. Medido en 145 caras de Caltech «faces-easy»
  (de frente, sin nombres): los distintos casi todos debajo de 0,34, la misma persona
  entre 0,7 y 0,98. **Sin medir con caras reales desde las gafas.**
- Probado de punta a punta con el cerebro y dos cuentas de prueba: otra foto del
  «amigo» → «Amigo Prueba · Persona conocida»; un desconocido → «persona»; al sacar el
  permiso, «persona» sin reconectar; el historial, sólo «persona»; al borrar las
  cuentas no quedó ninguna cara. Falta probarlo con la cámara y una persona de verdad.

**Ver más lejos** (pidió «ampliar la distancia lo más que se pueda»).
- YOLOS-tiny casi no encuentra lo que mide menos de ~48 px de alto. Darle más
  resolución rinde poco: 480 de lado en vez de 384 sube de 18 % a 23 % lo de 24-48 px
  y tarda casi el doble (250 fotos de COCO).
- Lo que rinde es el **zoom en la mirada** (`detectarConZoom`): el detector mira el
  cuadro entero y además el centro con todo su detalle. En 206 fotos de COCO, para lo
  del centro: lo de 12-24 px pasa de 6 % a 29 % (cámara con más detalle) o a 17 % (la
  misma cámara); lo de 24-48 px, de 27 % a 46 % o 33 %. Es ver hasta el doble de lejos,
  sólo en la mirada.
- Por eso la cámara del navegador manda hasta 1280×960 (antes 640×480), y el firmware
  pasa a 1024×768 (sin probar en el XIAO). Probado con el cerebro: con cuadros de
  1280×960 tarda 125-155 ms por cuadro, y un auto en el centro sale «A ≈ 17 m».
- La distancia ya no es sólo de vehículos y personas: también de cosas de tamaño
  parejo (celular, taza, botella, libro, teclado…: `LARGO_TIPICO_M` en `medir.js`),
  sin velocidad, y debajo de 1 m de a 10 cm.
- Lo que no tiene tamaño típico (una pantalla, la caja del Ryzen que enseñó) no se
  puede medir con una cámara sola: hace falta el sensor láser VL53L1X de las gafas
  (hasta 4 m), o decirle cuánto mide.

**«Todo lo negro es un notebook».** Medido en 1.500 fotos de COCO: cuando las redes
propias dicen del centro un objeto que el detector también conoce y el detector no lo
ve, aciertan 37 de 100 (notebook, 0 de 5); con el detector de acuerdo, 406 de 407.
Ahora, en ese caso, las redes solas valen sólo con ≥ 0,95 (24 de 40); la caja negra
del Ryzen salía «notebook» con 85 % a 93 %. Los animales (36 de 40) y lo que el
detector no conoce (una pinza, lo que se enseña) siguen igual.

**Corregir al detector** (`src/correcciones.js`). Con su webcam, la ropa colgada del
placar salía «persona 96 %»: el detector se equivoca seguro, y eso no lo arregla
ningún umbral. YOLOS-tiny no se reentrena acá; lo que se suma es la corrección del
usuario: toca el recuadro equivocado en Visión (o dice «eso no es una persona») y se
guarda el vector DINOv2 de ese recorte (tabla `correcciones`, no la foto). Un recuadro
de esa clase que se parece ≥ 0,8 a algo corregido, y más que a las personas de verdad de
la base de entrenamiento, se descarta; se ve punteado como «corregido» con «Ver lo
descartado». Una persona con una cara a la vista (YuNet: sólo «hay una cara») no se
descarta nunca, ni se puede corregir.
- Medido con las 31 «personas» falsas del detector en 1.500 fotos de COCO: a 0,8, la
  misma cosa en otro cuadro se descarta 29 de 31, y de 400 personas de verdad no se tira
  ninguna (a 0,7: 31 de 31, pero tira 1 de 400).
- Probado con el cerebro: corregida una «persona» falsa de una foto de COCO, deja de
  contarse, y también la de al lado, que era otra falsa igual. Queda en la base al
  reconectar. Cada revisión es una pasada de DINOv2 (~30 ms): se revisan hasta 6
  recuadros por cuadro, primero donde se corrigió algo en la sesión y después del
  centro hacia afuera; en una escena llena, algo corregido en un costado puede volver a
  aparecer al reconectar.
- La escena («¿qué hay?») se va sola de la pantalla a los 12 s: quedaba vieja.

**Más datos para la red general** (pidió «una base para acelerar el aprendizaje» y
aprobó bajar las tres propuestas, 3-oct-2026, de madrugada).
- COCO train: las anotaciones ya estaban en el zip; se bajaron SÓLO las 5.098 fotos
  necesarias (851 MB, `herramientas/bajar_coco_train.js`), 200 recortes por clase en
  `datos/coco_train_recortes`. Antes había mouse 18, microondas 27, control remoto 31,
  celular 62.
- LVIS v1 (anotaciones, 350 MB; `herramientas/lvis_a_chico.js` lo achica de 1,1 GB a
  135 MB): 600 recortes de ropa que no lleva puesta nadie (`bajar_ropa_lvis.js`), como
  clase nueva «ropa». Probados también como correcciones «de fábrica» para «persona»: no
  tiran personas de verdad, pero tampoco la ropa ajena (0 de 28): descartado.
- Piezas de PC: la base de Kaggle (asaniczka, «PC Parts Images Dataset», 14 clases)
  pide cuenta; Martín la baja y la descomprime en `datos/pc_parts/<clase>`. Ya está en
  `categorias.json` (cpu → procesador, gpu → placa de video, ram → memoria ram…).
- Martín la bajó el 3-oct (3.279 fotos de 256×256). Trae **203 fotos repetidas**: la
  misma foto de un teclado con su mouse en «keyboard» y en «mouse», o de un gabinete
  abierto en «case» y en «motherboard». Ahora `exportar_rasgos.js` saca las repetidas
  en toda la base: si están en dos clases no entra ninguna (enseñarían dos respuestas
  para lo mismo), y si están dos veces en la misma queda una (así la copia no cae en la
  prueba y la infla). Salieron 188 de dos clases y 65 copias.
- **Resultado** (129 clases, 39.930 filas de entrenamiento, 4.998 fotos de prueba):
  acierta **89,9 %** (azar 3,2 %); con confianza ≥ 0,9 opina en el 86 % y acierta el
  96 %. Con las MISMAS fotos de prueba, la red de 118 clases acertaba 83,3 % del total y
  90,1 % en sus propias clases; la nueva, 91,1 % en esas mismas. Mouse 73 → 89 de 99,
  teclado 90 → 93 de 108. Las clases nuevas: webcam 26/29, memoria ram 30/34, disco
  rígido 32/36, parlante 34/40, microfono 25/31, placa madre 27/38, gabinete 27/38,
  procesador 20/33, cable 19/31, placa de video 15/31. Lo que más confunde es entre las
  placas de adentro (procesador ↔ placa madre ↔ placa de video): en foto se parecen.
  Quedó la nueva en `estado/`; la de 118 sigue en `datos/respaldo_redes_118/`.

**Lo demás.** «Cuadros al LLM: no» en el arranque no es un error: el video no se le
manda entero a Gemini (`VISION_AL_LLM=0`, a propósito); los objetos le llegan con
`que_veo` y `que_hay`. La ropa del placar marcada «persona 53 %» se veía porque estaba
tildado «Ver lo descartado»: ahora dice «descartado».

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

1. Probar el emulador con la webcam real y objetos reales, anotando con «Acertó / Se
   equivocó», y correr `npm run pruebas-reales`.
2. Prender la voz con una clave nueva y probar una guía de desarme y «Leer texto».
3. Comparar las guías de primeros auxilios con la guía oficial de Cruz Roja Argentina.
4. Comprar el XIAO, el OLED y el VL53L1X; cargar `firmware/gafas_xiao` y probarlo.
5. Óptica y marco.
6. Probar el aviso de vehículos en la vereda, con autos de verdad (y alguien al lado).
7. Medir la velocidad del cerebro en una Raspberry Pi 5 (`docs/raspberry.md`).
8. Después del 12-oct: que las gafas le consulten a MIIA (`/api/ask`).
