// hud.js — el HUD de la opción A es un OLED SSD1306 de 128×64, monocromo.
//
// Con la fuente de 6×8 entran 21 columnas. Se usan 5 renglones: un título, tres
// de texto y un pie. El corte de palabras se hace ACÁ, en el cerebro, para que el
// ESP32 sólo tenga que dibujar renglones ya armados.

export const ANCHO_PX = 128;
export const ALTO_PX  = 64;
export const COLS     = 21;
export const LINEAS_TEXTO = 3;

export function recortar(texto, cols = COLS) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= cols ? t : t.slice(0, cols - 1) + '…';
}

// Parte un texto en renglones de `cols`, cortando por palabra. Una palabra más
// larga que el renglón se parte. Si no entra todo, el último renglón termina en «…».
export function envolver(texto, cols = COLS, maxLineas = LINEAS_TEXTO) {
  const palabras = String(texto ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lineas = [];
  let actual = '';
  for (let p of palabras) {
    while (p.length > cols) {
      if (actual) { lineas.push(actual); actual = ''; }
      lineas.push(p.slice(0, cols));
      p = p.slice(cols);
    }
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= cols) actual += ' ' + p;
    else { lineas.push(actual); actual = p; }
  }
  if (actual) lineas.push(actual);
  if (lineas.length <= maxLineas) return lineas;
  const visibles = lineas.slice(0, maxLineas);
  const ultima = visibles[maxLineas - 1];
  visibles[maxLineas - 1] = (ultima.length >= cols ? ultima.slice(0, cols - 1) : ultima) + '…';
  return visibles;
}

export function componerHud({ titulo, texto, lineas, pie }) {
  return {
    t: 'hud',
    titulo: recortar(titulo),
    lineas: lineas ? lineas.slice(0, LINEAS_TEXTO).map(l => recortar(l)) : envolver(texto),
    pie: recortar(pie),
  };
}
