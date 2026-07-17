// Das WELT-GITTER von LUDI. 1 Welteinheit = 1 Zelle; Agentenidentität =
// Zellindex row*cols+col — stabil für immer, unabhängig von Zoom und Modus.
// Wach ist nur die Schachbrett-Hälfte (litParity); die dunklen Lücken-Zellen
// sind schlafende, adressierbare Agenten (dort sitzen Logo-Buchstaben,
// Claws und Schnellaktionen). Dahinter liegt der Reserve-Pool für
// Feinraster-Text, Bilder und Apps (Verdichtung bis 1×1 px).
import { CONFIG } from './config.js';

export function buildGitter(mode) {
  const M = CONFIG.modes[mode];
  const cols = M.cols, rows = M.rows;
  const latticeCount = cols * rows;
  const count = latticeCount + CONFIG.pool.reserve;
  const lit = CONFIG.gitter.litParity;

  // carrier = 1: wache Schachbrett-Zelle (das Gitter in Ruhe)
  const carrier = new Uint8Array(count);
  const carrierArr = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (((c + r) & 1) === lit) {
        const i = r * cols + c;
        carrier[i] = 1;
        carrierArr.push(i);
      }
    }
  }
  const carrierList = Int32Array.from(carrierArr);

  // Diagonale Nachbarn (NE, SE, SW, NW) — gleiche Parität, Abstand √2
  const neighbors = new Int32Array(latticeCount * 4).fill(-1);
  const D = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  for (const i of carrierList) {
    const c = i % cols, r = (i / cols) | 0;
    for (let k = 0; k < 4; k++) {
      const nc = c + D[k][0], nr = r + D[k][1];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      neighbors[i * 4 + k] = nr * cols + nc;
    }
  }

  // Mesh-Kanten: jede Diagonale einmal (NE + SE je wacher Zelle)
  const edgeArr = [];
  for (const i of carrierList) {
    for (let k = 0; k < 2; k++) {
      const j = neighbors[i * 4 + k];
      if (j >= 0) edgeArr.push(i, j);
    }
  }
  const edges = Int32Array.from(edgeArr);

  // Homes: Zellmitten (Welt); Reserve-Homes werden beim Wecken gesetzt
  const homeX = new Float32Array(count);
  const homeY = new Float32Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      homeX[i] = c + 0.5;
      homeY[i] = r + 0.5;
    }
  }

  return {
    mode, cols, rows, latticeCount, count,
    spacing: 1, lit,
    carrier, carrierList, neighbors, edges, homeX, homeY,
    view: { w: M.w, h: M.h },
    start: { col0: M.startCol0, row0: M.startRow0, cols: M.startCols },
  };
}

// Zellindex der Gitterzelle unter einem Weltpunkt (geclampt), -1 außerhalb+
export function cellAt(gitter, wx, wy) {
  const c = Math.floor(wx), r = Math.floor(wy);
  if (c < 0 || c >= gitter.cols || r < 0 || r >= gitter.rows) return -1;
  return r * gitter.cols + c;
}

// Nächste WACHE (lit) Zelle zu einem Weltpunkt, mit maximalem Abstand
export function nearestLit(gitter, wx, wy, maxDist = 0.75) {
  let best = -1, bestD = maxDist * maxDist;
  const c0 = Math.floor(wx), r0 = Math.floor(wy);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= gitter.cols || r < 0 || r >= gitter.rows) continue;
      if (((c + r) & 1) !== gitter.lit) continue;
      const dx = c + 0.5 - wx, dy = r + 0.5 - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = r * gitter.cols + c; }
    }
  }
  return best;
}

// Nächste DUNKLE (Lücken-)Zelle zu einem Weltpunkt — für Logo, Claws,
// Schnellaktionen: Formationen wohnen in den Lücken des Schachbretts.
export function nearestGap(gitter, wx, wy) {
  let best = -1, bestD = Infinity;
  const c0 = Math.floor(wx), r0 = Math.floor(wy);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= gitter.cols || r < 0 || r >= gitter.rows) continue;
      if (((c + r) & 1) === gitter.lit) continue;
      const dx = c + 0.5 - wx, dy = r + 0.5 - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = r * gitter.cols + c; }
    }
  }
  return best;
}
