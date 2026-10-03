// fichas_animales.js — qué es cada animal, cuánto cuidado hay que tenerle y qué hacer.
//
// Lo usa fichas.js para la pantalla, y el LLM (que_veo, mostrar_ficha) para hablar.
// Son datos DE LA ESPECIE, no del animal que se tiene delante: un perro puede ser
// manso o no, y la cámara no lo sabe.
//
//   tipo    → qué clase de animal es.
//   peligro → para un adulto que se lo cruza sin molestarlo: bajo, medio, alto o
//             muy alto. Cuando la cámara no puede distinguir especies parecidas, vale
//             la MÁS peligrosa: toda serpiente se trata como venenosa (en Argentina
//             hay yarará, coral y cascabel), todo alacrán como el Tityus, y toda araña
//             como si pudiera ser del rincón o viuda negra. Equivocarse para el lado
//             del cuidado cuesta un susto; para el otro, una picadura.
//   hacer   → qué hacer, lo primero primero. El primero va siempre en pantalla.
//   rasgos  → cómo es, en pocas palabras.
//   alias   → otros nombres con los que se le puede enseñar o preguntar.
//
// Cada renglón entra en 21 columnas (lo vigila pruebas/fichas.test.js). Los que tienen
// clase en la red general o en el detector se llaman igual que allá (sin tildes, como
// «camion»): herramientas/categorias.json y src/detector.js.

export const NIVELES = ['bajo', 'medio', 'alto', 'muy alto'];

// El teléfono del Centro Nacional de Intoxicaciones (Hospital Posadas), para picaduras
// y mordeduras de animales venenosos. Atiende las 24 horas.
const INTOXICACIONES = 'Intox.: 0800-333-0160';

