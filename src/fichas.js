// fichas.js — datos y partes por tipo de dispositivo, para el HUD.
//
// Es lo que las gafas muestran cuando reconocen un dispositivo y la pantalla está
// libre. Son datos DEL TIPO de aparato («un monitor se conecta por HDMI»), no de
// la unidad que se tiene delante: la red dice «celular», no «Moto G54».
// La marca y el modelo los da src/identificar.js, a pedido y con el LLM.
//
//   datos  → dos renglones: qué es y cómo se alimenta o se conecta.
//   partes → lo que hay adentro, de afuera hacia adentro. Se ven de a tres con
//            «Siguiente».
//
// Cada renglón entra en 21 columnas (lo vigila pruebas/sesion.test.js). La clave es
// el nombre de la clase tal como figura en herramientas/categorias.json.
//
// Los animales (características, peligro y qué hacer) están en fichas_animales.js, y
// las piezas de computadoras y celulares (función, diseño y características) en
// fichas_piezas.js. paginasDe() y fichaDe() buscan en las tres.

import { ANIMALES, normalizarNombre, renglonDePeligro } from './fichas_animales.js';
import { PIEZAS } from './fichas_piezas.js';

export const FICHAS = {
  'celular': {
    datos:  ['Teléfono inteligente', 'USB-C o Lightning'],
    partes: ['Pantalla táctil', 'Tapa trasera', 'Batería', 'Placa madre', 'Cámaras', 'Altavoz y micrófono', 'Puerto de carga', 'Bandeja SIM'],
  },
  'notebook': {
    datos:  ['Computadora portátil', 'Batería y cargador'],
    partes: ['Pantalla', 'Bisagras', 'Teclado', 'Touchpad', 'Batería', 'Placa madre', 'Disco o SSD', 'Memoria RAM', 'Ventilador'],
  },
  'teclado': {
    datos:  ['Entrada de texto', 'USB o Bluetooth'],
    partes: ['Teclas', 'Membrana o switches', 'Placa controladora', 'Cable o receptor'],
  },
  // Monitor y televisor van juntos: COCO llama «tv» a los dos, y por fuera son lo
  // mismo. Separados, la red repartía la confianza entre las dos clases y no
  // llegaba al umbral con ninguna (medido el 2-oct-2026).
  'pantalla': {
    datos:  ['Monitor o televisor', 'HDMI, DP, VGA, antena'],
    partes: ['Panel', 'Luz de fondo', 'Placa principal', 'Fuente', 'Parlantes', 'Base y soporte'],
  },
  'control remoto': {
    datos:  ['Mando a distancia', 'Infrarrojo, 2 pilas'],
    partes: ['Botonera de goma', 'Placa', 'LED infrarrojo', 'Tapa y pilas'],
  },
  'mouse': {
    datos:  ['Puntero', 'USB o Bluetooth'],
    partes: ['Botones', 'Rueda', 'Sensor óptico', 'Placa', 'Cable o pilas'],
  },
  'calculadora': {
    datos:  ['Hace cuentas', 'Pilas o solar'],
    partes: ['Teclado', 'Pantalla LCD', 'Placa', 'Pila o celda solar'],
  },
  'auriculares': {
    datos:  ['Audio personal', 'Cable o Bluetooth'],
    partes: ['Parlantes', 'Almohadillas', 'Vincha', 'Cable o batería'],
  },
  'reloj': {
    datos:  ['Da la hora', 'Pila o cuerda'],
    partes: ['Caja', 'Cristal', 'Máquina', 'Corona', 'Malla', 'Pila'],
  },
  'cd': {
    datos:  ['Disco óptico', '700 MB de datos'],
    partes: [],
  },
  'disquete': {
    datos:  ['Disco magnético', '1,44 MB'],
    partes: ['Carcasa', 'Tapa metálica', 'Disco magnético'],
  },
  'placa': {
    datos:  ['Placa de expansión', 'Va en ranura PCI'],
    partes: ['Chapa trasera', 'Conector PCI', 'Chips', 'Capacitores'],
  },
  'linterna': {
    datos:  ['Luz portátil', 'Pilas o batería'],
    partes: ['Lámpara o LED', 'Reflector', 'Interruptor', 'Pilas'],
  },
  'lamparita': {
    datos:  ['Lámpara', 'Rosca E27 o E14'],
    partes: ['Ampolla', 'Filamento o LED', 'Rosca'],
  },
  'reproductor mp3': {
    datos:  ['Reproduce música', 'Batería interna'],
    partes: ['Pantalla', 'Rueda o botones', 'Batería', 'Placa', 'Ficha de audio'],
  },
  'agenda digital': {
    datos:  ['Agenda de mano', 'Pantalla táctil'],
    partes: ['Pantalla táctil', 'Lápiz', 'Batería', 'Placa'],
  },
  'telefono': {
    datos:  ['Teléfono fijo', 'Línea por cable'],
    partes: ['Tubo', 'Cable en espiral', 'Disco o teclado', 'Campanilla'],
  },
  'radiograbador': {
    datos:  ['Radio y parlantes', 'Pilas o 220 V'],
    partes: ['Parlantes', 'Antena', 'Casetera', 'Sintonizador', 'Fuente'],
  },
  'videocasetera': {
    datos:  ['Reproduce VHS', 'Salida RCA'],
    partes: ['Mecanismo de carga', 'Cabezal', 'Motor', 'Placa', 'Fuente'],
  },
  'proyector': {
    datos:  ['Proyecta imagen', 'HDMI o VGA'],
    partes: ['Lente', 'Lámpara', 'Ventilador', 'Placa', 'Fuente'],
  },
  'fotocopiadora': {
    datos:  ['Copia documentos', '220 V, usa tóner'],
    partes: ['Vidrio y escáner', 'Bandejas de papel', 'Tóner', 'Tambor', 'Fusor'],
  },
  'joystick': {
    datos:  ['Mando de juego', 'USB'],
    partes: ['Palanca', 'Botones', 'Placa', 'Cable USB'],
  },
  'trituradora': {
    datos:  ['Destruye papel', '220 V, ojo los dedos'],
    partes: ['Cesto', 'Sensor de papel', 'Cuchillas', 'Motor'],
  },
  'tostadora': {
    datos:  ['Tuesta pan', '220 V, se calienta'],
    partes: ['Palanca y resorte', 'Bandeja de migas', 'Resistencias', 'Temporizador'],
  },
  'microondas': {
    datos:  ['Calienta comida', '220 V, sin metal'],
    partes: ['Puerta con traba', 'Plato giratorio', 'Panel de control', 'Motor del plato', 'Magnetrón', 'Transformador', 'Capacitor: ¡carga!'],
  },
  'heladera': {
    datos:  ['Enfría alimentos', '220 V, compresor'],
    partes: ['Estantes', 'Burletes', 'Termostato', 'Evaporador', 'Condensador', 'Compresor'],
  },
  'lavarropas': {
    datos:  ['Lava ropa', '220 V y agua'],
    partes: ['Tambor', 'Electroválvula', 'Bomba de desagote', 'Correa', 'Motor', 'Placa de control'],
  },
  'panificadora': {
    datos:  ['Hace pan', '220 V, se calienta'],
    partes: ['Molde', 'Paleta', 'Panel', 'Resistencia', 'Motor'],
  },
  'microscopio': {
    datos:  ['Aumenta lo chico', 'Lentes delicadas'],
    partes: ['Ocular', 'Objetivos', 'Platina', 'Foco', 'Luz'],
  },
  'binoculares': {
    datos:  ['Acerca lo lejano', 'Lentes delicadas'],
    partes: ['Oculares', 'Rueda de foco', 'Prismas', 'Objetivos'],
  },
  'megafono': {
    datos:  ['Amplifica la voz', 'Pilas'],
    partes: ['Bocina', 'Micrófono', 'Amplificador', 'Pilas'],
  },
  // ── Vehículos ────────────────────────────────────────────────────────────
  'auto': {
    datos:  ['Vehículo de 4 ruedas', 'Nafta, gasoil o eléc.'],
    partes: ['Carrocería', 'Ruedas y frenos', 'Motor', 'Caja de cambios', 'Batería', 'Tablero'],
  },
  'moto': {
    datos:  ['Vehículo de 2 ruedas', 'Motor a nafta'],
    partes: ['Cuadro', 'Ruedas y frenos', 'Motor', 'Cadena', 'Tanque', 'Manubrio'],
  },
  'bicicleta': {
    datos:  ['Vehículo a pedal', 'Sin motor'],
    partes: ['Cuadro', 'Ruedas', 'Frenos', 'Cadena y piñones', 'Pedales', 'Manubrio'],
  },
  'colectivo': {
    datos:  ['Transporte de gente', 'Motor diésel o gas'],
    partes: ['Carrocería', 'Puertas', 'Asientos', 'Motor trasero', 'Ruedas dobles'],
  },
  'camion': {
    datos:  ['Transporte de carga', 'Motor diésel'],
    partes: ['Cabina', 'Caja o acoplado', 'Motor', 'Ejes y ruedas', 'Frenos de aire'],
  },
  'tren': {
    datos:  ['Transporte sobre vías', 'Diésel o eléctrico'],
    partes: ['Locomotora', 'Vagones', 'Bogies', 'Enganches'],
  },
  'avion': {
    datos:  ['Aeronave de ala fija', 'Turbinas o hélices'],
    partes: ['Fuselaje', 'Alas', 'Motores', 'Cola', 'Tren de aterrizaje'],
  },
  'helicoptero': {
    datos:  ['Aeronave de rotor', 'Despega en vertical'],
    partes: ['Rotor principal', 'Rotor de cola', 'Cabina', 'Motor', 'Patines'],
  },
  'barco': {
    datos:  ['Embarcación', 'Motor o vela'],
    partes: ['Casco', 'Cubierta', 'Motor', 'Timón', 'Hélice'],
  },
  'topadora': {
    datos:  ['Máquina vial', 'Motor diésel, orugas'],
    partes: ['Pala', 'Orugas', 'Cabina', 'Motor', 'Brazos hidráulicos'],
  },
  'matafuego': {
    datos:  ['Apaga fuego', 'Mirar el manómetro'],
    partes: ['Precinto', 'Palanca', 'Manómetro', 'Manguera', 'Cilindro'],
  },
  // El detector y la red general lo tienen para que un peluche no salga «oso».
  'oso de peluche': {
    datos:  ['Juguete de tela', 'No es un animal'],
    partes: ['Tela', 'Relleno', 'Ojos y costuras'],
  },
};

