// config.ejemplo.h — copiar a config.h y completar. config.h NO se sube a git.
//
// Sin config.h el programa compila igual con estos valores, pero no se va a
// conectar a ninguna red.

// La red WiFi. Con el celular haciendo de punto de acceso, la de su hotspot.
#define WIFI_RED       "nombre-de-la-red"
#define WIFI_CLAVE     "clave-de-la-red"

// Dónde corre el cerebro (servidor.js). Tiene que arrancar con HOST=0.0.0.0 en su
// .env y un TOKEN_GAFAS de 16 letras o más: si no, no acepta conexiones de la red.
#define CEREBRO_HOST   "192.168.0.10"
#define CEREBRO_PUERTO 8787

// La llave de ESTOS anteojos. Dos formas:
//   · la que te da el panel (http://<cerebro>:8787/panel.html → «Vincular anteojos»):
//     empieza con gaf_ y hace que las gafas entren con TU cuenta y usen lo que vos
//     les enseñaste. Es lo recomendado.
//   · el TOKEN_GAFAS del .env del cerebro: entran «sin cuenta».
#define TOKEN_GAFAS    ""

// 1 si la pantalla se ve reflejada en una lámina o un prisma (sale al revés).
#define ESPEJAR_OLED   1
