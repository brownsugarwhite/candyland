// Mathematische Figuren-Generatoren fürs Gehirn: reine Punktmengen,
// die der Schwarm formt — Ringe, Polygone, Spiralen, Phyllotaxis
// (goldener Winkel), Lissajous, Wellen. Wissenschaftlich schön.
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.507°

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// → Float32Array [x,y,...] mit n Punkten, zentriert um (cx, cy)
export function generateShape(kind, { x = 400, y = 300, r = 90, w = 0, h = 0, n = 200, p1 = 0, p2 = 0 }) {
  n = Math.max(8, Math.floor(n));
  const rx = w > 0 ? w / 2 : r;
  const ry = h > 0 ? h / 2 : r;
  const pts = new Float32Array(n * 2);

  switch (kind) {
    case 'polygon': {
      const sides = clamp(Math.round(p1) || 6, 3, 12);
      for (let k = 0; k < n; k++) {
        const t = (k / n) * sides;
        const e = Math.floor(t);
        const f = t - e;
        const a0 = (e / sides) * TAU - Math.PI / 2;
        const a1 = ((e + 1) / sides) * TAU - Math.PI / 2;
        pts[k * 2] = x + rx * (Math.cos(a0) * (1 - f) + Math.cos(a1) * f);
        pts[k * 2 + 1] = y + ry * (Math.sin(a0) * (1 - f) + Math.sin(a1) * f);
      }
      break;
    }
    case 'spiral': { // archimedisch, p1 = Windungen
      const turns = clamp(p1 || 3, 1, 8);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const a = t * turns * TAU;
        pts[k * 2] = x + rx * t * Math.cos(a);
        pts[k * 2 + 1] = y + ry * t * Math.sin(a);
      }
      break;
    }
    case 'phyllotaxis': { // Sonnenblume: goldener Winkel
      for (let k = 0; k < n; k++) {
        const rr = Math.sqrt((k + 0.5) / n);
        const a = k * GOLDEN_ANGLE;
        pts[k * 2] = x + rx * rr * Math.cos(a);
        pts[k * 2 + 1] = y + ry * rr * Math.sin(a);
      }
      break;
    }
    case 'lissajous': { // p1:p2 Frequenzverhältnis
      const fa = clamp(Math.round(p1) || 3, 1, 9);
      const fb = clamp(Math.round(p2) || 2, 1, 9);
      for (let k = 0; k < n; k++) {
        const t = (k / n) * TAU;
        pts[k * 2] = x + rx * Math.sin(fa * t + Math.PI / 2);
        pts[k * 2 + 1] = y + ry * Math.sin(fb * t);
      }
      break;
    }
    case 'wave': { // horizontale Sinuslinie, p1 = Perioden, p2 = Amplitude
      const per = clamp(p1 || 2, 0.5, 8);
      const amp = p2 > 0 ? p2 : ry * 0.4;
      const width = w > 0 ? w : rx * 2;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        pts[k * 2] = x - width / 2 + width * t;
        pts[k * 2 + 1] = y + amp * Math.sin(t * per * TAU);
      }
      break;
    }
    case 'ring':
    default: {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        pts[k * 2] = x + rx * Math.cos(a);
        pts[k * 2 + 1] = y + ry * Math.sin(a);
      }
      break;
    }
  }
  return pts;
}
