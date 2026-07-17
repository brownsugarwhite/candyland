// VEKTOR: Zeichnen wie mit dem Illustrator-Stift auf weißem Canvas.
// Das STIFT-Werkzeug (lila Button, immer gleiche px-Größe) setzt mit
// Klick Eckpunkte, Klick+Ziehen erzeugt weiche Punkte mit symmetrischen
// Handles. NUR die Punkte sind Agenten (Anker = dunkle Squircles,
// Handle-Knöpfe = türkise Kreise) — der PFAD selbst ist eine echte
// 1px-Linie (Linien-Pass), ebenso die Handle-Arme. Klick auf den
// Startpunkt schließt; „füllen" (lila) fragt nach einem Prompt und
// verdichtet die generative Füllung als 1px-Agenten in die Pfadmaske.
// Das Mausrad skaliert das Canvas separat (Werkzeuge bleiben fix).
import { CONFIG } from '../config.js';
import { STATE, allocReserve, wakeAgent, CIRCLE, SQUARE } from '../swarm.js';
import { shapeId } from '../formen.js';
import { createAppShell } from './app.js';
import { activeProvider, mockProvider } from '../fuellung.js';

const INK = [0.16, 0.17, 0.18];      // Pfadfarbe (Linie, 0..1)
const ARM = [0.17, 0.94, 0.85];      // Handle-Arme

