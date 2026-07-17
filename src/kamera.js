// Die KAMERA: { cx, cy, scale } — Weltzentrum + Pixel pro Zelle.
// Zoomen ändert ausschließlich scale (kritisch gedämpft geglättet, am
// Cursor verankert). Physik und Formationen leben komplett im Weltraum;
// die Transformation passiert erst im Shader → beim Zoomen ordnet sich
// garantiert nichts neu an.
import { CONFIG } from './config.js';

export function createKamera(gitter) {
  const V = gitter.view;
  const S = gitter.start;
  const maxScale = V.w / S.cols;                     // Start = maximaler Zoom (01A)
  const minScale = Math.max(V.w / gitter.cols, V.h / gitter.rows); // ganze Fläche (02)

  const startRows = V.h / maxScale;
  const kam = {
    cx: S.col0 + S.cols / 2,
    cy: S.row0 + startRows / 2,
    scale: maxScale,
    scaleTgt: maxScale,
    minScale, maxScale,
    viewW: V.w, viewH: V.h,
    anchor: null, // { sx, sy } Zoom-Fixpunkt in Screen-px
  };

  function clampCenter() {
    const halfW = kam.viewW / 2 / kam.scale;
    const halfH = kam.viewH / 2 / kam.scale;
    if (gitter.cols <= halfW * 2) kam.cx = gitter.cols / 2;
    else kam.cx = Math.min(gitter.cols - halfW, Math.max(halfW, kam.cx));
    if (gitter.rows <= halfH * 2) kam.cy = gitter.rows / 2;
    else kam.cy = Math.min(gitter.rows - halfH, Math.max(halfH, kam.cy));
  }
  clampCenter();

  return {
    get cx() { return kam.cx; },
    get cy() { return kam.cy; },
    get scale() { return kam.scale; },
    get minScale() { return kam.minScale; },
    get maxScale() { return kam.maxScale; },
    get viewW() { return kam.viewW; },
    get viewH() { return kam.viewH; },
    get zooming() { return Math.abs(kam.scaleTgt - kam.scale) > 1e-3; },

    screenToWorld(sx, sy) {
      return {
        x: (sx - kam.viewW / 2) / kam.scale + kam.cx,
        y: (sy - kam.viewH / 2) / kam.scale + kam.cy,
      };
    },
    worldToScreen(wx, wy) {
      return {
        x: (wx - kam.cx) * kam.scale + kam.viewW / 2,
        y: (wy - kam.cy) * kam.scale + kam.viewH / 2,
      };
    },

    // Zoom-Impuls, verankert am Screen-Punkt (sx, sy)
    zoomAt(sx, sy, factor) {
      kam.scaleTgt = Math.min(kam.maxScale, Math.max(kam.minScale, kam.scaleTgt * factor));
      kam.anchor = { sx, sy };
    },

    // Wurmloch-Flug: direkte, ungeklemmte Kamerasteuerung (pro Frame)
    setView(cx, cy, scale) {
      kam.cx = cx;
      kam.cy = cy;
      kam.scale = scale;
      kam.scaleTgt = scale;
      kam.anchor = null;
    },
    snapClamped(scale) {
      kam.scale = Math.min(kam.maxScale, Math.max(kam.minScale, scale));
      kam.scaleTgt = kam.scale;
      kam.anchor = null;
      clampCenter();
    },

    update(dt) {
      const d = kam.scaleTgt - kam.scale;
      if (Math.abs(d) > 1e-4) {
        const a = kam.anchor;
        const wx = a ? (a.sx - kam.viewW / 2) / kam.scale + kam.cx : kam.cx;
        const wy = a ? (a.sy - kam.viewH / 2) / kam.scale + kam.cy : kam.cy;
        kam.scale += d * Math.min(1, 1 - Math.exp(-CONFIG.kamera.ease * dt));
        if (a) { // Weltpunkt unter dem Anker bleibt stehen
          kam.cx = wx - (a.sx - kam.viewW / 2) / kam.scale;
          kam.cy = wy - (a.sy - kam.viewH / 2) / kam.scale;
        }
        clampCenter();
      } else if (kam.anchor) {
        kam.anchor = null;
      }
    },
  };
}
