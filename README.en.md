# lente-

Home-made augmented-reality glasses (option A: Seeed XIAO ESP32-S3 Sense + a 128×64 OLED).
This repository holds the **brain** (a Node.js server), a **browser emulator** that plays
the part of the glasses, and the **firmware** for the real glasses (it compiles; it has not
run on a board yet, because there is no hardware yet).

The code, comments and docs are in Spanish. The full log of what was built, measured and
left to do is in [`PLAN.md`](PLAN.md); the Spanish README is [`README.md`](README.md). If
anything here disagrees with the code, **the code wins**.

## What it does today

- **Recognises objects** through the camera: 67 classes (home, workshop, electronics,
  vehicles, "person"). DINOv2-small turns the image into numbers, and two small
  perceptrons (`class23`, `class24`, ported to C++) decide. Measured on 1,948 unseen
  photos: **91.2 % ± 1.3** (chance: 5.9 %). Without the DINOv2 model, two hand-made
  feature extractors vote instead.
- **Learns your own objects** from 12 frames ("Enseñar"), stored in MySQL (optional).
- **Shows on the HUD** facts, parts and colour of the recognised device.
- **Reads QR contact cards** that a person chooses to show.
- **Step-by-step guides** for assembling and disassembling, and **voice** through
  Gemini Live or DeepSeek (an API key is needed).
- **"Where did I leave…?"**: remembers when and where it last saw each object (never people).
- **Warns when a vehicle is about to arrive**, with a beep or vibration. It is an aid, not
  a safety system.
- **Reads text** (signs, labels, expiry dates) and translates it, through the LLM. It
  refuses to transcribe personal documents.
- **Stored guides** that work offline: first aid and household tasks, plus an importer for
  the iFixit repair manuals in the MyFixit dataset (non-commercial licence).
- **Measures objects** with a VL53L1X laser rangefinder and estimates their weight.
- **Real-world tests**: mark "right / wrong" in the emulator with a real webcam, and
  `npm run pruebas-reales` reports the accuracy with its 95 % margin.

It does **not** identify people by their face or look up their data. That is blocked in
the code on purpose (`src/identificar.js`).

## Running it

Node 22 or newer.

```bash
npm install
```

```bash
npm start
```

Then open `http://127.0.0.1:8787`. The offline tests (no server needed):

```bash
npm test
```

## Not in the repository

| What | Where it goes | How to get it |
|---|---|---|
| API keys and database password | `.env` | Copy `.env.example` and fill it in. **Never commit it** |
| DINOv2-small (24.5 MB) | `modelos/dinov2-small/model_quantized.onnx` | Hugging Face repo `Xenova/dinov2-small` |
| YOLOS-tiny detector (9.7 MB) | `modelos/yolos-tiny/model_quantized.onnx` | Hugging Face repo `Xenova/yolos-tiny` |
| Caltech-256 and COCO val2017 | `datos/` | Only for retraining; see `PLAN.md` |
| The compiled trainer | `cpp/entrenar(.exe)` | `npm run compilar` |
| What you taught it, what it remembers, your tests | `estado/` | Created as you use it |
| Firmware settings (Wi-Fi, token) | `firmware/gafas_xiao/config.h` | Copy `config.ejemplo.h` |
| iFixit manuals | `guias/myfixit/` | `npm run importar-myfixit -- <MyFixit file>` |

## Folders

| Folder | Contents |
|---|---|
| `servidor.js` | The brain: serves the emulator and talks to the glasses over a WebSocket |
| `src/` | Feature extractors, networks, HUD, session, voice, QR, database, measurements, memory, alerts, text reading, guides |
| `publico/` | The browser emulator (camera, microphone, speaker and a drawn OLED) |
| `firmware/` | The XIAO ESP32-S3 Sense program; it speaks the same protocol as the emulator (`src/protocolo.js`) |
| `guias/` | Stored step-by-step guides |
| `cpp/` | `class23` and `class24` in C++ and the trainer that measures against chance |
| `herramientas/` | Export features, crop COCO, train, live tests, QR cards, MyFixit import, test summary |
| `pruebas/` | Offline tests |
| `docs/` | The Word documentation, wiring and optics drawings, the database schema, and how to run the brain on a Raspberry Pi |