const DE_A = 3;
const deATres = (lista) => { const out = []; for (let k = 0; k < lista.length; k += DE_A) out.push(lista.slice(k, k + DE_A)); return out; };

// Todas las fichas por nombre normalizado, con sus alias: «Memoria RAM», «ram» y
// «memoria» llevan a la misma. Lo que se enseña tiene el nombre que el usuario eligió.
const INDICE = new Map();
for (const [tipo, tabla] of [['aparato', FICHAS], ['animal', ANIMALES], ['pieza', PIEZAS]])
  for (const [clave, f] of Object.entries(tabla))
    for (const n of [clave, ...(f.alias ?? [])]) if (!INDICE.has(normalizarNombre(n))) INDICE.set(normalizarNombre(n), { tipo, clave, f });

// { tipo: 'aparato' | 'animal' | 'pieza', clave, f } o null.
export function fichaDe(nombre) {
  return INDICE.get(normalizarNombre(nombre)) ?? null;
}

// Las páginas de una ficha. null si no hay ficha con ese nombre.
//   aparato → los datos (y lo medido, que agrega quien llama), y las partes de a tres.
//   animal  → el peligro y lo primero que hay que hacer, siempre arriba (`fijas`: lo
//             medido no las empuja fuera de la pantalla); después qué hacer y cómo es.
//   pieza   → para qué sirve (con el aviso arriba, si tiene), cómo es y qué mirar.
export function paginasDe(nombre) {
  const ficha = fichaDe(nombre);
  if (!ficha) return null;
  const { tipo, f } = ficha;
  if (tipo === 'animal') return [
    { titulo: nombre, fijas: [renglonDePeligro(f.peligro), f.hacer[0]], lineas: [f.tipo] },
    ...deATres(f.hacer.slice(1)).map(lineas => ({ titulo: 'Qué hacer', lineas })),
    ...deATres(f.rasgos).map(lineas => ({ titulo: 'Cómo es', lineas })),
  ];
  if (tipo === 'pieza') return [
    { titulo: nombre, fijas: f.aviso ? [f.aviso] : [], lineas: f.funcion.slice() },
    ...deATres(f.diseno).map(lineas => ({ titulo: 'Diseño', lineas })),
    ...deATres(f.caracteristicas).map(lineas => ({ titulo: 'Características', lineas })),
  ];
  return [
    { titulo: nombre, fijas: [], lineas: f.datos.slice() },
    ...deATres(f.partes).map(lineas => ({ titulo: 'Partes', lineas })),
  ];
}

