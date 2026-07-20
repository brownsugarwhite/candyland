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
import { STATE, wakeAgent, allocReserve, setAgentShape, SQUARE } from './swarm.js';

export function createVerdichtung(store, deps) {
  const { kamera, registerTask, revert, dissolveIds } = deps;
  let drag = null;     // { x0, y0, x1, y1 } Welt — Rechteck-Vorschau
  let ids = [];        // Reserve-Agenten der Fläche
  let carriers = [];   // rekrutierte Gitteragenten
  let zone = null;     // Sog-Feld { x0..y1, born, ende } für den Schwarm
  let taskId = 0;
  // Die KETTENREAKTION als laufender Plan: jeder Schritt wird erst
  // ausgeführt, wenn die Welle den Agenten erreicht — bis dahin bleibt
  // er ein ganz normaler Teil des Schwarms
  let plan = [];       // { t, id|-1, sx, sy, wx, wy } sortiert nach t
  let planIdx = 0;
  let pixelGroesse = 0;

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


  function starte(r, tNow) {
    aufloesen(tNow);
    if (!taskId) taskId = registerTask('verdichtung: fläche', true);
    const V = CONFIG.verdichtung;
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
    pixelGroesse = pitch * 1.55; // Überlappung — sonst frisst AA die Deckung

    // das Sog-Feld: der ganze Schwarm rückt kreisförmig näher
    zone = { ...r, born: tNow, ende: 0 };

    // DIE KETTENREAKTION planen — ausgeführt wird sie Schritt für
    // Schritt in update(), wenn die Welle den jeweiligen Agenten
    // erreicht. Pixel füllen sich von der MITTE nach außen; die
    // Agenten dafür kommen von INNEN nach außen aus dem Schwarm: erst
    // kontrahieren die Kacheln unterm Rechteck zur Mitte, dann zieht
    // es — Ring um Ring — die umliegenden nach (jeder Schritt reißt
    // über die Gitterkräfte den nächsten mit), bis die Fläche voll
    // ist. Reicht der Schwarm im Sog-Radius nicht, strömt Nachschub
    // von JENSEITS der Front nach — derselbe Fluss, weiter außen.
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const pixel = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = r.x0 + (col + 0.5) * pitch;
        const wy = r.y0 + (row + 0.5) * pitch;
        pixel.push({ wx, wy, d: Math.hypot(wx - cx, wy - cy) });
      }
    }
    pixel.sort((a, b) => a.d - b.d); // Fläche wächst aus der Mitte

    // Rekrutiert werden NUR die Kacheln im Rechteck plus eine schmale
    // Marge — der restliche Schwarm bleibt bestehen und rückt über den
    // Sog nach (er wird gezogen, aber nicht absorbiert)
    const marge = V.kettenMarge;
    const traeger = [];
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const hx = store.homeX[i], hy = store.homeY[i];
      if (hx < r.x0 - marge || hx > r.x1 + marge ||
          hy < r.y0 - marge || hy > r.y1 + marge) continue;
      traeger.push({ i, d: Math.hypot(hx - cx, hy - cy) });
    }
    traeger.sort((a, b) => a.d - b.d); // die Nächsten kondensieren zuerst

    // ALLE Schritte takten sich am Wachstum der Fläche (Mitte → außen,
    // wachsSpeed Zellen/s) — sie füllt sich Ring für Ring; Nachschub
    // strömt dicht über die nächstgelegene Rechteck-Kante ein
    const hw = Math.max(1e-3, (r.x1 - r.x0) / 2);
    const hh = Math.max(1e-3, (r.y1 - r.y0) / 2);
    plan = [];
    planIdx = 0;
    for (let k = 0; k < pixel.length; k++) {
      const p = pixel[k];
      const t = tNow + p.d / V.wachsSpeed + Math.random() * 0.06;
      if (k < traeger.length) {
        plan.push({ t, id: traeger[k].i, wx: p.wx, wy: p.wy });
      } else {
        let dx = p.wx - cx, dy = p.wy - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a); dy = Math.sin(a);
        } else { dx /= len; dy /= len; }
        // Randpunkt des Rechtecks in Zielrichtung + kurz dahinter
        const s = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-4);
        const aus = 0.3 + Math.random() * 1.8;
        plan.push({
          t, id: -1, wx: p.wx, wy: p.wy,
          sx: cx + dx / s + dx * aus + (Math.random() - 0.5) * 0.7,
          sy: cy + dy / s + dy * aus + (Math.random() - 0.5) * 0.7,
        });
      }
    }
    plan.sort((a, b) => a.t - b.t);
  }

  // Die Kettenreaktion läuft: pro Frame werden genau die Schritte
  // ausgeführt, deren Welle jetzt ankommt — bis dahin bleibt jeder
  // Agent ein normaler Teil des Schwarms (kein Dimmen, kein Warten)
  function update(tNow) {
    if (planIdx >= plan.length) return;
    const AG = store.baseTint;
    let n = 0;
    while (planIdx < plan.length && plan[planIdx].t <= tNow && n < 600) {
      const p = plan[planIdx++];
      n++;
      if (p.id >= 0) {
        if (store.active[p.id] === 0 || store.state[p.id] > STATE.RETURNING) continue;
        const id = p.id;
        store.state[id] = STATE.IMAGE; // friert nach Ankunft ein
        store.taskId[id] = taskId;
        store.frozen[id] = 0;
        store.targetX[id] = p.wx; // home bleibt unangetastet!
        store.targetY[id] = p.wy;
        store.sizeTgt[id] = pixelGroesse;
        store.activateAt[id] = tNow;
        setAgentShape(store, id, SQUARE); // Abstand weg → quadratisch
        carriers.push({ id });
      } else {
        const id = allocReserve(store, p.sx, p.sy);
        if (id < 0) continue;
        wakeAgent(store, id, tNow, 0, {
          size: 0.02, shape: SQUARE, taskId, swirl: true, px: p.sx, py: p.sy,
        });
        store.state[id] = STATE.IMAGE;
        store.targetX[id] = p.wx;
        store.targetY[id] = p.wy;
        store.sizeTgt[id] = pixelGroesse;
        store.tgtR[id] = AG[0];
        store.tgtG[id] = AG[1];
        store.tgtB[id] = AG[2];
        ids.push(id);
      }
    }
    store.needsRebuild = true;
  }

  function aufloesen(tNow = 0) {
    if (ids.length === 0 && carriers.length === 0 && plan.length === 0) return false;
    plan = [];
    planIdx = 0;
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
    down, move, up, aufloesen, vorschau, zonen, update,
    get isDragging() { return drag !== null; },
    get aktiv() { return ids.length > 0 || carriers.length > 0 || plan.length > 0; },
  };
}
