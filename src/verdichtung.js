// VERDICHTUNG — eine Kernfunktion des Schwarms: Agenten verdichten
// sich in einem beliebigen Abschnitt, unabhängig von der Zoomstufe,
// bis zur kleinstmöglichen Auflösung von 1×1 px — eine geschlossene
// Fläche ohne Zwischenräume (Agenten dann quadratisch, lückenlos).
// Die Fläche formt sich von AUSSEN nach INNEN, und die Agenten fliegen
// nicht irgendwoher: sie FLIESSEN von außen über den nächstgelegenen
// Rand ein — wie Sand in einer Sanduhr, der von außen zum Loch strömt.
// Gitteragenten unter der Fläche machen mit und kehren beim Auflösen
// exakt an ihre Plätze zurück (homeX/homeY bleiben unangetastet).
// Test-UI: ctrl + linke Maustaste zieht das Rechteck; Esc löst auf.
import { CONFIG } from './config.js';
import { STATE, wakeAgent, allocReserve, SQUARE } from './swarm.js';

export function createVerdichtung(store, deps) {
  const { kamera, registerTask, revert, dissolveIds } = deps;
  let drag = null;     // { x0, y0, x1, y1 } Welt — Rechteck-Vorschau
  let ids = [];        // Reserve-Agenten der Fläche
  let carriers = [];   // rekrutierte Gitteragenten
  let taskId = 0;

  const norm = (d) => ({
    x0: Math.min(d.x0, d.x1), x1: Math.max(d.x0, d.x1),
    y0: Math.min(d.y0, d.y1), y1: Math.max(d.y0, d.y1),
  });

  function down(wx, wy) {
    drag = { x0: wx, y0: wy, x1: wx, y1: wy };
    return true;
  }

  function move(wx, wy) {
    if (!drag) return false;
    drag.x1 = wx;
    drag.y1 = wy;
    return true;
  }

  function up(tNow) {
    if (!drag) return false;
    const r = norm(drag);
    drag = null;
    if ((r.x1 - r.x0) * kamera.scale > 10 && (r.y1 - r.y0) * kamera.scale > 10) {
      starte(r, tNow);
    }
    return true;
  }

  // Sanduhr-Einfluss: Startposition außerhalb des Rechtecks, über den
  // dem Ziel nächstgelegenen Rand hinaus (mit organischer Streuung)
  function randStart(r, wx, wy) {
    const dl = wx - r.x0, dr = r.x1 - wx, dt = wy - r.y0, db = r.y1 - wy;
    const m = Math.min(dl, dr, dt, db);
    const aus = 0.5 + Math.random() * 1.8;
    const streu = (Math.random() - 0.5) * 1.6;
    if (m === dl) return [r.x0 - aus, wy + streu];
    if (m === dr) return [r.x1 + aus, wy + streu];
    if (m === dt) return [wx + streu, r.y0 - aus];
    return [wx + streu, r.y1 + aus];
  }

  function starte(r, tNow) {
    aufloesen();
    if (!taskId) taskId = registerTask('verdichtung: fläche', true);
    const V = CONFIG.verdichtung;
    const AG = store.baseTint;
    // 1×1 px ohne Zwischenräume — unabhängig von der Zoomstufe; bei
    // riesigen Flächen wächst der Pitch, bis das Budget reicht
    let pitch = 1 / kamera.scale;
    let cols = Math.max(2, Math.round((r.x1 - r.x0) / pitch));
    let rows = Math.max(2, Math.round((r.y1 - r.y0) / pitch));
    while (cols * rows > V.maxAgenten) {
      pitch *= 1.3;
      cols = Math.max(2, Math.round((r.x1 - r.x0) / pitch));
      rows = Math.max(2, Math.round((r.y1 - r.y0) / pitch));
    }
    const size = pitch * 1.55; // Überlappung — sonst frisst AA die Deckung

    // Gitteragenten unter der Fläche machen mit (äußerste Schicht zuerst)
    const unter = [];
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const hx = store.homeX[i], hy = store.homeY[i];
      if (hx > r.x0 && hx < r.x1 && hy > r.y0 && hy < r.y1) unter.push(i);
    }
    let uIdx = 0;

    const maxRand = Math.max(1, Math.min(cols, rows) / 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = r.x0 + (col + 0.5) * pitch;
        const wy = r.y0 + (row + 0.5) * pitch;
        // von außen nach innen: äußere Schichten der Fläche zuerst
        const dRand = Math.min(col, row, cols - 1 - col, rows - 1 - row);
        const delay = (dRand / maxRand) * V.fliessSec + Math.random() * 0.05;
        if (uIdx < unter.length) {
          const id = unter[uIdx++];
          store.state[id] = STATE.IMAGE;
          store.taskId[id] = taskId;
          store.frozen[id] = 0;
          store.targetX[id] = wx; // home bleibt unangetastet!
          store.targetY[id] = wy;
          store.sizeTgt[id] = size;
          store.activateAt[id] = tNow + delay;
          carriers.push(id);
        } else {
          const id = allocReserve(store, wx, wy);
          if (id < 0) break;
          const [sx, sy] = randStart(r, wx, wy);
          wakeAgent(store, id, tNow, delay, {
            size: 0.02, shape: SQUARE, taskId, swirl: true, px: sx, py: sy,
          });
          store.state[id] = STATE.IMAGE; // friert nach Ankunft ein
          store.sizeTgt[id] = size;
          store.tgtR[id] = AG[0];
          store.tgtG[id] = AG[1];
          store.tgtB[id] = AG[2];
          ids.push(id);
        }
      }
    }
    store.needsRebuild = true;
  }

  function aufloesen() {
    if (ids.length === 0 && carriers.length === 0) return false;
    dissolveIds(ids);
    for (const id of carriers) revert(id);
    ids = [];
    carriers = [];
    return true;
  }

  // Vorschau-Rahmen während des Ziehens (feine Linie)
  function vorschau() {
    if (!drag) return;
    const r = norm(drag);
    const E = store.extraLines;
    const c = [0.65, 0.9, 0.85, 0.5];
    E.push(r.x0, r.y0, r.x1, r.y0, ...c);
    E.push(r.x1, r.y0, r.x1, r.y1, ...c);
    E.push(r.x1, r.y1, r.x0, r.y1, ...c);
    E.push(r.x0, r.y1, r.x0, r.y0, ...c);
  }

  return {
    down, move, up, aufloesen, vorschau,
    get isDragging() { return drag !== null; },
    get aktiv() { return ids.length > 0 || carriers.length > 0; },
  };
}
