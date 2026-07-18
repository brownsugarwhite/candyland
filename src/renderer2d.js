// Canvas2D-NOT-Fallback (abgerundete Rechtecke, keine Morphs) — greift nur,
// wenn weder WebGPU noch WebGL2 verfügbar sind. Gleiches Interface
// { render(store, kamera), kind, dpr, dispose() } wie die GPU-Renderer.
import { CONFIG } from './config.js';
import { funnelProject } from './renderformat.js';
import { STATE } from './swarm.js';

const FP = { x: 0, y: 0, f: 1, dim: 1, hidden: false };

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

    const {
      activeList, activeCount, active, posX, posY, size, brightness,
      colR, colG, colB, state, latticeCount,
    } = store;
    const F = store.funnel && store.funnel.holes.length > 0
      ? store.funnel.holes : null;
    for (let k = 0; k < activeCount; k++) {
      const i = activeList[k];
      if (active[i] === 0) continue;
      let b = brightness[i];
      if (b <= 0.01) continue;
      let wx = posX[i], wy = posY[i], sz = size[i];
      // Wurmloch-Trichter — gleiche Projektion wie die GPU-Backends
      if (F !== null && i < latticeCount && state[i] <= STATE.RETURNING) {
        funnelProject(F, wx, wy, FP);
        if (FP.hidden) continue;
        wx = FP.x; wy = FP.y;
        sz *= FP.f;
        b *= FP.dim;
        if (b <= 0.01) continue;
      }
      const s = sz * scale;
      if (s < 0.5) continue;
      const x = wx * scale + ox;
      const y = wy * scale + oy;
      if (x + s < 0 || x - s > view.w || y + s < 0 || y - s > view.h) continue;
      ctx.fillStyle = `rgb(${(colR[i] * b) | 0},${(colG[i] * b) | 0},${(colB[i] * b) | 0})`;
      ctx.beginPath();
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.3);
      ctx.fill();
    }
  }

  return { render, dpr, kind: 'canvas2d', dispose() {} };
}
