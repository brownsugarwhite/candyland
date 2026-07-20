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
  let flaeche = 0;     // Welt-Fläche des Rechtecks (für die Senken-Strömung)

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

    // DIE KETTENREAKTION ÜBERTRÄGT SICH AUF DAS GANZE MESH: Quellen
    // sind ALLE Gitteragenten des gesamten Lattice (das 4× größer ist
    // als das Sichtfenster — auch von jenseits des Bildrands wird
    // nachgezogen), sortiert nach Distanz. Die Welle konsumiert sie
    // Ring für Ring nach außen: jeder fliegt erst los, wenn alle
    // näheren schon unterwegs sind — niemand überfliegt Stehende.
    // Erst wenn das echte Lattice erschöpft ist, setzen Reserve-
    // Quellen den Strom jenseits davon fort. Zuordnung über WINKEL-
    // SEKTOREN: jedes Pixel bekommt eine Quelle aus seiner Richtung →
    // alle Bahnen laufen radial, ein einziger organischer Strom.
    const SEK = 48;
    const sektor = (x, y) => {
      let a = Math.atan2(y - cy, x - cx) / (Math.PI * 2) + 0.5;
      return Math.min(SEK - 1, Math.floor(a * SEK));
    };
    const quellen = Array.from({ length: SEK }, () => []);
    let nQuellen = 0;
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const hx = store.homeX[i], hy = store.homeY[i];
      quellen[sektor(hx, hy)].push({
        id: i, d: Math.hypot(hx - cx, hy - cy), x: hx, y: hy,
      });
      nQuellen++;
    }
    // Nachschub-Quellen: dichte Ringe JENSEITS des Sichtfensters
    const kx = kamera.cx, ky = kamera.cy;
    const hwV = kamera.viewW / 2 / kamera.scale;
    const hhV = kamera.viewH / 2 / kamera.scale;
    let sichtR = 0;
    for (const [ex, ey] of [[kx - hwV, ky - hhV], [kx + hwV, ky - hhV],
      [kx - hwV, ky + hhV], [kx + hwV, ky + hhV]]) {
      sichtR = Math.max(sichtR, Math.hypot(ex - cx, ey - cy));
    }
    let ringR = sichtR + 0.8;
    while (nQuellen < pixel.length) {
      const n = Math.max(8, Math.round((ringR * 6.2832) / 0.4));
      for (let k = 0; k < n && nQuellen < pixel.length * 1.02; k++) {
        // kräftiger Jitter — der Strom soll organisch wirken, nicht
        // als konzentrische Ringe
        const a = ((k + Math.random()) / n) * Math.PI * 2;
        const rr = ringR + Math.random() * 0.9;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        quellen[sektor(x, y)].push({ id: -1, d: rr, x, y });
        nQuellen++;
      }
      ringR += 0.45;
    }
    for (const q of quellen) q.sort((a, b) => a.d - b.d);

    // Zuordnung Pixel (Mitte → außen) ↔ Quelle (innen → außen) im
    // gleichen Sektor; die WELLE läuft mit kettenSpeed durch das Netz:
    // jede Quelle startet, wenn die Kettenreaktion sie erreicht
    const zeiger = new Int32Array(SEK);
    plan = [];
    planIdx = 0;
    let frontR = 0; // wie weit die Welle echtes Gitter konsumiert
    for (let k = 0; k < pixel.length; k++) {
      const p = pixel[k];
      const s0 = sektor(p.wx, p.wy);
      let q = null;
      for (let off = 0; off < SEK; off++) {
        const s = (s0 + (off % 2 === 0 ? off / 2 : -(off + 1) / 2) + SEK) % SEK;
        if (zeiger[s] < quellen[s].length) { q = quellen[s][zeiger[s]++]; break; }
      }
      if (!q) break;
      if (q.id >= 0 && q.d > frontR) frontR = q.d;
      plan.push({
        t: tNow + q.d / V.kettenSpeed + Math.random() * 0.12,
        id: q.id, wx: p.wx, wy: p.wy, sx: q.x, sy: q.y,
      });
    }
    plan.sort((a, b) => a.t - b.t);
    // Fließband-Abschluss: das restliche Gitter (auch offcanvas) rückt
    // um die geräumte Strecke nach und legt sich um die Fläche
    const halbDiag = Math.hypot((r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2);
    zone.cx = cx;
    zone.cy = cy;
    zone.frontR = frontR;
    zone.pullIn = Math.max(0, frontR - (halbDiag + 0.6));
    flaeche = (r.x1 - r.x0) * (r.y1 - r.y0);
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
        // Nachschub sieht aus wie der Schwarm selbst: er startet in
        // voller Kachelgröße als Squircle hinter der Front und wird
        // beim Einwandern kleiner und quadratisch — kein fertig
        // geschrumpftes Auftauchen
        wakeAgent(store, id, tNow, 0, {
          size: 0.8, shape: store.globalShape, taskId, swirl: true,
          px: p.sx, py: p.sy,
        });
        store.size[id] = 0.55 + Math.random() * 0.3;
        setAgentShape(store, id, SQUARE);
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
    // der Nachrück-Zug wächst mit dem Füllstand: während die Welle
    // konsumiert, folgt das restliche Gitter kontinuierlich nach
    const fill = plan.length > 0 ? planIdx / plan.length : 1;
    return [{
      cx: zone.cx, cy: zone.cy,
      frontR: zone.frontR || 0,
      pullIn: (zone.pullIn || 0) * fill,
      spanne: V.spanne, staerke, schrumpf: V.schrumpf,
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