export const ANIMALES = {
  // ── Los que marca el detector (COCO) ─────────────────────────────────────
  'perro': {
    tipo: 'Mamífero doméstico', peligro: 'medio', alias: ['perrito', 'cachorro', 'galgo'],
    hacer: ['No lo mires fijo', 'No corras: despacio', 'Si muerde: al médico'],
    rasgos: ['Olfato muy fino', 'Vive 10 a 15 años', 'Se vacuna (rabia)'],
  },
  'gato': {
    tipo: 'Mamífero doméstico', peligro: 'bajo', alias: ['gatito', 'felino'],
    hacer: ['Puede arañar', 'Si muerde: lavá bien'],
    rasgos: ['Ve en la oscuridad', 'Caza de noche', 'Vive 12 a 18 años'],
  },
  'pajaro': {
    tipo: 'Ave', peligro: 'bajo', alias: ['ave', 'pajarito', 'gorrion', 'hornero', 'zorzal', 'gaviota'],
    hacer: ['No lo toques', 'Lavate las manos'],
    rasgos: ['Plumas y pico', 'Pone huevos', 'Huesos huecos'],
  },
  'caballo': {
    tipo: 'Mamífero de granja', peligro: 'medio', alias: ['yegua', 'potro', 'caballito'],
    hacer: ['No pases por atrás', 'Patea y muerde', 'Hablale al acercarte'],
    rasgos: ['Pesa 400 a 600 kg', 'Ve casi 360°', 'Duerme parado'],
  },
  'oveja': {
    tipo: 'Mamífero de granja', peligro: 'bajo', alias: ['carnero', 'cordero'],
    hacer: ['El carnero embiste'],
    rasgos: ['Da lana y leche', 'Vive en rebaño', 'Rumiante'],
  },
  'vaca': {
    tipo: 'Mamífero de granja', peligro: 'medio', alias: ['toro', 'ternero', 'buey', 'novillo'],
    hacer: ['Lejos de su ternero', 'El toro: alejate'],
    rasgos: ['Pesa 500 a 700 kg', 'Rumiante: 4 estómagos', 'Da leche y carne'],
  },
  'elefante': {
    tipo: 'Mamífero salvaje', peligro: 'muy alto',
    hacer: ['Alejate despacio', 'No lo encierres', 'Orejas abiertas: ojo'],
    rasgos: ['Pesa hasta 6 t', 'Trompa: nariz y mano', 'Vive 60 a 70 años'],
  },
  'oso': {
    tipo: 'Mamífero salvaje', peligro: 'muy alto',
    hacer: ['No corras', 'Retrocedé despacio', 'Hablale con calma'],
    rasgos: ['Omnívoro', 'Corre a 50 km/h', 'Trepa y nada'],
  },
  'cebra': {
    tipo: 'Mamífero salvaje', peligro: 'alto',
    hacer: ['Patea y muerde', 'No te acerques'],
    rasgos: ['Rayas únicas', 'Vive en manada', 'Herbívora'],
  },
  'jirafa': {
    tipo: 'Mamífero salvaje', peligro: 'medio',
    hacer: ['Patea muy fuerte', 'No te acerques'],
    rasgos: ['La más alta: 5,5 m', 'Lengua de 45 cm', 'Herbívora'],
  },

  // ── Los de la red general (Caltech-256) ──────────────────────────────────
  'murcielago': {
    tipo: 'Mamífero volador', peligro: 'medio',
    hacer: ['NO lo toques', 'Puede tener rabia', 'Si muerde: al médico'],
    rasgos: ['Vuela de noche', 'Se guía por el eco', 'Come insectos'],
  },
  'mariposa': {
    tipo: 'Insecto', peligro: 'bajo', alias: ['polilla'],
    hacer: ['Inofensiva', 'Su oruga peluda quema'],
    rasgos: ['Fue oruga y capullo', 'Poliniza flores', 'Vive pocas semanas'],
  },
  // Toda oruga peluda se trata como la «gata peluda» (Lonomia), que en Misiones causa
  // hemorragias: a simple vista no se distingue.
  'oruga': {
    tipo: 'Larva de mariposa', peligro: 'medio', alias: ['gata peluda', 'isoca'],
    hacer: ['No la toques', 'Las peludas queman', 'Si quema: al médico'],
    rasgos: ['Será mariposa', 'Come hojas', 'Algunas son plaga'],
  },
  'camello': {
    tipo: 'Mamífero de desierto', peligro: 'medio', alias: ['dromedario'],
    hacer: ['Muerde y patea', 'Puede escupir'],
    rasgos: ['Joroba de grasa', 'Aguanta sin agua', 'Pesa 400 a 600 kg'],
  },
  'ciempies': {
    tipo: 'Artrópodo', peligro: 'medio', alias: ['escolopendra'],
    hacer: ['Pica: no lo toques', 'Si pica: al médico'],
    rasgos: ['Muchas patas', 'Caza insectos', 'Vive en la humedad'],
  },
  'chimpance': {
    tipo: 'Primate salvaje', peligro: 'alto', alias: ['mono'],
    hacer: ['Muy fuerte: lejos', 'No lo mires fijo'],
    rasgos: ['Usa herramientas', 'Vive en grupos', 'Pariente nuestro'],
  },
  'cucaracha': {
    tipo: 'Insecto', peligro: 'bajo',
    hacer: ['Lleva gérmenes', 'Tapá la comida'],
    rasgos: ['Sale de noche', 'Muy resistente', 'Corre rápido'],
  },
  'cormoran': {
    tipo: 'Ave acuática', peligro: 'bajo', alias: ['bigua'],
    hacer: ['No lo toques'],
    rasgos: ['Bucea para pescar', 'Seca alas al sol', 'Plumaje oscuro'],
  },
  'cangrejo': {
    tipo: 'Crustáceo', peligro: 'bajo',
    hacer: ['Ojo las pinzas'],
    rasgos: ['Camina de costado', 'Tiene caparazón', 'Diez patas'],
  },
  'delfin': {
    tipo: 'Mamífero marino', peligro: 'bajo', alias: ['tonina'],
    hacer: ['No lo alimentes', 'Miralo de lejos'],
    rasgos: ['Respira aire', 'Se guía por el eco', 'Muy inteligente'],
  },
  'pato': {
    tipo: 'Ave acuática', peligro: 'bajo',
    hacer: ['No le des pan'],
    rasgos: ['Patas palmeadas', 'Pico ancho', 'Nada y vuela'],
  },
  'ciervo': {
    tipo: 'Mamífero salvaje', peligro: 'medio', alias: ['venado', 'alce', 'reno'],
    hacer: ['En celo embiste', 'En la ruta: frená'],
    rasgos: ['El macho tiene astas', 'Las cambia cada año', 'Herbívoro'],
  },
  'rana': {
    tipo: 'Anfibio', peligro: 'bajo', alias: ['ranita'],
    hacer: ['Lavate las manos'],
    rasgos: ['Respira por la piel', 'Fue renacuajo', 'Salta mucho'],
  },
  'cabra': {
    tipo: 'Mamífero de granja', peligro: 'bajo', alias: ['chivo', 'cabrito'],
    hacer: ['Puede topar'],
    rasgos: ['Trepa muy bien', 'Da leche', 'Rumiante'],
  },
  'pez': {
    tipo: 'Pez', peligro: 'bajo', alias: ['pescado', 'pez dorado', 'pececito'],
    hacer: ['Sin peligro'],
    rasgos: ['Respira por branquias', 'Tiene escamas', 'Nada con aletas'],
  },
  'ganso': {
    tipo: 'Ave de granja', peligro: 'bajo',
    hacer: ['Pica si lo molestás'],
    rasgos: ['Hace de guardián', 'Vuela en V', 'Nada y camina'],
  },
  'gorila': {
    tipo: 'Primate salvaje', peligro: 'alto',
    hacer: ['Muy fuerte: lejos', 'No lo mires fijo'],
    rasgos: ['Pesa hasta 200 kg', 'Come plantas', 'Vive en grupos'],
  },
  'tucura': {
    tipo: 'Insecto', peligro: 'bajo', alias: ['saltamontes', 'langosta', 'grillo'],
    hacer: ['Sin peligro'],
    rasgos: ['Salta muy lejos', 'Come hojas', 'Algunas son plaga'],
  },
  'tortuga marina': {
    tipo: 'Reptil marino', peligro: 'bajo',
    hacer: ['No la toques', 'Especie protegida'],
    rasgos: ['Respira aire', 'Vive décadas', 'Desova en la playa'],
  },
  'mosca': {
    tipo: 'Insecto', peligro: 'bajo',
    hacer: ['Lleva gérmenes', 'Tapá la comida'],
    rasgos: ['Ojos compuestos', 'Vive 2 a 4 semanas', 'Pone muchos huevos'],
  },
  'picaflor': {
    tipo: 'Ave', peligro: 'bajo', alias: ['colibri'],
    hacer: ['Sin peligro'],
    rasgos: ['Aletea 50 a 80 por s', 'Toma néctar', 'Vuela para atrás'],
  },
  'ibis': {
    tipo: 'Ave acuática', peligro: 'bajo', alias: ['bandurria', 'cuervillo'],
    hacer: ['Sin peligro'],
    rasgos: ['Pico largo y curvo', 'Come en el barro', 'Vive en bandadas'],
  },
  'iguana': {
    tipo: 'Reptil', peligro: 'bajo', alias: ['lagarto'],
    hacer: ['Muerde y da coletazo', 'Lavate las manos'],
    rasgos: ['Come plantas', 'Toma sol', 'Cola larga'],
  },
  'canguro': {
    tipo: 'Marsupial', peligro: 'medio',
    hacer: ['Patea muy fuerte', 'No te acerques'],
    rasgos: ['Cría en la bolsa', 'Salta a 50 km/h', 'De Australia'],
  },
  'orca': {
    tipo: 'Mamífero marino', peligro: 'alto',
    hacer: ['Mirala de lejos', 'No entres al agua'],
    rasgos: ['Delfín grande', 'Caza en grupo', 'Pesa hasta 6 t'],
  },
  'leopardo': {
    tipo: 'Felino salvaje', peligro: 'muy alto', alias: ['jaguar', 'yaguarete'],
    hacer: ['No corras', 'Retrocedé despacio', 'Hacete grande'],
    rasgos: ['Manchas en roseta', 'Trepa árboles', 'Caza de noche'],
  },
  'llama': {
    tipo: 'Camélido', peligro: 'bajo', alias: ['guanaco', 'vicuna', 'alpaca'],
    hacer: ['Puede escupir'],
    rasgos: ['De los Andes', 'Da lana', 'Animal de carga'],
  },
  'pulpo': {
    tipo: 'Molusco', peligro: 'bajo',
    hacer: ['No lo agarres', 'Algunos son tóxicos'],
    rasgos: ['Ocho brazos', 'Cambia de color', 'Muy inteligente'],
  },
  'avestruz': {
    tipo: 'Ave corredora', peligro: 'alto', alias: ['nandu', 'choique'],
    hacer: ['Patea muy fuerte', 'No te acerques'],
    rasgos: ['No vuela', 'Corre a 70 km/h', 'Huevo de 1,5 kg'],
  },
  'lechuza': {
    tipo: 'Ave nocturna', peligro: 'bajo', alias: ['buho', 'lechucita', 'caburé'],
    hacer: ['Garras filosas'],
    rasgos: ['Caza de noche', 'Gira la cabeza 270°', 'Vuelo silencioso'],
  },
  'pinguino': {
    tipo: 'Ave marina', peligro: 'bajo',
    hacer: ['Pica si te acercás'],
    rasgos: ['No vuela: nada', 'Vive en colonias', 'Hay en la Patagonia'],
  },
  'puercoespin': {
    tipo: 'Roedor', peligro: 'medio',
    hacer: ['Púas: no lo toques', 'Púa clavada: médico'],
    rasgos: ['Miles de púas', 'Come plantas', 'Sale de noche'],
  },
  'mamboreta': {
    tipo: 'Insecto', peligro: 'bajo', alias: ['mantis', 'tata dios'],
    hacer: ['Inofensivo'],
    rasgos: ['Caza insectos', 'Patas como pinzas', 'Gira la cabeza'],
  },
  'mapache': {
    tipo: 'Mamífero salvaje', peligro: 'medio', alias: ['aguara pope'],
    hacer: ['No lo toques', 'Puede tener rabia', 'Si muerde: al médico'],
    rasgos: ['Antifaz negro', 'Lava la comida', 'Sale de noche'],
  },
  'alacran': {
    tipo: 'Arácnido venenoso', peligro: 'alto', alias: ['escorpion'],
    hacer: ['No lo toques', 'Si pica: al médico', INTOXICACIONES],
    rasgos: ['Aguijón en la cola', 'Grave en chicos', 'Se esconde en grietas'],
  },
  'zorrino': {
    tipo: 'Mamífero salvaje', peligro: 'bajo', alias: ['mofeta'],
    hacer: ['No lo asustes', 'Rocía olor fuerte'],
    rasgos: ['Rayas blancas', 'Sale de noche', 'Come insectos'],
  },
  'caracol': {
    tipo: 'Molusco', peligro: 'bajo', alias: ['babosa'],
    hacer: ['No lo toques', 'Lavate las manos'],
    rasgos: ['Lleva su casa', 'Deja baba', 'Come plantas'],
  },
  'serpiente': {
    tipo: 'Reptil', peligro: 'alto', alias: ['vibora', 'culebra', 'yarara', 'coral', 'cascabel', 'boa'],
    hacer: ['Tratala de venenosa', 'Alejate despacio', 'Si muerde: al médico', INTOXICACIONES],
    rasgos: ['Hay yarará y coral', 'Siente el calor', 'Huele con la lengua'],
  },
  'arana': {
    tipo: 'Arácnido', peligro: 'medio', alias: ['tarantula', 'viuda negra', 'arana del rincon'],
    hacer: ['Puede ser venenosa', 'No la toques', 'Si pica: al médico', INTOXICACIONES],
    rasgos: ['Ocho patas', 'Teje telas', 'Rincón y viuda: ojo'],
  },
  'estrella de mar': {
    tipo: 'Equinodermo', peligro: 'bajo',
    hacer: ['Dejala en el agua'],
    rasgos: ['Cinco brazos', 'Regenera brazos', 'Come moluscos'],
  },
  'cisne': {
    tipo: 'Ave acuática', peligro: 'bajo',
    hacer: ['Si tiene cría, ojo'],
    rasgos: ['Cuello largo', 'Pareja de por vida', 'Hay de cuello negro'],
  },
  'sapo': {
    tipo: 'Anfibio', peligro: 'bajo', alias: ['escuerzo'],
    hacer: ['No lo toques', 'Tóxico para perros'],
    rasgos: ['Piel seca y rugosa', 'Come insectos', 'Sale de noche'],
  },

  // ── Sin fotos para la red: valen si se los enseñás, o si los nombra el LLM ──
  'abeja': {
    tipo: 'Insecto', peligro: 'medio', alias: ['abejorro'],
    hacer: ['No la espantes', 'Alérgico: al médico', 'Sacá el aguijón'],
    rasgos: ['Hace miel', 'Poliniza flores', 'Muere al picar'],
  },
  'avispa': {
    tipo: 'Insecto', peligro: 'medio', alias: ['camoati'],
    hacer: ['Alejate del nido', 'Alérgico: al médico'],
    rasgos: ['Pica varias veces', 'Nido de papel', 'Defiende en grupo'],
  },
  'mosquito': {
    tipo: 'Insecto', peligro: 'medio', alias: ['aedes', 'zancudo'],
    hacer: ['Puede llevar dengue', 'Usá repelente', 'Sin agua estancada'],
    rasgos: ['Pica la hembra', 'Cría en agua quieta', 'Activo al atardecer'],
  },
  'rata': {
    tipo: 'Roedor', peligro: 'medio', alias: ['raton', 'laucha'],
    hacer: ['No la toques', 'Trae enfermedades', 'Limpiá con lavandina'],
    rasgos: ['Sale de noche', 'Roe cables', 'Leptospirosis'],
  },
  'hormiga': {
    tipo: 'Insecto', peligro: 'bajo',
    hacer: ['La colorada pica'],
    rasgos: ['Vive en colonias', 'Carga mucho peso', 'Sigue un rastro'],
  },
  'gallina': {
    tipo: 'Ave de granja', peligro: 'bajo', alias: ['gallo', 'pollito'],
    hacer: ['Lavate las manos'],
    rasgos: ['Pone huevos', 'Vuela poco', 'Come granos'],
  },
  'chancho': {
    tipo: 'Mamífero de granja', peligro: 'medio', alias: ['cerdo', 'lechon'],
    hacer: ['Puede morder', 'Lejos de sus crías'],
    rasgos: ['Muy inteligente', 'Omnívoro', 'Olfato muy fino'],
  },
  'conejo': {
    tipo: 'Mamífero', peligro: 'bajo', alias: ['liebre'],
    hacer: ['Sin peligro'],
    rasgos: ['Dientes que crecen', 'Herbívoro', 'Oído muy fino'],
  },
  'carpincho': {
    tipo: 'Roedor', peligro: 'bajo', alias: ['capibara'],
    hacer: ['Puede morder', 'No lo alimentes'],
    rasgos: ['El roedor más grande', 'Vive cerca del agua', 'Herbívoro'],
  },
  'paloma': {
    tipo: 'Ave', peligro: 'bajo', alias: ['torcaza'],
    hacer: ['No la toques', 'Lavate las manos'],
    rasgos: ['Vive en ciudades', 'Vuelve a su nido', 'Come semillas'],
  },
  'lagartija': {
    tipo: 'Reptil', peligro: 'bajo',
    hacer: ['Sin peligro'],
    rasgos: ['Suelta la cola', 'Come insectos', 'Toma sol'],
  },
  'tortuga': {
    tipo: 'Reptil', peligro: 'bajo', alias: ['tortuga de tierra'],
    hacer: ['Lavate las manos'],
    rasgos: ['Caparazón', 'Vive muchos años', 'Muy lenta'],
  },
  'yacare': {
    tipo: 'Reptil', peligro: 'alto', alias: ['caiman', 'cocodrilo', 'yacaré'],
    hacer: ['No te acerques', 'Lejos de la orilla'],
    rasgos: ['Caimán argentino', 'Vive en esteros', 'Mordida muy fuerte'],
  },
  'puma': {
    tipo: 'Felino salvaje', peligro: 'muy alto', alias: ['leon americano'],
    hacer: ['No corras', 'Hacete grande', 'Retrocedé despacio'],
    rasgos: ['Hay en casi todo AR', 'Caza de noche', 'Salta muy alto'],
  },
  'jabali': {
    tipo: 'Mamífero salvaje', peligro: 'alto', alias: ['pecari', 'chancho salvaje'],
    hacer: ['Puede embestir', 'Alejate despacio'],
    rasgos: ['Colmillos', 'Vive en grupos', 'Olfato muy fino'],
  },
  'zorro': {
    tipo: 'Mamífero salvaje', peligro: 'medio', alias: ['zorro gris', 'aguara guazu'],
    hacer: ['No lo alimentes', 'Puede tener rabia'],
    rasgos: ['Come de todo', 'Sale al atardecer', 'Vive en el campo'],
  },
};

