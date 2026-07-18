// LUDI-Logo (Referenz 08) + Rex-Claws (Referenz 09).
// Das Logo besteht aus VIER gleich großen Buchstaben-Agenten (L U D I,
// Abstand letterGap), zentriert über der Bildschirmmitte in der obersten
// Landing-Reihe. L und U stehen hell im Dunkeln, D und I liegen DUNKEL
// über einer ganz normalen Gitter-Kachel. Das Logo existiert nur auf dem
// Landing-Screen: Bei der ersten Aktion morphen die Buchstaben zu
// Default-Agenten und fügen sich dem Gitter.
// Die CLAWS wohnen in der freien Zelle oben rechts (gerade Spaltenzahl!)
// und sind dort HART verankert wie position:fixed — das Gitter weicht
// ihnen magnetisch aus (Anker-Warp).
import { CONFIG } from './config.js';
import { STATE, wakeAgent, setAgentShape, allocReserve } from './swarm.js';
import { shapeId, glyphShape } from './formen.js';
import { nearestGap } from './gitter.js';

export function createLogo(store, registerTask, kamera) {
  const g = store.gitter;
  const L = CONFIG.logo;
  const C = CONFIG.claws;

  const letters = []; // { id, ch }
  const claws = { k1: -1, k2: -1 };
  const taskLogo = registerTask('logo: LUDI', true);
  const taskRex = registerTask('rex: dirigent', true);

  let formed = false;
  let gone = false; // nach der ersten Aktion kommt das Logo nicht zurück

  // Buchstaben-Positionen: zentriert über der Screen-Mitte, oberste Reihe
  function letterPos(k) {
    const cx = g.start.col0 + g.start.cols / 2;
    return {
      x: cx + (k - 1.5) * L.letterGap,
      y: g.start.row0 + 0.5,
    };
  }

  function form(tNow) {
    if (formed || gone) return;
    'LUDI'.split('').forEach((ch, k) => {
      const p = letterPos(k);
      const id = allocReserve(store, p.x, p.y);
      if (id < 0) return;
      wakeAgent(store, id, tNow, 0.15 + k * 0.08, {
        size: 0.02, shape: glyphShape(ch), taskId: taskLogo, swirl: false,
        px: p.x, py: p.y,
      });
      store.state[id] = STATE.TEXT;
      store.sizeTgt[id] = L.letterH;
      const dark = k >= 2; // D und I liegen dunkel auf der hellen Kachel
      const col = dark ? L.dunkel
        : [store.baseTint[0] * L.briLetter, store.baseTint[1] * L.briLetter, store.baseTint[2] * L.briLetter];
      store.tgtR[id] = col[0];
      store.tgtG[id] = col[1];
      store.tgtB[id] = col[2];
      letters.push({ id, ch });
    });
    store.needsRebuild = true;
    formed = true;
  }

  // Erste Aktion: die Buchstaben werden Default-Agenten und fügen sich
  // dem Gitter (morphen zum Squircle, versinken in der nächsten Lücke)
  function dissolveToGrid() {
    if (!formed || gone) {
      gone = true;
      return;
    }
    for (const l of letters) {
      const id = l.id;
      if (store.active[id] === 0) continue;
      const gap = nearestGap(g, store.posX[id], store.posY[id]);
      store.state[id] = STATE.RETURNING;
      store.taskId[id] = 0;
      if (gap >= 0) {
        store.targetX[id] = g.homeX[gap];
        store.targetY[id] = g.homeY[gap];
      }
      store.sizeTgt[id] = 0; // Reserve-Agent versinkt und wird frei
      store.tgtR[id] = store.baseTint[0];
      store.tgtG[id] = store.baseTint[1];
      store.tgtB[id] = store.baseTint[2];
      setAgentShape(store, id, shapeId('squircle'));
    }
    letters.length = 0;
    formed = false;
    gone = true;
  }

  // ---- Claws: hart verankert in der freien Ecke oben rechts --------------
  function clawScreen() {
    const cell = kamera.maxScale; // Landing-Zellgröße in px
    return { sx: kamera.viewW - cell / 2, sy: cell / 2, cell };
  }

  function ensureClaws(tNow) {
    if (claws.k1 >= 0) return;
    const p = clawScreen();
    const w = kamera.screenToWorld(p.sx, p.sy);
    for (const [key, shape] of [['k1', 'klaue1'], ['k2', 'klaue2']]) {
      const id = allocReserve(store, w.x, w.y);
      if (id < 0) continue;
      wakeAgent(store, id, tNow, 0.3, {
        size: 0.02, shape: shapeId(shape), taskId: taskRex, swirl: false,
        px: w.x, py: w.y,
      });
      store.state[id] = STATE.TEXT;
      claws[key] = id;
    }
    store.needsRebuild = true;
  }

  // pro Frame NACH postStep: exakt pinnen (kein Feder-Nachlauf)
  function update(tNow) {
    ensureClaws(tNow);
    const p = clawScreen();
    const w = kamera.screenToWorld(p.sx, p.sy);
    const size = (p.cell * C.cellFrac) / kamera.scale;
    for (const id of [claws.k1, claws.k2]) {
      if (id < 0 || store.active[id] === 0) continue;
      store.posX[id] = w.x;
      store.posY[id] = w.y;
      store.velX[id] = 0;
      store.velY[id] = 0;
      store.homeX[id] = w.x;
      store.homeY[id] = w.y;
      store.targetX[id] = w.x;
      store.targetY[id] = w.y;
      store.sizeTgt[id] = size;
      store.size[id] = size; // fixed: auch die Größe folgt sofort
      store.tgtR[id] = store.baseTint[0] * C.bri;
      store.tgtG[id] = store.baseTint[1] * C.bri;
      store.tgtB[id] = store.baseTint[2] * C.bri;
    }
    if (!formed && !gone) form(tNow);
  }

  // Anker-Warp fürs Gitter (wie der Cursor, nur ortsfest am Icon)
  function anchor() {
    if (claws.k1 < 0) return null;
    const p = clawScreen();
    const w = kamera.screenToWorld(p.sx, p.sy);
    return {
      wx: w.x, wy: w.y,
      sigmaW: C.warpSigmaPx / kamera.scale,
      ampW: C.warpAmpPx / kamera.scale,
    };
  }

  return {
    form, update, anchor, dissolveToGrid,
    hide() {}, // Apps: Buchstaben sind nach der ersten Aktion ohnehin fort
    show() {},
    get taskLogo() { return taskLogo; },
    get taskRex() { return taskRex; },
    isClaw: (id) => id === claws.k1 || id === claws.k2,
    isLogo: (id) => letters.some((l) => l.id === id),
    * allIds() {
      yield claws.k1;
      yield claws.k2;
      for (const l of letters) yield l.id;
    },
    clawCenter() {
      const p = clawScreen();
      return kamera.screenToWorld(p.sx, p.sy);
    },
  };
}
