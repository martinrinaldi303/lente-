// vocabulario_clip.js — los nombres que CLIP puede reconocer, en castellano y en inglés.
//
// CLIP sólo entiende inglés: cada nombre lleva su traducción. Hay dos partes:
//   · CLASES: las de la red general y las del detector, con `clase` igual al nombre que
//     usan ellas. Sirven para comparar opiniones («la red dice celular, ¿CLIP también?»).
//   · OTROS: cosas de todos los días que ninguna red tiene. Si CLIP las ve claras, la
//     pantalla puede decir «Parece una lata de aerosol» en vez de sólo «No lo conozco».
//
// A propósito, NO hay nada sobre gente: ni edades, ni ropa puesta, ni rasgos. Lo único
// que se puede decir de una persona es «persona», y eso lo deciden el detector y las
// redes, no esta lista. Lo que el usuario sume por voz se agrega aparte (sesion.js).

const e = (es, en, clase = es) => ({ es, en, clase });

export const CLASES = [
  e('persona', 'person'),
  e('taza', 'mug'), e('taza', 'cup'),
  e('destornillador', 'screwdriver'), e('navaja', 'pocket knife'), e('cuchillo', 'knife'),
  e('pinza', 'tweezers'), e('linterna', 'flashlight'), e('escalera', 'ladder'), e('lamparita', 'light bulb'),
  e('notebook', 'laptop computer'), e('teclado', 'computer keyboard'),
  e('pantalla', 'computer monitor'), e('pantalla', 'television'),
  e('mouse', 'computer mouse'), e('calculadora', 'calculator'), e('auriculares', 'headphones'),
  e('anteojos', 'eyeglasses'), e('reloj', 'wristwatch'), e('reloj', 'clock'), e('mochila', 'backpack'),
  e('cuchara', 'spoon'), e('sarten', 'frying pan'), e('lata', 'soda can'), e('botella', 'bottle'),
  e('paraguas', 'umbrella'), e('zapatilla', 'sneaker'), e('remera', 't-shirt'), e('clip', 'paper clip'),
  e('cd', 'compact disc'), e('tostadora', 'toaster'), e('microondas', 'microwave oven'), e('heladera', 'refrigerator'),
  e('matafuego', 'fire extinguisher'), e('rueda', 'car tire'), e('moneda', 'coin'), e('tetera', 'teapot'),
  e('jeringa', 'syringe'), e('picaporte', 'door handle'), e('tripode', 'tripod'), e('torno', 'lathe'),
  e('placa', 'circuit board'), e('reproductor mp3', 'mp3 player'), e('agenda digital', 'pda handheld computer'),
  e('telefono', 'landline telephone'), e('radiograbador', 'boombox'), e('videocasetera', 'vcr video player'),
  e('proyector', 'video projector'), e('fotocopiadora', 'photocopier'), e('joystick', 'joystick'),
  e('disquete', 'floppy disk'), e('trituradora', 'paper shredder'), e('lavarropas', 'washing machine'),
  e('panificadora', 'bread machine'), e('microscopio', 'microscope'), e('binoculares', 'binoculars'),
  e('megafono', 'megaphone'), e('celular', 'cell phone'), e('celular', 'smartphone'), e('control remoto', 'remote control'),
  e('auto', 'car'), e('moto', 'motorcycle'), e('colectivo', 'bus'), e('camion', 'truck'), e('bicicleta', 'bicycle'),
  e('tren', 'train'), e('avion', 'airplane'), e('barco', 'boat'), e('helicoptero', 'helicopter'), e('topadora', 'bulldozer'),
  e('murcielago', 'bat, the animal'), e('oso', 'bear'), e('mariposa', 'butterfly'), e('camello', 'camel'),
  e('ciempies', 'centipede'), e('chimpance', 'chimpanzee'), e('cucaracha', 'cockroach'), e('cormoran', 'cormorant'),
  e('cangrejo', 'crab'), e('perro', 'dog'), e('gato', 'cat'), e('delfin', 'dolphin'), e('pato', 'duck'),
  e('elefante', 'elephant'), e('ciervo', 'deer'), e('rana', 'frog'), e('jirafa', 'giraffe'), e('cabra', 'goat'),
  e('oveja', 'sheep'), e('vaca', 'cow'), e('pez', 'fish'), e('ganso', 'goose'), e('gorila', 'gorilla'),
  e('tucura', 'grasshopper'), e('tortuga marina', 'sea turtle'), e('caballo', 'horse'), e('mosca', 'house fly'),
  e('picaflor', 'hummingbird'), e('ibis', 'ibis'), e('iguana', 'iguana'), e('canguro', 'kangaroo'), e('orca', 'killer whale'),
  e('leopardo', 'leopard'), e('llama', 'llama'), e('pulpo', 'octopus'), e('avestruz', 'ostrich'), e('lechuza', 'owl'),
  e('pinguino', 'penguin'), e('puercoespin', 'porcupine'), e('mamboreta', 'praying mantis'), e('mapache', 'raccoon'),
  e('alacran', 'scorpion'), e('zorrino', 'skunk'), e('caracol', 'snail'), e('serpiente', 'snake'), e('arana', 'spider'),
  e('estrella de mar', 'starfish'), e('cisne', 'swan'), e('cebra', 'zebra'), e('sapo', 'toad'), e('oso de peluche', 'teddy bear'),
  e('ropa', 'clothes'), e('ropa', 'clothes hanging in a closet'),
  e('procesador', 'computer processor chip'), e('placa de video', 'graphics card'), e('memoria ram', 'ram memory module'),
  e('placa madre', 'computer motherboard'), e('disco rigido', 'hard disk drive'), e('gabinete', 'computer case'),
  e('cable', 'cable'), e('microfono', 'microphone'), e('parlante', 'loudspeaker'), e('webcam', 'webcam'),
  // Las del detector que la red general no tiene.
  e('semaforo', 'traffic light'), e('hidrante', 'fire hydrant'), e('cartel de pare', 'stop sign'), e('parquimetro', 'parking meter'),
  e('banco', 'bench'), e('pajaro', 'bird'), e('cartera', 'handbag'), e('corbata', 'necktie'), e('valija', 'suitcase'),
  e('frisbee', 'frisbee'), e('esquis', 'skis'), e('snowboard', 'snowboard'), e('pelota', 'ball'), e('barrilete', 'kite'),
  e('bate', 'baseball bat'), e('guante', 'baseball glove'), e('skate', 'skateboard'), e('tabla de surf', 'surfboard'),
  e('raqueta', 'tennis racket'), e('copa', 'wine glass'), e('tenedor', 'fork'), e('bol', 'bowl'), e('banana', 'banana'),
  e('manzana', 'apple'), e('sandwich', 'sandwich'), e('naranja', 'orange, the fruit'), e('brocoli', 'broccoli'),
  e('zanahoria', 'carrot'), e('pancho', 'hot dog'), e('pizza', 'pizza'), e('dona', 'donut'), e('torta', 'cake'),
  e('silla', 'chair'), e('sillon', 'couch'), e('planta', 'potted plant'), e('cama', 'bed'), e('mesa', 'table'),
  e('inodoro', 'toilet'), e('horno', 'oven'), e('pileta', 'sink'), e('libro', 'book'), e('florero', 'vase'),
  e('tijera', 'scissors'), e('secador de pelo', 'hair dryer'), e('cepillo dental', 'toothbrush'),
];

