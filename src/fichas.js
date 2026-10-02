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
};

const PARTES_POR_PAGINA = 3;

// Las páginas de una ficha: la primera con los datos (y lo medido, que agrega quien
// llama), las siguientes con las partes de a tres. null si la clase no tiene ficha.
export function paginasDe(nombre) {
  const f = FICHAS[nombre];
  if (!f) return null;
  const paginas = [{ titulo: nombre, lineas: f.datos.slice() }];
  for (let k = 0; k < f.partes.length; k += PARTES_POR_PAGINA)
    paginas.push({ titulo: 'Partes', lineas: f.partes.slice(k, k + PARTES_POR_PAGINA) });
  return paginas;
}
