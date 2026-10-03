// memoria.js — «¿dónde dejé las llaves?»: cuándo y dónde se vio cada OBJETO por
// última vez.
//
// Las gafas no tienen GPS ni saben en qué habitación están. El «dónde» es una
// etiqueta que pone el usuario: diciéndolo («estoy en la cocina»), con el botón del
// emulador, o pegando en cada lugar un código QR que diga LUGAR:cocina (lo arma
// `npm run tarjeta -- --lugar cocina`). La etiqueta vale LUGAR_VALIDO_MS: después se
// da por vencida, porque el usuario se pudo haber movido sin avisar.
//
// Se guarda sólo el NOMBRE del objeto, la hora, la confianza y la etiqueta del lugar.
// Ninguna imagen. Y nunca personas: «persona» no entra, venga de donde venga.
//
// Lo que entra: lo que la pantalla nombra (lo enseñado o la red general) y lo que el
// detector marca seguro en cualquier parte del cuadro. Un objeto que nunca pasó por
// la cámara, o que ninguna red conoce (unas llaves que no se le enseñaron), no está.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const NO_SE_RECUERDA = new Set(['persona', 'nada', '']);
const LUGAR_VALIDO_MS = 15 * 60 * 1000;
const MS_ENTRE_GUARDADOS = 30000;   // a disco cada 30 s como mucho: en una Raspberry, la tarjeta SD se gasta; al apagar se guarda igual
const MAX_OBJETOS = 500;
const ARTICULOS = /^(?:el|la|los|las|mi|mis|un|una|unos|unas)\s+/;

// «Las Llaves» → «llaves»; sin tildes, para que «el control» encuentre «control».
export function normalizarNombre(texto) {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(ARTICULOS, '');
}

// El lugar que dice un código QR pegado en la pared («LUGAR:cocina»), o null.
export function lugarDeQr(texto) {
  const m = String(texto ?? '').match(/^\s*LUGAR:\s*(.+?)\s*$/is);
  return m ? m[1].replace(/\s+/g, ' ').slice(0, 32) : null;
}

// «llaves» y «llave», «celulares» y «celular»: el mismo objeto.
const singular = (n) => n.replace(/es$/, '').replace(/s$/, '');

// Cuánto hace, dicho en corto: «recién», «hace 12 min», «hace 3 h», «hace 2 días».
export function haceCuanto(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

export class Memoria {
  // `archivo` es dónde se guarda (estado/memoria.json), o null para no guardar nada.
  constructor({ archivo = null, reloj = Date.now, lugarValidoMs = LUGAR_VALIDO_MS } = {}) {
    this.archivo = archivo;
    this.reloj = reloj;
    this.lugarValidoMs = lugarValidoMs;
    this.vistos = new Map();       // nombre → { nombre, cuando, lugar, confianza }
    this.lugar = null;             // { nombre, desde }
    this.cambios = false;
    this.ultimoGuardado = 0;
    if (archivo && existsSync(archivo)) {
      try {
        for (const v of JSON.parse(readFileSync(archivo, 'utf8')).vistos ?? [])
          if (v?.nombre && Number.isFinite(v.cuando) && !NO_SE_RECUERDA.has(v.nombre)) this.vistos.set(v.nombre, v);
      } catch (e) { console.warn(`⚠️ memoria: no se pudo leer ${archivo}: ${e.message}`); }
    }
  }

  // «Estoy en la cocina». Vacío borra el lugar.
  marcarLugar(nombre) {
    const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
    this.lugar = limpio ? { nombre: limpio, desde: this.reloj() } : null;
    return this.lugar?.nombre ?? null;
  }

  // El lugar, si todavía vale.
  lugarActual() {
    if (!this.lugar) return null;
    if (this.reloj() - this.lugar.desde > this.lugarValidoMs) { this.lugar = null; return null; }
    return this.lugar.nombre;
  }

  // Lo que la cámara está viendo ahora.
  vi(nombre, confianza = 1) {
    if (NO_SE_RECUERDA.has(nombre ?? '')) return;
    const ahora = this.reloj();
    this.vistos.delete(nombre);                     // al final del Map: el más reciente
    this.vistos.set(nombre, { nombre, cuando: ahora, lugar: this.lugarActual(), confianza: Number(confianza.toFixed(2)) });
    while (this.vistos.size > MAX_OBJETOS) this.vistos.delete(this.vistos.keys().next().value);
    this.cambios = true;
    if (ahora - this.ultimoGuardado >= MS_ENTRE_GUARDADOS) this.guardar();
  }

  // El objeto que mejor coincide con lo que se pregunta, o null. Primero igual, después
  // singular contra singular, después «contiene» («control» encuentra «control remoto»).
  buscar(consulta) {
    const q = normalizarNombre(consulta);
    if (!q) return null;
    const lista = [...this.vistos.values()].reverse();          // el más reciente primero
    const n = (v) => normalizarNombre(v.nombre);
    return lista.find(v => n(v) === q)
        ?? lista.find(v => singular(n(v)) === singular(q))
        ?? lista.find(v => n(v).includes(q) || q.includes(n(v)))
        ?? null;
  }

  // Lo que contesta «¿dónde está…?», listo para el LLM y para el HUD.
  dondeEsta(consulta) {
    const v = this.buscar(consulta);
    if (!v) return { visto: false, motivo: `No vi «${String(consulta ?? '').trim()}» desde que tengo memoria` };
    const hace = haceCuanto(this.reloj() - v.cuando);
    return { visto: true, objeto: v.nombre, hace, lugar: v.lugar, cuando: new Date(v.cuando).toISOString(),
             frase: `${v.nombre}: ${hace}${v.lugar ? `, en ${v.lugar}` : ''}` };
  }

  // Los últimos vistos, del más reciente al más viejo.
  recientes(cuantos = 10) {
    return [...this.vistos.values()].reverse().slice(0, cuantos)
      .map(v => ({ objeto: v.nombre, hace: haceCuanto(this.reloj() - v.cuando), lugar: v.lugar,
                   cuando: new Date(v.cuando).toISOString(), confianza: v.confianza }));
  }

  // Olvidar todo lo visto (lo pide el usuario desde el panel). El lugar se mantiene.
  vaciar() {
    this.vistos.clear();
    this.cambios = true;
    this.guardar();
  }

  // Al disco, de una vez: se escribe un archivo aparte y se renombra, así un corte a la
  // mitad no deja un JSON roto.
  guardar() {
    this.ultimoGuardado = this.reloj();
    if (!this.archivo || !this.cambios) return;
    try {
      const tmp = `${this.archivo}.tmp`;
      writeFileSync(tmp, JSON.stringify({ vistos: [...this.vistos.values()] }));
      renameSync(tmp, this.archivo);
      this.cambios = false;
    } catch (e) { console.warn(`⚠️ memoria: no se pudo guardar: ${e.message}`); }
  }
}