const o = (es, en) => ({ es, en, clase: null });

export const OTROS = [
  // Casa y cocina
  o('lata de aerosol', 'spray can'), o('desodorante', 'deodorant'), o('marcador', 'marker pen'), o('lapicera', 'pen'),
  o('lápiz', 'pencil'), o('goma de borrar', 'eraser'), o('regla', 'ruler'), o('cuaderno', 'paper notebook'), o('billetera', 'wallet'),
  o('llaves', 'keys'), o('llavero', 'keychain'), o('encendedor', 'lighter'), o('fósforos', 'matchbox'), o('vela', 'candle'),
  o('mate', 'mate gourd'), o('termo', 'thermos'), o('paquete de yerba', 'package of yerba mate'), o('pava', 'kettle'),
  o('vaso', 'drinking glass'), o('plato', 'plate'), o('olla', 'cooking pot'), o('tabla de picar', 'cutting board'),
  o('rallador', 'grater'), o('abrelatas', 'can opener'), o('sacacorchos', 'corkscrew'), o('colador', 'strainer'),
  o('licuadora', 'blender'), o('batidora', 'hand mixer'), o('cafetera', 'coffee maker'), o('jarra', 'jug'),
  o('frasco', 'glass jar'), o('táper', 'plastic food container'), o('rollo de cocina', 'paper towel roll'),
  o('papel higiénico', 'toilet paper roll'), o('esponja', 'sponge'), o('detergente', 'dish soap bottle'), o('jabón', 'bar of soap'),
  o('shampoo', 'shampoo bottle'), o('cepillo de pelo', 'hairbrush'), o('peine', 'comb'), o('toalla', 'towel'),
  o('máquina de afeitar', 'razor'), o('perfume', 'perfume bottle'), o('pomo de crema', 'tube of cream'), o('pasta dental', 'toothpaste tube'),
  o('espejo', 'mirror'), o('lámpara', 'lamp'), o('ventilador', 'electric fan'), o('estufa', 'space heater'),
  o('aire acondicionado', 'air conditioner'), o('enchufe', 'power outlet'), o('zapatilla eléctrica', 'power strip'),
  o('alargue', 'extension cord'), o('cargador', 'phone charger'), o('pendrive', 'usb flash drive'), o('tarjeta de memoria', 'memory card'),
  o('router', 'wifi router'), o('impresora', 'printer'), o('tablet', 'tablet computer'), o('reloj inteligente', 'smartwatch'),
  o('consola de videojuegos', 'video game console'), o('auriculares inalámbricos', 'wireless earbuds'), o('cámara de fotos', 'photo camera'),
  o('pilas', 'batteries'), o('batería portátil', 'power bank'), o('disco SSD', 'ssd drive'), o('ventilador de PC', 'computer fan'),
  o('fuente de PC', 'computer power supply'), o('almohada', 'pillow'), o('frazada', 'blanket'), o('cortina', 'curtain'),
  o('alfombra', 'rug'), o('puerta', 'door'), o('ventana', 'window'), o('percha', 'clothes hanger'), o('perchero', 'coat rack'),
  o('campera', 'jacket'), o('buzo', 'sweatshirt'), o('pantalón', 'trousers'), o('gorra', 'baseball cap'), o('sombrero', 'hat'),
  o('bufanda', 'scarf'), o('guantes', 'gloves'), o('medias', 'socks'), o('ojotas', 'flip-flops'), o('zapato', 'shoe'),
  o('bota', 'boot'), o('cinturón', 'belt'), o('anillo', 'ring'), o('collar', 'necklace'), o('pulsera', 'bracelet'),
  o('anteojos de sol', 'sunglasses'), o('caja de cartón', 'cardboard box'), o('caja', 'box'), o('bolsa de plástico', 'plastic bag'),
  o('bolsa de compras', 'shopping bag'), o('sobre', 'envelope'), o('carpeta', 'folder'), o('diario', 'newspaper'),
  o('revista', 'magazine'), o('póster', 'poster'), o('cuadro', 'picture frame'), o('calendario', 'calendar'),
  o('reloj de arena', 'hourglass'), o('globo terráqueo', 'desk globe'), o('trofeo', 'trophy'), o('bandera', 'flag'),
  o('billete', 'banknote'), o('tarjeta', 'plastic card'),
  // Herramientas
  o('martillo', 'hammer'), o('alicate', 'pliers'), o('llave inglesa', 'wrench'), o('taladro', 'power drill'), o('sierra', 'saw'),
  o('cinta métrica', 'tape measure'), o('cinta adhesiva', 'adhesive tape'), o('tornillo', 'screw'), o('clavo', 'nail'),
  o('soldador', 'soldering iron'), o('multímetro', 'multimeter'), o('pegamento', 'glue'), o('cúter', 'utility knife'),
  o('nivel', 'spirit level'), o('escoba', 'broom'), o('pala', 'shovel'), o('balde', 'bucket'), o('manguera', 'garden hose'),
  o('maceta', 'flower pot'), o('regadera', 'watering can'), o('carretilla', 'wheelbarrow'), o('candado', 'padlock'),
  // Comida
  o('pan', 'bread'), o('galletitas', 'cookies'), o('caramelo', 'candy'), o('chocolate', 'chocolate bar'), o('alfajor', 'alfajor cookie'),
  o('queso', 'cheese'), o('huevo', 'egg'), o('tomate', 'tomato'), o('papa', 'potato'), o('cebolla', 'onion'), o('limón', 'lemon'),
  o('frutilla', 'strawberry'), o('uvas', 'grapes'), o('sandía', 'watermelon'), o('ananá', 'pineapple'), o('lechuga', 'lettuce'),
  o('cartón de leche', 'milk carton'), o('botella de agua', 'water bottle'), o('lata de cerveza', 'beer can'),
  o('paquete de fideos', 'package of pasta'), o('caja de cereal', 'cereal box'), o('hamburguesa', 'hamburger'), o('helado', 'ice cream cone'),
  // Calle
  o('farola', 'street lamp'), o('tacho de basura', 'trash can'), o('contenedor', 'dumpster'), o('cono', 'traffic cone'),
  o('señal de tránsito', 'road sign'), o('buzón', 'mailbox'), o('árbol', 'tree'), o('flor', 'flower'), o('cactus', 'cactus'),
  o('patente', 'license plate'), o('surtidor de nafta', 'gas pump'), o('cabina telefónica', 'telephone booth'), o('triciclo', 'tricycle'),
  o('cochecito', 'baby stroller'), o('silla de ruedas', 'wheelchair'), o('muletas', 'crutches'), o('bastón', 'walking cane'),
  // Animales que las redes no tienen
  o('paloma', 'pigeon'), o('gallina', 'chicken'), o('conejo', 'rabbit'), o('hámster', 'hamster'), o('tortuga', 'turtle'),
  o('lagartija', 'lizard'), o('abeja', 'bee'), o('avispa', 'wasp'), o('mosquito', 'mosquito'), o('hormiga', 'ant'),
  o('chancho', 'pig'), o('carpincho', 'capybara'), o('zorro', 'fox'), o('lobo', 'wolf'), o('león', 'lion'), o('tigre', 'tiger'),
  o('mono', 'monkey'), o('loro', 'parrot'), o('gaviota', 'seagull'), o('cucaracha', 'cockroach'), o('lombriz', 'earthworm'),
  // Juegos, música y deporte
  o('dado', 'dice'), o('cartas', 'playing cards'), o('ajedrez', 'chess board'), o('rompecabezas', 'jigsaw puzzle'), o('muñeca', 'doll'),
  o('autito de juguete', 'toy car'), o('guitarra', 'guitar'), o('piano', 'piano'), o('violín', 'violin'), o('flauta', 'flute'),
  o('tambor', 'drum'), o('armónica', 'harmonica'), o('yo-yo', 'yo-yo'), o('globo', 'balloon'), o('mancuerna', 'dumbbell'),
  o('casco', 'helmet'), o('patines', 'roller skates'), o('carpa', 'tent'), o('pelota de fútbol', 'soccer ball'),
  o('pelota de tenis', 'tennis ball'), o('bolo', 'bowling pin'), o('palo de golf', 'golf club'),
  // Salud
  o('termómetro', 'thermometer'), o('remedios', 'pill bottle'), o('curita', 'adhesive bandage'), o('barbijo', 'face mask'),
];

export const VOCABULARIO = [...CLASES, ...OTROS.filter(x => !CLASES.some(c => c.es === x.es))];
