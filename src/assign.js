// Zuweisung: nächster passender WACHER Agent je Zielpunkt (Weltkoordinaten).
// Räumlicher Hash (Bucket-CSR) über Kandidaten aus der activeList, dann
// Greedy mit expandierenden Bucket-Ringen. So morphen die UMLIEGENDEN
// Schwarmagenten in Texte und Formen — nichts erscheint aus dem Nichts.
import { CONFIG } from './config.js';
import { STATE } from './swarm.js';

export const isFree = (store) => (i) => store.state[i] <= STATE.RETURNING;

// pts: flache [x,y,...]-Paare (Welt). candFn(i) → bool; nach dem Claim
// fällt der Kandidat durch seinen neuen state automatisch aus dem Pool.
// → Int32Array Agent-Id je Zielpunkt (-1 wenn keiner gefunden).
export function assignTargets(store, pts, nPts, newState, candFn = null, taskId = 0) {
  const cand = candFn || isFree(store);
  const O = CONFIG.organic;
  const g = store.gitter;
  const {
    posX, posY, velX, velY, state, targetX, targetY, activateAt,
    activeList, activeCount, active, frozen, taskId: taskArr,
  } = store;

  const bucket = 4; // Zellen
  const gw = Math.max(1, Math.ceil(g.cols / bucket));
  const gh = Math.max(1, Math.ceil(g.rows / bucket));
  const nb = gw * gh;

  const bucketOf = (x, y) => {
    let bx = (x / bucket) | 0;
    let by = (y / bucket) | 0;
    if (bx < 0) bx = 0; else if (bx >= gw) bx = gw - 1;
    if (by < 0) by = 0; else if (by >= gh) by = gh - 1;
    return by * gw + bx;
  };

  const usable = (i) => active[i] === 1 && cand(i);

  const offsets = new Int32Array(nb + 1);
  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (usable(i)) offsets[bucketOf(posX[i], posY[i]) + 1]++;
  }
  for (let b = 0; b < nb; b++) offsets[b + 1] += offsets[b];
  const ids = new Int32Array(offsets[nb]);
  const fill = new Int32Array(nb);
  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (!usable(i)) continue;
    const b = bucketOf(posX[i], posY[i]);
    ids[offsets[b] + fill[b]++] = i;
  }

  const out = new Int32Array(nPts).fill(-1);
  const maxR = Math.max(gw, gh);

  for (let p = 0; p < nPts; p++) {
    const tx = pts[p * 2], ty = pts[p * 2 + 1];
    let bx = (tx / bucket) | 0;
    let by = (ty / bucket) | 0;
    if (bx < 0) bx = 0; else if (bx >= gw) bx = gw - 1;
    if (by < 0) by = 0; else if (by >= gh) by = gh - 1;

    let best = -1, bestD = Infinity, foundRing = -1;
    for (let r = 0; r <= maxR; r++) {
      if (foundRing >= 0 && r > foundRing + 1) break;
      const x0 = bx - r, x1 = bx + r, y0 = by - r, y1 = by + r;
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= gh) continue;
        const edgeRow = y === y0 || y === y1;
        const stepX = edgeRow ? 1 : Math.max(1, x1 - x0);
        for (let x = x0; x <= x1; x += stepX) {
          if (x < 0 || x >= gw) continue;
          const b = y * gw + x;
          for (let s = offsets[b]; s < offsets[b + 1]; s++) {
            const id = ids[s];
            if (!usable(id)) continue;
            const dx = posX[id] - tx, dy = posY[id] - ty;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = id; }
          }
        }
      }
      if (best >= 0 && foundRing < 0) foundRing = r;
    }

    if (best >= 0) {
      state[best] = newState;
      frozen[best] = 0;
      taskArr[best] = taskId;
      targetX[best] = tx;
      targetY[best] = ty;
      activateAt[best] = -1;
      // Spiral-Einflug: tangentialer Kick → der Agent wirbelt zur Aufgabe
      const dx = tx - posX[best], dy = ty - posY[best];
      const d = Math.hypot(dx, dy) || 1;
      const sw = (O.swirlMin + Math.random() * (O.swirlMax - O.swirlMin)) * (Math.random() < 0.5 ? -1 : 1);
      velX[best] += (-dy / d) * sw;
      velY[best] += (dx / d) * sw;
      out[p] = best;
    }
  }
  return out;
}

// Entlassen: Agenten fliegen heim, Aufgabe erlischt; postStep übernimmt.
export function releaseAgents(store, idsLike) {
  for (const id of idsLike) {
    if (id == null || id < 0) continue;
    store.state[id] = STATE.RETURNING;
    store.frozen[id] = 0;
    store.taskId[id] = 0;
    store.targetX[id] = store.homeX[id];
    store.targetY[id] = store.homeY[id];
  }
}
