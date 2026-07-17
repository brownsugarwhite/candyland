// APP-SHELL: der Schwarm morpht ORGANISCH zum App-Screen. Die Content-
// Region wächst aus der Mitte (weicher Rect-Warp) — die Gitteragenten
// fließen dabei von selbst an die Ränder und verdichten sich dort zu
// einem unruhigen Rahmen (Referenz 03). Keine Rotation, keine Sprünge,
// keine Lücken: alles läuft über die Federphysik. Oben rechts sitzt der
// pinke Schließen-Agent (Screen-px, zoom ist während Apps gesperrt).
import { CONFIG } from '../config.js';
import { STATE, allocReserve, wakeAgent } from '../swarm.js';
import { shapeId } from '../formen.js';

export function createAppShell(store, deps, name) {
  const A = CONFIG.apps;
  const task = deps.registerTask('app: ' + name, true);

  let closeId = -1;
  let region = null;
  let t0 = 0;

  function open(tNow) {
    t0 = tNow;
    const kam = deps.kamera;
    const halfW = kam.viewW / 2 / kam.scale;
    const halfH = kam.viewH / 2 / kam.scale;
    region = {
      x0: kam.cx - halfW + A.inset,
      y0: kam.cy - halfH + A.inset,
      x1: kam.cx + halfW - A.inset,
      y1: kam.cy + halfH - A.inset,
    };

    deps.logo.hide(); // LUDI tritt beiseite — die Claws bleiben (Rex!)

    // pinker Schließen-Agent oben rechts (Screen-px)
    const size = A.closeSizePx / kam.scale;
    const bx = region.x1 - size * 0.7, by = region.y0 + size * 0.7;
    closeId = allocReserve(store, bx, by);
    if (closeId >= 0) {
      wakeAgent(store, closeId, tNow, 0.5, {
        size: 0.02, shape: shapeId('squircle'), taskId: task, swirl: false,
        px: bx, py: by,
      });
      const P = CONFIG.colors.pink;
      store.state[closeId] = STATE.TEXT;
      store.sizeTgt[closeId] = size;
      store.tgtR[closeId] = P[0];
      store.tgtG[closeId] = P[1];
      store.tgtB[closeId] = P[2];
      store.needsRebuild = true;
    }
    return region;
  }

  function close(tNow) {
    if (closeId >= 0) {
      deps.revert(closeId);
      closeId = -1;
    }
    deps.logo.show(tNow);
    region = null;
  }

  // Warp-Rect fürs Gitter: wächst weich aus der Mitte (growSec)
  function warpRect(t) {
    if (!region) return null;
    let p = Math.min(1, (t - t0) / A.growSec);
    p = p * p * (3 - 2 * p);
    const cx = (region.x0 + region.x1) / 2;
    const cy = (region.y0 + region.y1) / 2;
    const hw = ((region.x1 - region.x0) / 2) * (0.12 + 0.88 * p);
    const hh = ((region.y1 - region.y0) / 2) * (0.12 + 0.88 * p);
    return {
      x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh,
      maxOut: A.maxOut,
      shrink: 1 - A.shrink,
    };
  }

  return {
    open, close, task, warpRect,
    get region() { return region; },
    hitClose(wx, wy) {
      if (closeId < 0) return false;
      const dx = store.posX[closeId] - wx, dy = store.posY[closeId] - wy;
      return dx * dx + dy * dy < 0.42;
    },
  };
}
