// Gemeinsames Instanz-Format für WebGPU- und WebGL2-Renderer — die eine
// Quelle der Wahrheit fürs Packing. Ein Agent = eine Instanz (Quad):
//   [x, y, size, rot, r, g, b, shapeA, shapeB, shapeT, frei, frei] = 12 f32 (48 B)
// Koordinaten/Größe in WELTEINHEITEN; Farbe bereits mit Helligkeit
// multipliziert (premultiplied über dunklem Grund).
export const INST_FLOATS = 12;

// Aktive, sichtbare Agenten in arr packen (Kamera-Culling inklusive).
// → Anzahl geschriebener Instanzen.
export function packInstances(store, kamera, arr) {
  const {
    activeList, activeCount, active, posX, posY, size, brightness,
    colR, colG, colB, rot, shapeA, shapeB, shapeT,
  } = store;
  const scale = kamera.scale;
  const cx = kamera.cx, cy = kamera.cy;
  const halfW = kamera.viewW / 2 / scale;
  const halfH = kamera.viewH / 2 / scale;
  const inv = 1 / 255;
  let w = 0;
  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (active[i] === 0) continue;
    const b = brightness[i];
    if (b <= 0.01) continue;
    const px = posX[i], py = posY[i];
    const half = size[i] * 0.6; // etwas Luft für Rotation/AA
    if (px + half < cx - halfW || px - half > cx + halfW ||
        py + half < cy - halfH || py - half > cy + halfH) continue;
    arr[w++] = px;
    arr[w++] = py;
    arr[w++] = size[i];
    arr[w++] = rot[i];
    arr[w++] = colR[i] * b * inv;
    arr[w++] = colG[i] * b * inv;
    arr[w++] = colB[i] * b * inv;
    arr[w++] = shapeA[i];
    arr[w++] = shapeB[i];
    arr[w++] = shapeT[i] < 0 ? 0 : shapeT[i];
    arr[w++] = 0;
    arr[w++] = 0;
  }
  return w / INST_FLOATS;
}

// Linien-Vertices packen: [x, y, r, g, b, a] — Mesh-Kanten (Aktivität
// lässt Synapsen aufleuchten) + freie Linien aus store.extraLines
// (Vektor-Pfade, 3D-Drahtgitter, Handle-Arme).
import { CONFIG } from './config.js';
import { STATE } from './swarm.js';

export const LINE_FLOATS = 6;

// → { nMesh, nTotal }: Mesh-Linien [0, nMesh) unter den Agenten,
// freie Linien [nMesh, nTotal) DARÜBER (Vektor-Pfade, 3D-Kanten)
export function packLines(store, kamera, arr) {
  let w = 0;
  const scale = kamera.scale;
  const cx = kamera.cx, cy = kamera.cy;
  const halfW = kamera.viewW / 2 / scale + 1;
  const halfH = kamera.viewH / 2 / scale + 1;
  const onScreen = (x, y) =>
    x > cx - halfW && x < cx + halfW && y > cy - halfH && y < cy + halfH;

  if (store.meshEnabled && store.edges && store.edges.length > 0) {
    const N = CONFIG.neural;
    const T = N.tint;
    const { posX, posY, targetX, targetY, state, active, brightness } = store;
    const edges = store.edges;
    for (let e = 0; e < edges.length; e += 2) {
      const i = edges[e], j = edges[e + 1];
      if (active[i] === 0 || active[j] === 0) continue;
      if (state[i] > STATE.RETURNING || state[j] > STATE.RETURNING) continue;
      if (!onScreen(posX[i], posY[i]) && !onScreen(posX[j], posY[j])) continue;
      // überdehnte Federn (verdrängte Nachbarn) zeichnen keine Linien —
      // sonst spannt sich ein Netz quer über Apps und Karten
      const ldx = posX[i] - posX[j], ldy = posY[i] - posY[j];
      if (ldx * ldx + ldy * ldy > 6.8) continue;
      const act =
        Math.abs(posX[i] - targetX[i]) + Math.abs(posY[i] - targetY[i]) +
        Math.abs(posX[j] - targetX[j]) + Math.abs(posY[j] - targetY[j]);
      const glow = brightness[i] + brightness[j] - 1.3;
      let a = N.baseAlpha + N.gainAlpha * act + (glow > 0 ? N.glowAlpha * glow : 0);
      if (a > N.maxAlpha) a = N.maxAlpha;
      if (a < 0.012) continue;
      arr[w++] = posX[i]; arr[w++] = posY[i];
      arr[w++] = T[0]; arr[w++] = T[1]; arr[w++] = T[2]; arr[w++] = a;
      arr[w++] = posX[j]; arr[w++] = posY[j];
      arr[w++] = T[0]; arr[w++] = T[1]; arr[w++] = T[2]; arr[w++] = a;
    }
  }

  const nMesh = w / LINE_FLOATS;
  const ex = store.extraLines;
  for (let k = 0; k + 7 < ex.length; k += 8) {
    arr[w++] = ex[k]; arr[w++] = ex[k + 1];
    arr[w++] = ex[k + 4]; arr[w++] = ex[k + 5]; arr[w++] = ex[k + 6]; arr[w++] = ex[k + 7];
    arr[w++] = ex[k + 2]; arr[w++] = ex[k + 3];
    arr[w++] = ex[k + 4]; arr[w++] = ex[k + 5]; arr[w++] = ex[k + 6]; arr[w++] = ex[k + 7];
  }
  return { nMesh, nTotal: w / LINE_FLOATS };
}

export function lineCapacity(store) {
  return (store.edges ? store.edges.length : 0) + store.extraLines.length / 4 + 64;
}

export function hexToRgb01(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