export function createVektor(store, deps) {
  const shell = createAppShell(store, deps, 'vektor');
  const M = CONFIG.malen;

  let tNow = 0;
  let region = null;
  let u = 1;
  let canvas = null;      // Welt-Rect des weißen Canvas
  let canvasIds = [];
  let canvasScale = 1;
  let rebuildAt = 0;      // Canvas-Block nach dem Skalieren neu verdichten
  let path = [];          // [{ p, hIn, hOut }] (Welt)
  let closed = false;
  let drawingHandle = null;
  let curve = [];         // gesampelte Pfadpunkte (Welt)
  let ankerAgents = [];   // { a, hi, ho }
  let fillIds = [];
  let buttons = [];       // { id, key } — stift, füllen
  let stiftAktiv = true;
  let busy = false;

  function wakeAt(x, y, size, shape, col, delay = 0) {
    const id = allocReserve(store, x, y);
    if (id < 0) return -1;
    wakeAgent(store, id, tNow, delay, {
      size: 0.02, shape, taskId: shell.task, swirl: false,
      px: x + (Math.random() - 0.5) * 1.2,
      py: y + (Math.random() - 0.5) * 1.2,
    });
    store.state[id] = STATE.TEXT;
    store.sizeTgt[id] = size;
    store.tgtR[id] = col[0];
    store.tgtG[id] = col[1];
    store.tgtB[id] = col[2];
    store.needsRebuild = true;
    return id;
  }

  // ---- Canvas-Block (1px-Agenten) ---------------------------------------
  function buildCanvas() {
    for (const id of canvasIds) deps.revert(id);
    canvasIds = [];
    const kam = deps.kamera;
    const pxW = 1 / kam.scale;
    const cw = (M.canvas.w + 1.6) * canvasScale;
    const ch = (M.canvas.h + 0.8) * canvasScale;
    const ccx = region.x0 + M.canvas.dx + (M.canvas.w + 1.6) / 2;
    const ccy = region.y0 + M.canvas.dy - 0.6 + (M.canvas.h + 0.8) / 2;
    const wPx = Math.round(cw / pxW);
    const hPx = Math.round(ch / pxW);
    const x0 = ccx - (wPx * pxW) / 2;
    const y0 = ccy - (hPx * pxW) / 2;
    canvas = { x0, y0, x1: x0 + wPx * pxW, y1: y0 + hPx * pxW };
    for (let y = 0; y < hPx; y++) {
      const rowDelay = 0.4 + (y / hPx) * M.waveSec;
      for (let x = 0; x < wPx; x++) {
        const wx = x0 + (x + 0.5) * pxW;
        const wy = y0 + (y + 0.5) * pxW;
        const id = allocReserve(store, wx, wy);
        if (id < 0) return;
        wakeAgent(store, id, tNow, rowDelay, {
          size: pxW * 1.55, shape: SQUARE, taskId: shell.task, swirl: y % 3 === 0,
          px: wx + (Math.random() - 0.5) * 1.2,
          py: wy + (Math.random() - 0.5) * 1.2,
        });
        store.state[id] = STATE.IMAGE;
        store.tgtR[id] = 255;
        store.tgtG[id] = 255;
        store.tgtB[id] = 255;
        canvasIds.push(id);
      }
    }
    store.needsRebuild = true;
  }

  // ---- Kurve -------------------------------------------------------------
  function segPoints(a, b, n) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const v = 1 - t;
      pts.push([
        v * v * v * a.p[0] + 3 * v * v * t * a.hOut[0] + 3 * v * t * t * b.hIn[0] + t * t * t * b.p[0],
        v * v * v * a.p[1] + 3 * v * v * t * a.hOut[1] + 3 * v * t * t * b.hIn[1] + t * t * t * b.p[1],
      ]);
    }
    return pts;
  }

  function resample() {
    curve = [];
    const segs = closed ? path.length : path.length - 1;
    for (let s = 0; s < segs; s++) {
      const a = path[s], b = path[(s + 1) % path.length];
      const guess = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) +
        Math.hypot(a.hOut[0] - a.p[0], a.hOut[1] - a.p[1]) * 2;
      const n = Math.max(8, Math.ceil(guess / 0.12));
      const pts = segPoints(a, b, n);
      for (let k = s === 0 ? 0 : 1; k < pts.length; k++) curve.push(pts[k]);
    }
  }

  // Anker/Handle-AGENTEN synchronisieren (nur die Punkte!)
  function relayout() {
    resample();
    const TK = CONFIG.colors.tuerkis;
    while (ankerAgents.length < path.length) {
      ankerAgents.push({
        a: wakeAt(canvas.x0, canvas.y0, 11 * u, shapeId('squircle'), [70, 76, 78]),
        hi: wakeAt(canvas.x0, canvas.y0, 7 * u, CIRCLE, TK),
        ho: wakeAt(canvas.x0, canvas.y0, 7 * u, CIRCLE, TK),
      });
    }
    while (ankerAgents.length > path.length) {
      const g = ankerAgents.pop();
      deps.revert(g.a); deps.revert(g.hi); deps.revert(g.ho);
    }
    for (let i = 0; i < path.length; i++) {
      const n = path[i];
      const g = ankerAgents[i];
      store.targetX[g.a] = n.p[0];
      store.targetY[g.a] = n.p[1];
      const hasH = Math.hypot(n.hOut[0] - n.p[0], n.hOut[1] - n.p[1]) > 0.03;
      for (const [hid, hp] of [[g.hi, n.hIn], [g.ho, n.hOut]]) {
        store.targetX[hid] = hp[0];
        store.targetY[hid] = hp[1];
        store.sizeTgt[hid] = hasH ? 7 * u : 0;
      }
    }
  }

  // Pfad + Handle-Arme als echte Linien in den Linien-Pass
  function pushLines() {
    if (curve.length >= 2) {
      const ex = store.extraLines;
      for (let k = 0; k + 1 < curve.length; k++) {
        ex.push(curve[k][0], curve[k][1], curve[k + 1][0], curve[k + 1][1],
          INK[0], INK[1], INK[2], 0.9);
      }
    }
    for (let i = 0; i < path.length; i++) {
      const n = path[i];
      if (Math.hypot(n.hOut[0] - n.p[0], n.hOut[1] - n.p[1]) < 0.03) continue;
      store.extraLines.push(n.hIn[0], n.hIn[1], n.hOut[0], n.hOut[1],
        ARM[0], ARM[1], ARM[2], 0.4);
    }
  }

  function inCanvas(wx, wy) {
    return canvas && wx >= canvas.x0 && wx <= canvas.x1 && wy >= canvas.y0 && wy <= canvas.y1;
  }

  function closePath() {
    if (path.length < 3 || closed) return;
    closed = true;
    relayout();
    deps.showNote('pfad geschlossen — „füllen" (lila) füllt generativ');
  }

  // ---- Generative Füllung ------------------------------------------------
  async function fillPath(prompt) {
    if (busy || !closed) return;
    busy = true;
    deps.showNote('füllung entsteht …');
    try {
      const kam = deps.kamera;
      const pxW = 1 / kam.scale;
      const w = Math.round((canvas.x1 - canvas.x0) / pxW);
      const h = Math.round((canvas.y1 - canvas.y0) / pxW);
      const mask = document.createElement('canvas');
      mask.width = w;
      mask.height = h;
      const mctx = mask.getContext('2d');
      const p2d = new Path2D();
      const nx = (v) => (v[0] - canvas.x0) / pxW;
      const ny = (v) => (v[1] - canvas.y0) / pxW;
      path.forEach((n, i) => {
        if (i === 0) p2d.moveTo(nx(n.p), ny(n.p));
        const b = path[(i + 1) % path.length];
        p2d.bezierCurveTo(nx(n.hOut), ny(n.hOut), nx(b.hIn), ny(b.hIn), nx(b.p), ny(b.p));
      });
      p2d.closePath();
      mctx.fillStyle = '#fff';
      mctx.fill(p2d);

      const provider = activeProvider();
      let img;
      try {
        img = await provider.fill({ maskCanvas: mask, prompt });
      } catch (err) {
        deps.showNote(String((err && err.message) || err));
        img = await mockProvider.fill({ maskCanvas: mask, prompt });
      }

      const comp = document.createElement('canvas');
      comp.width = w;
      comp.height = h;
      const cctx = comp.getContext('2d');
      cctx.drawImage(img, 0, 0, w, h);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(mask, 0, 0);
      const data = cctx.getImageData(0, 0, w, h).data;

      for (const id of fillIds) deps.revert(id);
      fillIds = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          if (data[o + 3] < 64) continue;
          const wx = canvas.x0 + (x + 0.5) * pxW;
          const wy = canvas.y0 + (y + 0.5) * pxW;
          const id = allocReserve(store, wx, wy);
          if (id < 0) break;
          wakeAgent(store, id, tNow, (y / h) * 0.9, {
            size: pxW * 1.55, shape: SQUARE, taskId: shell.task, swirl: y % 4 === 0,
            px: wx + (Math.random() - 0.5) * 0.8,
            py: wy + (Math.random() - 0.5) * 0.8,
          });
          store.state[id] = STATE.IMAGE;
          store.tgtR[id] = data[o];
          store.tgtG[id] = data[o + 1];
          store.tgtB[id] = data[o + 2];
          fillIds.push(id);
        }
      }
      store.needsRebuild = true;
      deps.showNote(`gefüllt (${provider.name}) — esc beendet`);
    } finally {
      busy = false;
    }
  }

  return {
    name: 'vektor',
    warpRect: (t) => shell.warpRect(t),

    open(t) {
      tNow = t;
      region = shell.open(t);
      u = 1 / deps.kamera.scale;
      buildCanvas();

      // Werkzeuge (immer gleiche px-Größe): Stift + Füllen
      const LI = CONFIG.colors.lila;
      buttons = [];
      ['stift', 'fuellen'].forEach((key, j) => {
        const bx = region.x0 + (26 + j * 52) * u;
        const by = region.y1 - 26 * u;
        const id = wakeAt(bx, by, 34 * u, shapeId('squircle'), LI, 0.3 + j * 0.1);
        if (id >= 0) buttons.push({ id, key });
      });
      deps.showNote('stift: klick = eckpunkt · klick+ziehen = kurve · rad skaliert das canvas');
    },

    close(t) {
      for (const id of canvasIds) deps.revert(id);
      for (const g of ankerAgents) {
        deps.revert(g.a); deps.revert(g.hi); deps.revert(g.ho);
      }
      for (const id of fillIds) deps.revert(id);
      for (const b of buttons) deps.revert(b.id);
      canvasIds = fillIds = [];
      ankerAgents = [];
      buttons = [];
      path = [];
      curve = [];
      closed = false;
      shell.close(t);
    },

    // Canvas separat skalierbar — Werkzeuge und Grid bleiben unberührt
    onWheel(deltaY) {
      const c = deps.cursorRef();
      if (!inCanvas(c.wx, c.wy) && canvas) return;
      const f = Math.exp(-deltaY * 0.001);
      const neu = Math.min(1.6, Math.max(0.5, canvasScale * f));
      if (neu === canvasScale) return;
      const ratio = neu / canvasScale;
      canvasScale = neu;
      const ccx = (canvas.x0 + canvas.x1) / 2;
      const ccy = (canvas.y0 + canvas.y1) / 2;
      for (const n of path) {
        for (const p of [n.p, n.hIn, n.hOut]) {
          p[0] = ccx + (p[0] - ccx) * ratio;
          p[1] = ccy + (p[1] - ccy) * ratio;
        }
      }
      canvas.x0 = ccx + (canvas.x0 - ccx) * ratio;
      canvas.x1 = ccx + (canvas.x1 - ccx) * ratio;
      canvas.y0 = ccy + (canvas.y0 - ccy) * ratio;
      canvas.y1 = ccy + (canvas.y1 - ccy) * ratio;
      relayout();
      rebuildAt = tNow + 0.5; // Pixel-Block gebündelt neu verdichten
    },

    onPointerDown(wx, wy) {
      for (const b of buttons) {
        const dx = store.posX[b.id] - wx, dy = store.posY[b.id] - wy;
        if (dx * dx + dy * dy < (26 * u) ** 2) {
          if (b.key === 'stift') {
            stiftAktiv = !stiftAktiv;
            deps.showNote(stiftAktiv ? 'stift aktiv' : 'stift abgelegt');
          } else {
            if (!closed) deps.showNote('erst den pfad schließen (klick auf den startpunkt)');
            else deps.openPromptFeld('füll-prompt + enter', (text) => fillPath(text));
          }
          return true;
        }
      }
      if (!stiftAktiv || !inCanvas(wx, wy) || closed) return false;
      if (path.length >= 3) {
        const s = path[0].p;
        if (Math.hypot(s[0] - wx, s[1] - wy) < 14 * u) {
          closePath();
          return true;
        }
      }
      path.push({ p: [wx, wy], hIn: [wx, wy], hOut: [wx, wy] });
      drawingHandle = path.length - 1;
      relayout();
      return true;
    },

    onPointerDrag(wx, wy) {
      if (drawingHandle === null) return;
      const n = path[drawingHandle];
      n.hOut = [wx, wy];
      n.hIn = [2 * n.p[0] - wx, 2 * n.p[1] - wy];
      relayout();
    },

    onPointerUp() {
      drawingHandle = null;
    },

    onClick(wx, wy) {
      if (shell.hitClose(wx, wy)) return 'close';
      return true;
    },

    update(t) {
      tNow = t;
      if (rebuildAt > 0 && t > rebuildAt) {
        rebuildAt = 0;
        buildCanvas();
      }
      pushLines();
    },
  };
}
