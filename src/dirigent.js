// Der DIRIGENT von LUDI — Rex' Verwaltung. Kernprinzip: ALLES IST EINE
// AUFGABE, alles besteht aus Agenten. Der Dirigent hält die Aufgaben-
// Registry und die Agenten-Identitäten, formt Feinraster-Text aus dem
// Reserve-Pool, verdrahtet Eingabefeld, Hover/Agentenkarte, Logo/Claws
// und spricht über brain.js mit der Claude-API (Rex' Intelligenz).
import { CONFIG } from './config.js';
import {
  STATE, setAgentShape, setGlobalShape, allocReserve, wakeAgent,
  rebuildActiveList, baseSize, CIRCLE, SQUARE,
} from './swarm.js';
import { releaseAgents } from './assign.js';
import { rasterizeText, rasterRows } from './rasterize.js';
import { shapeId, glyphShape } from './formen.js';
import { askBrain, hasKey, setKey, clearKey } from './brain.js';
import { generateShape } from './shapes.js';
import { createLogo } from './logo.js';
import { createFeld } from './feld.js';
import { createAuswahl } from './auswahl.js';
import { createKarte } from './agentenkarte.js';
import { createSpiel2048 } from './apps/spiel2048.js';
import { createMalen } from './apps/malen.js';
import { create3dEditor } from './apps/editor3d.js';
import { createVektor } from './apps/vektor.js';

