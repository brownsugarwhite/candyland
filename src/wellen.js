// Wasserwellen: die Ruhe-Bewegung des Gitters folgt wandernden radialen
// Ringwellen — wie Steine, die sanft ins Wasser fallen. Jedes Zentrum
// erzeugt sin(k·r − ω·t)·exp(−r/λ); Auslenkung radial, dazu leichte
// Größenmodulation. Alles ruhig, smooth, organisch.
import { CONFIG } from './config.js';

export function createWellen(gitter) {
  const W = CONFIG.wellen;
  const n = W.centers;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const dirX = new Float32Array(n);
  const dirY = new Float32Array(n);
  const phase = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    cx[i] = (0.15 + 0.7 * ((i * 0.618 + 0.21) % 1)) * gitter.cols;
    cy[i] = (0.15 + 0.7 * ((i * 0.417 + 0.53) % 1)) * gitter.rows;
    const a = i * 2.399 + 0.7;
    dirX[i] = Math.cos(a);
    dirY[i] = Math.sin(a);
    phase[i] = i * 2.1;
  }

  return {
    update(dt, tSim) {
      for (let i = 0; i < n; i++) {
        cx[i] += dirX[i] * W.wander * dt;
        cy[i] += dirY[i] * W.wander * dt;
        // sanft an den Rändern umkehren
        if (cx[i] < gitter.cols * 0.1 || cx[i] > gitter.cols * 0.9) dirX[i] *= -1;
        if (cy[i] < gitter.rows * 0.1 || cy[i] > gitter.rows * 0.9) dirY[i] *= -1;
      }
      this.t = tSim;
    },
    t: 0,
    // → { ox, oy, s } Auslenkung (Zellen) + Größenfaktor an Weltpunkt
    sample(wx, wy, out) {
      let ox = 0, oy = 0, s = 0;
      for (let i = 0; i < n; i++) {
        const dx = wx - cx[i], dy = wy - cy[i];
        const r = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        const env = Math.exp(-r / CONFIG.wellen.lambda);
        const w = Math.sin(CONFIG.wellen.k * r - CONFIG.wellen.omega * this.t + phase[i]) * env;
        ox += (dx / r) * w;
        oy += (dy / r) * w;
        s += w;
      }
      out.ox = ox * CONFIG.wellen.posAmp;
      out.oy = oy * CONFIG.wellen.posAmp;
      out.s = 1 + s * CONFIG.wellen.sizeAmp;
      return out;
    },
  };
}
