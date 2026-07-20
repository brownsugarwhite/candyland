// VERDICHTUNG — eine Kernfunktion des Schwarms: Agenten verdichten
// sich in einem beliebigen Abschnitt, unabhängig von der Zoomstufe,
// bis zur kleinstmöglichen Auflösung von 1×1 px — eine geschlossene
// Fläche ohne Zwischenräume (Agenten dann quadratisch, lückenlos).
// Die Fläche formt sich von der MITTE nach außen, und der GANZE
// Schwarm ist betroffen: die nötigen Agenten verdichten sich (aus dem
// Umfeld rekrutiert), und der Sog der Verdichtung zieht alle übrigen
// Agenten kreisförmig näher ans Feld (Zonen-Warp in swarm.postStep),
// wobei sie zum Feld hin organisch kleiner werden — die entstandene
// Fläche wirkt perfekt aus dem Schwarm gemorpht. Gitteragenten kehren
// beim Auflösen exakt an ihre Plätze zurück (homeX/homeY tabu).
// Test-UI: ctrl + linke Maustaste zieht das Rechteck; Esc löst auf.
import { CONFIG } from './config.js';
import { STATE, wakeAgent, allocReserve, SQUARE } from './swarm.js';

export function createVerdichtung(store, deps) {
  const { kamera, registerTask, revert, dissolveIds } = deps;
  let drag = null;     // { x0, y0, x1, y1 } Welt — Rechteck-Vorschau
  let ids = [];        // Reserve-Agenten der Fläche
  let carriers = [];   // rekrutierte Gitteragenten
  let zone = null;     // Sog-Feld { x0..y1, born, ende } für den Schwarm
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

  // Einfluss aus dem Schwarm: Startposition außerhalb des Rechtecks,
  // radial hinter dem Ziel (vom Zentrum aus gesehen) — die Agenten
  // strömen aus dem umliegenden Schwarm kreisförmig herein
  function randStart(r, wx, wy) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    let dx = wx - cx, dy = wy - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a); dy = Math.sin(a);
    } else {
      dx /= len; dy /= len;
    }
    const hw = Math.max(1e-3, (r.x1 - r.x0) / 2);
    const hh = Math.max(1e-3, (r.y1 - r.y0) / 2);
    const s = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-4);
    const aus = 0.4 + Math.random() * 2.4;
    const jit = (Math.random() - 0.5) * 1.1;
    return [
      cx + dx / s + dx * aus - dy * jit,
      cy + dy / s + dy * aus + dx * jit,
    ];
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

    // das Sog-Feld: der ganze Schwarm rückt kreisförmig näher
    zone = { ...r, born: tNow, ende: 0 };

    // Gitteragenten in und UM die Fläche machen mit — jeder übernimmt
    // das Pixel, das seinem Platz am nächsten liegt (kurze, organische
    // Wege; die Lücke drumherum schließt der Sog)
    const marge = V.marge;
    const belegt = new Set();
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const hx = store.homeX[i], hy = store.homeY[i];
      if (hx < r.x0 - marge || hx > r.x1 + marge ||
          hy < r.y0 - marge || hy > r.y1 + marge) continue;
      let col = Math.max(0, Math.min(cols - 1, Math.floor((hx - r.x0) / pitch)));
      let row = Math.max(0, Math.min(rows - 1, Math.floor((hy - r.y0) / pitch)));
      let idx = row * cols + col;
      while (belegt.has(idx)) idx = (idx + 1) % (cols * rows); // frei suchen
      belegt.add(idx);
      carriers.push({ id: i, idx });
    }

    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const maxD = Math.hypot((r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2) || 1e-3;
    const ziel = (idx) => {
      const col = idx % cols, row = (idx / cols) | 0;
      const wx = r.x0 + (col + 0.5) * pitch;
      const wy = r.y0 + (row + 0.5) * pitch;
      // die Fläche formt sich von der MITTE nach außen
      const delay = (Math.hypot(wx - cx, wy - cy) / maxD) * V.fliessSec +
        Math.random() * 0.05;
      return { wx, wy, delay };
    };

    // Die Kacheln unter dem Rechteck sind der ANFANG der Animation:
    // sie skalieren SOFORT auf 1px und rücken auf ihr Pixel — kein
    // Warten, kein Dimmen, kein Verschwinden
    for (const c of carriers) {
      const z = ziel(c.idx);
      store.state[c.id] = STATE.IMAGE;
      store.taskId[c.id] = taskId;
      store.frozen[c.id] = 0;
      store.targetX[c.id] = z.wx; // home bleibt unangetastet!
      store.targetY[c.id] = z.wy;
      store.sizeTgt[c.id] = size;
      store.activateAt[c.id] = tNow;
    }
    // … erst danach breitet sich die Verdichtung aus: die restlichen
    // Pixel füllen sich von der Mitte nach außen aus dem Schwarm
    for (let idx = 0; idx < cols * rows; idx++) {
      if (belegt.has(idx)) continue;
      const id = allocReserve(store, cx, cy);
      if (id < 0) break;
      const z = ziel(idx);
      const [sx, sy] = randStart(r, z.wx, z.wy);
      wakeAgent(store, id, tNow, V.startPause + z.delay, {
        size: 0.02, shape: SQUARE, taskId, swirl: true, px: sx, py: sy,
      });
      store.state[id] = STATE.IMAGE; // friert nach Ankunft ein
      store.targetX[id] = z.wx;
      store.targetY[id] = z.wy;
      store.sizeTgt[id] = size;
      store.tgtR[id] = AG[0];
      store.tgtG[id] = AG[1];
      store.tgtB[id] = AG[2];
      ids.push(id);
    }
    store.needsRebuild = true;
  }

  function aufloesen(tNow = 0) {
    if (ids.length === 0 && carriers.length === 0) return false;
    dissolveIds(ids);
    for (const c of carriers) revert(c.id);
    ids = [];
    carriers = [];
    if (zone) zone.ende = tNow || zone.born; // Sog ebbt weich ab
    return true;
  }

  // das aktive Sog-Feld für den Physik-Warp (swarm.postStep env.zonen):
  // wächst weich ein und ebbt beim Auflösen weich ab — nie snappend
  const glatt = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  function zonen(t) {
    if (!zone) return null;
    const V = CONFIG.verdichtung;
    let staerke = glatt((t - zone.born) / 0.8);
    if (zone.ende > 0) {
      staerke *= 1 - glatt((t - zone.ende) / 0.7);
      if (t > zone.ende + 0.75) { zone = null; return null; }
    }
    if (staerke <= 0.001) return null;
    return [{
      x0: zone.x0, y0: zone.y0, x1: zone.x1, y1: zone.y1,
      staerke, zug: V.zug, schrumpf: V.schrumpf, reich: V.reich,
    }];
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
    down, move, up, aufloesen, vorschau, zonen,
    get isDragging() { return drag !== null; },
    get aktiv() { return ids.length > 0 || carriers.length > 0; },
  };
}
