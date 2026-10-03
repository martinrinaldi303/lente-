// gafas_xiao.ino — el programa de las gafas: Seeed XIAO ESP32-S3 Sense.
//
// Hace lo mismo que el emulador del navegador (publico/gafas.js) y habla el MISMO
// protocolo (src/protocolo.js): manda cámara, micrófono, botones y el sensor de
// distancia, y dibuja en el OLED lo que el cerebro le ordena. No decide nada: toda la
// lógica está en el cerebro. Si algo de lógica termina acá, está en el lugar equivocado.
//
// Las conexiones son las de docs/planos/plano2_conexiones.png:
//   D0 (GPIO1)   botón 1, a GND: corto = siguiente, largo = anterior
//   D1 (GPIO2)   MAX98357A BCLK      D2 (GPIO3)  MAX98357A LRC     D3 (GPIO4)  MAX98357A DIN
//   D4 (GPIO5)   SDA                 D5 (GPIO6)  SCL   → OLED 0x3C y VL53L1X 0x29
//   D6 (GPIO43)  buzzer activo, o motor de vibración con un transistor: el aviso de vehículo
//   D7 (GPIO44)  botón 2, a GND: corto = leer texto, largo = marca y modelo
//   Cámara y micrófono PDM (GPIO41 y GPIO42): ya vienen en la placa Sense.
//
// Para compilar (Arduino IDE o arduino-cli), placa «XIAO_ESP32S3» con PSRAM «OPI PSRAM»:
//   arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32S3:PSRAM=opi firmware/gafas_xiao
// Bibliotecas: WebSockets (Markus Sattler), ArduinoJson 7, Adafruit SSD1306 y GFX, VL53L1X (Pololu).
//
// ⚠️ Compilado el 3-oct-2026 con el núcleo esp32 3.3.12, pero SIN PROBAR en una placa:
// todavía no hay hardware. Los pines salen de la hoja de Seeed y del plano; confirmarlos
// antes de soldar.
//
// Lo que todavía no hace:
//   · Con DeepSeek (que conversa por escrito) no hay voz: haría falta transcribir y
//     sintetizar en el cerebro. Con Gemini Live, sí: el micrófono sube y el parlante suena.
//   · {t:"decir"} (leer en voz alta con la voz de las gafas) se ignora: el ESP32 no
//     tiene un sintetizador. La respuesta queda en la pantalla.
//   · El MPU6050 del plano (gestos de cabeza) no se usa.

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_camera.h>
#include <ESP_I2S.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <VL53L1X.h>

#if __has_include("config.h")
#include "config.h"
#else
#warning "Falta config.h: se compila con config.ejemplo.h y no se va a conectar a ninguna red"
#include "config.ejemplo.h"
#endif

// ── Pines ───────────────────────────────────────────────────────────────────
static const int PIN_BOTON = 1, PIN_BOTON2 = 44, PIN_AVISO = 43;
static const int PIN_I2S_BCLK = 2, PIN_I2S_LRC = 3, PIN_I2S_DIN = 4;
static const int PIN_SDA = 5, PIN_SCL = 6;
static const int PIN_MIC_CLK = 42, PIN_MIC_DATOS = 41;

// ── El protocolo (src/protocolo.js) ─────────────────────────────────────────
static const uint8_t BIN_AUDIO_SUBE = 0x01, BIN_JPEG = 0x02, BIN_AUDIO_BAJA = 0x03, BIN_FOTO = 0x04;
static const size_t MAX_JPEG = 300 * 1024, MAX_FOTO = 480 * 1024;
static const framesize_t TAMANO_CUADRO = FRAMESIZE_XGA;   // 1024×768 (ver iniciarCamara)

static const uint32_t MS_ENTRE_CUADROS = 500;      // 2 cuadros por segundo, como el emulador
static const uint32_t MS_ENTRE_DISTANCIAS = 250;   // el cerebro da por vieja una lectura a los 1,5 s
static const uint32_t MS_BOTON_LARGO = 700;
static const uint32_t MS_REBOTE = 30;
static const size_t MUESTRAS_POR_PAQUETE = 1600;   // 100 ms de micrófono a 16 kHz
static const size_t MUESTRAS_POR_LECTURA = 320;    // se lee de a 20 ms para no trabar el resto

WebSocketsClient ws;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
VL53L1X laser;
I2SClass mic, parlante;

bool hayOled = false, hayCamara = false, hayLaser = false, hayMic = false, hayParlante = false;
bool conectado = false;
bool vozPorAudio = false;          // el cerebro dijo {t:"estado", voz:"lista", modo:"audio"}
uint32_t ultimoCuadro = 0, ultimaDistancia = 0;
uint32_t avisoDesde = 0;
bool avisando = false;

