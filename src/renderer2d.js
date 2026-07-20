// Canvas2D-NOT-Fallback (abgerundete Rechtecke, keine Morphs) — greift nur,
// wenn weder WebGPU noch WebGL2 verfügbar sind. Gleiches Interface
// { render(store, kamera), kind, dpr, dispose() } wie die GPU-Renderer.
import { CONFIG } from './config.js';
import { project3d, lochWarp } from './renderformat.js';
import { STATE } from './swarm.js';

const PJ = { x: 0, y: 0, k: 1, dim: 1, hidden: false };
const LW = { x: 0, y: 0, f: 1, str: 1, rot: 0, blend: 0, hidden: false };

export function createRenderer2D(canvas, view) {
  const dpr = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
  canvas.width = view.w * dpr;
  canvas.height = view.h * dpr;
  const ctx = canvas.getContext('2d');

  function render(store, kamera) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(
      view.w / 2, view.h / 2, 0,
      view.w / 2, view.h / 2, Math.hypot(view.w, view.h) * 0.55,
    );
    g.addColorStop(0, CONFIG.colors.bgInner);
    g.addColorStop(1, CONFIG.colors.bgOuter);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    const scale = kamera.scale;
    const ox = view.w / 2 - kamera.cx * scale;
    const oy = view.h / 2 - kamera.cy * scale;

    // Kapseln (Rex' Drahtgitter) — unter den Agenten, runde Enden
    const K = store.kapseln;
    if (K && K.length > 0) {
      ctx.lineCap = 'round';
      for (let k = 0; k + 8 < K.length; k += 9) {
        ctx.strokeStyle = `rgba(${(K[k + 4] * 255) | 0},${(K[k + 5] * 255) | 0},${(K[k + 6] * 255) | 0},${K[k + 7]})`;
        ctx.lineWidth = Math.max(1, K[k + 8]);
        ctx.beginPath();
        ctx.moveTo(K[k] * scale + ox, K[k + 1] * scale + oy);
        ctx.lineTo(K[k + 2] * scale + ox, K[k + 3] * scale + oy);
        ctx.stroke();
      }
    }

    const {
      activeList, activeCount, active, posX, posY, size, brightness,
      colR, colG, colB, state, latticeCount,
    } = store;
    const P = store.p3d;
    const aktiv = !!(P && P.aktiv);
    for (let k = 0; k < activeCount; k++) {
      const i = activeList[k];
      if (active[i] === 0) continue;
      let b = brightness[i];
      if (b <= 0.01) continue;
      let wx = posX[i], wy = posY[i], sz = size[i];
      // derselbe Schwarzes-Loch-Warp + 3D-Lochkamera wie die GPU-Backends
      // (Notfallback: ohne Maler-Sortierung und ohne Streckung)
      let fog = 1;
      if (aktiv) {
        if (P.holes.length > 0 && i < latticeCount && state[i] <= STATE.RETURNING) {
          lochWarp(P, wx, wy, LW);
          if (LW.hidden) continue;
          wx = LW.x; wy = LW.y;
          sz *= LW.f;
        }
        project3d(P, kamera, wx, wy, store.zPos[i], PJ);
        if (PJ.hidden) continue;
        wx = PJ.x; wy = PJ.y;
        sz *= PJ.k;
        fog = PJ.dim;
        if (fog <= 0.03) continue;
      }
      const s = sz * scale;
      if (s < 0.5) continue;
      const x = wx * scale + ox;
      const y = wy * scale + oy;
      if (x + s < 0 || x - s > view.w || y + s < 0 || y - s > view.h) continue;
      // Tiefennebel zur Hintergrundfarbe (49,53,58)
      const fr = (colR[i] * b * fog + 49 * (1 - fog)) | 0;
      const fg = (colG[i] * b * fog + 53 * (1 - fog)) | 0;
      const fb = (colB[i] * b * fog + 58 * (1 - fog)) | 0;
      ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
      ctx.beginPath();
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.3);
      ctx.fill();
    }
  }

  return { render, dpr, kind: 'canvas2d', dispose() {} };
}
