// MALEN (Referenz 05): der Schwarm bildet ein weißes Canvas aus
// 1px-Agenten (verlustfrei, Identitäts-Mapping im Reserve-Block), oben
// rechts einen HSV-Farbwähler (selbst aus Agenten), oben links den
// türkisen Supervisor-Agenten, unten zwei lila Schnellaktionen
// (Radierer, Pinselgröße). Der Cursoragent wird über dem Canvas zum
// Stift. Malen = Ziel-Farben der überstrichenen Pixel-Agenten stempeln —
// die Tinte „trocknet" durchs Farb-Easing organisch ein.
import { CONFIG } from '../config.js';
import { STATE, allocReserve, wakeAgent, CIRCLE } from '../swarm.js';
import { shapeId } from '../formen.js';
import { createAppShell } from './app.js';

function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

export function createMalen(store, deps) {
  const M = CONFIG.malen;
  const shell = createAppShell(store, deps, 'malen');
  const el = document.getElementById('feld');

  let tNow = 0;
  let region = null;
  let canvas = null;   // { x0, y0, x1, y1, w, h, px, ids: Int32Array }
  let picker = null;   // { x0, y0, x1, y1, ids }  (SV-Fläche)
  let hueBar = null;
  let svDot = -1;      // Indikator im SV-Feld
  let superId = -1;
  let buttons = [];    // { id, key }
  let penId = -1;

  let hue = 0.46, sat = 0.75, val = 0.85; // Start: Türkis wie Referenz
  let radierer = false;
  let brushIx = 1;
  let stroke = null;   // letzter Malpunkt (Canvas-px)

  const brushColor = () => (radierer ? [255, 255, 255] : hsvToRgb(hue, sat, val));

  function wakeBlock(x0, y0, wPx, hPx, pxWorld, colorFn, waveSec) {
    const ids = new Int32Array(wPx * hPx).fill(-1);
    for (let y = 0; y < hPx; y++) {
      const rowDelay = waveSec > 0 ? (y / hPx) * waveSec : 0;
      for (let x = 0; x < wPx; x++) {
        const wx = x0 + (x + 0.5) * pxWorld;
        const wy = y0 + (y + 0.5) * pxWorld;
        const id = allocReserve(store, wx, wy);
        if (id < 0) return ids;
        // deutliche Überlappung: die AA-Kanten der Mini-Quads fressen
        // sonst Deckung — so bleibt die Fläche satt und lückenlos
        wakeAgent(store, id, tNow, rowDelay, {
          size: pxWorld * 1.55, shape: 1 /* SQUARE */, taskId: shell.task,
          px: wx + (Math.random() - 0.5) * 1.2,
          py: wy + (Math.random() - 0.5) * 1.2,
          swirl: y % 3 === 0, // nur ein Teil wirbelt — ruhigerer Einflug
        });
        const c = colorFn(x, y);
        store.state[id] = STATE.IMAGE; // friert nach Ankunft ein
        store.tgtR[id] = c[0];
        store.tgtG[id] = c[1];
        store.tgtB[id] = c[2];
        ids[y * wPx + x] = id;
      }
    }
    return ids;
  }

  function svColors() {
    return (x, y) => {
      const s = x / (picker.w - 1);
      const v = 1 - y / (picker.h - 1);
      return hsvToRgb(hue, s, v);
    };
  }

  function repaintPicker() {
    const fn = svColors();
    for (let y = 0; y < picker.h; y++) {
      for (let x = 0; x < picker.w; x++) {
        const id = picker.ids[y * picker.w + x];
        if (id < 0) continue;
        const c = fn(x, y);
        store.tgtR[id] = c[0];
        store.tgtG[id] = c[1];
        store.tgtB[id] = c[2];
        store.frozen[id] = 0; // Farbwechsel fließt durch
      }
    }
    if (svDot >= 0) {
      store.targetX[svDot] = picker.wx0 + sat * (picker.wx1 - picker.wx0);
      store.targetY[svDot] = picker.wy0 + (1 - val) * (picker.wy1 - picker.wy0);
      store.frozen[svDot] = 0;
    }
    if (penId >= 0) {
      const c = brushColor();
      store.tgtR[penId] = c[0];
      store.tgtG[penId] = c[1];
      store.tgtB[penId] = c[2];
    }
  }

  // Welt → Canvas-Pixel; null wenn außerhalb
  function toCanvasPx(wx, wy) {
    if (!canvas) return null;
    const x = Math.floor((wx - canvas.x0) / canvas.px);
    const y = Math.floor((wy - canvas.y0) / canvas.px);
    if (x < 0 || x >= canvas.w || y < 0 || y >= canvas.h) return null;
    return { x, y };
  }

  function stamp(x, y) {
    const r = M.brushSizes[brushIx] / 2 + 0.2;
    const r2 = r * r;
    const c = brushColor();
    const xa = Math.max(0, Math.ceil(x - r)), xb = Math.min(canvas.w - 1, Math.floor(x + r));
    const ya = Math.max(0, Math.ceil(y - r)), yb = Math.min(canvas.h - 1, Math.floor(y + r));
    for (let py = ya; py <= yb; py++) {
      for (let px = xa; px <= xb; px++) {
        const dx = px - x, dy = py - y;
        if (dx * dx + dy * dy > r2) continue;
        const id = canvas.ids[py * canvas.w + px];
        if (id < 0) continue;
        store.tgtR[id] = c[0];
        store.tgtG[id] = c[1];
        store.tgtB[id] = c[2];
        store.frozen[id] = 0; // Tinte fließt ein
      }
    }
  }

  function strokeTo(p) {
    if (!stroke) {
      stamp(p.x, p.y);
    } else {
      const d = Math.hypot(p.x - stroke.x, p.y - stroke.y);
      const steps = Math.max(1, Math.ceil(d / 1.5));
      for (let k = 1; k <= steps; k++) {
        stamp(stroke.x + ((p.x - stroke.x) * k) / steps, stroke.y + ((p.y - stroke.y) * k) / steps);
      }
    }
    stroke = p;
  }

  function pickAt(wx, wy) {
    // SV-Fläche
    if (wx >= picker.wx0 && wx <= picker.wx1 && wy >= picker.wy0 && wy <= picker.wy1) {
      sat = Math.min(1, Math.max(0, (wx - picker.wx0) / (picker.wx1 - picker.wx0)));
      val = Math.min(1, Math.max(0, 1 - (wy - picker.wy0) / (picker.wy1 - picker.wy0)));
      radierer = false;
      repaintPicker();
      return true;
    }
    // Hue-Balken
    if (wx >= hueBar.wx0 && wx <= hueBar.wx1 && wy >= hueBar.wy0 && wy <= hueBar.wy1) {
      hue = Math.min(1, Math.max(0, (wx - hueBar.wx0) / (hueBar.wx1 - hueBar.wx0)));
      radierer = false;
      repaintPicker();
      return true;
    }
    return false;
  }

  function buttonAt(wx, wy) {
    for (const b of buttons) {
      const dx = store.posX[b.id] - wx, dy = store.posY[b.id] - wy;
      if (dx * dx + dy * dy < 0.4) return b;
    }
    return null;
  }

  return {
    name: 'malen',
    warpRect: (t) => shell.warpRect(t),

    open(t) {
      tNow = t;
      region = shell.open(t);
      const kam = deps.kamera;
      const pxW = 1 / kam.scale; // 1 Agent = 1 Bildschirmpixel — verlustfrei

      // weißes Canvas (links, Referenz 05)
      const cx0 = region.x0 + M.canvas.dx;
      const cy0 = region.y0 + M.canvas.dy;
      const wPx = Math.round(M.canvas.w / pxW);
      const hPx = Math.round(M.canvas.h / pxW);
      canvas = {
        x0: cx0, y0: cy0, x1: cx0 + wPx * pxW, y1: cy0 + hPx * pxW,
        w: wPx, h: hPx, px: pxW,
        ids: wakeBlock(cx0, cy0, wPx, hPx, pxW, () => [255, 255, 255], M.waveSec),
      };

      // HSV-Wähler oben rechts: SV-Fläche + Hue-Balken (gröbere Agenten)
      const pPx = M.picker.px / kam.scale;
      const pw = Math.round(M.picker.w / pPx);
      const ph = Math.round(M.picker.h / pPx);
      const px0 = region.x1 - M.picker.dxRight;
      const py0 = region.y0 + M.picker.dy;
      picker = {
        w: pw, h: ph,
        wx0: px0, wy0: py0, wx1: px0 + pw * pPx, wy1: py0 + ph * pPx,
      };
      picker.ids = wakeBlock(px0, py0, pw, ph, pPx, svColors(), 0.4);
      const hh = Math.max(2, Math.round(M.picker.hueH / pPx));
      hueBar = {
        w: pw, h: hh,
        wx0: px0, wy0: picker.wy1 + pPx * 1.5,
        wx1: px0 + pw * pPx, wy1: picker.wy1 + pPx * (1.5 + hh),
      };
      hueBar.ids = wakeBlock(px0, hueBar.wy0, pw, hh, pPx,
        (x) => hsvToRgb(x / (pw - 1), 1, 1), 0.4);

      // SV-Indikator (kleiner heller Kreis-Agent)
      svDot = allocReserve(store, px0, py0);
      if (svDot >= 0) {
        wakeAgent(store, svDot, t, 0.4, { size: 0.02, shape: CIRCLE, taskId: shell.task });
        store.state[svDot] = STATE.TEXT;
        store.sizeTgt[svDot] = 0.12;
        store.tgtR[svDot] = 250; store.tgtG[svDot] = 250; store.tgtB[svDot] = 250;
      }

      // Supervisor oben links (türkise Augen-Kachel — der Über-Agent des
      // Malprojekts, Referenz 05)
      superId = allocReserve(store, region.x0 + M.supervisor.dx, region.y0 + M.supervisor.dy);
      if (superId >= 0) {
        const TK = CONFIG.colors.tuerkis;
        wakeAgent(store, superId, t, 0.2, {
          size: 0.02, shape: shapeId('augenTile'), taskId: shell.task,
        });
        store.state[superId] = STATE.TEXT;
        store.sizeTgt[superId] = M.supervisor.size;
        store.tgtR[superId] = TK[0]; store.tgtG[superId] = TK[1]; store.tgtB[superId] = TK[2];
      }

      // zwei lila Schnellaktionen unter dem Canvas: Radierer, Pinselgröße
      buttons = [];
      const LI = CONFIG.colors.lila;
      const bys = region.y0 + M.canvas.dy + M.canvas.h + M.buttons.dy;
      for (const [ix, key] of [['radierer', 0], ['pinsel', 1]].map((v, i) => [i, v[0]])) {
        const bx = canvas.x0 + 1.2 + ix * M.buttons.gap;
        const id = allocReserve(store, bx, bys);
        if (id < 0) continue;
        wakeAgent(store, id, t, 0.3 + ix * 0.1, {
          size: 0.02, shape: shapeId('squircle'), taskId: shell.task,
        });
        store.state[id] = STATE.TEXT;
        store.sizeTgt[id] = M.buttons.size;
        store.tgtR[id] = LI[0]; store.tgtG[id] = LI[1]; store.tgtB[id] = LI[2];
        buttons.push({ id, key });
      }

      // Stift: der Cursoragent (sonst unsichtbar) wird über dem Canvas
      // sichtbar; der OS-Cursor verschwindet dort
      penId = allocReserve(store, canvas.x0, canvas.y0);
      if (penId >= 0) {
        wakeAgent(store, penId, t, 0, { size: 0.02, shape: CIRCLE, taskId: shell.task, swirl: false });
        store.state[penId] = STATE.TEXT;
        store.brightness[penId] = 0;
        const c = brushColor();
        store.tgtR[penId] = c[0]; store.tgtG[penId] = c[1]; store.tgtB[penId] = c[2];
      }
      store.needsRebuild = true;
    },

    close(t) {
      if (canvas) for (const id of canvas.ids) deps.revert(id);
      if (picker) for (const id of picker.ids) deps.revert(id);
      if (hueBar) for (const id of hueBar.ids) deps.revert(id);
      for (const b of buttons) deps.revert(b.id);
      for (const id of [svDot, superId, penId]) deps.revert(id);
      canvas = picker = hueBar = null;
      buttons = [];
      svDot = superId = penId = -1;
      el.style.cursor = 'crosshair';
      shell.close(t);
    },

    onPointerDown(wx, wy) {
      const b = buttonAt(wx, wy);
      if (b) {
        if (b.key === 'radierer') {
          radierer = !radierer;
          deps.showNote(radierer ? 'radierer aktiv' : 'pinsel aktiv');
          repaintPicker();
        } else {
          brushIx = (brushIx + 1) % M.brushSizes.length;
          deps.showNote(`pinselgröße ${M.brushSizes[brushIx]} px`);
        }
        return true;
      }
      if (pickAt(wx, wy)) return true;
      const p = toCanvasPx(wx, wy);
      if (p) {
        stroke = null;
        strokeTo(p);
        return true;
      }
      return false;
    },

    onPointerDrag(wx, wy) {
      if (pickAt(wx, wy)) return;
      const p = toCanvasPx(wx, wy);
      if (p) strokeTo(p);
      else stroke = null;
    },

    onPointerUp() {
      stroke = null;
    },

    onClick(wx, wy) {
      if (shell.hitClose(wx, wy)) return 'close';
      return true;
    },

    update(t, cursor) {
      tNow = t;
      // Stift folgt exakt dem Cursor; über dem Canvas ersetzt er ihn
      if (penId >= 0 && cursor) {
        const over = cursor.active && toCanvasPx(cursor.wx, cursor.wy) !== null;
        store.targetX[penId] = cursor.wx;
        store.targetY[penId] = cursor.wy;
        store.posX[penId] = cursor.wx;   // exakt, ohne Feder-Nachlauf
        store.posY[penId] = cursor.wy;
        store.sizeTgt[penId] = over ? (M.brushSizes[brushIx] / deps.kamera.scale) * 1.15 : 0;
        el.style.cursor = over ? 'none' : 'crosshair';
      }
      // aktiver Radierer: Button pulsiert leicht
      for (const b of buttons) {
        if (b.key === 'radierer' && radierer) {
          store.brightness[b.id] = 0.75 + 0.25 * Math.sin(t * 5);
        }
      }
    },
  };
}