int16_t audio[MUESTRAS_POR_PAQUETE + 1];   // +1: la cabecera va en el primer byte del arreglo
size_t muestras = 0;

// ── Pantalla ────────────────────────────────────────────────────────────────
// El texto llega en UTF-8 y la fuente de 6×8 es la de la página de códigos 437: las
// letras del castellano están, pero en otro lugar. Lo que no está se aproxima, sin
// cambiar el largo: el cerebro ya cortó cada renglón en 21 letras.
uint8_t a437(uint32_t c) {
  switch (c) {
    case 0xE1: return 0xA0; case 0xE9: return 0x82; case 0xED: return 0xA1;   // á é í
    case 0xF3: return 0xA2; case 0xFA: return 0xA3; case 0xF1: return 0xA4;   // ó ú ñ
    case 0xD1: return 0xA5; case 0xFC: return 0x81; case 0xDC: return 0x9A;   // Ñ ü Ü
    case 0xC9: return 0x90; case 0xBF: return 0xA8; case 0xA1: return 0xAD;   // É ¿ ¡
    case 0xC1: return 'A';  case 0xCD: return 'I';  case 0xD3: return 'O';  case 0xDA: return 'U';
    case 0xB0: return 0xF8; case 0xB7: return 0xFA; case 0xD7: return 'x';    // ° · ×
    case 0x2248: return 0xF7;                                                // ≈
    case 0x2026: return 0xFA;                                                // … (no hay: un punto medio)
    case 0x2192: return 0x1A; case 0x2190: return 0x1B;                      // → ←
    default: return c < 0x80 ? (uint8_t)c : '?';
  }
}

String utf8a437(const char* s) {
  String out;
  if (!s) return out;
  for (const uint8_t* p = (const uint8_t*)s; *p;) {
    uint32_t c = *p++;
    int resto = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : 0;
    if (resto) c &= (0x3F >> resto);
    while (resto-- > 0 && (*p & 0xC0) == 0x80) c = (c << 6) | (*p++ & 0x3F);
    out += (char)a437(c);
  }
  return out;
}

// Cinco renglones, igual que dibujarHud() del emulador: título, raya, tres de texto, raya, pie.
void dibujarHud(const char* titulo, JsonArrayConst lineas, const char* pie) {
  if (!hayOled) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 1);
  oled.print(utf8a437(titulo));
  oled.drawFastHLine(0, 11, 128, SSD1306_WHITE);
  int i = 0;
  for (JsonVariantConst l : lineas) {
    if (i >= 3) break;
    oled.setCursor(0, 15 + i * 11);
    oled.print(utf8a437(l.as<const char*>()));
    i++;
  }
  oled.drawFastHLine(0, 51, 128, SSD1306_WHITE);
  oled.setCursor(0, 55);
  oled.print(utf8a437(pie));
  oled.display();
}

void mensaje(const char* titulo, const char* linea) {
  JsonDocument doc;
  doc.add(linea);
  dibujarHud(titulo, doc.as<JsonArrayConst>(), "");
}

// ── Envío ───────────────────────────────────────────────────────────────────
// Un paquete binario es UN mensaje: el byte de tipo y el cuerpo, seguidos.
void enviarBin(uint8_t tipo, const uint8_t* cuerpo, size_t largo) {
  uint8_t* p = (uint8_t*)ps_malloc(largo + 1);
  if (!p) return;
  p[0] = tipo;
  memcpy(p + 1, cuerpo, largo);
  ws.sendBIN(p, largo + 1);
  free(p);
}

void enviarJson(JsonDocument& doc) {
  String texto;
  serializeJson(doc, texto);
  ws.sendTXT(texto);
}

void pedir(const char* t) {
  JsonDocument doc;
  doc["t"] = t;
  enviarJson(doc);
}

