// hacer_documento.js — arma el Word con la documentación y los planos.
//
//   npm run documento        (antes: python herramientas/dibujar_planos.py)
//
// Deja docs/Gafas MIIA - Documentación y planos.docx. Los números de la última
// medición salen de estado/medicion_conjunto.json; el resto del texto está acá.

import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, LevelFormat, Packer, PageNumber,
  PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const SALIDA = join(RAIZ, 'docs', 'Gafas MIIA - Documentación y planos.docx');
const ANCHO = 9026;                       // A4 con márgenes de 2,54 cm, en DXA
const AZUL = '1F4E79', GRIS = '5F6B7A', CLARO = 'EEF2F7', AVISO = 'FFF4DC';

const medicion = existsSync(join(RAIZ, 'estado', 'medicion_conjunto.json'))
  ? JSON.parse(readFileSync(join(RAIZ, 'estado', 'medicion_conjunto.json'), 'utf8')) : null;
const pct = (v, d = 1) => (100 * v).toFixed(d).replace('.', ',') + ' %';
const fila = (nombre) => medicion?.filas.find(f => f.nombre === nombre);
const u07 = medicion?.umbrales.find(u => u.umbral === 0.7);

// Lo que dio herramientas/probar_en_vivo.js el 2-oct-2026 (no se guarda en un archivo).
const EN_VIVO = { n: 252, bien: 223, callo: 19, mal: 10, cuandoOpina: 96 };

// ── Ayudas ──────────────────────────────────────────────────────────────────
// Texto con **negrita** y `código` adentro.
function trozos(texto, base = {}) {
  return String(texto).split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(t => {
    if (t.startsWith('**')) return new TextRun({ ...base, text: t.slice(2, -2), bold: true });
    if (t.startsWith('`')) return new TextRun({ ...base, text: t.slice(1, -1), font: 'Consolas', size: (base.size ?? 22) - 2 });
    return new TextRun({ ...base, text: t });
  });
}
const p = (texto, opciones = {}) => new Paragraph({ spacing: { after: 140 }, ...opciones, children: trozos(texto) });
// Los títulos no quedan solos al pie de una hoja: se van con el párrafo que sigue.
const h1 = (texto, hojaNueva = false) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: hojaNueva, keepNext: true, children: [new TextRun(texto)] });
const h2 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(texto)] });
const vineta = (texto) => new Paragraph({ numbering: { reference: 'vinetas', level: 0 }, spacing: { after: 80 }, children: trozos(texto) });
// Cada lista numerada necesita su propia referencia: con una sola, la segunda lista sigue contando desde la primera.
const paso = (texto, lista = 'pasos') => new Paragraph({ numbering: { reference: lista, level: 0 }, spacing: { after: 80 }, children: trozos(texto) });
const codigo = (texto) => new Paragraph({
  spacing: { after: 140 }, shading: { type: ShadingType.CLEAR, fill: CLARO }, indent: { left: 200 },
  children: [new TextRun({ text: texto, font: 'Consolas', size: 20 })],
});
const nota = (texto) => new Paragraph({
  spacing: { before: 120, after: 200 }, shading: { type: ShadingType.CLEAR, fill: AVISO },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D9822B', space: 8 } }, indent: { left: 160 },
  children: trozos(texto),
});

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: 'B8C2CC' };
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };
// `anchos` en proporciones; la primera fila es el encabezado.
function tabla(anchos, filas) {
  const total = anchos.reduce((a, b) => a + b, 0);
  const dxa = anchos.map(a => Math.round(ANCHO * a / total));
  dxa[dxa.length - 1] += ANCHO - dxa.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: dxa,
    rows: filas.map((celdas, f) => new TableRow({
      tableHeader: f === 0,
      children: celdas.map((texto, c) => new TableCell({
        borders: BORDES,
        width: { size: dxa[c], type: WidthType.DXA },
        shading: f === 0 ? { type: ShadingType.CLEAR, fill: 'DCE6F1' } : undefined,
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
        children: [new Paragraph({ children: trozos(texto, f === 0 ? { bold: true, size: 20 } : { size: 20 }) })],
      })),
    })),
  });
}
const aire = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function plano(archivo, anchoPx, altoPx, titulo, epigrafe) {
  const ancho = 900, alto = Math.round(ancho * altoPx / anchoPx);
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true, children: [new TextRun(titulo)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: readFileSync(join(RAIZ, 'docs', 'planos', archivo)), transformation: { width: ancho, height: alto } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: epigrafe, italics: true, size: 20, color: GRIS })] }),
  ];
}

