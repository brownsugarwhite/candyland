// Das EINGABEFELD: kein Kasten, sondern eine Bucht im Schwarm — die
// umliegenden Agenten weichen aus (Feld-Warp) und MORPHEN in die
// Buchstaben (Feinraster-Poppins mit Kantenglättung). Der Puffer ist
// unbegrenzt, Copy/Paste funktioniert, der Text bricht automatisch um
// und das Feld wächst mit dem Inhalt (Breite bis max, dann Höhe).
import { CONFIG } from './config.js';
import { STATE, setAgentShape, allocReserve, wakeAgent, SQUARE } from './swarm.js';
import { assignTargets } from './assign.js';
import { rasterizeText, wrapText, measureTextPx, rasterRows } from './rasterize.js';

export function createFeld(store, deps) {
  // deps: { kamera, registerTask, onSubmit, revert }
  const F = CONFIG.feld;
  const TXT = CONFIG.colors.text;
  const g = store.gitter;

  let rect = null;        // Welt { x0, y0, x1, y1 }
  let anchor = null;      // Öffnungspunkt (Welt)
  let text = '';
  let keyCapture = false; // „key"-Modus: Anzeige maskiert (●●●)
  let taskId = 0;
  let caretIds = null;
  const textMap = new Map(); // Zellschlüssel → Agent-Id
  let lines = [''];
  let pixelW = 0;         // Welteinheiten pro Textpixel
  let rowsPerLine = 0;
  let u = 1;              // Welteinheiten pro Screen-px (bei open fixiert)
  let ringIds = null;     // feiner Punktring um das Feld

  const isOpen = () => rect !== null;

  function layout() {
    // Screen-px → Welt: das Feld hat auf JEDER Zoomstufe dieselbe px-Größe
    u = 1 / deps.kamera.scale;
    rowsPerLine = rasterRows(F.fontPx);
    const lineH = F.lineHPx * u;
    pixelW = lineH / rowsPerLine;
    // Umbruch in Raster-px (Textpixel), Breiten in Welt
    const maxTextPx = ((F.maxWidthPx - 2 * F.padXPx) * rowsPerLine) / F.lineHPx;
    lines = wrapText(text, maxTextPx, F.fontPx);
    let widest = 0;
    for (const ln of lines) widest = Math.max(widest, measureTextPx(ln, F.fontPx));
    const wantW = Math.min(F.maxWidthPx * u,
      Math.max(F.widthPx * u, widest * pixelW + (2 * F.padXPx + 24) * u));
    const wantH = Math.max(1, lines.length) * lineH + 26 * u;

    // um den Öffnungspunkt zentriert, ins Sichtfenster geklemmt
    const kam = deps.kamera;
    const halfW = kam.viewW / 2 / kam.scale;
    const halfH = kam.viewH / 2 / kam.scale;
    let x0 = anchor.x - wantW / 2;
    let y0 = anchor.y - wantH / 2;
    x0 = Math.min(kam.cx + halfW - wantW - 0.6, Math.max(kam.cx - halfW + 0.6, x0));
    y0 = Math.min(kam.cy + halfH - wantH - 0.6, Math.max(kam.cy - halfH + 0.6, y0));
    rect = { x0, y0, x1: x0 + wantW, y1: y0 + wantH };
    ringLayout();
  }

  // feiner Punktring: macht die Bucht auf jeder Zoomstufe sichtbar
  function ringPoint(k) {
    const n = F.ringDots;
    const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
    const per = 2 * (w + h);
    let d = ((k + 0.5) / n) * per;
    const m = 5 * u;
    if (d < w) return [rect.x0 + d, rect.y0 - m];
    d -= w;
    if (d < h) return [rect.x1 + m, rect.y0 + d];
    d -= h;
    if (d < w) return [rect.x1 - d, rect.y1 + m];
    d -= w;
    return [rect.x0 - m, rect.y1 - d];
  }

  function ringLayout() {
    if (!ringIds) return;
    for (let k = 0; k < ringIds.length; k++) {
      const id = ringIds[k];
      if (id < 0) continue;
      const p = ringPoint(k);
      store.targetX[id] = p[0];
      store.targetY[id] = p[1];
      store.sizeTgt[id] = F.ringDotPx * u;
    }
  }

  const originX = () => rect.x0 + F.padXPx * u;
  const originY = () => rect.y0 + 12 * u;

  function displayLines() {
    if (!keyCapture) return lines;
    return ['●'.repeat(Math.min(text.length, 24))];
  }

  function fineStyle(id, a) {
    store.sizeTgt[id] = pixelW * 1.55; // Überlappung → satte, scharfe Schrift
    setAgentShape(store, id, SQUARE);
    const f = a / 255;
    store.tgtR[id] = TXT[0] * f;
    store.tgtG[id] = TXT[1] * f;
    store.tgtB[id] = TXT[2] * f;
  }

  function caretPos() {
    const dls = displayLines();
    const last = dls[dls.length - 1];
    const cx = Math.min(
      originX() + measureTextPx(last, F.fontPx) * pixelW,
      rect.x1 - F.padXPx * u,
    );
    const cy = originY() + (dls.length - 1) * F.lineHPx * u + 3 * u;
    return { cx, cy };
  }

  // Rekrutierung: erst morphen UMLIEGENDE Gitteragenten in die Buchstaben
  // (begrenztes Budget), der Rest kommt als Reserve-Agent aus der Nähe.
  let gridUsed = 0;

  function nearCarrier(i) {
    if (store.carrier[i] !== 1 || store.state[i] > STATE.RETURNING) return false;
    const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
    return Math.abs(store.posX[i] - cx) < F.gridPullDist + (rect.x1 - rect.x0) / 2 &&
           Math.abs(store.posY[i] - cy) < F.gridPullDist + (rect.y1 - rect.y0) / 2;
  }

  function recruit(pts, nPts) {
    const ids = new Int32Array(nPts).fill(-1);
    const fromGrid = Math.max(0, Math.min(nPts, F.maxGridAgents - gridUsed));
    if (fromGrid > 0) {
      const got = assignTargets(store, pts, fromGrid, STATE.TEXT, nearCarrier, taskId);
      for (let k = 0; k < fromGrid; k++) {
        ids[k] = got[k];
        if (got[k] >= 0) gridUsed++;
      }
    }
    let woke = false;
    for (let k = 0; k < nPts; k++) {
      if (ids[k] >= 0) continue;
      const wx = pts[k * 2], wy = pts[k * 2 + 1];
      const id = allocReserve(store, wx, wy);
      if (id < 0) break;
      // lebendiger Energiefluss: neue Buchstaben-Agenten kommen VON AUSSEN
      const side = (Math.random() * 4) | 0;
      const off = 1.2 + Math.random() * 1.6;
      const sx = side === 0 ? rect.x0 - off : side === 1 ? rect.x1 + off
        : rect.x0 + Math.random() * (rect.x1 - rect.x0);
      const sy = side === 2 ? rect.y0 - off : side === 3 ? rect.y1 + off
        : rect.y0 + Math.random() * (rect.y1 - rect.y0);
      wakeAgent(store, id, 0, 0, {
        size: 0.02, shape: SQUARE, taskId,
        px: side < 2 ? sx : sx,
        py: side < 2 ? rect.y0 + Math.random() * (rect.y1 - rect.y0) : sy,
      });
      store.state[id] = STATE.TEXT;
      ids[k] = id;
      woke = true;
    }
    if (woke) store.needsRebuild = true;
    return ids;
  }

  function recruitCaret() {
    const { cx, cy } = caretPos();
    const pts = new Float32Array(F.caretRows * 2);
    for (let k = 0; k < F.caretRows; k++) {
      pts[k * 2] = cx;
      pts[k * 2 + 1] = cy + k * pixelW * 1.8;
    }
    const ids = recruit(pts, F.caretRows);
    for (const id of ids) if (id >= 0) fineStyle(id, 255);
    return ids;
  }

  function moveCaret() {
    if (!caretIds) return;
    const { cx, cy } = caretPos();
    for (let k = 0; k < caretIds.length; k++) {
      const id = caretIds[k];
      if (id < 0) continue;
      store.targetX[id] = cx;
      store.targetY[id] = cy + k * pixelW * 1.8;
    }
  }

  // Diff-Retype: nur neue Zellen rekrutieren, verwaiste entlassen —
  // die Schrift „fließt" beim Tippen, statt zu flackern.
  function retype() {
    layout();
    const ox = originX(), oy = originY();
    const dls = displayLines();
    const newCells = new Map(); // key → alpha
    for (let li = 0; li < dls.length; li++) {
      const ras = rasterizeText(dls[li], F.fontPx);
      const rowOff = li * rowsPerLine;
      for (let k = 0; k < ras.n; k++) {
        const dc = ras.cells[k * 2], dr = ras.cells[k * 2 + 1] + rowOff;
        newCells.set(dc * 16384 + dr, ras.alpha[k]);
      }
    }
    for (const [key, id] of textMap) {
      if (!newCells.has(key)) {
        if (store.carrier[id] === 1) gridUsed--;
        deps.revert(id);
        textMap.delete(key);
      }
    }
    // Ziele ALLER bleibenden Zellen aktualisieren — das Feld wächst und
    // verschiebt sich, die Buchstaben fließen mit
    for (const [key, id] of textMap) {
      const dc = (key / 16384) | 0, dr = key % 16384;
      store.targetX[id] = ox + (dc + 0.5) * pixelW;
      store.targetY[id] = oy + (dr + 0.5) * pixelW;
      store.frozen[id] = 0;
    }
    const toAdd = [];
    for (const key of newCells.keys()) if (!textMap.has(key)) toAdd.push(key);
    toAdd.sort((a, b) => a - b);
    if (toAdd.length > 0) {
      const pts = new Float32Array(toAdd.length * 2);
      for (let k = 0; k < toAdd.length; k++) {
        const dc = (toAdd[k] / 16384) | 0, dr = toAdd[k] % 16384;
        pts[k * 2] = ox + (dc + 0.5) * pixelW;
        pts[k * 2 + 1] = oy + (dr + 0.5) * pixelW;
      }
      const ids = recruit(pts, toAdd.length);
      for (let k = 0; k < toAdd.length; k++) {
        if (ids[k] < 0) continue;
        textMap.set(toAdd[k], ids[k]);
        fineStyle(ids[k], newCells.get(toAdd[k]));
      }
    }
    moveCaret();
  }

  function open(wx, wy) {
    if (isOpen()) close();
    anchor = { x: wx, y: wy };
    text = '';
    taskId = deps.registerTask('eingabe-text', true);
    layout();
    caretIds = recruitCaret();
    // Punktring rekrutieren (umliegende Agenten oder Reserve)
    const pts = new Float32Array(F.ringDots * 2);
    for (let k = 0; k < F.ringDots; k++) {
      const p = ringPoint(k);
      pts[k * 2] = p[0];
      pts[k * 2 + 1] = p[1];
    }
    ringIds = [...recruit(pts, F.ringDots)];
    for (const id of ringIds) {
      if (id < 0) continue;
      store.sizeTgt[id] = F.ringDotPx * u;
      setAgentShape(store, id, SQUARE);
      store.tgtR[id] = store.baseTint[0] * 0.55;
      store.tgtG[id] = store.baseTint[1] * 0.55;
      store.tgtB[id] = store.baseTint[2] * 0.55;
    }
  }

  function close() {
    if (!isOpen()) return;
    for (const id of textMap.values()) deps.revert(id);
    textMap.clear();
    gridUsed = 0;
    if (caretIds) {
      for (const id of caretIds) if (id >= 0) deps.revert(id);
      caretIds = null;
    }
    if (ringIds) {
      for (const id of ringIds) if (id >= 0) deps.revert(id);
      ringIds = null;
    }
    rect = null;
    anchor = null;
    text = '';
    keyCapture = false;
  }

  return {
    open, close, retype,
    get isOpen() { return isOpen(); },
    get rect() { return rect; },
    get text() { return text; },
    set text(v) { text = v; retype(); },
    get keyCapture() { return keyCapture; },
    set keyCapture(v) { keyCapture = v; text = ''; retype(); },

    near(wx, wy) {
      if (!rect) return false;
      const pad = 64 * u;
      return wx > rect.x0 - pad && wx < rect.x1 + pad &&
             wy > rect.y0 - pad && wy < rect.y1 + pad;
    },

    onPaste(str) {
      if (!isOpen()) return false;
      const clean = String(str).replace(/[\r\n\t]+/g, ' ');
      text = (text + clean).slice(0, F.maxBuffer);
      retype();
      return true;
    },

    onKey(e) {
      if (!isOpen()) return false;
      if (e.key === 'Escape') { close(); return true; }
      if (e.key === 'Enter') {
        const t = text;
        deps.onSubmit(t, { keyCapture });
        return true;
      }
      if (e.key === 'Backspace') {
        if (text.length > 0) {
          text = text.slice(0, -1);
          retype();
        }
        return true;
      }
      if (e.key.length === 1 && !e.altKey) {
        if (text.length < F.maxBuffer) {
          text += e.key;
          retype();
        }
        return true;
      }
      return false;
    },

    update(t) {
      if (!isOpen() || !caretIds) return;
      const on = (t * F.caretBlinkHz) % 1 < 0.6;
      for (const id of caretIds) if (id >= 0) store.brightness[id] = on ? 1 : 0.1;
    },
  };
}
