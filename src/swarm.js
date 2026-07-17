// LUDI-Schwarm-Kern (Welt-Gitter-Architektur). Struct-of-Arrays über
// Gitterzellen + Reserve-Pool. Wach ist default nur die Schachbrett-Hälfte
// des Gitters; Formationen WECKEN Lücken-Zellen oder Reserve-Agenten und
// frieren gesettelte Pixel ein. Jeder Agent trägt eine AUFGABE (taskId →
// Registry im Dirigenten) und eine stabile Identität (sein Index).
//
// Alle Koordinaten in WELTEINHEITEN (1 = Gitterzelle). Die Kamera skaliert
// nur die Darstellung — Zoomen ordnet nichts neu an. Cursor-Magnet und
// Feld-Warp sind in Screen-px definiert und werden durch kamera.scale
// geteilt, damit sie sich auf jeder Zoomstufe gleich anfühlen.
import { CONFIG } from './config.js';
import { CIRCLE, SQUARE } from './formen.js';

export const STATE = {
  IDLE: 0,
  DISPLACED: 1,
  RETURNING: 2,
  TEXT: 4,
  IMAGE: 5,
};

export { CIRCLE, SQUARE };

const SIN_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) SIN_LUT[i] = Math.sin((i / 256) * Math.PI * 2);

const phaseHash = (i) => (Math.imul(i, 2654435761) >>> 16) & 255;

export const baseSize = (store, i) =>
  (store.carrier[i] === 1 ? CONFIG.gitter.agentSize : 0.25);

export function createSwarm(gitter, defaultShape, tNow = 0) {
  const store = Object.create(null);
  const n = gitter.count;
  store.gitter = gitter;
  store.count = n;
  store.latticeCount = gitter.latticeCount;
  store.spacing = 1;
  store.carrier = gitter.carrier;
  store.carrierList = gitter.carrierList;
  store.neighbors = gitter.neighbors;
  store.homeX = gitter.homeX;
  store.homeY = gitter.homeY;
  store.globalShape = defaultShape;

  store.posX = new Float32Array(n);
  store.posY = new Float32Array(n);
  store.velX = new Float32Array(n);
  store.velY = new Float32Array(n);
  store.targetX = new Float32Array(n);
  store.targetY = new Float32Array(n);
  store.size = new Float32Array(n);
  store.sizeTgt = new Float32Array(n);
  store.brightness = new Float32Array(n);
  store.colR = new Float32Array(n);
  store.colG = new Float32Array(n);
  store.colB = new Float32Array(n);
  store.tgtR = new Float32Array(n);
  store.tgtG = new Float32Array(n);
  store.tgtB = new Float32Array(n);
  store.rot = new Float32Array(n);
  store.hover = new Float32Array(n);   // Hover-Wachstum (auswahl.js)
  store.shapeA = new Uint16Array(n);
  store.shapeB = new Uint16Array(n);
  store.shapeT = new Float32Array(n);
  store.activateAt = new Float32Array(n);
  store.state = new Uint8Array(n);
  store.phase = new Uint8Array(n);
  store.active = new Uint8Array(n);
  store.frozen = new Uint8Array(n);
  store.taskId = new Uint16Array(n);
  store.activeList = new Int32Array(n);
  store.activeCount = 0;

  // Reserve-Freelist: Pool-Agenten jenseits des Gitters
  store.baseTint = [...CONFIG.colors.agent]; // Grundfarbe (Dimension wechselt sie)
  store.meshEnabled = CONFIG.neural.enabled;
  store.edges = gitter.edges;
  store.extraLines = []; // [x0,y0,x1,y1, r,g,b,a] je Linie (0..1) — pro Frame
  store.freeList = new Int32Array(n - gitter.latticeCount);
  let w = 0;
  for (let i = n - 1; i >= gitter.latticeCount; i--) store.freeList[w++] = i;
  store.freeCount = w;

  // Boot: RUHIGES Erblühen — jeder Agent wächst an seinem Platz aus dem
  // Nichts, als radiale Welle von der Mitte (kein wildes Einfliegen)
  const cx = gitter.cols / 2, cy = gitter.rows / 2;
  const maxDist = Math.hypot(cx, cy);
  const AG = CONFIG.colors.agent;
  for (const i of store.carrierList) {
    const dx = store.homeX[i] - cx, dy = store.homeY[i] - cy;
    const radial = (Math.hypot(dx, dy) / maxDist) * CONFIG.boot.staggerSec;
    wakeAgent(store, i, tNow, radial, {
      px: store.homeX[i],
      py: store.homeY[i],
      size: CONFIG.gitter.agentSize,
      swirl: false,
    });
    store.size[i] = 0.02;
    store.colR[i] = AG[0]; store.colG[i] = AG[1]; store.colB[i] = AG[2];
    store.tgtR[i] = AG[0]; store.tgtG[i] = AG[1]; store.tgtB[i] = AG[2];
  }
  rebuildActiveList(store);
  return store;
}