// Las especies que el detector no distingue: él dice «pajaro», y si las redes propias
// reconocen cuál, se muestra el nombre más específico (ver sesion.js).
export const ESPECIES_DE = {
  'pajaro': ['pato', 'ganso', 'cisne', 'picaflor', 'lechuza', 'pinguino', 'avestruz', 'ibis', 'cormoran', 'paloma', 'gallina'],
};

export const esEspecieDe = (especie, generico) => Boolean(ESPECIES_DE[generico]?.includes(especie));

// El renglón del peligro. Alto y muy alto, en mayúsculas: tienen que verse de reojo.
export function renglonDePeligro(nivel) {
  return `Peligro: ${NIVELES.indexOf(nivel) >= 2 ? nivel.toUpperCase() : nivel}`;
}

// Lo que se sabe que es peligroso no baja de este nivel, diga lo que diga quien lo
// nombró (el LLM puede llamar «culebra inofensiva» a una yarará en una foto borrosa).
// Los patrones van sin tildes: se comparan contra el nombre ya normalizado.
const PISOS = [
  [/\b(vibora|serpiente|culebra|yarara|coral|cascabel|cobra|mamba|boa|anaconda|piton)\b/, 'alto'],
  [/\b(alacran|escorpion)\b/, 'alto'],
  [/\b(yacare|caiman|cocodrilo|tiburon)\b/, 'alto'],
  [/\b(puma|leon|tigre|leopardo|jaguar|yaguarete|elefante|hipopotamo)\b/, 'muy alto'],
  [/\boso\b(?!.*peluche)/, 'muy alto'],
  [/\b(arana|tarantula|viuda)\b/, 'medio'],
  [/\b(murcielago|rata|raton|mapache|abeja|avispa|mosquito|medusa|aguaviva|escolopendra|ciempies|oruga)\b/, 'medio'],
];

// «Araña del Rincón» → «arana del rincon»: así se comparan los nombres.
export const normalizarNombre = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

export function pisoDePeligro(nombre, nivel) {
  const n = normalizarNombre(nombre);
  let i = Math.max(0, NIVELES.indexOf(nivel));
  for (const [patron, piso] of PISOS) if (patron.test(n)) i = Math.max(i, NIVELES.indexOf(piso));
  return NIVELES[i];
}
