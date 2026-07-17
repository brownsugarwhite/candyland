// Die AGENTENKARTE (Referenz 04): der angeklickte Agent wächst an Ort und
// Stelle zur türkisen Augen-Kachel; daneben erscheinen Name und Aufgaben
// als Feinraster-Poppins-Agenten, darunter drei lila Schnellaktionen —
// selbst Schwarmagenten in den Lücken des Gitters. Das Umfeld weicht über
// den Feld-Warp aus und beruhigt sich unter dem Schleier.
import { CONFIG } from './config.js';
import { STATE, setAgentShape, baseSize } from './swarm.js';
import { shapeId } from './formen.js';
import { nearestGap } from './gitter.js';

const ACTIONS = [
  { key: 'gruppe', label: 'gruppe wählen' },
  { key: 'aufgabe', label: 'neue aufgabe' },
  { key: 'aufloesen', label: 'auflösen' },
];

export function createKarte(store, deps) {
  // deps: { kamera, registerTask, agentName, taskLines, formText, dissolveText, onAction }
  const K = CONFIG.karte;
  const TK = CONFIG.colors.tuerkis;
  const LI = CONFIG.colors.lila;
  const g = store.gitter;
  const taskKarte = deps.registerTask('agentenkarte', true);

  let agent = -1;
  let orig = null;      // { shape, size }
  let textIds = [];
  let buttons = [];     // { id, action }
  let rect = null;      // Welt-Rect für Warp/Veil

  function open(id, tNow) {
    if (agent >= 0) close();
    agent = id;
    orig = { shape: store.shapeB[id], size: baseSize(store, id) };

    const hx = store.homeX[id], hy = store.homeY[id];
    // Screen-px → Welt: die Karte ist auf jeder Zoomstufe gleich groß
    const kam = deps.kamera;
    const u = 1 / kam.scale;
    const viewR = kam.cx + kam.viewW / 2 / kam.scale;
    const flip = hx + 460 * u > viewR ? -1 : 1;

    // Identität + Aufgaben VOR dem Morph erfassen (Zustand des Agenten)
    const name = deps.agentName(id);
    const tasks = deps.taskLines(id).join('  •  ');

    store.state[id] = STATE.TEXT;
    store.frozen[id] = 0;
    store.taskId[id] = store.taskId[id] || 0; // Aufgabe des Agenten bleibt
    store.hover[id] = 0;
    store.targetX[id] = hx;
    store.targetY[id] = hy;
    store.sizeTgt[id] = K.tileSizePx * u;
    store.tgtR[id] = TK[0];
    store.tgtG[id] = TK[1];
    store.tgtB[id] = TK[2];
    setAgentShape(store, id, shapeId('augenTile'));

    // Name + Aufgaben (Feinraster-Poppins aus Reserve-Agenten)
    const nameX = flip > 0 ? hx + K.nameDxPx * u : hx - K.nameDxPx * u;
    const nm = deps.formText(name, {
      x: nameX, y: hy + (K.nameDyPx - K.nameHPx / 2) * u,
      h: K.nameHPx * u, weight: 400, align: flip > 0 ? 'left' : 'right',
      taskId: taskKarte,
    });
    const ts = deps.formText(tasks, {
      x: nameX, y: hy + (K.tasksDyPx - K.tasksHPx / 2) * u,
      h: K.tasksHPx * u, weight: 400, align: flip > 0 ? 'left' : 'right',
      taskId: taskKarte,
    });
    textIds = [...nm.ids, ...ts.ids];

    // Drei lila Schnellaktionen in den Gitterlücken darunter
    buttons = [];
    const used = new Set([id]);
    for (let j = 0; j < ACTIONS.length; j++) {
      const wx = hx + flip * (30 + j * 118) * u;
      const wy = hy + K.buttonDyPx * u;
      let bId = nearestGap(g, wx, wy);
      if (bId < 0 || used.has(bId) || store.state[bId] > STATE.RETURNING) {
        bId = nearestGap(g, wx + flip, wy + 1);
      }
      if (bId < 0 || used.has(bId)) continue;
      used.add(bId);
      if (store.active[bId] === 0) {
        // Lücken-Agent schläft → weckt sich klein an Ort und Stelle
        store.posX[bId] = store.homeX[bId];
        store.posY[bId] = store.homeY[bId];
        store.velX[bId] = 0;
        store.velY[bId] = 0;
        store.active[bId] = 1;
        store.size[bId] = 0.02;
        store.phase[bId] = bId & 255;
        store.needsRebuild = true;
      }
      store.state[bId] = STATE.TEXT;
      store.frozen[bId] = 0;
      store.taskId[bId] = taskKarte;
      store.activateAt[bId] = tNow + 0.12 + j * 0.09;
      store.targetX[bId] = wx;
      store.targetY[bId] = wy;
      store.sizeTgt[bId] = K.buttonSizePx * u;
      store.brightness[bId] = 0;
      store.tgtR[bId] = LI[0];
      store.tgtG[bId] = LI[1];
      store.tgtB[bId] = LI[2];
      setAgentShape(store, bId, shapeId('squircle'));
      buttons.push({ id: bId, action: ACTIONS[j].key, label: ACTIONS[j].label });
    }

    const w = Math.max(nm.w, ts.w);
    const spanned = Math.max(K.nameDxPx * u + w, 380 * u) + 40 * u;
    rect = flip > 0
      ? { x0: hx - 70 * u, y0: hy - 74 * u, x1: hx + spanned, y1: hy + (K.buttonDyPx + 74) * u }
      : { x0: hx - spanned, y0: hy - 74 * u, x1: hx + 70 * u, y1: hy + (K.buttonDyPx + 74) * u };
  }

  function close() {
    if (agent < 0) return;
    const id = agent;
    store.state[id] = STATE.RETURNING;
    store.targetX[id] = store.homeX[id];
    store.targetY[id] = store.homeY[id];
    store.sizeTgt[id] = orig.size;
    const AG = CONFIG.colors.agent;
    store.tgtR[id] = AG[0];
    store.tgtG[id] = AG[1];
    store.tgtB[id] = AG[2];
    setAgentShape(store, id, orig.shape);

    deps.dissolveText(textIds);
    textIds = [];
    for (const b of buttons) {
      store.state[b.id] = STATE.RETURNING;
      store.taskId[b.id] = 0;
      store.targetX[b.id] = store.homeX[b.id];
      store.targetY[b.id] = store.homeY[b.id];
      store.sizeTgt[b.id] = 0; // Lücken-Agent versinkt wieder
      setAgentShape(store, b.id, shapeId('squircle'));
    }
    buttons = [];
    agent = -1;
    orig = null;
    rect = null;
  }

  return {
    open, close,
    get agent() { return agent; },
    get isOpen() { return agent >= 0; },
    get rect() { return rect; },

    // Klick innerhalb der Karte? → Aktion oder „bleibt offen"; sonst false
    hit(wx, wy) {
      if (agent < 0) return false;
      for (const b of buttons) {
        const dx = store.posX[b.id] - wx, dy = store.posY[b.id] - wy;
        if (dx * dx + dy * dy < 0.45) {
          deps.onAction(b.action, agent);
          return true;
        }
      }
      const u2 = 1 / deps.kamera.scale;
      const dx = store.posX[agent] - wx, dy = store.posY[agent] - wy;
      if (dx * dx + dy * dy < (K.tileSizePx * 0.62 * u2) ** 2) return true;
      if (rect && wx > rect.x0 && wx < rect.x1 && wy > rect.y0 && wy < rect.y1) return true;
      return false;
    },

    update(t) {
      if (agent < 0) return;
      const pulse = 1 + 0.025 * Math.sin(t * 2.1);
      store.sizeTgt[agent] = (K.tileSizePx / deps.kamera.scale) * pulse;
    },
  };
}