// Reserve-Agent beziehen (Feinraster-Text, Pixel, App-Elemente). Der Agent
// wohnt an (x, y); Rückgabe -1 wenn der Pool leer ist.
export function allocReserve(store, x, y) {
  if (store.freeCount === 0) return -1;
  const i = store.freeList[--store.freeCount];
  store.homeX[i] = x;
  store.homeY[i] = y;
  return i;
}

function freeReserve(store, i) {
  store.freeList[store.freeCount++] = i;
}

// Slot aufwecken: erscheint nahe seinem Ziel und WIRBELT hinein
export function wakeAgent(store, i, tNow, delay, opts = {}) {
  const AG = CONFIG.colors.agent;
  store.active[i] = 1;
  store.frozen[i] = 0;
  store.taskId[i] = opts.taskId || 0;
  store.posX[i] = opts.px !== undefined ? opts.px : store.homeX[i] + (Math.random() - 0.5) * 0.9;
  store.posY[i] = opts.py !== undefined ? opts.py : store.homeY[i] + (Math.random() - 0.5) * 0.9;
  store.targetX[i] = store.homeX[i];
  store.targetY[i] = store.homeY[i];
  if (opts.swirl !== false) {
    const dx = store.targetX[i] - store.posX[i];
    const dy = store.targetY[i] - store.posY[i];
    const d = Math.hypot(dx, dy) || 1;
    const O = CONFIG.organic;
    const s = (O.swirlMin + Math.random() * (O.swirlMax - O.swirlMin)) * (Math.random() < 0.5 ? -1 : 1);
    store.velX[i] = (-dy / d) * s;
    store.velY[i] = (dx / d) * s;
  } else {
    store.velX[i] = 0;
    store.velY[i] = 0;
  }
  const sz = opts.size !== undefined ? opts.size : baseSize(store, i);
  store.size[i] = Math.min(sz, 0.05);
  store.sizeTgt[i] = sz;
  store.brightness[i] = 0;
  store.rot[i] = 0;
  store.hover[i] = 0;
  store.colR[i] = AG[0] * 0.4; store.colG[i] = AG[1] * 0.4; store.colB[i] = AG[2] * 0.4;
  const shape = opts.shape !== undefined ? opts.shape : store.globalShape;
  store.shapeA[i] = shape;
  store.shapeB[i] = shape;
  store.shapeT[i] = 1;
  store.state[i] = STATE.RETURNING;
  store.phase[i] = phaseHash(i);
  store.activateAt[i] = tNow + delay;
}

export function rebuildActiveList(store) {
  const { active, activeList, count } = store;
  let w = 0;
  for (let i = 0; i < count; i++) if (active[i] === 1) activeList[w++] = i;
  store.activeCount = w;
}

export function setGlobalShape(store, shape, seed = null) {
  store.globalShape = shape;
  const g = store.gitter;
  const sx = seed ? seed.x : g.cols / 2;
  const sy = seed ? seed.y : g.rows / 2;
  const speed = CONFIG.morphWave.speed;
  const rate = CONFIG.shapes.morphRate;
  const { activeList, activeCount, state, homeX, homeY, shapeA, shapeB, shapeT } = store;
  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    const st = state[i];
    if (st === STATE.TEXT || st === STATE.IMAGE) continue;
    if (shapeB[i] === shape && shapeT[i] >= 1) continue;
    const delay = Math.hypot(homeX[i] - sx, homeY[i] - sy) / speed;
    shapeA[i] = shapeB[i];
    shapeB[i] = shape;
    shapeT[i] = -delay * rate;
  }
}

export function setAgentShape(store, id, shape) {
  if (store.shapeB[id] === shape) return;
  store.shapeA[id] = store.shapeB[id];
  store.shapeB[id] = shape;
  store.shapeT[id] = 0;
}