// ── Contenido ───────────────────────────────────────────────────────────────
const portada = [
  new Paragraph({ spacing: { before: 2600, after: 200 }, children: [new TextRun({ text: 'Gafas MIIA', size: 88, bold: true, color: AZUL })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Documentación y planos del prototipo', size: 40, color: GRIS })] }),
  new Paragraph({ spacing: { after: 900 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: AZUL, space: 6 } }, children: [new TextRun({ text: 'Gafas de realidad aumentada de armado propio (opción A)', size: 26 })] }),
  p('**Autor:** Martín Rinaldi Toledo'),
  p('**Fecha:** 2 de octubre de 2026'),
  p('**Versión:** prototipo 0.1'),
  aire(),
  nota('**Estado real.** El software funciona en la PC, con una webcam haciendo de gafas. El hardware todavía **no se armó**: los planos de este documento son de partida y hay que confirmarlos al construir. Cada sección dice qué está probado y qué no.'),
];

const cuerpo = [
  h1('1. Qué son y en qué estado están', true),
  p('Las gafas MIIA son un visor transparente delante de un ojo, con cámara y micrófono, que muestra en una pantalla de 128 × 64 píxeles lo que reconoce de lo que se tiene delante. No son las gafas de una película: no proyectan hologramas en todo el campo visual. Son un renglón de texto flotando en la mirada, que dice qué es lo que se está mirando y da datos sobre eso.'),
  p('El diseño separa dos partes. Las **gafas** son simples: capturan imagen y sonido y dibujan lo que se les ordena. El **cerebro** es un programa que corre en una computadora, recibe lo que mandan las gafas y decide qué mostrar. Hoy el cerebro existe y las gafas todavía no: las reemplaza una página del navegador que usa la webcam.'),
  tabla([3, 5], [
    ['Qué hace hoy', 'Cómo está'],
    ['Reconocer objetos, dispositivos, vehículos y personas (como categoría)', medicion ? `${medicion.clases} clases, ${pct(fila('todos, voto por validación').acierto)} de acierto en ${medicion.fotos_de_prueba.toLocaleString('es-AR')} fotos de prueba` : 'Sin medir'],
    ['Aprender un objeto nuevo mostrándoselo', 'Con 12 cuadros. Se guarda en MySQL y sobrevive a un reinicio'],
    ['Mostrar datos y partes del aparato reconocido', 'Fichas por tipo de aparato; color medido de la imagen'],
    ['Leer la tarjeta que una persona muestra en un código QR', 'Funciona; se guarda sólo si se pide'],
    ['Guiar paso a paso para armar o desarmar', 'Funciona con guías cargadas; con voz, las redacta el asistente'],
    ['Voz, y marca y modelo de un aparato', 'Con Gemini, probado de verdad: contesta con audio, usa las herramientas y devuelve la ficha. Con DeepSeek, escrito y **sin probar**: la cuenta no tiene saldo'],
    ['Encontrar objetos en cualquier parte de la imagen', 'Detector de 80 clases: encuentra el 75 % de los objetos de las fotos de prueba'],
    ['Medir distancia y velocidad de vehículos y personas', 'Funciona con el detector. Es una estimación gruesa y **no se probó con vehículos reales**'],
    ['Las gafas físicas', '**Sin armar**'],
  ]),

  h1('2. Cómo está armado'),
  p('El principio viene de MIIA: ningún módulo conoce a los otros, y cada parte se puede reemplazar sin tocar el resto. Las gafas y el cerebro hablan por un único WebSocket con un protocolo corto, el mismo para el emulador del navegador y para el microcontrolador. El **Plano 1** muestra los bloques.'),
  h2('Qué corre en cada lado'),
  tabla([2, 6], [
    ['Dónde', 'Qué hace'],
    ['Gafas', 'Mandan dos cuadros JPEG por segundo y el audio del micrófono. Reciben renglones de texto ya cortados a medida y el audio para el parlante. No deciden nada.'],
    ['Cerebro', 'Convierte cada cuadro en números (extractores), los pasa por las redes, hace votar los resultados, arma la pantalla y lleva el registro.'],
    ['Fuera de la máquina', 'Sólo dos cosas, y las dos son opcionales: la conversación y la consulta de marca y modelo de un aparato. Las hace un LLM de afuera: DeepSeek o Gemini, el que tenga clave. Todo lo demás corre sin internet.'],
  ]),
  h2('Lo que se reutilizó de MIIA'),
  vineta('**Las redes** `class23` y `class24`, reescritas en C++ sin dependencias y con salida para muchas clases.'),
  vineta('**El voto por módulo** de `class25A`, con una corrección: acá los votantes no son parejos y el voto se pesa.'),
  vineta('**La cola acotada** que tapó la fuga de memoria de `class30`: se queda con lo más nuevo y descarta lo viejo.'),
  vineta('**El método:** se mide contra el azar, sobre datos que la red no vio, y se anota también lo que salió mal.'),
  nota('El repositorio de MIIA no se tocó. Lo reutilizado se copió a esta carpeta, porque MIIA está en una corrida de medición hasta el 12 de octubre de 2026.'),

  h1('3. Lista de materiales'),
  p('Precios aproximados en dólares de afuera; en Argentina hay que sumar envío e impuestos. Total: entre 40 y 50 USD.'),
  tabla([3, 5, 1], [
    ['Pieza', 'Para qué', 'USD'],
    ['Seeed XIAO ESP32-S3 Sense', 'El microcontrolador. Ya trae cámara, micrófono, WiFi, Bluetooth y cargador de batería', '14'],
    ['OLED SSD1306 de 0,96", 128 × 64, I2C', 'La pantalla', '3'],
    ['Lente plano-convexa Ø 25 mm, focal 50 mm', 'Aleja la imagen para que el ojo la vea en foco', '3'],
    ['Lámina semiespejada (o acrílico de 1 mm)', 'Refleja la pantalla y deja ver a través', '3'],
    ['MAX98357A y parlante de 8 Ω, 0,5 W', 'Que el asistente hable', '4'],
    ['Batería LiPo 3,7 V, 500 a 1000 mAh', 'Autonomía', '6'],
    ['VL53L1X', 'Sensor láser de distancia, hasta 4 m: para medir objetos', '5'],
    ['MPU6050', 'Sensor de movimiento: gestos de cabeza (opcional)', '2'],
    ['Radar Doppler de 24 GHz (CDM324 o similar)', 'Medir velocidad de vehículos (opcional)', '6'],
    ['Marco impreso en 3D o un armazón viejo', 'Soporte', '—'],
  ]),
  nota('Lo difícil no es la electrónica: es la óptica. Que una pantalla a 5 cm del ojo se vea nítida exige probar lentes y distancias con paciencia.'),

  h1('4. Conexiones eléctricas'),
  p('El **Plano 2** muestra el cableado. Todo trabaja a 3,3 V. La pantalla y los dos sensores comparten las mismas dos líneas de datos (bus I2C), porque cada uno tiene una dirección distinta.'),
  tabla([3, 2, 4], [
    ['Módulo', 'Pin del XIAO', 'Notas'],
    ['OLED, VL53L1X y MPU6050: SDA', 'D4 (GPIO5)', 'Línea de datos del bus I2C'],
    ['OLED, VL53L1X y MPU6050: SCL', 'D5 (GPIO6)', 'Línea de reloj del bus I2C'],
    ['MAX98357A: BCLK', 'D1 (GPIO2)', 'Reloj de bits del audio'],
    ['MAX98357A: LRC', 'D2 (GPIO3)', 'Selección de canal'],
    ['MAX98357A: DIN', 'D3 (GPIO4)', 'Datos de audio'],
    ['Botón', 'D0 (GPIO1)', 'El otro contacto a GND; resistencia interna'],
    ['Alimentación de todos los módulos', '3V3 y GND', 'No usar el pin 5V: sólo tiene tensión con el USB puesto'],
    ['Batería', 'BAT+ y BAT−', 'Contactos de la cara de abajo; se carga por USB-C'],
  ]),
  aire(),
  tabla([3, 2], [
    ['Dispositivo en el bus I2C', 'Dirección'],
    ['OLED SSD1306', '0x3C'],
    ['VL53L1X', '0x29'],
    ['MPU6050', '0x68'],
  ]),
  nota('**Sin armar ni probar.** El reparto de pines es una propuesta: los números de GPIO hay que confirmarlos con el diagrama de Seeed antes de soldar. La cámara y el micrófono ya vienen conectados dentro de la placa.'),

  h1('5. Óptica'),
  p('El **Plano 3** muestra el camino de la luz. La pantalla mira hacia abajo; una lente la deja en el foco, de modo que el ojo la ve como si estuviera lejos y no tiene que enfocar de cerca; una lámina a 45° la refleja hacia el ojo y deja pasar la luz de afuera.'),
  tabla([3, 5], [
    ['Medida', 'Valor de partida'],
    ['Distancia de la pantalla a la lente', '50 mm, igual a la focal de la lente'],
    ['De la lente a la lámina', 'Unos 22 mm'],
    ['De la lámina al ojo', '20 a 25 mm'],
    ['Ancho aparente de la imagen', '2 · atan(21,7 / 2 / 50) ≈ 24,5°'],
  ]),
  vineta('**El foco** se ajusta acercando o alejando la pantalla de la lente, de a medio milímetro.'),
  vineta('**La imagen sale espejada** por el reflejo. El cerebro la manda al revés: es el tilde «Espejar» del emulador.'),
  vineta('**Con mucha luz de fondo el texto se lava.** La pantalla suma luz, no tapa: sobre una pared blanca al sol se va a leer mal. El emulador lo muestra así a propósito.'),

  h1('6. Marco'),
  p('El **Plano 4** ubica los módulos vistos desde arriba. La idea es repartir el peso: la electrónica y el parlante en una patilla, la batería en la otra y bien atrás, para que las gafas no se vayan hacia adelante.'),
  tabla([3, 3, 3], [
    ['Módulo', 'Medidas', 'Dónde va'],
    ['XIAO ESP32-S3 Sense', '21 × 17,8 mm', 'Patilla derecha, adelante; la cámara mira al frente'],
    ['MAX98357A', '19 × 18 mm', 'Patilla derecha, al medio'],
    ['Parlante', 'Ø 20 mm', 'Patilla derecha, a la altura del oído'],
    ['Módulo óptico', 'Pantalla de 27 × 27 mm, más lente y lámina', 'Frente, sobre el ojo derecho'],
    ['VL53L1X', '13 × 18 mm', 'Frente, al centro, mirando adelante'],
    ['MPU6050', '21 × 16 mm', 'Patilla izquierda, adelante'],
    ['Batería LiPo 502535', '35 × 25 × 5 mm', 'Patilla izquierda, atrás de la oreja'],
  ]),
  nota('**Diseño de partida, sin imprimir.** Las medidas de los módulos son las de sus hojas de datos; el marco hay que ajustarlo a la cara de quien lo use.'),

  h1('7. El software'),
  p('Todo está en la carpeta del proyecto. El **Plano 5** sigue un cuadro desde la cámara hasta la pantalla.'),
  tabla([3, 6], [
    ['Archivo', 'Qué hace'],
    ['`servidor.js`', 'El cerebro. Sirve el emulador y atiende a las gafas'],
    ['`src/sesion.js`', 'Un par de gafas conectado: cuadros, pantalla, guías, tarjetas, registro'],
    ['`src/protocolo.js`', 'Lo que viaja entre gafas y cerebro'],
    ['`src/rasgos.js` y `src/rasgos_v1.js`', 'Los dos extractores propios: color y bordes'],
    ['`src/rasgos_dino.js`', 'El extractor ya entrenado (DINOv2), que corre en la PC'],
    ['`cpp/redes.hpp` y `cpp/entrenar.cpp`', 'Las redes de MIIA en C++ y el entrenador que mide'],
    ['`src/conjunto.js`', 'Hace votar a las redes de los extractores que votan'],
    ['`src/detector.js`', 'Dice dónde está cada objeto en el cuadro (YOLOS-tiny, corre en la PC)'],
    ['`src/seguimiento.js`', 'Elige el objeto principal y le mide distancia, velocidad y tiempo'],
    ['`src/red_objetos.js`', 'La red personal: lo que se enseña en el momento'],
    ['`src/fichas.js`', 'Datos y partes de cada tipo de aparato y vehículo'],
    ['`src/identificar.js`', 'Marca y modelo de un aparato, con el LLM y a pedido'],
    ['`src/qr.js`', 'Lectura de tarjetas en códigos QR'],
    ['`src/base.js`', 'Lo que se guarda en MySQL'],
    ['`src/medir.js`', 'Dimensiones, peso estimado, distancia y velocidad'],
    ['`publico/`', 'El emulador: la página que hace de gafas'],
    ['`pruebas/`', 'Las pruebas en frío'],
  ]),
  h2('El protocolo'),
  tabla([2, 3, 4], [
    ['Sentido', 'Mensaje', 'Contenido'],
    ['Gafas → cerebro', 'Binario `0x01`', 'Audio del micrófono: 16 bits, 16 kHz'],
    ['Gafas → cerebro', 'Binario `0x02`', 'Un cuadro JPEG entero'],
    ['Cerebro → gafas', 'Binario `0x03`', 'Audio para el parlante: 16 bits, 24 kHz'],
    ['Cerebro → gafas', '`{t:"hud"}`', 'Título, hasta tres renglones y un pie, de 21 letras'],
    ['Gafas → cerebro', '`{t:"ensenar"}`, `{t:"paso"}`…', 'Botones: enseñar, siguiente, guardar tarjeta'],
  ]),
  p('El binario lleva un solo byte de cabecera y nada de base64, porque en un microcontrolador eso cuesta memoria. Si el cerebro escucha fuera de la propia máquina exige un token: por ese puerto pasan el micrófono y la cámara.'),

  h1('8. Qué reconoce y cuánto acierta'),
  p('Reconocer tiene dos pasos. Un **extractor** convierte la imagen en una lista de números; una **red** decide, a partir de esos números, qué clase es. Hay tres extractores y cada uno tiene su par de redes (`class23` y `class24`). Desde el 3 de octubre, con DINOv2 bajado votan sólo sus dos redes; sin él, las de los dos extractores propios.'),
  tabla([3, 2, 4], [
    ['Extractor', 'Números', 'Origen'],
    ['`rasgos_v0`', '168', 'Propio: histograma de color y bordes en una grilla de 4 × 4'],
    ['`rasgos_v1`', '1.060', 'Propio: bordes orientados por bloques y color por cuadrante'],
    ['`dino_s`', '384', 'DINOv2-small, de Meta (licencia Apache 2.0). Corre en la PC, sin internet'],
  ]),
  h2('Cómo fue mejorando'),
  p('Cada pasada se midió sobre fotos que las redes no habían visto, contra el azar (acertar siempre la clase más frecuente).'),
  tabla([5, 1.3, 1.5], [
    ['Qué se cambió', 'Clases', 'Acierto'],
    ['1 · Las redes de MIIA sobre el primer extractor propio', '40', '34,7 %'],
    ['2 · Foto entera, espejo y un segundo extractor propio', '40', '49,7 %'],
    ['3 · Se suma DINOv2 como tercer votante', '40', '94,0 %'],
    ['4 · Más dispositivos, y voto pesado al cubo', '55', '94,5 %'],
    ['5 · Celulares, de COCO; monitor y televisor unidos', '57', '91,8 %'],
    [medicion ? '6 · Vehículos, de Caltech-256 y de COCO' : '6 · Vehículos', medicion ? String(medicion.clases) : '—', medicion ? pct(fila('todos, voto por validación').acierto) : '—'],
  ]),
  ...(medicion ? [
    aire(),
    tabla([4, 2], [
      [`Última medición: ${medicion.fotos_de_prueba.toLocaleString('es-AR')} fotos de prueba`, 'Acierto'],
      ['Azar', pct(medicion.azar)],
      ...medicion.filas.map(f => [f.nombre.replace('todos, voto por validación', 'Los tres, voto pesado (el que se usa)').replace('todos, voto parejo', 'Los tres, voto parejo').replace(' solo', ', solo'), `${pct(f.acierto)} ± ${(100 * f.margen95).toFixed(1).replace('.', ',')}`]),
    ]),
    p(`La pantalla sólo muestra algo cuando la confianza llega a 0,7. Con ese umbral opina en el ${(100 * u07.opina / medicion.fotos_de_prueba).toFixed(0)} % de las fotos y acierta el ${(100 * u07.acierta / u07.opina).toFixed(0)} %.`),
  ] : []),
  h2('Lo que dicen esos números, sin adornos'),
  vineta('**El salto lo dio el extractor ya entrenado.** Los dos extractores propios, solos, no pasan del 50 %. Con voto parejo le restan puntos al tercero; por eso el voto se pesa y `dino_s` se lleva más del 90 %.'),
  vineta('**Los propios quedan** porque son los únicos que podrían correr dentro del microcontrolador, sin cerebro.'),
  vineta('**Bajó al sumar COCO**, y es esperable: son fotos de calles y casas reales, más difíciles que las de catálogo.'),
  vineta('**De celulares hay pocos:** 62 recortes, 14 de prueba. Ese resultado tiene mucho margen.'),
  ...(EN_VIVO ? [
    h2('Como en vivo'),
    p(`Para acercarse al uso real, cada foto de prueba se ubicó dentro del recuadro de un cuadro de 640 × 480 y se mandó al cerebro por el WebSocket, leyendo lo que mostraba la pantalla. De ${EN_VIVO.n} fotos: **${EN_VIVO.bien} bien**, se calló en ${EN_VIVO.callo} y se equivocó en ${EN_VIVO.mal}. Cuando opinó, acertó el ${EN_VIVO.cuandoOpina} %.`),
  ] : []),
  h2('El detector: dónde está cada cosa'),
  p('Las redes de arriba dicen qué es lo que llena el recuadro del centro. No sirven si el objeto está al costado, lejos o al lado de otro más grande: con un celular en la mano junto a la cara, ganaba siempre «persona». Para eso se sumó un **detector** (YOLOS-tiny, licencia Apache 2.0, 9,7 MB), que marca un recuadro por objeto y corre en la PC en unos 130 ms por cuadro.'),
  tabla([4, 3], [
    ['Medido el 2 de octubre de 2026', 'Resultado'],
    ['Objetos anotados de 14 clases que el detector encuentra (fotos de validación de COCO)', '845 de 1.124 (75 %)'],
    ['Celulares', '54 de 70 (77 %)'],
    ['De lo que marca con confianza menor a 0,9, es cierto', 'menos de 4 de cada 10'],
    ['El objeto que elige la mirada, uno por foto: es cierto', '305 de 338 (90 %)'],
    ['Escenas con un celular: la pantalla dijo «celular»', '25 de 40'],
    ['Escenas con una moto: la pantalla dijo «moto»', '19 de 23'],
  ]),
  vineta('**Sólo conoce 80 clases.** Un destornillador o una calculadora no los ve: para eso siguen las redes propias.'),
  vineta('**Se equivoca mucho cuando duda.** Marca unos 12 recuadros por foto y más de la mitad no son nada. Por eso sólo cuenta lo que marca con confianza de 0,9 o más.'),
  vineta('**Segunda opinión.** Lo que marca sin llegar a 0,9 no se tira: el recorte se le muestra a las redes propias, y vale sólo si ellas dicen lo mismo que el detector. Así se recupera el celular en la mano. Si no coinciden se descarta: medido, en ese caso las redes aciertan muy pocas veces.'),
  vineta('**De todos los objetos elige uno: el que se está mirando.** Las gafas no ven el ojo, así que la mirada es el centro de la imagen, adonde apunta la cabeza. Lo que queda alrededor no se muestra. Si es una persona con algo en la mano, el objeto.'),
  vineta('**La pantalla no salta.** No cambia de tema más de una vez cada 2 segundos, para no cansar la vista ni sacar la atención de la calle.'),
  vineta('**Un vehículo que viene de costado no se anuncia:** sólo se mide lo que se mira.'),
  nota('**Sin medir con la cámara real.** Todo lo anterior son fotos de bases públicas. Con una webcam, luz de interior y objetos propios puede dar menos, y eso todavía no se midió. El objeto tiene que llenar el recuadro punteado.'),
  h2('Enseñarle un objeto propio'),
  p('La red personal aprende lo que se le muestra: se escribe el nombre, se aprieta Enseñar y guarda 12 cuadros. Enseñándole siete cosas que la red general nunca había visto, con 12 fotos distintas de cada una, reconoció el **96,2 %** de 210 fotos nuevas (con el extractor propio original era 43,3 %).'),
  vineta('Hay que enseñarle primero **nada** (la mesa vacía): sin eso, todo lo que vea lo va a llamar con el nombre de algo que conoce.'),
  vineta('Conviene girar el objeto mientras aprende, para que lo vea de varios lados.'),

  h1('9. La base de datos'),
  p('Lo que las gafas aprenden y reconocen se guarda en una base MySQL, la del XAMPP de esta computadora. Se llama `gafas` y es independiente de la base de MIIA, que vive en el mismo servidor y no se toca. El usuario `gafas` sólo tiene permiso sobre esa base.'),
  tabla([2, 6], [
    ['Tabla', 'Qué guarda'],
    ['`objetos`', 'El nombre de cada objeto que se enseñó'],
    ['`ejemplos`', 'Los vectores de cada objeto: **esto es el aprendizaje**'],
    ['`reconocimientos`', 'Una fila cada vez que cambia lo que las gafas reconocen'],
    ['`tarjetas_qr`', 'Las tarjetas que se decidió guardar'],
    ['`identificaciones`', 'Lo que contestó el LLM sobre un aparato'],
    ['`mediciones`', 'Distancia y velocidad de vehículos. Hoy vacía: falta el detector'],
  ]),
  vineta('**Qué persiste.** Se guardan los ejemplos, no los pesos de la red: al arrancar, el cerebro lee los ejemplos y recalcula los pesos en menos de un segundo. Así no hay dos copias que se puedan desacomodar.'),
  vineta('**No se guardan fotos.** De un objeto queda un vector de 384 números, que no se puede volver a convertir en imagen.'),
  vineta('**Es opcional.** Con MySQL apagado el cerebro arranca igual, avisa y guarda lo aprendido en un archivo, como antes.'),
  p('Probado de punta a punta: se enseñaron tres objetos por el servidor, se borró el archivo local, se reinició el cerebro y los tres volvieron desde MySQL; reconoció 17 de 18 fotos nuevas.'),
  nota('El MySQL de XAMPP escucha en todas las interfaces de red y su usuario `root` no tiene contraseña: es la configuración de fábrica. En una red compartida conviene ponerle clave a `root`.'),

  h1('10. Tarjetas en código QR'),
  p('Es la forma en que las gafas saben quién es una persona: **lo decide esa persona**. Arma una tarjeta con lo que quiere compartir, la convierte en un código QR y lo muestra. Las gafas lo leen y ponen en pantalla el nombre y hasta dos renglones más.'),
  codigo('npm run tarjeta -- "Ana Pérez" --org "Taller Sur" --url https://instagram.com/ana.perez'),
  vineta('Entiende tarjetas de contacto (vCard y MECARD), enlaces y texto. De un enlace a una red social muestra la red y el usuario.'),
  vineta('**No abre ningún enlace** ni ejecuta nada de lo que diga el código: sólo lo muestra.'),
  vineta('**Leer una tarjeta no la guarda.** Queda en la base únicamente si se aprieta Guardar.'),

  h1('11. Vehículos: distancia, velocidad y tiempo'),
  p('Las gafas reconocen autos, motos, colectivos, camiones, bicicletas, trenes, aviones, barcos, helicópteros y topadoras. Con el detector, además, les miden la distancia, la velocidad de acercamiento y el tiempo que falta para que lleguen, y lo muestran en pantalla: «A ≈ 12 m», «Se acerca ≈ 20 km/h», «Llega en ≈ 2 s». También miden la distancia a una persona.'),
  h2('Cómo sale cada número'),
  tabla([3, 5], [
    ['Qué', 'Cómo sale'],
    ['Distancia', 'alto real × focal ÷ alto en píxeles. Un auto de 1,5 m que ocupa 115 píxeles está a 10 m'],
    ['Velocidad de acercamiento', '(distancia anterior − distancia actual) ÷ tiempo'],
    ['Tiempo hasta que llega', 'distancia ÷ velocidad'],
    ['Alcance', 'Con la webcam actual, un auto deja de poder medirse a unos 58 m'],
  ]),
  h2('Cuánto creerle'),
  vineta('**No se probó con vehículos reales.** Las cuentas están probadas con un auto simulado que viene a 36 km/h, y el camino completo con fotos fijas. Falta salir a la calle con una cinta métrica.'),
  vineta('**La distancia tiene un error de al menos 15 %,** porque los vehículos no miden todos lo mismo, y depende de cargar bien el campo de visión de la cámara.'),
  vineta('**La velocidad es peor:** sale de cómo cambia la distancia en tres segundos, a dos cuadros por segundo. Sirve para «viene rápido», no para un radar de tránsito. Sólo cuenta lo que viene de frente.'),
  vineta('**Si el vehículo está cortado por el borde de la imagen, no se mide.**'),
  vineta('**Para velocidad de verdad** lo que corresponde es un radar Doppler de 24 GHz, que la mide directamente. Está en la lista de materiales y hay pines libres para conectarlo.'),

  h1('12. Privacidad'),
  p('Las gafas llevan una cámara en la cara de alguien. Hay cosas que se decidió que no hagan.'),
  vineta('**No identifican personas.** Reconocen que hay una persona, como categoría. No dicen quién es, ni buscan su nombre o sus redes por la cara. Reconocer a un desconocido y juntarle los datos es el daño a la privacidad en sí, aunque cada dato suelto sea público.'),
  vineta('**La consulta de marca y modelo es sólo para aparatos.** Se niega si hay una persona en el recuadro, manda únicamente el recorte, y la respuesta no tiene dónde poner un nombre.'),
  vineta('**No se guardan imágenes**, ni en disco ni en la base.'),
  vineta('**Sin una clave de LLM (DeepSeek o Gemini), nada sale de la computadora.**'),
  vineta('**La memoria de objetos («¿dónde dejé…?») nunca guarda personas**: sólo el nombre del objeto, la hora y el lugar que puso el usuario.'),
  vineta('**Leer texto no lee documentos personales**: ni documentos de identidad, ni tarjetas, ni datos de otros. Y no se manda nada si hay una persona en el centro de la mirada.'),

  h1('13. Cómo se usa'),
  paso('Prender MySQL desde el panel de XAMPP (opcional: sin él, anda igual).'),
  paso('En la carpeta del proyecto, correr `npm start`.'),
  paso('Abrir `http://127.0.0.1:8787` en Edge o Chrome y apretar «Prender la cámara».'),
  paso('Poner un objeto de modo que llene el recuadro punteado.'),
  aire(),
  tabla([3, 5], [
    ['Comando', 'Para qué'],
    ['`npm start`', 'Levantar el cerebro'],
    ['`npm test`', 'Correr las pruebas en frío'],
    ['`npm run compilar`', 'Compilar el entrenador en C++'],
    ['`npm run entrenar`', 'Entrenar las redes con las bases públicas y medir'],
    ['`npm run tarjeta -- "Nombre"`', 'Armar un código QR con una tarjeta'],
    ['`npm run tarjeta -- --lugar cocina`', 'Armar el cartel QR de un lugar, para «¿dónde dejé…?»'],
    ['`npm run pruebas-reales`', 'Cuánto acierta con la webcam, según lo anotado en el emulador'],
    ['`npm run importar-myfixit -- <archivo>`', 'Convertir manuales de iFixit en guías'],
    ['`npm run documento`', 'Volver a generar este documento'],
  ]),
  p('Para conversar y para marca y modelo hay que poner una clave en el archivo `.env`: `DEEPSEEK_API_KEY` o `GEMINI_API_KEY`. La de Gemini tiene que ser una clave nueva, no la de MIIA, porque comparten cuota.'),
  p('**DeepSeek conversa por escrito: no tiene audio.** En el emulador escucha y habla el navegador (Edge o Chrome). Unas gafas de verdad, con DeepSeek, todavía no pueden conversar por voz: falta un transcriptor y un sintetizador en el cerebro. Con Gemini Live la voz va y viene como audio.'),

  h1('14. Lo que se sumó el 3 de octubre'),
  p('Todo es opcional: sin clave, sin detector o sin sensor, el cerebro arranca igual y cada cosa avisa qué le falta. El detalle está en la décima pasada de `PLAN.md`.'),
  tabla([2, 4, 2], [
    ['Qué', 'Cómo anda', 'Necesita'],
    ['«¿Dónde dejé…?»', 'Recuerda cuándo y dónde vio cada objeto por última vez. El lugar lo marca el usuario, o un cartel QR que diga LUGAR:cocina.', 'Nada'],
    ['Aviso de vehículo', 'Mira el cuadro entero y avisa con pitido y «¡CUIDADO!» si un vehículo llega en menos de 4 segundos. Es una ayuda: no reemplaza mirar.', 'El detector'],
    ['Leer texto', 'Carteles, etiquetas y vencimientos, con traducción. Las gafas mandan una foto más grande a pedido.', 'Clave del LLM'],
    ['Guías guardadas', 'Primeros auxilios y hogar, sin internet. Las de primeros auxilios hay que compararlas con la guía de Cruz Roja Argentina.', 'Nada'],
    ['Medir objetos', 'Ancho y alto del objeto del centro, y peso estimado según el material.', 'Detector y VL53L1X'],
    ['Pruebas reales', '«Acertó» o «Se equivocó» en el emulador, y un resumen con el margen de error.', 'La webcam'],
    ['Firmware', 'El programa del XIAO ESP32-S3: cámara, foto grande, OLED, sensor, botones, pitido y audio. Compila; sin probar en una placa.', 'El hardware'],
    ['Raspberry Pi', 'Cómo correr el cerebro en una Pi 5, para usar las gafas sin la PC (`docs/raspberry.md`).', 'Una Pi 5'],
  ]),
  p('Además, con DINOv2 bajado vota sólo él: los dos extractores hechos a mano no sumaban (91,2 % contra 91,3 %) y costaban tiempo. Sin DINOv2, votan ellos.'),

  h1('15. Qué está probado y qué no'),
  tabla([1, 1], [
    ['Probado', 'Sin probar'],
    ['Las pruebas en frío, incluida la base real', 'El micrófono y el parlante reales con la voz'],
    ['La voz y marca y modelo contra Gemini de verdad', 'La conversación y marca y modelo contra DeepSeek (sin saldo)'],
    ['El cerebro de punta a punta, con fotos de prueba y escenas reales mandadas como cuadros de cámara', 'El micrófono del navegador'],
    ['El detector contra las anotaciones de COCO', 'La distancia y la velocidad con vehículos reales'],
    ['La cámara con una webcam Logitech C270: reconoce una persona', 'El acierto con objetos propios y luz de interior'],
    ['Que lo aprendido vuelve de MySQL tras reiniciar', 'Todo el hardware: conexiones, óptica y marco'],
    ['La lectura y el guardado de una tarjeta QR', 'El programa del microcontrolador en una placa (compila, pero no hay hardware)'],
    ['Las funciones del 3 de octubre en el emulador, en un navegador de verdad', 'Leer texto contra la API real y el aviso con vehículos reales'],
  ]),

  h1('16. Lo que sigue'),
  paso('Medir el acierto con la webcam y objetos reales con «Acertó / Se equivocó», y correr `npm run pruebas-reales`.', 'siguientes'),
  paso('Probar la voz con el micrófono de verdad, y cargar saldo en DeepSeek para probarlo.', 'siguientes'),
  paso('Comparar las guías de primeros auxilios con la guía oficial de Cruz Roja Argentina.', 'siguientes'),
  paso('Probar la distancia, la velocidad y el aviso en la calle, y calibrar el campo de visión de la cámara.', 'siguientes'),
  paso('Comprar el XIAO, la pantalla y el sensor; cargar el programa de `firmware/gafas_xiao` y probarlo.', 'siguientes'),
  paso('Armar la óptica y ajustar el foco; imprimir el marco.', 'siguientes'),
  paso('Pasar el cerebro a una Raspberry Pi 5 (`docs/raspberry.md`) y medir si le da la velocidad.', 'siguientes'),
  paso('Después del 12 de octubre: que las gafas le consulten a MIIA.', 'siguientes'),
];

const planos = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Planos')] }),
  p('Los cinco planos van a hoja completa. Se regeneran con `python herramientas/dibujar_planos.py`.'),
  ...plano('plano1_bloques.png', 1800, 1100, 'Plano 1 — Bloques del sistema', 'Qué corre en las gafas, qué corre en el cerebro y qué sale de la máquina.'),
  ...plano('plano2_conexiones.png', 1800, 1100, 'Plano 2 — Conexiones eléctricas', 'Propuesta de cableado. Confirmar los pines con el diagrama del fabricante antes de soldar.'),
  ...plano('plano3_optica.png', 1800, 1100, 'Plano 3 — Óptica', 'Vista de costado. Medidas de partida; el foco se ajusta a mano.'),
  ...plano('plano4_marco.png', 2100, 1100, 'Plano 4 — Marco y ubicación de los módulos', 'Vista superior. Diseño de partida, sin imprimir.'),
  ...plano('plano5_camino.png', 1800, 900, 'Plano 5 — El camino de un cuadro', 'De la cámara a la pantalla, dos veces por segundo.'),
];

const pieDePagina = { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: 'Gafas MIIA — Documentación y planos · página ', size: 18, color: GRIS }),
  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GRIS }),
] })] }) };
const margenes = { top: 1440, right: 1440, bottom: 1440, left: 1440 };

const doc = new Document({
  creator: 'Martín Rinaldi Toledo',
  title: 'Gafas MIIA — Documentación y planos',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, color: AZUL, font: 'Arial' }, paragraph: { spacing: { before: 520, after: 220 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, color: AZUL, font: 'Arial' }, paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: 'vinetas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] },
    ...['pasos', 'siguientes'].map(reference => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 360 } } } }] })),
  ] },
  sections: [
    // Un renglón de aire después de cada tabla: si no, el texto que sigue queda pegado al borde.
    { properties: { page: { margin: margenes } }, footers: pieDePagina,
      children: [...portada, ...cuerpo].flatMap(x => x instanceof Table ? [x, new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: '', size: 12 })] })] : [x]) },
    { properties: { page: { margin: margenes, size: { orientation: PageOrientation.LANDSCAPE } } }, footers: pieDePagina, children: planos },
  ],
});

writeFileSync(SALIDA, await Packer.toBuffer(doc));
console.log(`✅ ${SALIDA}`);
