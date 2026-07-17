// Native Feinschrift: Poppins auf Offscreen-Canvas gerendert, vom
// Dirigenten als Feinraster-Agenten geweckt (echte Kantenglättung:
// Glyph-Alpha → Agentenfarbe).
export function buildLabelCanvas(text, opts = {}) {
  const font = opts.font || '400 13px Poppins, ui-sans-serif, sans-serif';
  const color = opts.color || '#e1e5e3';
  const height = opts.height || 20;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 6;
  cv.width = Math.max(2, w);
  cv.height = height;
  const c2 = cv.getContext('2d');
  c2.font = font;
  c2.textBaseline = 'middle';
  c2.fillStyle = color;
  c2.fillText(text, 3, Math.round(height / 2));
  return cv;
}

// Beliebige CanvasImageSource auf w×h rastern → RGBA-Daten
const sampCv = document.createElement('canvas');
const sampCtx = sampCv.getContext('2d', { willReadFrequently: true });

export function sampleCanvas(source, w, h) {
  if (sampCv.width !== w || sampCv.height !== h) {
    sampCv.width = w;
    sampCv.height = h;
  }
  sampCtx.clearRect(0, 0, w, h);
  sampCtx.drawImage(source, 0, 0, w, h);
  return sampCtx.getImageData(0, 0, w, h).data;
}