// Ein Physik-Substep — nur aktive Liste, Gefrorene übersprungen.
export function stepSwarm(store, dt, tSim) {
  const P = CONFIG.physics;
  const kA = P.anchorK;
  const cA = 2 * P.anchorZeta * Math.sqrt(kA);
  const kN = P.neighborK, cN = P.neighborC;
  const dragF = Math.exp(-P.dragRate * dt);
  const vMax2 = P.vMax * P.vMax;
  const rest = Math.SQRT2;

  const {
    activeList, activeCount, posX, posY, velX, velY, targetX, targetY,
    state, neighbors, activateAt, frozen, carrier, active, latticeCount,
  } = store;

  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (active[i] === 0 || frozen[i] === 1 || tSim < activateAt[i]) continue;
    const px = posX[i], py = posY[i];

    let fx = -kA * (px - targetX[i]) - cA * velX[i];
    let fy = -kA * (py - targetY[i]) - cA * velY[i];

    if (state[i] <= STATE.DISPLACED && carrier[i] === 1 && i < latticeCount) {
      const base = i * 4;
      for (let m = 0; m < 4; m++) {
        const j = neighbors[base + m];
        if (j < 0 || active[j] === 0 || state[j] > STATE.DISPLACED || tSim < activateAt[j]) continue;
        const dx = posX[j] - px, dy = posY[j] - py;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const nx = dx / d, ny = dy / d;
        const vrel = (velX[j] - velX[i]) * nx + (velY[j] - velY[i]) * ny;
        const f = kN * (d - rest) + cN * vrel;
        fx += f * nx;
        fy += f * ny;
      }
    }

    let vx = (velX[i] + fx * dt) * dragF;
    let vy = (velY[i] + fy * dt) * dragF;
    const sp2 = vx * vx + vy * vy;
    if (sp2 > vMax2) {
      const f = P.vMax / Math.sqrt(sp2);
      vx *= f; vy *= f;
    }
    velX[i] = vx; velY[i] = vy;
    posX[i] = px + vx * dt;
    posY[i] = py + vy * dt;
  }
}

// Einmal pro Frame: Wellen, Cursor-Warp, Rect-Warps, radialer Falloff,
// Zustände, Easing, Einfrieren.
// env = { cursor:{wx,wy,active,polarity}, kamera, warpRects:[], veil, wellen }
const wtmp = { ox: 0, oy: 0, s: 1 };

