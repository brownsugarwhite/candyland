// LUDi-Logo (Referenz 08) + Rex-Claws (Referenz 09).
// Das Logo lebt IM Gitter des Landingscreens: „L" und „U" sind
// Lücken-Zellen-Agenten (halbe Kachelhöhe), „DI" ist die Kachel daneben
// mit ausgestanzten Buchstaben. Beim Raus-Zoomen werden alle drei wieder
// gewöhnliche Gitteragenten und formen sich beim Zurückkommen neu.
// Die CLAWS sind dagegen SCREEN-FIX: immer oben rechts, immer gleich
// groß (px) — zwei Reserve-Agenten folgen der Ecke, und das Gitter
// weicht ihnen aus wie dem Cursor (Anker-Warp).
import { CONFIG } from './config.js';
import {
  STATE, wakeAgent, setAgentShape, rebuildActiveList, allocReserve, baseSize,
} from './swarm.js';
import { shapeId, glyphShape } from './formen.js';
import { nearestGap } from './gitter.js';

export function createLogo(store, registerTask, kamera) {
  const g = store.gitter;
  const L = CONFIG.logo;
  const C = CONFIG.claws;

  const ids = { L: -1, U: -1, di: -1, klaue1: -1, klaue2: -1 };
  const taskLogo = registerTask('logo: LUDi', true);
  const taskRex = registerTask('rex: dirigent', true);

  let formed = false;
  let suspended = false; // Apps: Logo bleibt eingefahren

  function wakeGapAt(wx, wy, tNow, exclude) {
    let id = nearestGap(g, wx, wy);
    for (let r = 1; r <= 3 && (id < 0 || exclude.has(id)); r++) {
      id = nearestGap(g, wx - r, wy);
      if (id < 0 || exclude.has(id)) id = nearestGap(g, wx + r, wy);
    }
    if (id < 0 || exclude.has(id)) return -1;
    exclude.add(id);
    return id;
  }

  function styleAgent(id, tNow, { x, y, shape, size, bri }) {
    if (store.active[id] === 0) {
      wakeAgent(store, id, tNow, 0.1 + Math.random() * 0.25, { size: 0.02, shape, swirl: false, px: x, py: y });
    }
    store.state[id] = STATE.TEXT;
    store.targetX[id] = x;
    store.targetY[id] = y;
    store.sizeTgt[id] = size;
    store.tgtR[id] = store.baseTint[0] * bri;
    store.tgtG[id] = store.baseTint[1] * bri;
    store.tgtB[id] = store.baseTint[2] * bri;
    setAgentShape(store, id, shape);
  }

  function form(tNow) {
    if (formed || suspended) return;
    const wc = g.start.col0 + g.start.cols / 2;
    const rowY = g.start.row0 + 0.5;
    const used = new Set();

    let cDi = Math.round(wc + L.dxDi - 0.5);
    if (((cDi + g.start.row0) & 1) !== g.lit) cDi -= 1;
    const diId = g.start.row0 * g.cols + cDi;
    styleAgent(diId, tNow, {
      x: wc + L.dxDi, y: rowY,
      shape: shapeId('diTile'),
      size: CONFIG.gitter.agentSize,
      bri: L.briTile,
    });
    store.taskId[diId] = taskLogo;
    ids.di = diId;
    used.add(diId);

    const lId = wakeGapAt(wc + L.dxL, rowY, tNow, used);
    if (lId >= 0) {
      styleAgent(lId, tNow, { x: wc + L.dxL, y: rowY, shape: glyphShape('L'), size: L.letterH, bri: L.briLetter });
      store.taskId[lId] = taskLogo;
      ids.L = lId;
    }
    const uId = wakeGapAt(wc + L.dxU, rowY, tNow, used);
    if (uId >= 0) {
      styleAgent(uId, tNow, { x: wc + L.dxU, y: rowY, shape: glyphShape('U'), size: L.letterH, bri: L.briLetter });
      store.taskId[uId] = taskLogo;
      ids.U = uId;
    }

    formed = true;
    rebuildActiveList(store);
  }

  // Logo wird wieder Gitter: DI-Kachel morpht zurück, L/U versinken
  function dissolve() {
    if (!formed) return;
    for (const key of ['L', 'U']) {
      const id = ids[key];
      if (id >= 0 && store.active[id] === 1) {
        store.state[id] = STATE.RETURNING;
        store.taskId[id] = 0;
        store.targetX[id] = store.homeX[id];
        store.targetY[id] = store.homeY[id];
        store.sizeTgt[id] = 0;
        setAgentShape(store, id, shapeId('squircle'));
      }
      ids[key] = -1;
    }
    if (ids.di >= 0) {
      const id = ids.di;
      store.state[id] = STATE.RETURNING;
      store.taskId[id] = 0;
      store.targetX[id] = store.homeX[id];
      store.targetY[id] = store.homeY[id];
      store.sizeTgt[id] = baseSize(store, id);
      store.tgtR[id] = store.baseTint[0];
      store.tgtG[id] = store.baseTint[1];
      store.tgtB[id] = store.baseTint[2];
      setAgentShape(store, id, shapeId('squircle'));
      ids.di = -1;
    }
    formed = false;
  }

  // ---- Claws: screen-fix, das Gitter weicht aus -------------------------
  function clawScreenPos() {
    return { sx: kamera.viewW - C.dxPx, sy: C.dyPx };
  }

  function ensureClaws(tNow) {
    if (ids.klaue1 >= 0) return;
    const p = clawScreenPos();
    const w = kamera.screenToWorld(p.sx, p.sy);
    for (const [key, shape] of [['klaue1', 'klaue1'], ['klaue2', 'klaue2']]) {
      const id = allocReserve(store, w.x, w.y);
      if (id < 0) continue;
      wakeAgent(store, id, tNow, 0.3, {
        size: 0.02, shape: shapeId(shape), swirl: false, px: w.x, py: w.y,
      });
      store.state[id] = STATE.TEXT;
      store.taskId[id] = taskRex;
      ids[key] = id;
    }
    store.needsRebuild = true;
  }

  // pro Frame: Claws folgen der Screen-Ecke (federnd), Größe bleibt in px;
  // Logo erscheint nur nahe der Start-Zoomstufe
  function update(tNow) {
    ensureClaws(tNow);
    const p = clawScreenPos();
    const w = kamera.screenToWorld(p.sx, p.sy);
    const size = C.sizePx / kamera.scale;
    for (const key of ['klaue1', 'klaue2']) {
      const id = ids[key];
      if (id < 0 || store.active[id] === 0) continue;
      store.homeX[id] = w.x;
      store.homeY[id] = w.y;
      store.targetX[id] = w.x;
      store.targetY[id] = w.y;
      store.sizeTgt[id] = size;
      store.tgtR[id] = store.baseTint[0] * C.bri;
      store.tgtG[id] = store.baseTint[1] * C.bri;
      store.tgtB[id] = store.baseTint[2] * C.bri;
    }
    if (!suspended) {
      if (formed && kamera.scale < kamera.maxScale * L.zoomHide) dissolve();
      else if (!formed && kamera.scale > kamera.maxScale * 0.97) form(tNow);
    }
  }

  // Anker-Warp fürs Gitter (wie der Cursor, nur ortsfest am Icon)
  function anchor() {
    if (ids.klaue1 < 0) return null;
    const p = clawScreenPos();
    const w = kamera.screenToWorld(p.sx, p.sy);
    return {
      wx: w.x, wy: w.y,
      sigmaW: C.warpSigmaPx / kamera.scale,
      ampW: C.warpAmpPx / kamera.scale,
    };
  }

  return {
    form, update, anchor,
    hide() { suspended = true; dissolve(); },
    show() { suspended = false; },
    get taskLogo() { return taskLogo; },
    get taskRex() { return taskRex; },
    isClaw: (id) => id === ids.klaue1 || id === ids.klaue2,
    isLogo: (id) => id === ids.L || id === ids.U || id === ids.di,
    * allIds() {
      yield ids.klaue1;
      yield ids.klaue2;
      yield ids.L;
      yield ids.U;
      yield ids.di;
    },
    clawCenter() {
      const p = clawScreenPos();
      return kamera.screenToWorld(p.sx, p.sy);
    },
  };
}