// La ficha para mostrar como una guía (pantalla con «◀ ▶»): un título para todas, así
// que cada sección arranca con su nombre como renglón («Qué hacer:»).
export function paginasSueltas(nombre) {
  const paginas = paginasDe(nombre);
  if (!paginas) return null;
  const [primera, ...resto] = paginas, secciones = new Map();
  for (const p of resto) secciones.set(p.titulo, [...(secciones.get(p.titulo) ?? []), ...p.lineas]);
  return [[...primera.fijas, ...primera.lineas].slice(0, DE_A), ...[...secciones].flatMap(([t, l]) => deATres([`${t}:`, ...l]))];
}

// Qué es, en un renglón, todo lo que reconocen la red general y el detector y no
// tiene ficha propia. De «persona» se dice eso y nada más: nada de cómo es.
export const DEFINICIONES = {
  'persona': 'Ser humano',
  'taza': 'Recipiente con asa', 'botella': 'Envase de líquidos', 'copa': 'Vaso con pie', 'lata': 'Envase de metal',
  'tetera': 'Calienta agua', 'bol': 'Recipiente hondo', 'sarten': 'Para freír',
  'tenedor': 'Cubierto con dientes', 'cuchillo': 'Cubierto con filo', 'cuchara': 'Cubierto cóncavo',
  'destornillador': 'Gira tornillos', 'navaja': 'Cuchillo plegable', 'pinza': 'Agarra y aprieta',
  'tijera': 'Corta con dos hojas', 'escalera': 'Para subir y bajar', 'torno': 'Máquina que tornea',
  'tripode': 'Soporte de tres patas', 'jeringa': 'Inyecta líquidos', 'clip': 'Sujeta papeles',
  'picaporte': 'Abre la puerta', 'rueda': 'Neumático', 'moneda': 'Dinero de metal',
  'anteojos': 'Corrigen la vista', 'mochila': 'Bolso de espalda', 'cartera': 'Bolso de mano',
  'valija': 'Equipaje de viaje', 'paraguas': 'Protege de la lluvia', 'zapatilla': 'Calzado deportivo',
  'remera': 'Prenda de algodón', 'corbata': 'Prenda del cuello', 'ropa': 'Prendas de vestir',
  'cable': 'Lleva energía o datos', 'webcam': 'Cámara de la compu',
  'semaforo': 'Ordena el tránsito', 'hidrante': 'Agua para bomberos', 'cartel de pare': 'Obliga a frenar',
  'parquimetro': 'Cobra estacionamiento', 'banco': 'Asiento largo',
  'frisbee': 'Disco para lanzar', 'esquis': 'Tablas para nieve', 'snowboard': 'Tabla para nieve',
  'pelota': 'Para jugar', 'barrilete': 'Vuela con el viento', 'bate': 'Palo de béisbol',
  'guante': 'Guante de béisbol', 'skate': 'Tabla con ruedas', 'tabla de surf': 'Tabla para olas',
  'raqueta': 'Para tenis o pádel',
  'banana': 'Fruta tropical', 'manzana': 'Fruta de árbol', 'naranja': 'Fruta cítrica',
  'brocoli': 'Verdura verde', 'zanahoria': 'Raíz comestible', 'sandwich': 'Pan con relleno',
  'pancho': 'Pan con salchicha', 'pizza': 'Masa con salsa', 'dona': 'Masa frita dulce', 'torta': 'Masa dulce horneada',
  'silla': 'Asiento con respaldo', 'sillon': 'Asiento acolchado', 'cama': 'Mueble para dormir',
  'mesa': 'Mueble con tablero', 'planta': 'Ser vivo verde', 'florero': 'Vaso para flores',
  'inodoro': 'Artefacto del baño', 'horno': 'Cocina con calor', 'pileta': 'Bacha con canilla',
  'libro': 'Hojas encuadernadas', 'secador de pelo': 'Seca con aire', 'cepillo dental': 'Limpia los dientes',
};

// Qué es una cosa, en un renglón: lo de su ficha si tiene, o la definición de arriba.
export function definicionDe(nombre) {
  const ficha = fichaDe(nombre);
  if (ficha?.tipo === 'animal') return ficha.f.tipo;
  if (ficha?.tipo === 'pieza') return ficha.f.funcion[0];
  if (ficha) return ficha.f.datos[0];
  return DEFINICIONES[normalizarNombre(nombre)] ?? null;
}

// Lo mismo, para que el LLM lo cuente en voz alta.
export function resumenDeFicha(nombre) {
  const ficha = fichaDe(nombre);
  if (!ficha) return null;
  const { tipo, f } = ficha;
  if (tipo === 'animal') return { es: 'animal', tipo_de_animal: f.tipo, peligro: f.peligro, que_hacer: f.hacer, como_es: f.rasgos };
  if (tipo === 'pieza') return { es: 'pieza', aviso: f.aviso, funcion: f.funcion, diseno: f.diseno, caracteristicas: f.caracteristicas };
  return { es: 'aparato', datos_del_tipo: f.datos, partes_del_tipo: f.partes };
}