export function postStep(store, tSim, dtFrame, env) {
  const B = CONFIG.breathing;
  const rate = Math.min(1, 1 - Math.exp(-8 * dtFrame));
  const morph = CONFIG.shapes.morphRate * dtFrame;
  const lutBase = (tSim * B.freqHz * 256) | 0;

  const kam = env.kamera;
  const scale = kam.scale;
  const kcx = kam.cx, kcy = kam.cy;
  const halfDiag2 = (kam.viewW * kam.viewW + kam.viewH * kam.viewH) / 4;

  const CW = CONFIG.cursor;
  const cur = env.cursor;
  const warpCursor = cur && cur.active;
  const cSigW = CW.sigma / scale;
  const cSig2 = cSigW * cSigW;
  const cCut2 = cSig2 * 9;
  const cAmpW = CW.amp / scale;

  const FW = CONFIG.fieldWarp;
  const rects = env.warpRects || null;
  const fSigW = FW.sigma / scale;
  const fSig2 = fSigW * fSigW;
  const fCut2 = fSig2 * 9;
  const fAmpW = FW.amp / scale;
  const fInBase = FW.insideBase / scale;

  const O = CONFIG.organic;
  const dIdx = (tSim * O.driftHz * 256) | 0;
  const dAmp = O.driftAmp;

  const FALL = CONFIG.falloff;
  const wellen = env.wellen;

  const veil = env.veil; // Welt-Rect { x0, y0, x1, y1 } oder null
  const vFeatherW = CONFIG.veil.feather / scale;
  const vDim = CONFIG.veil.dim;
  const vF2 = vFeatherW * vFeatherW;

  const AGS = CONFIG.gitter.agentSize;

  const {
    activeList, activeCount, active, posX, posY, velX, velY, homeX, homeY,
    state, brightness, size, sizeTgt, colR, colG, colB, tgtR, tgtG, tgtB,
    targetX, targetY, shapeT, phase, activateAt, frozen, carrier, hover, latticeCount,
  } = store;

  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (active[i] === 0) continue;

    if (shapeT[i] < 1) shapeT[i] = Math.min(1, shapeT[i] + morph);

    if (tSim < activateAt[i]) {
      brightness[i] = carrier[i] === 1 ? 0.3 : 0;
      continue;
    }
    const st = state[i];
    const isCarrier = carrier[i] === 1 && i < latticeCount;

    // radialer Falloff relativ zur Bildschirmmitte (folgt der Kamera)
    let fallBri = 1, fallSize = 1;
    if (st <= STATE.RETURNING && isCarrier) {
      const sx = (homeX[i] - kcx) * scale;
      const sy = (homeY[i] - kcy) * scale;
      let dn = (sx * sx + sy * sy) / halfDiag2;
      if (dn > 1) dn = 1;
      const f = dn * (2 - dn); // weich ansteigend
      fallBri = 1 - FALL.bri * f;
      fallSize = 1 - FALL.size * f;
    }

    let tR = tgtR[i], tG = tgtG[i], tB = tgtB[i];

    // Veil-Faktor für Trägeragenten unter Inhalten
    let veilF = 1;
    if (veil !== null && isCarrier && st <= STATE.RETURNING) {
      const hx = homeX[i], hy = homeY[i];
      const dx = hx < veil.x0 ? veil.x0 - hx : hx > veil.x1 ? hx - veil.x1 : 0;
      const dy = hy < veil.y0 ? veil.y0 - hy : hy > veil.y1 ? hy - veil.y1 : 0;
      const d2 = dx * dx + dy * dy;
      if (d2 < vF2) {
        const f = Math.sqrt(d2) / vFeatherW;
        const s = f * f * (3 - 2 * f);
        veilF = vDim + (1 - vDim) * s;
      }
    }

    // ---- Warp-Pass für ungebundene Träger ----
    if (st <= STATE.RETURNING && isCarrier) {
      const hx = homeX[i], hy = homeY[i];
      const ph = phase[i];
      wellen.sample(hx, hy, wtmp);
      let tx = hx + wtmp.ox + dAmp * SIN_LUT[(dIdx + ph) & 255];
      let ty = hy + wtmp.oy + dAmp * SIN_LUT[(dIdx + ph * 3 + 87) & 255];
      let shrink = wtmp.s;

      // Wurmloch-Ordner: kreisrunde Löcher im Netz (Referenz 06) —
      // Innen-Agenten stauen sich als Ring am Rand, der Trichter dimmt
      if (env.holes) {
        const WL = CONFIG.wurmloch;
        for (const hole of env.holes) {
          const dx = hx - hole.x, dy = hy - hole.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
          const R = hole.r || WL.r;
          if (d < R) {
            const f = d / R;
            tx = hole.x + (dx / d) * (R + f * WL.rim);
            ty = hole.y + (dy / d) * (R + f * WL.rim);
            shrink *= 0.3 + 0.5 * f;
          } else if (d < R + WL.feather) {
            const g = 1 - (d - R) / WL.feather;
            const push = g * g * 0.45;
            tx += (dx / d) * push;
            ty += (dy / d) * push;
            shrink *= 1 - 0.22 * g * g;
          }
        }
      }

      if (warpCursor) {
        const dx = hx - cur.wx, dy = hy - cur.wy;
        const d2 = dx * dx + dy * dy;
        if (d2 < cCut2) {
          const g = Math.exp(-d2 / cSig2);
          const d = Math.sqrt(d2) || 1e-3;
          const off = (cAmpW * g * cur.polarity) / d;
          tx += dx * off;
          ty += dy * off;
          shrink *= 1 - CW.shrink * g;
        }
      }

      // ortsfeste Anker (Rex-Icon): das Gitter weicht aus wie dem Cursor
      if (env.anchors) {
        for (const a of env.anchors) {
          const dx = hx - a.wx, dy = hy - a.wy;
          const d2 = dx * dx + dy * dy;
          const sig2 = a.sigmaW * a.sigmaW;
          if (d2 < sig2 * 9) {
            const ga = Math.exp(-d2 / sig2);
            const d = Math.sqrt(d2) || 1e-3;
            const off = (a.ampW * ga) / d;
            tx += dx * off;
            ty += dy * off;
            shrink *= 1 - 0.5 * ga;
          }
        }
      }

      if (rects !== null) {
        for (let rI = 0; rI < rects.length; rI++) {
          const rect = rects[rI];
          const inX = hx >= rect.x0 && hx <= rect.x1;
          const inY = hy >= rect.y0 && hy <= rect.y1;
          if (inX && inY) {
            const dl = hx - rect.x0, dr = rect.x1 - hx, dtp = hy - rect.y0, db = rect.y1 - hy;
            let m = dl, ox = -1, oy = 0;
            if (dr < m) { m = dr; ox = 1; oy = 0; }
            if (dtp < m) { m = dtp; ox = 0; oy = -1; }
            if (db < m) { m = db; ox = 0; oy = 1; }
            let out = fInBase + m * FW.insideSpread;
            if (rect.maxOut !== undefined && out > rect.maxOut) out = rect.maxOut;
            if (ox < 0) tx = rect.x0 - out;
            else if (ox > 0) tx = rect.x1 + out;
            else if (oy < 0) ty = rect.y0 - out;
            else ty = rect.y1 + out;
            shrink *= 1 - (rect.shrink !== undefined ? rect.shrink : FW.shrink);
          } else {
            const ndx = hx < rect.x0 ? hx - rect.x0 : hx > rect.x1 ? hx - rect.x1 : 0;
            const ndy = hy < rect.y0 ? hy - rect.y0 : hy > rect.y1 ? hy - rect.y1 : 0;
            const d2 = ndx * ndx + ndy * ndy;
            if (d2 < fCut2) {
              const g = Math.exp(-d2 / fSig2);
              const d = Math.sqrt(d2) || 1e-3;
              const off = (fAmpW * g) / d;
              tx += ndx * off;
              ty += ndy * off;
              shrink *= 1 - FW.shrink * g;
            }
          }
        }
      }

      targetX[i] = tx;
      targetY[i] = ty;
      sizeTgt[i] = AGS * shrink * fallSize * (1 + hover[i]);
    }

    // ---- Zustände, Easing ----
    if (st === STATE.RETURNING) {
      const dx = posX[i] - targetX[i], dy = posY[i] - targetY[i];
      const v2 = velX[i] * velX[i] + velY[i] * velY[i];
      if (dx * dx + dy * dy < 0.001 && v2 < 0.01) {
        if (!isCarrier && sizeTgt[i] === 0) {
          active[i] = 0;
          brightness[i] = 0;
          if (i >= latticeCount) store.freeList[store.freeCount++] = i;
          continue;
        }
        state[i] = STATE.IDLE;
      }
      brightness[i] += (veilF * fallBri - brightness[i]) * rate;
    } else if (st <= STATE.DISPLACED) {
      const dx = posX[i] - homeX[i], dy = posY[i] - homeY[i];
      state[i] = dx * dx + dy * dy > 0.0008 ? STATE.DISPLACED : STATE.IDLE;
      const lut = SIN_LUT[(lutBase + phase[i]) & 255];
      brightness[i] = (B.base + B.amp * lut) * veilF * fallBri;
    } else if (st === STATE.TEXT) {
      brightness[i] += (1 - brightness[i]) * rate;
    } else { // IMAGE: Pixel-Dienst
      brightness[i] += (1 - brightness[i]) * rate;
      if (frozen[i] === 1) {
        const dc = Math.abs(tR - colR[i]) + Math.abs(tG - colG[i]) + Math.abs(tB - colB[i]);
        if (dc < 1.5 && Math.abs(sizeTgt[i] - size[i]) < 0.002 && brightness[i] > 0.99) continue;
      } else {
        const dx = posX[i] - targetX[i], dy = posY[i] - targetY[i];
        const v2 = velX[i] * velX[i] + velY[i] * velY[i];
        if (dx * dx + dy * dy < 0.0008 && v2 < 0.006) {
          frozen[i] = 1;
          posX[i] = targetX[i];
          posY[i] = targetY[i];
        }
      }
    }

    size[i] += (sizeTgt[i] - size[i]) * rate;
    colR[i] += (tR - colR[i]) * rate;
    colG[i] += (tG - colG[i]) * rate;
    colB[i] += (tB - colB[i]) * rate;
  }
}
