// Text → Feinraster-Pixel (Poppins, proportional, mit Kantenglättung).
// 1 Canvas-Pixel = 1 Textpixel; der Aufrufer bestimmt, wie groß ein
// Textpixel in Welteinheiten dargestellt wird. Rückgabe enthält pro
// gesetzter Zelle auch das Glyph-Alpha (für weiche Kanten im Schwarm).
const cv = document.createElement('canvas');
cv.width = 1024;
cv.height = 96;
const ctx = cv.getContext('2d', { willReadFrequently: true });

const fontStr = (px, weight) => `${weight} ${px}px Poppins, ui-sans-serif, sans-serif`;

// Zeilenhöhe in Rasterzeilen (inkl. Ober-/Unterlängen)
export const rasterRows = (px) => Math.ceil(px * 1.32);

export function measureTextPx(text, px, weight = 400) {
  ctx.font = fontStr(px, weight);
  return ctx.measureText(text).width;
}

// → { cells: Int16Array [dc,dr,...], alpha: Uint8Array, n, wPx, rows }
export function rasterizeText(text, px = 17, weight = 400) {
  const rows = rasterRows(px);
  if (!text) return { cells: new Int16Array(0), alpha: new Uint8Array(0), n: 0, wPx: 0, rows };
  ctx.font = fontStr(px, weight);
  const wPx = Math.min(cv.width, Math.max(1, Math.ceil(ctx.measureText(text).width) + 2));
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.font = fontStr(px, weight);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 1, Math.round(px * 1.02));
  const data = ctx.getImageData(0, 0, wPx, Math.min(cv.height, rows)).data;
  const h = Math.min(cv.height, rows);
  const cells = [];
  const alpha = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < wPx; x++) {
      const a = data[(y * wPx + x) * 4 + 3];
      if (a > 24) {
        cells.push(x, y);
        alpha.push(a);
      }
    }
  }
  return {
    cells: Int16Array.from(cells),
    alpha: Uint8Array.from(alpha),
    n: alpha.length,
    wPx, rows,
  };
}

// Greedy-Wortumbruch auf maximale Rasterbreite; lange Wörter werden
// hart getrennt. → Zeilen-Array
export function wrapText(text, maxWPx, px, weight = 400) {
  ctx.font = fontStr(px, weight);
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const fits = (s) => ctx.measureText(s).width <= maxWPx;
  for (let wd of words) {
    while (!fits(wd)) { // Einzelwort zu lang → hart trennen
      let cut = wd.length - 1;
      while (cut > 1 && !fits(wd.slice(0, cut))) cut--;
      const head = wd.slice(0, cut);
      if (line) { lines.push(line); line = ''; }
      lines.push(head);
      wd = wd.slice(cut);
    }
    const probe = line ? line + ' ' + wd : wd;
    if (line && !fits(probe)) {
      lines.push(line);
      line = wd;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}
