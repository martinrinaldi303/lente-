# dibujar_planos.py — genera los planos de docs/planos/ (PNG) que van al documento Word.
#
#   python herramientas/dibujar_planos.py
#
# Son planos de PARTIDA: las medidas de los módulos salen de sus hojas de datos, pero
# el marco, las distancias ópticas y el reparto de pines no se armaron ni se midieron
# todavía. Cada plano lo dice en su pie.

import math
import os
from PIL import Image, ImageDraw, ImageFont

SALIDA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'planos')
os.makedirs(SALIDA, exist_ok=True)

TINTA, GRIS, CLARO, AZUL, ROJO, VERDE, NARANJA = '#1c2430', '#6b7686', '#eef1f5', '#1f6fb5', '#c0392b', '#2e8b57', '#d9822b'
FONDO = 'white'

def fuente(tam, negrita=False):
    for nombre in (['segoeuib.ttf', 'arialbd.ttf'] if negrita else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(os.path.join('C:\\Windows\\Fonts', nombre), tam)
        except OSError:
            pass
    return ImageFont.load_default()

F_TIT, F_SUB, F, F_CH, F_NEG = fuente(40, True), fuente(24), fuente(24), fuente(20), fuente(24, True)

def lienzo(titulo, subtitulo, ancho=1800, alto=1100):
    img = Image.new('RGB', (ancho, alto), FONDO)
    d = ImageDraw.Draw(img)
    d.text((50, 30), titulo, font=F_TIT, fill=TINTA)
    d.text((50, 86), subtitulo, font=F_SUB, fill=GRIS)
    d.line((50, 128, ancho - 50, 128), fill=TINTA, width=3)
    return img, d

def pie(d, texto, ancho=1800, alto=1100):
    d.line((50, alto - 70, ancho - 50, alto - 70), fill=GRIS, width=1)
    d.text((50, alto - 58), texto, font=F_CH, fill=GRIS)

def caja(d, x, y, w, h, titulo, lineas=(), color=AZUL, relleno=CLARO):
    d.rounded_rectangle((x, y, x + w, y + h), radius=12, fill=relleno, outline=color, width=3)
    d.text((x + 16, y + 12), titulo, font=F_NEG, fill=color)
    for i, l in enumerate(lineas):
        d.text((x + 16, y + 48 + i * 28), l, font=F_CH, fill=TINTA)

def flecha(d, x1, y1, x2, y2, color=TINTA, ancho=3, texto=None, doble=False, lado=1):
    d.line((x1, y1, x2, y2), fill=color, width=ancho)
    def punta(xa, ya, xb, yb):
        ang = math.atan2(yb - ya, xb - xa)
        for s in (-1, 1):
            d.line((xb, yb, xb - 16 * math.cos(ang + s * 0.4), yb - 16 * math.sin(ang + s * 0.4)), fill=color, width=ancho)
    punta(x1, y1, x2, y2)
    if doble:
        punta(x2, y2, x1, y1)
    if texto:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        w = d.textlength(texto, font=F_CH)
        if abs(x2 - x1) >= abs(y2 - y1):
            d.text((mx - w / 2, my - 30 if lado > 0 else my + 8), texto, font=F_CH, fill=color)
        else:
            d.text((mx + 12 if lado > 0 else mx - w - 12, my - 12), texto, font=F_CH, fill=color)

def cota(d, x1, y1, x2, y2, texto, color=ROJO):
    """Línea de cota con topes y su medida."""
    d.line((x1, y1, x2, y2), fill=color, width=2)
    if abs(x2 - x1) >= abs(y2 - y1):
        for x in (x1, x2):
            d.line((x, y1 - 9, x, y1 + 9), fill=color, width=2)
        w = d.textlength(texto, font=F_CH)
        d.text(((x1 + x2) / 2 - w / 2, y1 - 30), texto, font=F_CH, fill=color)
    else:
        for y in (y1, y2):
            d.line((x1 - 9, y, x1 + 9, y), fill=color, width=2)
        d.text((x1 + 14, (y1 + y2) / 2 - 12), texto, font=F_CH, fill=color)


# ── Plano 1: bloques del sistema ─────────────────────────────────────────────
def plano_bloques():
    img, d = lienzo('Plano 1 — Bloques del sistema', 'Qué corre en las gafas, qué corre en el cerebro y qué sale de la máquina')
    d.rounded_rectangle((60, 170, 600, 960), radius=18, outline=GRIS, width=2)
    d.text((80, 182), 'GAFAS (ESP32-S3)', font=F_NEG, fill=GRIS)
    caja(d, 90, 240, 480, 120, 'Cámara OV2640', ['JPEG 640×480, 2 cuadros/s'], VERDE)
    caja(d, 90, 380, 480, 120, 'Micrófono PDM', ['PCM 16 bits, 16 kHz'], VERDE)
    caja(d, 90, 520, 480, 120, 'OLED SSD1306 128×64', ['5 renglones de 21 letras'], VERDE)
    caja(d, 90, 660, 480, 120, 'Parlante + MAX98357A', ['PCM 16 bits, 24 kHz'], VERDE)
    caja(d, 90, 800, 480, 130, 'Sensores I2C', ['VL53L1X: distancia hasta 4 m', 'MPU6050: movimiento de cabeza'], VERDE)

    d.rounded_rectangle((760, 170, 1300, 960), radius=18, outline=GRIS, width=2)
    d.text((780, 182), 'CEREBRO (Node, PC o servidor)', font=F_NEG, fill=GRIS)
    caja(d, 790, 240, 480, 110, 'servidor.js', ['WebSocket /ws/gafas, token'], AZUL)
    caja(d, 790, 365, 480, 110, 'sesion.js', ['Cola acotada, HUD, guías, QR'], AZUL)
    caja(d, 790, 490, 480, 140, 'Extractores', ['rasgos_v0 · rasgos_v1 (propios)', 'dino_s (DINOv2, local)'], AZUL)
    caja(d, 790, 645, 480, 140, 'Redes de MIIA en C++', ['class23 + class24 por extractor', 'voto pesado por validación'], AZUL)
    caja(d, 790, 800, 480, 130, 'Red personal', ['Lo que se enseña: 12 cuadros', 'sobre dino_s|384'], AZUL)

    caja(d, 1420, 240, 330, 150, 'Gemini Live', ['Voz: escucha y habla', '(única API en vivo)'], NARANJA, '#fdf3e6')
    caja(d, 1420, 420, 330, 150, 'Gemini visión', ['Marca y modelo de', 'aparatos, a pedido'], NARANJA, '#fdf3e6')
    caja(d, 1420, 660, 330, 150, 'MySQL (XAMPP)', ['Base «gafas»: lo', 'aprendido y el registro'], ROJO, '#fbeeee')

    flecha(d, 570, 300, 790, 300, VERDE, texto='0x02 + JPEG')
    flecha(d, 570, 440, 790, 420, VERDE, texto='0x01 + audio')
    flecha(d, 790, 560, 570, 580, AZUL, texto='{t:"hud"}', lado=-1)
    flecha(d, 790, 720, 570, 720, AZUL, texto='0x03 + audio', lado=-1)
    flecha(d, 1270, 295, 1420, 315, NARANJA, doble=True)
    flecha(d, 1270, 420, 1420, 495, NARANJA)
    flecha(d, 1270, 865, 1420, 735, ROJO, doble=True)
    d.text((648, 196), 'WiFi', font=F_NEG, fill=TINTA)
    pie(d, 'Naranja: sale de la máquina (pide internet y clave). Rojo: base local. Las gafas todavía no existen: hoy las emula el navegador (publico/).')
    img.save(os.path.join(SALIDA, 'plano1_bloques.png'))


# ── Plano 2: conexiones ──────────────────────────────────────────────────────
def plano_conexiones():
    img, d = lienzo('Plano 2 — Conexiones eléctricas', 'Seeed XIAO ESP32-S3 Sense y sus módulos. Todo a 3,3 V; el bus I2C es compartido')
    # La placa, con sus pines a los costados.
    px, py, pw, ph = 720, 220, 360, 620
    d.rounded_rectangle((px, py, px + pw, py + ph), radius=16, fill='#e9f1fa', outline=AZUL, width=4)
    d.text((px + 34, py + 20), 'XIAO ESP32-S3', font=F_NEG, fill=AZUL)
    d.text((px + 34, py + 52), 'Sense', font=F_NEG, fill=AZUL)
    d.rounded_rectangle((px + 110, py - 26, px + 250, py + 6), radius=6, fill=GRIS)
    d.text((px + 138, py - 24), 'USB-C', font=F_CH, fill='white')
    d.text((px + 34, py + 110), 'Adentro de la placa:', font=F_CH, fill=GRIS)
    for i, l in enumerate(['cámara OV2640', 'micrófono PDM', '(GPIO41 y GPIO42)', 'ranura microSD', 'cargador de LiPo']):
        d.text((px + 34, py + 140 + i * 28), l, font=F_CH, fill=TINTA)

    izq = [('D0', 'GPIO1'), ('D1', 'GPIO2'), ('D2', 'GPIO3'), ('D3', 'GPIO4'), ('D4', 'GPIO5 · SDA'), ('D5', 'GPIO6 · SCL'), ('D6', 'GPIO43')]
    der = [('5V', ''), ('GND', ''), ('3V3', ''), ('D10', 'GPIO9'), ('D9', 'GPIO8'), ('D8', 'GPIO7'), ('D7', 'GPIO44')]
    yi = {}
    for i, (n, g) in enumerate(izq):
        y = py + 330 + i * 40
        yi[n] = y
        d.ellipse((px - 10, y - 10, px + 10, y + 10), fill='#d4a017', outline=TINTA)
        d.text((px + 20, y - 13), f'{n}  {g}', font=F_CH, fill=TINTA)
    for i, (n, g) in enumerate(der):
        y = py + 330 + i * 40
        yi[n] = y
        d.ellipse((px + pw - 10, y - 10, px + pw + 10, y + 10), fill='#d4a017', outline=TINTA)
        w = d.textlength(f'{g}  {n}'.strip(), font=F_CH)
        d.text((px + pw - 20 - w, y - 13), f'{g}  {n}'.strip(), font=F_CH, fill=TINTA)

    def cable(x1, y1, x2, y2, color, quiebre):
        d.line((x1, y1, quiebre, y1, quiebre, y2, x2, y2), fill=color, width=4, joint='curve')

    # Izquierda: botón y amplificador.
    caja(d, 70, 190, 420, 110, 'Botón', ['a GND, con pull-up interna'], GRIS)
    cable(px - 10, yi['D0'], 490, 245, GRIS, 560)
    caja(d, 70, 330, 420, 210, 'MAX98357A (amplificador I2S)', ['BCLK ← D1', 'LRC  ← D2', 'DIN  ← D3', 'VIN ← 3V3 · GND ← GND'], NARANJA, '#fdf3e6')
    cable(px - 10, yi['D1'], 490, 400, NARANJA, 600)
    cable(px - 10, yi['D2'], 490, 430, NARANJA, 620)
    cable(px - 10, yi['D3'], 490, 460, NARANJA, 640)
    caja(d, 70, 570, 420, 100, 'Parlante 8 Ω, 0,5 W', ['a las salidas + y − del amplificador'], NARANJA, '#fdf3e6')
    d.line((280, 540, 280, 570), fill=NARANJA, width=4)

    # Bus I2C: una línea para SDA y otra para SCL, y los tres módulos colgados.
    caja(d, 70, 720, 420, 250, 'Bus I2C (compartido)', ['SDA ← D4      SCL ← D5', '', 'OLED SSD1306 ......... 0x3C', 'VL53L1X (distancia) .. 0x29', 'MPU6050 (movimiento) . 0x68', 'Cada uno: VCC ← 3V3, GND ← GND'], VERDE, '#eaf6ef')
    cable(px - 10, yi['D4'], 490, 790, VERDE, 580)
    cable(px - 10, yi['D5'], 490, 820, VERDE, 600)

    # Derecha: alimentación.
    caja(d, 1300, 190, 440, 190, 'Batería LiPo 3,7 V', ['500 a 1000 mAh', 'A los contactos BAT+ y BAT−', 'de ABAJO de la placa.', 'Se carga por el USB-C.'], ROJO, '#fbeeee')
    d.line((1300, 300, 1190, 300, 1190, py + 60, px + pw, py + 60), fill=ROJO, width=4)
    caja(d, 1300, 420, 440, 200, 'Alimentación de los módulos', ['3V3 → VCC de todos', 'GND → GND de todos', 'El pin 5V sólo tiene tensión', 'con el USB enchufado: no usarlo.'], ROJO, '#fbeeee')
    cable(px + pw + 10, yi['3V3'], 1300, 500, ROJO, 1220)
    cable(px + pw + 10, yi['GND'], 1300, 540, TINTA, 1250)
    caja(d, 1300, 660, 440, 200, 'Libres', ['D6 a D10: para un radar Doppler', '(velocidad) o más botones.', 'D8, D9 y D10 los usa la microSD', 'si se pone una tarjeta.'], GRIS)
    pie(d, 'SIN ARMAR NI PROBAR. Los números de GPIO hay que confirmarlos con el pinout de Seeed antes de soldar. Direcciones I2C: las de fábrica.')
    img.save(os.path.join(SALIDA, 'plano2_conexiones.png'))


# ── Plano 3: óptica ──────────────────────────────────────────────────────────
def plano_optica():
    img, d = lienzo('Plano 3 — Óptica (vista de costado, ojo derecho)', 'El OLED mira hacia abajo, la lente aleja la imagen y la lámina a 45° la manda al ojo')
    E = 9.0   # px por mm
    ox, oy = 640, 230          # esquina del OLED
    # OLED: 27 mm de módulo, 21,7 mm de área activa (se ve de canto el lado de 10,9 mm).
    d.rectangle((ox, oy, ox + 27 * E, oy + 4 * E), fill='#22303f', outline=TINTA, width=2)
    d.text((ox + 27 * E + 20, oy - 2), 'OLED 0,96" (módulo 27 × 27 × 4 mm)', font=F, fill=TINTA)
    d.text((ox + 27 * E + 20, oy + 28), 'Área que se ve: 21,7 × 10,9 mm', font=F_CH, fill=GRIS)
    cx = ox + 13.5 * E
    # Lente plano-convexa. La distancia se dibuja comprimida para que entre: vale la cota.
    ly = oy + 4 * E + 50 * E * 0.72
    d.pieslice((cx - 12.5 * E, ly - 30, cx + 12.5 * E, ly + 60), 180, 360, fill='#cfe6f7', outline=AZUL, width=3)
    d.line((cx - 12.5 * E, ly + 15, cx + 12.5 * E, ly + 15), fill=AZUL, width=3)
    d.text((cx + 12.5 * E + 20, ly - 20), 'Lente plano-convexa', font=F, fill=TINTA)
    d.text((cx + 12.5 * E + 20, ly + 10), 'Ø 25 mm, focal 50 mm', font=F_CH, fill=GRIS)
    xc = ox - 250                # las cotas van bien a la izquierda, lejos de los rayos
    d.line((xc, oy + 4 * E, ox, oy + 4 * E), fill='#e7b8b2', width=1)
    d.line((xc, ly + 15, cx - 12.5 * E, ly + 15), fill='#e7b8b2', width=1)
    cota(d, xc, oy + 4 * E, xc, ly + 15, '50 mm (la focal)')
    # Lámina a 45°.
    my = ly + 15 + 22 * E
    d.line((cx - 14 * E, my + 14 * E, cx + 14 * E, my - 14 * E), fill=VERDE, width=7)
    d.text((cx + 15 * E + 10, my - 14 * E - 6), 'Lámina semiespejada a 45°', font=F, fill=TINTA)
    d.text((cx + 15 * E + 10, my - 14 * E + 24), '30 × 25 mm (o acrílico de 1 mm)', font=F_CH, fill=GRIS)
    cota(d, xc, ly + 15, xc, my, '22 mm')
    # Rayos: bajan del OLED, cruzan la lente y la lámina los manda al ojo, a la izquierda.
    for dx in (-8, 0, 8):
        d.line((cx + dx * E, oy + 4 * E, cx + dx * E, my - dx * E), fill=NARANJA, width=2)
        flecha(d, cx + dx * E, my - dx * E, 250, my - dx * E, NARANJA, 2)
    # Ojo.
    d.ellipse((110, my - 70, 250, my + 70), outline=TINTA, width=3)
    d.ellipse((205, my - 26, 249, my + 26), fill='#3b5d7a')
    d.text((150, my + 80), 'Ojo', font=F, fill=TINTA)
    cota(d, 250, my + 160, cx, my + 160, '20 a 25 mm (de la lámina al ojo)')
    # El mundo, de frente, atraviesa la lámina.
    flecha(d, 1500, my + 60, cx + 16 * E, my + 60, GRIS, 2)
    d.text((cx + 20 * E, my + 70), 'La luz de afuera atraviesa la lámina', font=F_CH, fill=GRIS)
    caja(d, 1230, 330, 520, 330, 'Qué se ve', [
        'Imagen en el infinito: no hay', 'que enfocar de cerca.', '',
        'Ancho aparente:', '2·atan(21,7 / 2 / 50) ≈ 24,5°', '',
        'Sale espejada: el cerebro la', 'manda al revés («Espejar»).'], AZUL)
    pie(d, 'MEDIDAS DE PARTIDA, sin armar. El foco se ajusta acercando o alejando el OLED de la lente. El dibujo no está a escala en vertical.')
    img.save(os.path.join(SALIDA, 'plano3_optica.png'))


# ── Plano 4: marco, vista superior ───────────────────────────────────────────
def plano_marco():
    ANCHO = 2100
    img, d = lienzo('Plano 4 — Marco y ubicación de los módulos (vista superior)', 'El peso se reparte: electrónica en una patilla, batería en la otra, atrás de la oreja', ancho=ANCHO)
    E = 6.5
    fx, fy = 620, 250            # esquina del frente
    FW, FT, PAT = 140, 8, 140    # ancho y espesor del frente y largo de las patillas, mm
    LARGO = PAT * E * 0.70       # las patillas se dibujan al 70 %: vale la cota
    der = fx + FW * E
    d.rectangle((fx, fy, der, fy + FT * E), fill=CLARO, outline=TINTA, width=3)
    d.text((fx + FW * E / 2 - 50, fy + 12), 'FRENTE', font=F_NEG, fill=GRIS)
    for x in (fx, der - 6 * E):
        d.rectangle((x, fy + FT * E, x + 6 * E, fy + FT * E + LARGO), fill=CLARO, outline=TINTA, width=3)
    cota(d, fx, fy - 30, der, fy - 30, '140 mm')
    cota(d, fx + 6 * E + 40, fy + FT * E, fx + 6 * E + 40, fy + FT * E + LARGO, '140 mm')

    def modulo(x, y, w, h, nombre, medida, color, tx, ty):
        d.rounded_rectangle((x, y, x + w * E, y + h * E), radius=6, fill='white', outline=color, width=4)
        d.text((tx, ty), nombre, font=F_NEG, fill=color)
        d.text((tx, ty + 30), medida, font=F_CH, fill=TINTA)

    # Patilla DERECHA del usuario (izquierda del dibujo): la electrónica, por fuera.
    xm = fx - 26 * E
    modulo(xm, fy + 14 * E, 21, 17.8, 'XIAO ESP32-S3 Sense', '21 × 17,8 mm · la cámara mira al frente', AZUL, 60, fy + 14 * E + 20)
    modulo(xm, fy + 40 * E, 19.4, 17.8, 'MAX98357A', '19 × 18 mm', NARANJA, 60, fy + 40 * E + 20)
    modulo(xm, fy + 68 * E, 20, 20, 'Parlante', 'Ø 20 mm, a la altura del oído', NARANJA, 60, fy + 68 * E + 30)
    d.text((xm - 10, fy + FT * E + LARGO + 14), 'patilla DERECHA', font=F_CH, fill=GRIS)

    # Frente: el módulo óptico sobre el ojo derecho y el sensor de distancia al centro.
    modulo(fx + 16 * E, fy + FT * E + 5 * E, 27, 27, 'Módulo óptico', 'OLED 27 × 27 mm + lente + lámina', VERDE, fx + 16 * E, fy + FT * E + 36 * E)
    modulo(fx + 63.5 * E, fy + FT * E + 5 * E, 13, 18, 'VL53L1X', '13 × 18 mm, mira al frente', VERDE, fx + 63.5 * E, fy + FT * E + 27 * E)

    # Patilla IZQUIERDA del usuario (derecha del dibujo): movimiento y batería, por fuera.
    xd = der + 6 * E
    modulo(xd, fy + 14 * E, 21, 16, 'MPU6050', '21 × 16 mm', VERDE, xd + 30 * E, fy + 14 * E + 20)
    modulo(xd, fy + 52 * E, 25, 35, 'LiPo 502535', '35 × 25 × 5 mm · 500 mAh', ROJO, xd + 30 * E, fy + 62 * E)
    d.text((xd, fy + FT * E + LARGO + 14), 'patilla IZQUIERDA', font=F_CH, fill=GRIS)

    d.text((fx + 22 * E, fy + FT * E + 62 * E), 'Por dentro del frente pasan 4 hilos de una patilla a la otra:', font=F_CH, fill=GRIS)
    d.text((fx + 22 * E, fy + FT * E + 67 * E), '3V3, GND, SDA y SCL, más BAT+ y BAT− hasta la batería.', font=F_CH, fill=GRIS)
    pie(d, 'DISEÑO DE PARTIDA, sin imprimir. Las medidas de los módulos son las de sus hojas de datos; el marco se ajusta a la cara de cada uno. Patillas dibujadas al 70 %.', ancho=ANCHO)
    img.save(os.path.join(SALIDA, 'plano4_marco.png'))


# ── Plano 5: el camino de un cuadro ──────────────────────────────────────────
def plano_camino():
    img, d = lienzo('Plano 5 — El camino de un cuadro', 'De la cámara a la pantalla, dos veces por segundo', alto=900)
    y = 230
    pasos = [
        ('Cuadro JPEG', ['640 × 480', 'llega por WebSocket'], VERDE),
        ('Cola acotada', ['Se queda con los', '2 más nuevos'], GRIS),
        ('¿Hay un QR?', ['En el cuadro entero', '→ tarjeta en pantalla'], NARANJA),
        ('Recuadro del centro', ['El 60 % del lado', 'menor: 288 × 288'], AZUL),
        ('3 extractores', ['168 + 1060 + 384', 'números'], AZUL),
    ]
    x = 60
    for i, (t, l, c) in enumerate(pasos):
        caja(d, x, y, 310, 150, t, l, c)
        if i < len(pasos) - 1:
            flecha(d, x + 310, y + 75, x + 345, y + 75)
        x += 345
    y2 = 500
    pasos2 = [
        ('Red personal', ['Lo que se enseñó', '→ «veo: …»'], AZUL),
        ('6 redes en C++', ['class23 + class24', 'por cada extractor'], AZUL),
        ('Voto pesado', ['dino_s lleva ~92 %', 'umbral 0,7'], AZUL),
        ('Mayoría de 5', ['3 de los últimos 5', 'cuadros → «creo: …»'], AZUL),
        ('HUD', ['Ficha, partes, color', '5 renglones × 21'], VERDE),
    ]
    x = 60
    for i, (t, l, c) in enumerate(pasos2):
        caja(d, x, y2, 310, 150, t, l, c)
        if 0 < i < len(pasos2) - 1:     # la red personal y las redes generales van en paralelo
            flecha(d, x + 310, y2 + 75, x + 345, y2 + 75)
        x += 345
    d.line((60 + 4 * 345 + 155, y + 150, 60 + 4 * 345 + 155, y + 205, 60 + 155, y + 205, 60 + 155, y2), fill=TINTA, width=3)
    flecha(d, 60 + 155, y2 - 30, 60 + 155, y2)
    d.line((60 + 4 * 345 + 155, y + 205, 60 + 345 + 155, y + 205), fill=TINTA, width=3)
    flecha(d, 60 + 345 + 155, y + 205, 60 + 345 + 155, y2)
    caja(d, 60, 700, 1690, 90, 'Y aparte, sólo si se pide', ['«Marca y modelo»: el recorte del recuadro va al LLM, salvo que haya una persona. Cada cambio de lo reconocido se anota en MySQL.'], NARANJA, '#fdf3e6')
    pie(d, 'Tiempos medidos en el Ryzen 5 5600GT: DINOv2 ~28 ms por cuadro; todo el camino, menos de 80 ms.', alto=900)
    img.save(os.path.join(SALIDA, 'plano5_camino.png'))


for f in (plano_bloques, plano_conexiones, plano_optica, plano_marco, plano_camino):
    f()
print('planos en', SALIDA)