const NAMES = [
  'Rex', 'Vega', 'Juno', 'Milo', 'Nova', 'Piko', 'Echo', 'Faro', 'Gizmo',
  'Luna', 'Nero', 'Ondo', 'Quant', 'Rondo', 'Sirius', 'Tako', 'Uma', 'Zula',
];
const COLOR_WORDS = {
  rot: [255, 86, 86], 'grün': [96, 224, 128], gruen: [96, 224, 128],
  blau: [96, 148, 255], gold: [255, 204, 96], cyan: [110, 231, 255],
  'weiß': [240, 242, 246], weiss: [240, 242, 246], pink: [241, 79, 200],
  violett: [179, 102, 232], orange: [255, 160, 80],
  'türkis': [43, 239, 217], tuerkis: [43, 239, 217],
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createDirigent(store, kamera) {
  const cursor = { sx: 0, sy: 0, wx: 0, wy: 0, active: false, polarity: 1, attractId: -1 };
  const AG = CONFIG.colors.agent;

  let tNow = 0;
  let lastT = 0;
  let compactAt = 0;
  let booted = false;

  // ---- Aufgaben-Registry & Identität -----------------------------------
  let nextTaskId = 1;
  const taskMeta = new Map(); // id → { name, custom, system }
  function registerTask(name, system = false) {
    const id = nextTaskId++;
    taskMeta.set(id, { name, custom: null, system });
    return id;
  }

  const hashOf = (i) => Math.imul(i + 1, 2654435761) >>> 8;
  function agentName(id) {
    const h = hashOf(id);
    return `Agent ${NAMES[h % NAMES.length]} ${1000 + ((h >> 5) % 90) * 100}`;
  }

  const agentTasks = new Map(); // Einzel-Aufgaben (id → text)
  const beacons = new Set();

  function taskLines(id) {
    const lines = [];
    const custom = agentTasks.get(id);
    if (custom) lines.push(custom);
    const tid = store.taskId[id];
    if (tid > 0) {
      const m = taskMeta.get(tid);
      if (m) lines.push(m.custom || m.name);
    }
    if (beacons.has(id)) lines.push('leuchtfeuer');
    const st = store.state[id];
    if (st === STATE.TEXT && lines.length === 0) lines.push('zeichen formen');
    if (st === STATE.IMAGE) lines.push(store.frozen[id] === 1 ? 'pixel-dienst' : 'pixel-anflug');
    if (store.carrier[id] === 1) lines.push('gitter halten');
    lines.push('atmen');
    return lines.slice(0, 3);
  }

  // ---- Agenten zurücksetzen / Text auflösen ------------------------------
  function revert(id) {
    if (id == null || id < 0) return;
    if (id >= store.latticeCount) { // Reserve → versinkt und wird frei
      store.state[id] = STATE.RETURNING;
      store.taskId[id] = 0;
      store.frozen[id] = 0;
      store.sizeTgt[id] = 0;
      store.targetX[id] = store.posX[id];
      store.targetY[id] = store.posY[id];
      return;
    }
    releaseAgents(store, [id]);
    store.sizeTgt[id] = baseSize(store, id);
    store.tgtR[id] = store.baseTint[0];
    store.tgtG[id] = store.baseTint[1];
    store.tgtB[id] = store.baseTint[2];
    setAgentShape(store, id, store.globalShape);
    if (store.carrier[id] === 0) store.sizeTgt[id] = 0; // Lücken-Agent schläft ein
  }

  function dissolveIds(ids) {
    for (const id of ids) revert(id);
    compactAt = tNow + 1.8;
  }

  // ---- Feinraster-Text aus dem Reserve-Pool ------------------------------
  // opts: { x, y, h, weight, color, align, taskId, wave }
  function formText(str, opts) {
    const h = opts.h || 0.3;
    const fontPx = clamp(Math.round(h * kamera.scale / 1.32), 9, 44);
    const ras = rasterizeText(str, fontPx, opts.weight || 400);
    const pixelW = h / ras.rows;
    const wWorld = ras.wPx * pixelW;
    let x0 = opts.x;
    if (opts.align === 'center') x0 -= wWorld / 2;
    else if (opts.align === 'right') x0 -= wWorld;
    const col = opts.color || CONFIG.colors.text;
    const tid = opts.taskId || 0;
    const ids = [];
    for (let k = 0; k < ras.n; k++) {
      const wx = x0 + (ras.cells[k * 2] + 0.5) * pixelW;
      const wy = opts.y + (ras.cells[k * 2 + 1] + 0.5) * pixelW;
      const id = allocReserve(store, wx, wy);
      if (id < 0) break;
      const delay = opts.wave ? (ras.cells[k * 2] / Math.max(1, ras.wPx)) * 0.5 : Math.random() * 0.15;
      wakeAgent(store, id, tNow, delay, {
        size: pixelW * 1.12, shape: SQUARE, taskId: tid, swirl: true,
        px: wx + (Math.random() - 0.5) * 1.6,
        py: wy + (Math.random() - 0.5) * 1.6,
      });
      const f = ras.alpha[k] / 255;
      store.state[id] = STATE.IMAGE; // friert nach Ankunft ein (billig)
      store.tgtR[id] = col[0] * f;
      store.tgtG[id] = col[1] * f;
      store.tgtB[id] = col[2] * f;
      ids.push(id);
    }
    store.needsRebuild = true;
    return { ids, w: wWorld, h };
  }

  // ---- Notizen (Statuszeile unten, aus Agenten) --------------------------
  let noteIds = [];
  let noteUntil = 0;
  function showNote(msg) {
    if (noteIds.length > 0) dissolveIds(noteIds);
    const halfH = kamera.viewH / 2 / kamera.scale;
    const res = formText(msg, {
      x: kamera.cx, y: kamera.cy + halfH - 0.9, h: 0.3,
      align: 'center', color: [154, 223, 255],
    });
    noteIds = res.ids;
    noteUntil = tNow + 4;
  }

  let thinkIds = [];
  function showThinking() {
    const halfH = kamera.viewH / 2 / kamera.scale;
    const res = formText('das gehirn denkt …', {
      x: kamera.cx, y: kamera.cy + halfH - 0.9, h: 0.3,
      align: 'center', color: [154, 223, 255],
    });
    thinkIds = res.ids;
  }
  function clearThinking() {
    if (thinkIds.length > 0) dissolveIds(thinkIds);
    thinkIds = [];
  }

  // ---- Subsysteme --------------------------------------------------------
  const logo = createLogo(store, registerTask, kamera);
  const auswahl = createAuswahl(store, logo);

  let taskFor = null; // Auswahl { ids }, für die das Aufgabenfeld offen ist
  let promptFor = null; // App-Callback, der die nächste Feld-Eingabe erhält
  const feld = createFeld(store, {
    kamera, registerTask, revert,
    onSubmit(text, { keyCapture }) {
      const t = text.trim();
      if (keyCapture) {
        feld.close();
        finishKeyCapture(t);
        return;
      }
      if (promptFor) {
        const cb = promptFor;
        promptFor = null;
        feld.close();
        if (t) cb(t);
        return;
      }
      if (taskFor !== null) {
        const sel = taskFor;
        taskFor = null;
        feld.close();
        assignTask(sel, t);
        return;
      }
      const tl = t.toLowerCase();
      if (!tl) { feld.close(); return; }
      if (tl === 'key') {
        feld.keyCapture = true;
        showNote(hasKey()
          ? 'key einfügen (⌘v) + enter · „weg" löscht · esc behält'
          : 'api-key einfügen (⌘v) und enter drücken');
        return;
      }
      if (tl === 'tunnel' || tl === 'ordner') {
        const r = feld.rect;
        const hx = (r.x0 + r.x1) / 2, hy = (r.y0 + r.y1) / 2;
        feld.close();
        createTunnel(hx, hy);
        return;
      }
      if (tl === '2048') {
        feld.close();
        openApp(createSpiel2048(store, appDeps()));
        return;
      }
      if (tl === 'malen') {
        feld.close();
        openApp(createMalen(store, appDeps()));
        return;
      }
      if (tl === '3d') {
        feld.close();
        openApp(create3dEditor(store, appDeps()));
        return;
      }
      if (tl === 'vektor') {
        feld.close();
        openApp(createVektor(store, appDeps()));
        return;
      }
      feld.close();
      brainAsk(t, null);
    },
  });

  function finishKeyCapture(k) {
    if (k === 'weg') {
      clearKey();
      showNote('api-key gelöscht — das gehirn schläft');
    } else if (k) {
      setKey(k);
      showNote('api-key gespeichert — das gehirn ist wach');
    }
  }

  const karte = createKarte(store, {
    kamera, registerTask, agentName, taskLines, formText,
    dissolveText: dissolveIds,
    onAction(action, agentId) {
      if (action === 'gruppe') selectGroup(agentId);
      else if (action === 'aufgabe') {
        taskFor = { ids: groupOf(agentId) };
        const r = karte.rect;
        feld.open((r.x0 + r.x1) / 2, r.y1 + 1.4);
      } else if (action === 'aufloesen') {
        const tid = store.taskId[agentId];
        const m = tid > 0 ? taskMeta.get(tid) : null;
        if (m && !m.system) {
          karte.close();
          dissolveTask(tid);
          showNote(`aufgabe „${m.name}" aufgelöst`);
        } else {
          showNote('dieser agent trägt eine system-aufgabe');
        }
      }
    },
  });

  function groupOf(agentId) {
    const tid = store.taskId[agentId];
    if (tid === 0) return [agentId];
    const m = taskMeta.get(tid);
    if (!m || m.system) return [agentId];
    const ids = [];
    const { activeList, activeCount, active, taskId } = store;
    for (let k = 0; k < activeCount; k++) {
      const i = activeList[k];
      if (active[i] === 1 && taskId[i] === tid) ids.push(i);
    }
    return ids;
  }

  // Gruppen-Glühen: Auswahl-Visualisierung ohne Kasten
  let glowIds = [];
  let glowUntil = 0;
  function selectGroup(agentId) {
    glowIds = groupOf(agentId);
    glowUntil = tNow + 3.5;
    if (glowIds.length <= 1) showNote('agent ist frei — keine gruppe');
    else showNote(`${glowIds.length} agenten mit gleicher aufgabe`);
  }

  function dissolveTask(tid) {
    const ids = [];
    const { activeList, activeCount, active, taskId } = store;
    for (let k = 0; k < activeCount; k++) {
      const i = activeList[k];
      if (active[i] === 1 && taskId[i] === tid) ids.push(i);
    }
    dissolveIds(ids);
  }

  // ---- Aufgaben zuteilen (Builtins sofort, Rest ans Gehirn) --------------
  function assignTask(sel, taskText) {
    const t = taskText.trim();
    if (!t || !sel) return;
    const tl = t.toLowerCase();
    const color = COLOR_WORDS[tl];
    if (color) {
      for (const id of sel.ids) {
        if (store.active[id] === 0) continue;
        if (store.state[id] <= STATE.RETURNING) {
          store.state[id] = STATE.IMAGE;
          store.frozen[id] = 0;
          store.targetX[id] = store.posX[id];
          store.targetY[id] = store.posY[id];
        }
        store.tgtR[id] = color[0];
        store.tgtG[id] = color[1];
        store.tgtB[id] = color[2];
      }
      agentTasks.set(sel.ids[0], t + ' ✓');
    } else if (/leucht/i.test(tl)) {
      for (const id of sel.ids) beacons.add(id);
      agentTasks.set(sel.ids[0], 'leuchtfeuer');
    } else if (tl === 'auflösen' || tl === 'aufloesen' || tl === 'frei') {
      for (const id of sel.ids) {
        if (store.carrier[id] === 1 && store.state[id] <= STATE.RETURNING) continue;
        revert(id);
      }
      compactAt = tNow + 1.6;
    } else {
      agentTasks.set(sel.ids[0], t + ' · geplant');
      brainAsk(t, { task: t, count: sel.ids.length });
    }
  }

  // ---- Das GEHIRN --------------------------------------------------------
  let brainBusy = false;
  let brainIds = [];
  let brainRect = null;
  let brainTask = 0;

  function brainAsk(q, context) {
    if (!hasKey()) {
      showNote('kein api-key — tippe „key" ins eingabefeld');
      return;
    }
    if (brainBusy) {
      showNote('das gehirn denkt noch …');
      return;
    }
    brainBusy = true;
    showThinking();
    askBrain(q, context, { w: kamera.viewW, h: kamera.viewH })
      .then((plan) => {
        brainBusy = false;
        clearThinking();
        executeBrainPlan(plan, q);
      })
      .catch((err) => {
        brainBusy = false;
        clearThinking();
        showNote('gehirn: ' + ((err && err.message) || err));
        console.warn('[ludi] gehirn:', err);
      });
  }

  function dissolveBrain() {
    if (brainIds.length > 0) dissolveIds(brainIds);
    brainIds = [];
    brainRect = null;
  }

  // Plan ausführen: Screen-px des Plans → Weltkoordinaten
  function executeBrainPlan(plan, q) {
    dissolveBrain();
    brainTask = registerTask('KI: ' + q.slice(0, 24));
    const toWorld = (px, py) => kamera.screenToWorld(px, py);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    const grow = (x0, y0, x1, y1) => {
      bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0);
      bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1);
    };

    const drawText = (str, pxX, pxY, pxSize, rgb, weight) => {
      const w = toWorld(pxX, pxY);
      const h = (pxSize * 1.5) / kamera.scale;
      const res = formText(str, {
        x: w.x, y: w.y, h, weight, align: 'center',
        color: rgb || CONFIG.colors.text, taskId: brainTask, wave: true,
      });
      for (const id of res.ids) brainIds.push(id);
      grow(w.x - res.w / 2, w.y, w.x + res.w / 2, w.y + h);
    };

    for (const c of plan.commands) {
      switch (c.cmd) {
        case 'heading':
          drawText(c.text, c.x, c.y, c.px || 19, c.color, 600);
          break;
        case 'text':
          drawText(c.text, c.x, c.y, c.px || 12, c.color, 400);
          break;
        case 'panel': {
          if (c.title) drawText(c.title, c.x, c.y - c.h / 2 + 8, 14, c.color, 600);
          let ly = c.y - c.h / 2 + 40;
          for (const line of c.lines) {
            drawText(line, c.x, ly, 12, [200, 205, 209], 400);
            ly += 20;
          }
          break;
        }
        case 'shape': {
          const pts = generateShape(c.kind, c);
          const n = pts.length / 2;
          const rgb = c.color || [110, 231, 255];
          const dot = 2.4 / kamera.scale;
          for (let k = 0; k < n; k++) {
            const w = toWorld(pts[k * 2], pts[k * 2 + 1]);
            const id = allocReserve(store, w.x, w.y);
            if (id < 0) break;
            wakeAgent(store, id, tNow, (k / n) * 1.3, {
              size: dot, shape: CIRCLE, taskId: brainTask,
            });
            store.state[id] = STATE.IMAGE;
            store.tgtR[id] = rgb[0];
            store.tgtG[id] = rgb[1];
            store.tgtB[id] = rgb[2];
            brainIds.push(id);
            grow(w.x - 0.2, w.y - 0.2, w.x + 0.2, w.y + 0.2);
          }
          store.needsRebuild = true;
          break;
        }
        case 'color':
          if (karte.isOpen && c.color) {
            for (const id of groupOf(karte.agent)) {
              store.tgtR[id] = c.color[0];
              store.tgtG[id] = c.color[1];
              store.tgtB[id] = c.color[2];
              if (store.state[id] <= STATE.RETURNING) {
                store.state[id] = STATE.IMAGE;
                store.targetX[id] = store.posX[id];
                store.targetY[id] = store.posY[id];
              }
            }
          }
          break;
        case 'beacon':
          if (karte.isOpen) for (const id of groupOf(karte.agent)) beacons.add(id);
          break;
        case 'dissolve':
          if (karte.isOpen) {
            const ids = groupOf(karte.agent);
            karte.close();
            dissolveIds(ids);
          }
          break;
        case 'morph': {
          const map = { squircle: shapeId('squircle'), kreis: CIRCLE, quadrat: SQUARE };
          if (map[c.shape] !== undefined) {
            setGlobalShape(store, map[c.shape], cursor.active ? { x: cursor.wx, y: cursor.wy } : null);
          }
          break;
        }
      }
    }
    if (plan.say && brainIds.length === 0) showNote(plan.say);
    if (brainIds.length > 0) {
      brainRect = { x0: bx0 - 0.5, y0: by0 - 0.5, x1: bx1 + 0.5, y1: by1 + 0.5 };
    }
  }

  // ---- TUNNEL: Schwarze-Loch-Ordner mit echter Gravitationslinse --------
  // Die Verzerrung liegt im Post-Process der Renderer (store.linse):
  // Punktmassen-Linsengleichung β = θ − θE²/θ um jeden Tunnel, innen der
  // Ereignishorizont, dazu der Ring-Glow. Hier leben Platzierung (Drag),
  // Label + Dreiecks-Marker und die REISE: Kamera-Anflug (Linse zieht an)
  // → Lichtgeschwindigkeits-Fahrt (radiale Aberration + Sternstreifen)
  // → Ankunft als Wasser-Ringwelle in der anderen Dimension.
  const dimHoles = [[], []];
  let dim = 0;
  let reise = null;      // { phase, t0, hole, scale0, cx0, cy0, switched }
  let holeDrag = null;   // { hole, lastX, lastY, movedPx }
  let lenseBoost = 1;    // animierte Linsenstärke
  let reiseRot = 0;      // Sichtrolle während des Durchflugs (0..2π)
  let reiseSmear = 0;    // ruhige radiale Aberration
  let suppressClick = 0;

  function formHoleLabel(hole) {
    const T = CONFIG.tunnel;
    const res = formText(hole.name, {
      x: hole.x, y: hole.y + hole.r * 0.30, h: T.labelH,
      align: 'center', color: [235, 244, 239],
    });
    hole.labelIds = res.ids;
    const tri = allocReserve(store, hole.x, hole.y + hole.r - 0.21);
    if (tri >= 0) {
      wakeAgent(store, tri, tNow, 0.2, {
        size: 0.02, shape: 2, swirl: false, // analytisches Dreieck
        px: hole.x, py: hole.y + hole.r - 0.21,
      });
      store.state[tri] = STATE.TEXT;
      store.sizeTgt[tri] = 0.4;
      store.tgtR[tri] = 235;
      store.tgtG[tri] = 244;
      store.tgtB[tri] = 239;
      hole.triId = tri;
      store.needsRebuild = true;
    }
  }

  function clearHoleLabel(hole) {
    if (hole.labelIds) dissolveIds(hole.labelIds);
    if (hole.triId >= 0) revert(hole.triId);
    hole.labelIds = null;
    hole.triId = -1;
  }

  function moveHole(hole, dx, dy) {
    hole.x += dx;
    hole.y += dy;
    const ids = [...(hole.labelIds || [])];
    if (hole.triId >= 0) ids.push(hole.triId);
    for (const id of ids) {
      if (store.active[id] === 0) continue;
      store.homeX[id] += dx;
      store.homeY[id] += dy;
      store.targetX[id] += dx;
      store.targetY[id] += dy;
      store.posX[id] += dx;
      store.posY[id] += dy;
    }
  }

  function createTunnel(x, y, name) {
    const hole = {
      x, y, r: CONFIG.tunnel.r, name: name || 'tunnel',
      labelIds: null, triId: -1,
    };
    dimHoles[dim].push(hole);
    formHoleLabel(hole);
    showNote('tunnel entsteht — drag verschiebt ihn, klick reist hindurch');
  }

  function holeAt(wx, wy) {
    for (const h of dimHoles[dim]) {
      const dx = wx - h.x, dy = wy - h.y;
      if (dx * dx + dy * dy < (h.r * 1.15) ** 2) return h;
    }
    return null;
  }

  // Drag verschiebt den Tunnel, ein ruhiger Klick reist hindurch
  function holePointerDown(wx, wy) {
    if (activeApp || reise || feld.isOpen || karte.isOpen) return false;
    const hole = holeAt(wx, wy);
    if (!hole) return false;
    holeDrag = { hole, lastX: wx, lastY: wy, movedPx: 0 };
    return true;
  }

  function holePointerDrag(wx, wy) {
    if (!holeDrag) return false;
    const dx = wx - holeDrag.lastX, dy = wy - holeDrag.lastY;
    holeDrag.movedPx += Math.hypot(dx, dy) * kamera.scale;
    moveHole(holeDrag.hole, dx, dy);
    holeDrag.lastX = wx;
    holeDrag.lastY = wy;
    return true;
  }

  function holePointerUp() {
    if (!holeDrag) return;
    const { hole, movedPx } = holeDrag;
    holeDrag = null;
    suppressClick = tNow + 0.3;
    if (movedPx < CONFIG.tunnel.dragMin) startReise(hole);
  }

  function startReise(hole) {
    if (reise) return;
    clearHoleLabel(hole);
    reise = {
      phase: 'anflug', t0: tNow, hole, switched: false,
      scale0: kamera.scale, cx0: kamera.cx, cy0: kamera.cy,
    };
  }

  function dimensionsWechsel(hole) {
    const T = CONFIG.tunnel;
    dim = 1 - dim;
    if (!dimHoles[dim].some((h) => Math.hypot(h.x - hole.x, h.y - hole.y) < 1)) {
      dimHoles[dim].push({
        x: hole.x, y: hole.y, r: T.r,
        name: dim === 1 ? 'zurück' : hole.name,
        labelIds: null, triId: -1,
      });
    }
    store.baseTint = [...T.dims[dim].tint];
    CONFIG.wellen.omega = T.dims[dim].omega;
    // Ankunft als WASSERWELLE: jeder Agent erwacht an seinem Platz, wenn
    // ihn der Ring vom Loch aus erreicht — wie ein Stein im Wasser
    for (const i of store.carrierList) {
      if (store.state[i] > STATE.RETURNING) continue;
      const dx = store.homeX[i] - hole.x, dy = store.homeY[i] - hole.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      store.active[i] = 1;
      store.posX[i] = store.homeX[i] - (dx / d) * 0.55;
      store.posY[i] = store.homeY[i] - (dy / d) * 0.55;
      store.velX[i] = 0;
      store.velY[i] = 0;
      store.size[i] = 0.02;
      store.state[i] = STATE.RETURNING;
      store.frozen[i] = 0;
      store.activateAt[i] = tNow + 0.15 + d / T.welleSpeed;
      store.tgtR[i] = store.baseTint[0];
      store.tgtG[i] = store.baseTint[1];
      store.tgtB[i] = store.baseTint[2];
      store.brightness[i] = 0;
    }
    store.needsRebuild = true;
    // Kamera zentriert überm Ausgangs-Loch der neuen Dimension
    kamera.setView(hole.x, hole.y, reise.scale0);
    kamera.snapClamped(reise.scale0);
    showNote(dim === 1 ? 'neue dimension — der tunnel führt zurück' : 'wieder zuhause');
  }

  function reiseUpdate(t) {
    if (!reise) return;
    const T = CONFIG.tunnel;
    const H = reise.hole;
    const glatt = (p) => p * p * (3 - 2 * p);
    if (reise.phase === 'anflug') {
      // Anflug: ein RUHIGER Kameraflug aufs Loch, die Krümmung zieht an
      const p = Math.min(1, (t - reise.t0) / T.anflugSec);
      const e = glatt(p);
      kamera.setView(
        reise.cx0 + (H.x - reise.cx0) * e,
        reise.cy0 + (H.y - reise.cy0) * e,
        reise.scale0 * (1 + 0.65 * e * e),
      );
      lenseBoost = 1 + (T.anflugLense - 1) * e;
      if (p >= 1) {
        reise.phase = 'durch';
        reise.t0 = t;
        reise.scaleIn = kamera.scale;
      }
    } else if (reise.phase === 'durch') {
      // DURCHFLUG: der Schwarm ist als Wurmloch nach innen gestülpt —
      // die Linse wächst, bis ihre Mündung den ganzen Schirm füllt
      // (innen sind keine Agenten), die Sicht rollt dabei um 180°.
      const p = Math.min(1, (t - reise.t0) / T.durchSec);
      const e = glatt(p);
      reiseRot = Math.PI * e;
      reiseSmear = Math.sin(Math.PI * p) * 0.9;
      // θE wächst vom Loch-Radius bis über die halbe Bilddiagonale
      const voll = Math.hypot(kamera.viewW, kamera.viewH) * 0.62;
      const start = H.r * reise.scaleIn * T.anflugLense;
      reise.thetaOverride = start + (voll - start) * e;
      kamera.setView(H.x, H.y, reise.scaleIn * (1 + 0.35 * e));
      if (!reise.switched && p >= 0.92) {
        // hinter der gefüllten Mündung wechselt still die Dimension
        reise.switched = true;
        dimensionsWechsel(H);
      }
      if (p >= 1) {
        reise.phase = 'oeffnen';
        reise.t0 = t;
      }
    } else if (reise.phase === 'oeffnen') {
      // ANDERE SEITE: das Wurmloch öffnet sich — die Mündung zieht sich
      // auf den Rückweg-Tunnel zusammen, die Rolle vollendet 360°,
      // man blickt auf den noch gekrümmten Raum, der sich entspannt
      const p = Math.min(1, (t - reise.t0) / T.oeffnenSec);
      const e = glatt(p);
      reiseRot = Math.PI * (1 + e);
      reiseSmear = (1 - e) * 0.5;
      // Kamera gleitet auf die Normalansicht zurück, die Mündung zieht
      // sich auf den Rückweg-Tunnel zusammen
      const scaleDurch = reise.scaleIn * 1.35;
      kamera.setView(H.x, H.y, scaleDurch + (reise.scale0 - scaleDurch) * e);
      const voll = Math.hypot(kamera.viewW, kamera.viewH) * 0.62;
      const ziel = H.r * reise.scale0;
      reise.thetaOverride = voll + (ziel - voll) * e;
      lenseBoost = 1;
      if (p >= 1) {
        kamera.snapClamped(reise.scale0);
        reiseRot = 0;
        reiseSmear = 0;
        reise.thetaOverride = 0;
        reise.phase = 'welle';
        reise.t0 = t;
      }
    } else if (t > reise.t0 + T.welleSec) {
      lenseBoost = 1;
      reise = null;
      for (const h of dimHoles[dim]) {
        if (!h.labelIds) formHoleLabel(h);
      }
    } else {
      lenseBoost = Math.max(1, lenseBoost - (t - reise.t0) * 0.5);
    }
  }

  // Post-Process-Uniforms: Löcher in Screen-px + Fahrt-Zustand
  function linseUpdate(t) {
    const L = store.linse;
    L.holes.length = 0;
    const sichtbar = activeApp ? [] : (reise ? [reise.hole] : dimHoles[dim]);
    for (const h of sichtbar) {
      const sp = kamera.worldToScreen(h.x, h.y);
      const theta = reise && reise.thetaOverride
        ? reise.thetaOverride
        : h.r * kamera.scale * lenseBoost;
      L.holes.push({ sx: sp.x, sy: sp.y, thetaE: theta });
    }
    L.rot = reiseRot;
    L.smear = reiseSmear;
    L.tcx = kamera.viewW / 2;
    L.tcy = kamera.viewH / 2;
    L.zeit = t;
  }

  // ---- Apps (der Schwarm morpht zum Screen) ------------------------------
  let activeApp = null;
  const appDeps = () => ({
    kamera, registerTask, revert, logo, showNote,
    cursorRef: () => cursor,
    openPromptFeld(hint, cb) {
      promptFor = cb;
      const halfH = kamera.viewH / 2 / kamera.scale;
      feld.open(kamera.cx, kamera.cy + halfH - 2.4);
      showNote(hint);
    },
  });

  function openApp(app) {
    if (activeApp) closeApp();
    if (karte.isOpen) karte.close();
    activeApp = app;
    app.open(tNow);
  }
  function closeApp() {
    if (!activeApp) return;
    activeApp.close(tNow);
    activeApp = null;
    compactAt = tNow + 1.8;
  }

  // ---- Events ------------------------------------------------------------
  // Erste Aktion auf dem Landing-Screen: LUDI fügt sich dem Gitter —
  // außer man klickt einen der Buchstaben selbst an
  function notifyAction() {
    logo.dissolveToGrid();
  }

  function onClick(sx, sy) {
    const w = kamera.screenToWorld(sx, sy);
    const hovNow = auswahl.hovered;
    if (!(hovNow >= 0 && logo.isLogo(hovNow))) notifyAction();
    if (feld.isOpen && activeApp) {
      if (!feld.near(w.x, w.y)) {
        promptFor = null;
        feld.close();
      }
      return;
    }
    if (activeApp) {
      if (activeApp.onClick(w.x, w.y) === 'close') closeApp();
      return;
    }
    if (feld.isOpen) {
      if (!feld.near(w.x, w.y)) {
        taskFor = null;
        feld.close();
      }
      return;
    }
    if (karte.isOpen) {
      if (!karte.hit(w.x, w.y)) karte.close();
      return;
    }
    if (brainIds.length > 0) {
      dissolveBrain();
      return;
    }
    if (tNow < suppressClick || holeAt(w.x, w.y)) return;
    const hovered = auswahl.hovered;
    if (hovered >= 0) {
      if (logo.isClaw(hovered)) { // Rex ist immer erreichbar
        const c = logo.clawCenter();
        feld.open(c.x - 2.2, c.y + 2.2);
        showNote('rex hört zu — aufgabe eintippen und enter');
        return;
      }
      karte.open(hovered, tNow);
      return;
    }
    feld.open(w.x, w.y);
  }

  function onKey(e) {
    notifyAction();
    if (feld.isOpen) { // Prompt-Feld einer App hat Vorrang
      if (e.key === 'Escape') { taskFor = null; promptFor = null; }
      return feld.onKey(e);
    }
    if (activeApp) {
      // die App zuerst (z. B. Transform-Abbruch im 3D-Editor) — erst wenn
      // sie Escape nicht verbraucht, schließt die App
      if (activeApp.onKey && activeApp.onKey(e)) return true;
      if (e.key === 'Escape') { closeApp(); return true; }
      return false;
    }
    if (e.key === 'Escape') {
      if (karte.isOpen) { karte.close(); return true; }
      if (brainIds.length > 0) { dissolveBrain(); return true; }
      if (glowIds.length > 0) { glowIds = []; return true; }
      return false;
    }
    if (e.key === 'Enter' && karte.isOpen) {
      taskFor = { ids: groupOf(karte.agent) };
      const r = karte.rect;
      feld.open((r.x0 + r.x1) / 2, r.y1 + 1.4);
      return true;
    }
    if (e.key === 'p' || e.key === 'P') {
      cursor.polarity *= -1;
      return true;
    }
    if (e.key === '1') { setGlobalShape(store, shapeId('squircle'), { x: cursor.wx, y: cursor.wy }); return true; }
    if (e.key === '2') { setGlobalShape(store, CIRCLE, { x: cursor.wx, y: cursor.wy }); return true; }
    if (e.key === '3') { setGlobalShape(store, SQUARE, { x: cursor.wx, y: cursor.wy }); return true; }
    return false;
  }

  // ---- pro Frame NACH swarm.postStep ------------------------------------
  function update(t) {
    const dt = Math.min(0.05, Math.max(0.001, t - lastT));
    lastT = t;
    tNow = t;

    cursor.wx = (cursor.sx - kamera.viewW / 2) / kamera.scale + kamera.cx;
    cursor.wy = (cursor.sy - kamera.viewH / 2) / kamera.scale + kamera.cy;

    store.extraLines.length = 0; // freie Linien werden pro Frame neu gemeldet

    if (store.needsRebuild) {
      rebuildActiveList(store);
      store.needsRebuild = false;
    }
    if (compactAt > 0 && t > compactAt) {
      rebuildActiveList(store);
      compactAt = 0;
    }

    if (!booted && t > CONFIG.boot.staggerSec + 0.9) booted = true;
    if (booted) logo.update(t);

    auswahl.update(dt, cursor, !feld.isOpen && !activeApp);
    // der dem Cursor nächste GITTER-Agent wird angezogen statt abgestoßen
    const hov = auswahl.hovered;
    cursor.attractId = hov >= 0 && store.state[hov] <= STATE.RETURNING ? hov : -1;
    feld.update(t);
    karte.update(t);
    if (activeApp) activeApp.update(t, cursor);
    reiseUpdate(t);
    linseUpdate(t);

    if (thinkIds.length > 0) {
      const b = 0.5 + 0.5 * Math.sin(t * 4);
      for (const id of thinkIds) if (store.active[id] === 1) store.brightness[id] = b;
    }
    if (noteUntil > 0 && t > noteUntil) {
      dissolveIds(noteIds);
      noteIds = [];
      noteUntil = 0;
    }

    if (glowIds.length > 0) {
      if (t > glowUntil) {
        glowIds = [];
      } else {
        const pulse = 0.75 + 0.25 * Math.sin(t * 4);
        for (const id of glowIds) {
          if (store.active[id] === 1) store.brightness[id] = Math.max(store.brightness[id], pulse);
        }
      }
    }

    for (const id of beacons) {
      if (store.active[id] === 0) continue;
      store.brightness[id] = 0.7 + 0.3 * Math.sin(t * 3 + (id % 7));
      store.colR[id] = CONFIG.colors.tuerkis[0];
      store.colG[id] = CONFIG.colors.tuerkis[1];
      store.colB[id] = CONFIG.colors.tuerkis[2];
    }
  }

  return {
    cursor,
    get mode() {
      if (activeApp) return activeApp.name.toUpperCase();
      if (feld.isOpen) return 'FELD';
      if (karte.isOpen) return 'KARTE';
      if (brainBusy) return 'DENKT';
      return 'FREI';
    },
    get zoomLocked() { return !!activeApp || feld.isOpen || karte.isOpen || !!reise; },
    onSwipe(dx, dy) {
      if (activeApp && activeApp.onSwipe) activeApp.onSwipe(dx, dy);
    },
    onPointerDown(sx, sy) {
      if (feld.isOpen) return false; // Prompt-Eingabe: nicht malen/zeichnen
      const w = kamera.screenToWorld(sx, sy);
      if (holePointerDown(w.x, w.y)) return true;
      if (!activeApp || !activeApp.onPointerDown) return false;
      return activeApp.onPointerDown(w.x, w.y);
    },
    onPointerDrag(sx, sy) {
      const w = kamera.screenToWorld(sx, sy);
      if (holePointerDrag(w.x, w.y)) return;
      if (!activeApp || !activeApp.onPointerDrag) return;
      activeApp.onPointerDrag(w.x, w.y);
    },
    onPointerUp() {
      holePointerUp();
      if (activeApp && activeApp.onPointerUp) activeApp.onPointerUp();
    },
    get text() { return feld.text; },
    get hovered() { return auswahl.hovered; },
    get warpRects() {
      const rects = [];
      if (feld.rect) rects.push(feld.rect);
      if (karte.rect) rects.push(karte.rect);
      if (activeApp && activeApp.warpRect) {
        const r = activeApp.warpRect(tNow);
        if (r) rects.push(r);
      }
      return rects.length > 0 ? rects : null;
    },
    get anchors() {
      const a = logo.anchor();
      return a ? [a] : null;
    },
    get veil() {
      if (karte.rect) return karte.rect;
      if (brainRect) return brainRect;
      return null;
    },
    get holes() { return activeApp ? null : (reise ? [reise.hole] : dimHoles[dim]); },
    get dim() { return dim; },
    get brainBusy() { return brainBusy; },
    agentName, taskLines,
    notifyAction,
    onPointerMove(sx, sy) {
      cursor.sx = sx; cursor.sy = sy;
      const w = kamera.screenToWorld(sx, sy);
      cursor.wx = w.x; cursor.wy = w.y;
      cursor.active = true;
    },
    onPointerLeave() { cursor.active = false; },
    onClick,
    onKey,
    onWheel(deltaY) { // Apps fangen das Rad (3D: Dolly); sonst Zoom
      if (!activeApp) return false;
      if (activeApp.onWheel) activeApp.onWheel(deltaY);
      return true;
    },
    onPaste: (t) => feld.onPaste(t),
    update,
    brainAsk,
    executeBrainPlan, // Test-Hook: Plan ohne API ausführen
    showNote,
    formText,
    dissolveIds,
  };
}
