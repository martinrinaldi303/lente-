# El cerebro en una Raspberry Pi

Escrito el 3-oct-2026. **Sin probar en una Raspberry de verdad**: todavía no hay una.
Lo que sí se probó es que todo corre en Linux (las pruebas y el entrenador en C++ pasan
en Ubuntu 24.04 con Node 22), y que las dos bibliotecas que no son JavaScript puro
tienen versión para ARM de 64 bits (onnxruntime-node y g++).

## Para qué

Hoy el cerebro corre en la PC, y el iPhone no puede correr Node. Con una Raspberry Pi
en el bolsillo (o en la mochila) las gafas andan en la calle sin la PC y sin un
servidor en internet: la Pi y las gafas se conectan al hotspot del celular.

## Qué hace falta

| Pieza | Para qué | Nota |
|---|---|---|
| Raspberry Pi 5, 4 GB o más | El cerebro | Una Pi 4 también anda, más lenta |
| Raspberry Pi OS de **64 bits** | onnxruntime-node no tiene versión de 32 bits | Bookworm o más nuevo |
| Tarjeta microSD de 32 GB | Sistema, modelos y lo aprendido | |
| Batería USB-C con Power Delivery | Alimentarla en la calle | La Pi 5 pide 5 V y hasta 5 A; con menos, avisa y baja la velocidad |

**Velocidad: sin medir.** En la PC (Ryzen 5 5600GT) DINOv2 tarda ~28 ms por cuadro y el
camino entero, menos de 80 ms. En una Pi 5 va a ser varias veces más lento; a 2 cuadros
por segundo debería alcanzar, pero hay que medirlo. Si no alcanza, lo primero es
apagar el detector (sacar `modelos/yolos-tiny`) y quedarse con DINOv2 solo.

## Instalación

1. Node 22 o más nuevo (de nodejs.org o de NodeSource; el de los repositorios de
   Debian suele ser viejo):

   ```bash
   node --version
   ```

2. El repositorio y sus dependencias:

   ```bash
   git clone https://github.com/martinrinaldi303/lente-.git
   ```

   ```bash
   cd lente- && npm ci
   ```

3. Los modelos no están en git: copiar la carpeta `modelos/` de la PC (DINOv2 y
   YOLOS-tiny, unos 35 MB), por ejemplo con `scp -r modelos pi@<ip-de-la-pi>:lente-/`.

4. El `.env`: copiar `.env.example` y cambiar como mínimo

   ```
   HOST=0.0.0.0
   TOKEN_GAFAS=<16 letras o más; sale de «openssl rand -hex 16»>
   CAMARA_FOV_DIAGONAL=<el de la lente de la cámara de las gafas>
   ```

   Sin `TOKEN_GAFAS` el cerebro se niega a arrancar abierto a la red, a propósito: por
   ese puerto entran la cámara y el micrófono.

5. Probarlo a mano:

   ```bash
   npm test
   ```

   ```bash
   npm start
   ```

6. Que arranque solo al prender (`docs/gafas-cerebro.service`; si el usuario no es
   `pi` o la carpeta es otra, cambiarlos en el archivo antes):

   ```bash
   sudo cp docs/gafas-cerebro.service /etc/systemd/system/
   ```

   ```bash
   sudo systemctl enable --now gafas-cerebro
   ```

   Para ver qué dice: `journalctl -u gafas-cerebro -f`.

## La red

- La Pi y las gafas se conectan al **hotspot del celular**. El celular les da
  internet para el LLM (si hay clave) y las dos se ven entre sí.
- Las gafas necesitan la IP de la Pi en `CEREBRO_HOST` (`firmware/gafas_xiao/config.h`).
  El hotspot del iPhone reparte direcciones 172.20.10.x y no deja reservarlas: lo más
  simple es darle a la Pi una IP fija dentro de ese rango (por ejemplo 172.20.10.10)
  con NetworkManager:

  ```bash
  sudo nmcli connection modify "<nombre del hotspot>" ipv4.method manual ipv4.addresses 172.20.10.10/28 ipv4.gateway 172.20.10.1 ipv4.dns 172.20.10.1
  ```

- Sin LLM (sin clave o sin internet) andan igual: reconocer, enseñar, la memoria de
  objetos, el aviso de vehículos, medir y las guías guardadas. No andan: conversar,
  marca y modelo, y leer texto.

## Lo que aprendió, y la base

- Lo enseñado vive en `estado/`. Para llevarlo de la PC a la Pi, copiar
  `estado/red_*.json` (sin los `red_general_*`, que ya están en git) y
  `estado/memoria.json`.
- MySQL es opcional, igual que en la PC. En la Pi, si se quiere, MariaDB
  (`sudo apt install mariadb-server`) con la misma base y el mismo usuario del `.env`.
