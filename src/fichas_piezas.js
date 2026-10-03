// fichas_piezas.js — las piezas de una computadora y de un celular: para qué sirven,
// cómo son y qué las distingue.
//
// La red general no tiene fotos de piezas sueltas (Caltech-256 sólo trae la placa
// PCI, que es «placa»): estas fichas se ven cuando le ENSEÑÁS la pieza con su nombre
// («memoria ram», «fuente»), cuando MIIA las nombra con mostrar_ficha, o como guía
// para lo que identifica el LLM a pedido.
//
//   funcion        → para qué sirve.
//   diseno         → cómo es y dónde va.
//   caracteristicas→ lo que hay que mirar al comprarla o cambiarla.
//   aviso          → si tocarla tiene un riesgo: va siempre en la primera página.
//   alias          → otros nombres con los que se la puede enseñar o preguntar.
//
// Cada renglón entra en 21 columnas (lo vigila pruebas/fichas.test.js).

export const PIEZAS = {
  // ── Computadora ───────────────────────────────────────────────────────────
  'placa madre': {
    alias: ['motherboard', 'mother', 'placa base', 'mainboard', 'placa principal'],
    funcion: ['Une todas las piezas', 'Reparte la energía', 'Lleva los datos'],
    diseno: ['Placa con zócalos', 'ATX, mATX o ITX', 'Ranuras RAM y PCIe'],
    caracteristicas: ['Socket del procesador', 'Chipset', 'Pila CMOS y BIOS'],
  },
  'procesador': {
    alias: ['cpu', 'micro', 'microprocesador', 'procesador de pc'],
    funcion: ['Hace las cuentas', 'Ejecuta programas'],
    diseno: ['Chip cuadrado', 'Pines o contactos', 'Va con disipador'],
    caracteristicas: ['Núcleos e hilos', 'Frecuencia en GHz', 'Calienta: pasta'],
  },
  'memoria ram': {
    alias: ['ram', 'memoria', 'dimm', 'sodimm', 'so-dimm', 'modulo de memoria'],
    funcion: ['Guarda lo que usás', 'Se borra al apagar'],
    diseno: ['Tira con chips', 'DIMM o SO-DIMM (nb)', 'Muesca: va de un lado'],
    caracteristicas: ['DDR3, DDR4 o DDR5', 'Capacidad en GB', 'Velocidad en MHz'],
  },
  'disco rigido': {
    alias: ['hdd', 'disco duro', 'disco', 'rigido'],
    funcion: ['Guarda los archivos', 'No se borra al apagar'],
    diseno: ['Platos magnéticos', 'Cabezal que se mueve', 'De 3,5" o 2,5"'],
    caracteristicas: ['Mucha capacidad', 'Más lento que un SSD', 'No lo golpees'],
  },
  'ssd': {
    alias: ['disco solido', 'm.2', 'nvme', 'disco ssd', 'unidad ssd'],
    funcion: ['Guarda los archivos', 'Arranca muy rápido'],
    diseno: ['Chips de memoria', '2,5" SATA o M.2', 'Sin partes móviles'],
    caracteristicas: ['NVMe: el más rápido', 'Aguanta golpes', 'Se gasta al escribir'],
  },
  'placa de video': {
    alias: ['gpu', 'tarjeta grafica', 'grafica', 'placa de vídeo', 'tarjeta de video'],
    funcion: ['Arma la imagen', 'Juegos y 3D', 'También IA'],
    diseno: ['Placa PCIe x16', 'Ventiladores', 'Salidas HDMI y DP'],
    caracteristicas: ['Memoria VRAM', 'Consume mucho', 'Cables PCIe 6/8 pin'],
  },
  'fuente': {
    alias: ['fuente de poder', 'psu', 'fuente de alimentacion', 'fuente atx'],
    aviso: 'No abrir: capacitores',
    funcion: ['Pasa 220 V a 12 V', 'y a 5 V y 3,3 V', 'Alimenta todo'],
    diseno: ['Caja de metal', 'Ventilador', 'Cables ATX y PCIe'],
    caracteristicas: ['Watts: la potencia', '80 Plus: eficiencia', 'Modular o no'],
  },
  'cooler': {
    alias: ['disipador', 'fan', 'ventilador de pc', 'refrigeracion', 'water cooling'],
    funcion: ['Saca el calor', 'Protege el procesador'],
    diseno: ['Aletas de metal', 'Ventilador', 'Pasta térmica abajo'],
    caracteristicas: ['Por aire o líquido', 'Vueltas en RPM', 'Limpiale el polvo'],
  },
  'gabinete': {
    alias: ['case', 'torre', 'chasis'],
    funcion: ['Protege las piezas', 'Guía el aire'],
    diseno: ['Chapa y vidrio', 'Bahías y ranuras', 'USB adelante'],
    caracteristicas: ['ATX, mATX o ITX', 'Lugar para coolers', 'Filtros de polvo'],
  },
  'pila cmos': {
    alias: ['cr2032', 'pila de la placa', 'bateria bios', 'pila bios'],
    funcion: ['Guarda la hora', 'y la configuración'],
    diseno: ['Pila botón CR2032', 'En la placa madre'],
    caracteristicas: ['Dura 3 a 5 años', 'Si falla: hora mal', 'Se cambia fácil'],
  },
  'placa wifi': {
    alias: ['wifi', 'placa de red', 'tarjeta de red', 'tarjeta wifi', 'antena wifi'],
    funcion: ['Conecta a internet', 'Por Wi-Fi o cable'],
    diseno: ['PCIe, M.2 o USB', 'Con antenas'],
    caracteristicas: ['Wi-Fi 5, 6 o 7', 'A veces Bluetooth', 'Velocidad en Mb/s'],
  },
  'lectora': {
    alias: ['lectora de cd', 'lectora de dvd', 'grabadora', 'dvd', 'unidad optica'],
    funcion: ['Lee CD y DVD', 'Algunas graban'],
    diseno: ['Bandeja que sale', 'Láser y motor', 'Bahía de 5,25"'],
    caracteristicas: ['Casi en desuso', 'Se conecta por SATA', 'El láser se gasta'],
  },
  'teclado de notebook': {
    alias: ['teclado de laptop', 'teclado interno'],
    funcion: ['Entrada de texto'],
    diseno: ['Teclas tijera', 'Flex a la placa', 'Remachado o atorn.'],
    caracteristicas: ['Distribución ES/LA', 'Con o sin luz', 'Se cambia entero'],
  },
  'bisagra': {
    alias: ['bisagras', 'bisagra de notebook'],
    funcion: ['Une pantalla y base', 'Deja abrir y cerrar'],
    diseno: ['Metal con resorte', 'Atornillada', 'Pasa el flex al lado'],
    caracteristicas: ['Se afloja con uso', 'Rota: tapa floja', 'Abrí desde el medio'],
  },

  // ── Celular ───────────────────────────────────────────────────────────────
  'bateria': {
    alias: ['batería', 'bateria de celular', 'bateria del celular', 'bateria de litio', 'bateria de notebook', 'pila de litio'],
    aviso: 'Hinchada: no la uses',
    funcion: ['Guarda la energía'],
    diseno: ['Bolsa plana de litio', 'Pegada con adhesivo', 'Flex con conector'],
    caracteristicas: ['Capacidad en mAh', 'Se gasta con cargas', 'No pinchar: fuego'],
  },
  'display': {
    alias: ['pantalla del celular', 'modulo de pantalla', 'lcd', 'oled', 'tactil', 'touch', 'glass'],
    funcion: ['Muestra la imagen', 'Detecta el tacto'],
    diseno: ['Vidrio y panel', 'Táctil pegado', 'Flex a la placa'],
    caracteristicas: ['LCD u OLED', 'Resolución y Hz', 'Se rompe al caer'],
  },
  'placa del celular': {
    alias: ['placa logica', 'placa madre del celular', 'logic board', 'placa del cel'],
    funcion: ['Procesa todo', 'Une todas las partes'],
    diseno: ['Placa chica', 'Chips soldados', 'Blindajes de metal'],
    caracteristicas: ['SoC: CPU, GPU y más', 'Memoria soldada', 'Difícil de reparar'],
  },
  'camara': {
    alias: ['modulo de camara', 'camara del celular', 'camara trasera', 'camara frontal'],
    funcion: ['Saca fotos y video'],
    diseno: ['Lente y sensor', 'Flex a la placa', 'A veces estabilizada'],
    caracteristicas: ['Megapíxeles', 'Varias por equipo', 'El vidrio se raya'],
  },
  'puerto de carga': {
    alias: ['pin de carga', 'conector de carga', 'ficha de carga', 'usb-c', 'usb c', 'lightning', 'micro usb', 'centro de carga'],
    funcion: ['Carga la batería', 'Pasa datos'],
    diseno: ['USB-C o Lightning', 'Suele ir en un flex'],
    caracteristicas: ['Junta pelusa', 'Limpiá sin metal', 'Se cambia el flex'],
  },
  'bandeja sim': {
    alias: ['sim', 'porta sim', 'bandeja del chip', 'chip', 'tarjeta sim'],
    funcion: ['Sostiene el chip', 'y a veces la microSD'],
    diseno: ['Bandeja de metal', 'Sale con una aguja'],
    caracteristicas: ['Nano SIM', 'Algunos usan eSIM', 'Tiene un burlete'],
  },
  'parlante': {
    alias: ['altavoz', 'speaker', 'auricular del celular', 'buzzer', 'altavoz del celular'],
    funcion: ['Saca el sonido'],
    diseno: ['Imán y bobina', 'Membrana y rejilla'],
    caracteristicas: ['Potencia en watts', 'Polvo: suena bajo', 'Cuidalo del agua'],
  },
  'microfono': {
    alias: ['mic', 'micro del celular'],
    funcion: ['Capta la voz'],
    diseno: ['Agujero chiquito', 'Hay 2 o 3 por equipo'],
    caracteristicas: ['Cancela el ruido', 'No metas agujas', 'Va en placa o flex'],
  },
  'motor de vibracion': {
    alias: ['vibrador', 'motor vibrador', 'taptic', 'taptic engine', 'vibracion'],
    funcion: ['Hace vibrar'],
    diseno: ['Motor chico', 'o lineal (Taptic)'],
    caracteristicas: ['Avisos sin sonido', 'Se cambia fácil'],
  },
  'flex': {
    alias: ['cable flex', 'flexor', 'cinta flex'],
    funcion: ['Une piezas a la placa'],
    diseno: ['Cinta de plástico', 'Pistas de cobre', 'Conector a presión'],
    caracteristicas: ['Frágil: no lo dobles', 'Desconectá batería', 'Antes de soltarlo'],
  },
  'tapa trasera': {
    alias: ['back cover', 'tapa del celular', 'tapa de atras'],
    funcion: ['Protege por atrás'],
    diseno: ['Vidrio, plástico', 'o metal', 'Pegada o a presión'],
    caracteristicas: ['Vidrio: carga inal.', 'Calor para despegar', 'Se rompe al caer'],
  },
  'bobina de carga': {
    alias: ['carga inalambrica', 'bobina', 'nfc', 'antena nfc', 'magsafe'],
    funcion: ['Carga sin cable', 'Pagos por NFC'],
    diseno: ['Espiral de cobre', 'Bajo la tapa trasera'],
    caracteristicas: ['Estándar Qi', 'Calienta un poco', 'Funda gruesa: falla'],
  },
};