// ── Cámara ──────────────────────────────────────────────────────────────────
// Pines del XIAO ESP32-S3 Sense (camera_pins.h de Espressif, CAMERA_MODEL_XIAO_ESP32S3).
bool iniciarCamara() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 15; c.pin_d1 = 17; c.pin_d2 = 18; c.pin_d3 = 16;
  c.pin_d4 = 14; c.pin_d5 = 12; c.pin_d6 = 11; c.pin_d7 = 48;
  c.pin_xclk = 10; c.pin_pclk = 13; c.pin_vsync = 38; c.pin_href = 47;
  c.pin_sccb_sda = 40; c.pin_sccb_scl = 39;
  c.pin_pwdn = -1; c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  // Se arranca con el tamaño MÁS GRANDE para que los búferes alcancen para la foto de
  // leer texto, y enseguida se baja al de los cuadros de siempre: 1024×768 (antes
  // 640×480). El cerebro mira el centro con zoom, y ahí más detalle es ver más lejos
  // (src/detector.js). A 2 cuadros por segundo son unos 150 KB/s por WiFi.
  c.frame_size = FRAMESIZE_UXGA;
  c.jpeg_quality = 12;
  c.fb_count = 2;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&c) != ESP_OK) return false;
  sensor_t* s = esp_camera_sensor_get();
  s->set_framesize(s, TAMANO_CUADRO);
  return true;
}

void descartarCuadros(int n) {
  for (int i = 0; i < n; i++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
  }
}

void mandarCuadro() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return;
  if (fb->format == PIXFORMAT_JPEG && fb->len <= MAX_JPEG) enviarBin(BIN_JPEG, fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// La foto grande que pide el cerebro para leer texto ({t:"foto"} → 0x04).
void mandarFoto() {
  if (!hayCamara) return;
  sensor_t* s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_UXGA);
  descartarCuadros(2);                  // los primeros todavía salen del tamaño anterior
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb && fb->format == PIXFORMAT_JPEG && fb->len <= MAX_FOTO) enviarBin(BIN_FOTO, fb->buf, fb->len);
  if (fb) esp_camera_fb_return(fb);
  s->set_framesize(s, TAMANO_CUADRO);
  descartarCuadros(1);
}

// ── Audio ───────────────────────────────────────────────────────────────────
// Sólo con Gemini Live (modo «audio»): con un LLM de texto, el micrófono crudo no sirve.
void atenderMicrofono() {
  if (!hayMic || !vozPorAudio || !conectado) { muestras = 0; return; }
  size_t cuantas = min(MUESTRAS_POR_LECTURA, MUESTRAS_POR_PAQUETE - muestras);
  size_t leidos = mic.readBytes((char*)&audio[1 + muestras], cuantas * 2);
  muestras += leidos / 2;
  if (muestras < MUESTRAS_POR_PAQUETE) return;
  // La cabecera va en el byte inmediatamente anterior a la primera muestra.
  uint8_t* paquete = (uint8_t*)&audio[1] - 1;
  paquete[0] = BIN_AUDIO_SUBE;
  ws.sendBIN(paquete, 1 + MUESTRAS_POR_PAQUETE * 2);
  muestras = 0;
}

// ── El aviso de vehículo: tres pulsos ───────────────────────────────────────
void empezarAviso() { avisando = true; avisoDesde = millis(); }

void atenderAviso() {
  if (!avisando) return;
  uint32_t t = millis() - avisoDesde;
  if (t >= 750) { digitalWrite(PIN_AVISO, LOW); avisando = false; return; }
  digitalWrite(PIN_AVISO, (t % 250) < 150 ? HIGH : LOW);
}

// ── Sensor de distancia ─────────────────────────────────────────────────────
void mandarDistancia() {
  if (!hayLaser || !laser.dataReady()) return;
  laser.read(false);
  JsonDocument doc;
  doc["t"] = "distancia";
  // 0 = no ve nada confiable; el cerebro deja de medir.
  doc["mm"] = laser.ranging_data.range_status == VL53L1X::RangeValid ? laser.ranging_data.range_mm : 0;
  enviarJson(doc);
}

// ── Botones ─────────────────────────────────────────────────────────────────
struct Boton {
  int pin;
  bool apretado;
  uint32_t desde;
};
Boton boton1 = { PIN_BOTON, false, 0 }, boton2 = { PIN_BOTON2, false, 0 };

// Devuelve 0 si no pasó nada, 1 si fue un toque corto y 2 si fue largo. Se decide al soltar.
int revisar(Boton& b) {
  bool ahora = digitalRead(b.pin) == LOW;
  uint32_t t = millis();
  if (ahora && !b.apretado) { b.apretado = true; b.desde = t; return 0; }
  if (!ahora && b.apretado) {
    b.apretado = false;
    uint32_t duro = t - b.desde;
    if (duro < MS_REBOTE) return 0;
    return duro >= MS_BOTON_LARGO ? 2 : 1;
  }
  return 0;
}

