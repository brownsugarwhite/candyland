// Das WELT-GITTER von LUDI. 1 Welteinheit = 1 Zelle; Agentenidentität =
// Zellindex row*cols+col — stabil für immer, unabhängig von Zoom und Modus.
//
// LANDING-FIT (Referenz 01A/01B): Das Startfenster passt sich dem Screen
// an — Zellgröße ≈ CONFIG.gitter.zellePx, GERADE Spalten-/Zeilenzahl,
// Breite exakt randbündig. Damit hat die Ecke oben LINKS eine Kachel und
// die Zelle oben RECHTS bleibt frei (Zuhause des Rex-Icons); alle Ränder
// haben den gleichen Abstand. Dahinter liegt das große Gesamtgitter
// (latFaktor × Fenster) fürs Zoomen plus der Reserve-Pool.
import { CONFIG } from './config.js';

export function buildGitter(mode, viewW, viewH) {
  const M = CONFIG.modes[mode];
  const w = viewW || M.w;
  const h = viewH || M.h;
  const G = CONFIG.gitter;

  // Landing-Fenster: gerade Spaltenzahl, Zelle = Breite/Spalten (exakt)
  // Spaltenzahl ÷ 4: gerade → freie Ecke oben rechts fürs Rex-Icon, und
  // C/2 gerade → rechts der Bildschirmmitte liegt IMMER eine Kachel
  // (Zuhause von D und I). Referenzen: wide 16, high 8.
  const startCols = Math.max(8, 4 * Math.round(w / G.zellePx / 4));
  const cell = w / startCols;                    // px pro Zelle beim Landing
  const startRows = Math.max(4, Math.round(h / cell)); // Zeilen: beste Passung

  // Gesamtgitter + zentriertes Fenster; Parität so, dass die Fenster-Ecke
  // oben links WACH ist (→ oben rechts frei, dort sitzt Rex)
  const cols = startCols * G.latFaktor;
  const rows = startRows * G.latFaktor;
  const col0 = Math.round((cols - startCols) / 2);
  let row0 = Math.round((rows - startRows) / 2);
  if (((col0 + row0) & 1) !== G.litParity) row0 -= 1;

  const latticeCount = cols * rows;
  const count = latticeCount + CONFIG.pool.reserve;
  const lit = G.litParity;

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
    view: { w, h },
    start: { col0, row0, cols: startCols, rows: startRows, cell },
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

// Nächste DUNKLE (Lücken-)Zelle zu einem Weltpunkt — für Formationen,
// die in den Lücken des Schachbretts wohnen.
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
