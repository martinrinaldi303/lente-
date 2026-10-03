# lente-

Home-made augmented-reality glasses (option A: Seeed XIAO ESP32-S3 Sense + a 128×64 OLED).
This repository holds the **brain** (a Node.js server), the **browser screens** that play
the part of the glasses, and the **firmware** for the real glasses (it compiles; it has not
run on a board yet, because there is no hardware yet).

The code, comments and docs are in Spanish. The full log of what was built, measured and
left to do is in [`PLAN.md`](PLAN.md); the Spanish README is [`README.md`](README.md). If
anything here disagrees with the code, **the code wins**.

## What it does today

- **Recognises objects** through the camera: 129 classes (home, workshop, electronics, PC
  parts, vehicles, animals, clothes, "person"). DINOv2-small turns the image into numbers,
  and two small perceptrons (`class23`, `class24`, ported to C++) decide. Measured on
  4,998 unseen photos on 3 Oct 2026: **89.9 % ± 0.8** (chance: 3.2 %). Without the
  DINOv2 model, two hand-made feature extractors vote instead.
- **Says "I don't know it"** when what it sees does not look like any of its classes,
  instead of naming the closest one.
- **Detector (YOLOS-tiny)**: where each thing is, with a zoom on the centre of the gaze.
  The display names ONE thing, the one being looked at; approximate distance to vehicles,
  people and things of typical size.
- **Learns your own objects** from 12 frames ("Enseñar"), stored in MySQL, per account.
- **Accounts and linked glasses** (also "Continue with Google"): everyone sees only their own.
- **Panel screens** (designed in Stitch): Vision, Teach, History, Objects, Known people and
  Settings. The old emulator is still at `/emulador.html`.
- **Shows on the HUD** facts and parts of the recognised device, the card of 68 animals
  with their danger level, and of 26 computer and phone parts.
- **"What is it?"**: a device, a part or an animal, through the LLM, on request.
- **Several things at once** ("what's around?"): what each person holds and how far apart
  things are.
- **The detector can be corrected**: "that is not a person" (clothes in a wardrobe) and it
  stops marking it.
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
- **Real-world tests**: mark "right / wrong" with a real webcam, and
  `npm run pruebas-reales` reports the accuracy with its 95 % margin.

It does **not** identify strangers by their face or look up their data; that is blocked in
the code on purpose (`src/identificar.js`). It only names someone who enrolled **themselves**
from their own account and gave yours permission ("Known people"); everyone else is "person".

## Running it

Node 20.12 or newer.

```bash
npm install
```

```bash
npm start
```

Then open `http://localhost:8787` (not `127.0.0.1`: Google only accepts `localhost`). The
screens need an account, and accounts need the XAMPP MySQL running; without a database the
old emulator still works at `http://localhost:8787/emulador.html`. The offline tests (no
server needed):

```bash
npm test
```

## Not in the repository

| What | Where it goes | How to get it |
|---|---|---|
| API keys and database password | `.env` | Copy `.env.example` and fill it in. **Never commit it** |
| DINOv2-small (24.5 MB) | `modelos/dinov2-small/model_quantized.onnx` | Hugging Face repo `Xenova/dinov2-small` |
| YOLOS-tiny detector (9.7 MB) | `modelos/yolos-tiny/model_quantized.onnx` | Hugging Face repo `Xenova/yolos-tiny` |
| Caltech-256, COCO (val2017 and part of train2017), LVIS and the Kaggle PC parts | `datos/` | For retraining; see `PLAN.md` |
| The computed features | `datos/rasgos/` | Produced when retraining. Without them there is no "I don't know it", and corrections to the detector need a closer match |
| Face models: YuNet and SFace | `modelos/caras/` | OpenCV Zoo on Hugging Face. Without them "Known people" is off |
| The compiled trainer | `cpp/entrenar(.exe)` | `npm run compilar` |
| What you taught it, what it remembers, your tests | `estado/` | Created as you use it |
| Firmware settings (Wi-Fi, token) | `firmware/gafas_xiao/config.h` | Copy `config.ejemplo.h` |
| iFixit manuals | `guias/myfixit/` | `npm run importar-myfixit -- <MyFixit file>` |

## Folders

| Folder | Contents |
|---|---|
| `servidor.js` | The brain: serves the screens and talks to the glasses over a WebSocket |
| `src/` | Feature extractors, networks, detector, HUD, session, voice, QR, database, accounts, measurements, memory, alerts, text reading, guides, cards, scene, corrections |
| `publico/` | The panel screens (Vision, Teach, History, Objects, Known people, Settings) and the old emulator |
| `firmware/` | The XIAO ESP32-S3 Sense program; it speaks the same protocol as the emulator (`src/protocolo.js`) |
| `guias/` | Stored step-by-step guides |
| `cpp/` | `class23` and `class24` in C++ and the trainer that measures against chance |
| `herramientas/` | Export features, crop COCO, train, live tests, QR cards, MyFixit import, test summary |
| `pruebas/` | Offline tests |
| `docs/` | The Word documentation, wiring and optics drawings, the database schema, and how to run the brain on a Raspberry Pi |