void atenderBotones() {
  int r = revisar(boton1);
  if (r && conectado) {
    JsonDocument doc;
    doc["t"] = "paso";
    doc["hacia"] = r == 1 ? 1 : -1;
    enviarJson(doc);
  }
  r = revisar(boton2);
  if (r && conectado) pedir(r == 1 ? "leer" : "identificar");
}

// ── Lo que llega del cerebro ────────────────────────────────────────────────
void alTexto(const uint8_t* datos, size_t largo) {
  JsonDocument doc;
  if (deserializeJson(doc, datos, largo)) return;
  const char* t = doc["t"] | "";
  if (!strcmp(t, "hud")) dibujarHud(doc["titulo"] | "", doc["lineas"].as<JsonArrayConst>(), doc["pie"] | "");
  else if (!strcmp(t, "alerta")) empezarAviso();
  else if (!strcmp(t, "foto")) mandarFoto();
  else if (!strcmp(t, "estado")) vozPorAudio = !strcmp(doc["voz"] | "", "lista") && !strcmp(doc["modo"] | "", "audio");
  // «aviso» ya llega también como HUD; «callar», «decir», «cajas» y «dicho» no aplican acá.
}

void alEvento(WStype_t tipo, uint8_t* datos, size_t largo) {
  switch (tipo) {
    case WStype_CONNECTED: {
      conectado = true;
      if (strlen(TOKEN_GAFAS)) {
        JsonDocument doc;
        doc["t"] = "hola";
        doc["token"] = TOKEN_GAFAS;
        enviarJson(doc);
      }
      mensaje("MIIA gafas", "Conectada");
      break;
    }
    case WStype_DISCONNECTED:
      if (conectado) mensaje("MIIA gafas", "Sin cerebro...");
      conectado = false;
      vozPorAudio = false;
      break;
    case WStype_TEXT:
      alTexto(datos, largo);
      break;
    case WStype_BIN:
      if (largo > 2 && datos[0] == BIN_AUDIO_BAJA && hayParlante) parlante.write(datos + 1, largo - 1);
      break;
    default:
      break;
  }
}

// ── Arranque y vuelta ───────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOTON, INPUT_PULLUP);
  pinMode(PIN_BOTON2, INPUT_PULLUP);
  pinMode(PIN_AVISO, OUTPUT);
  digitalWrite(PIN_AVISO, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  hayOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (hayOled) {
    oled.cp437(true);
    oled.setTextSize(1);
    // Reflejada en una lámina la imagen sale al revés: se da vuelta en el propio OLED.
    if (ESPEJAR_OLED) oled.ssd1306_command(SSD1306_SEGREMAP);
    mensaje("MIIA gafas", "Arrancando...");
  }

  hayCamara = iniciarCamara();
  laser.setTimeout(50);
  hayLaser = laser.init();
  if (hayLaser) {
    laser.setDistanceMode(VL53L1X::Long);
    laser.setMeasurementTimingBudget(50000);
    laser.startContinuous(100);
  }
  mic.setPinsPdmRx(PIN_MIC_CLK, PIN_MIC_DATOS);
  hayMic = mic.begin(I2S_MODE_PDM_RX, 16000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  parlante.setPins(PIN_I2S_BCLK, PIN_I2S_LRC, PIN_I2S_DIN);
  hayParlante = parlante.begin(I2S_MODE_STD, 24000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  Serial.printf("oled %d · cámara %d · láser %d · micrófono %d · parlante %d\n", hayOled, hayCamara, hayLaser, hayMic, hayParlante);
  if (!hayCamara) mensaje("Sin camara", "Revisar el conector");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // con el ahorro de energía prendido, el WebSocket se atrasa
  WiFi.begin(WIFI_RED, WIFI_CLAVE);
  if (hayCamara) mensaje("MIIA gafas", "Buscando WiFi...");

  // La biblioteca manda «Origin: file://» por defecto. El cerebro rechaza cualquier
  // Origin que no sea su propia página (es lo que frena a otro sitio del navegador),
  // así que las gafas no mandan ninguno, igual que cualquier cliente que no es navegador.
  ws.setExtraHeaders();
  ws.begin(CEREBRO_HOST, CEREBRO_PUERTO, "/ws/gafas");
  ws.onEvent(alEvento);
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  ws.loop();
  atenderBotones();
  atenderAviso();
  if (!conectado) return;
  uint32_t t = millis();
  if (hayCamara && t - ultimoCuadro >= MS_ENTRE_CUADROS) { ultimoCuadro = t; mandarCuadro(); }
  if (t - ultimaDistancia >= MS_ENTRE_DISTANCIAS) { ultimaDistancia = t; mandarDistancia(); }
  atenderMicrofono();
}
