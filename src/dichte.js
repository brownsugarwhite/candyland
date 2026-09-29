// DICHTE-VERSUCH — Doppelklick irgendwo auf der Fläche: der GANZE
// Schwarm verdichtet sich GLEICHZEITIG, in einer einzigen Bewegung,
// zur komplett gefüllten Sichtfläche (z. B. wide: 800×600 = 480000
// Agenten) aus weißen 1×1-px-Quadraten ohne Zwischenräume — Ziel
// ~0,5 s. Kein Strom, keine Welle, kein Plan: jedes Pixel bekommt
// seinen Agenten und ALLE fliegen im selben Moment los.
//
// Die Bewegung ist EINE gleichförmige Kontraktion: die Reserve-
// Agenten starten auf dem radial um die Bildmitte aufgeblähten
// Pixelraster (×streu, selbstähnlich — Startgröße ×streu, damit die
// kontrahierende Fläche geschlossen bleibt) und ziehen sich auf das
// echte Pixelraster zusammen. Sichtbare Gitteragenten nehmen das
// Pixel an ihrem Ort und schrumpfen mit (homeX/homeY bleibt tabu —
// nur targetX/targetY). Doppelklick oder Esc löst auf; alles kehrt
// exakt zurück (poolWach fällt auf den Ausgangswert).
import { CONFIG } from './config.js';
import { STATE, wakeAgent, allocReserve, setAgentShape, SQUARE } from './swarm.js';

export function createDichte(store, deps) {
  const { kamera, registerTask, revert, dissolveIds, showNote } = deps;
  let ids = [];        // Reserve-Agenten des Versuchs
  let carriers = [];   // beteiligte Gitteragenten
  let taskId = 0;

  function ausloesen(tNow) {
    if (ids.length > 0 || carriers.length > 0) return false; // läuft schon
    if (!taskId) taskId = registerTask('dichte: vollfläche', true);
    const D = CONFIG.dichte;
    const W = D.weiss;
    // die komplette Sichtfläche, Pixel für Pixel
    const pitch = 1 / kamera.scale;
    const cols = Math.round(kamera.viewW);
    const rows = Math.round(kamera.viewH);
    if (cols * rows > store.freeCount - 1000) {
      if (showNote) showNote('pool erschöpft — versuch abgebrochen');
      return false;
    }
    const mx = kamera.cx, my = kamera.cy;
    const x0 = mx - (cols * pitch) / 2;
    const y0 = my - (rows * pitch) / 2;
    const pixelGroesse = pitch * 1.55; // Überlappung — sonst frisst AA die Deckung

    // sichtbare Gitteragenten claimen das Pixel an ihrem Ort
    const belegt = new Uint8Array(cols * rows);
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const hx = store.homeX[i], hy = store.homeY[i];
      const c = Math.round((hx - x0) / pitch - 0.5);
      const r = Math.round((hy - y0) / pitch - 0.5);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      if (belegt[r * cols + c] === 1) continue;
      belegt[r * cols + c] = 1;
      store.state[i] = STATE.IMAGE; // friert nach Ankunft ein
      store.taskId[i] = taskId;
      store.frozen[i] = 0;
      store.targetX[i] = x0 + (c + 0.5) * pitch; // home bleibt unangetastet!
      store.targetY[i] = y0 + (r + 0.5) * pitch;
      store.activateAt[i] = tNow;
      store.sizeTgt[i] = pixelGroesse;
      store.tgtR[i] = W[0];
      store.tgtG[i] = W[1];
      store.tgtB[i] = W[2];
      setAgentShape(store, i, SQUARE);
      carriers.push({ id: i });
    }

    // der Rest aus dem Pool: alle GLEICHZEITIG, Start auf dem ×streu
    // aufgeblähten Raster — eine einzige Kontraktion zur Bildmitte
    const F = D.streu;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (belegt[r * cols + c] === 1) continue;
        const wx = x0 + (c + 0.5) * pitch;
        const wy = y0 + (r + 0.5) * pitch;
        const sx = mx + (wx - mx) * F;
        const sy = my + (wy - my) * F;
        const id = allocReserve(store, sx, sy);
        if (id < 0) break;
        wakeAgent(store, id, tNow, 0, {
          size: pixelGroesse, shape: SQUARE, taskId, swirl: false, px: sx, py: sy,
        });
        // Korngröße KONSTANT (nicht ×F): das Startbild ist ein lockeres
        // Griesel-Raster mit Lücken — nur so ist die Kontraktion sichtbar
        // (eine selbstähnlich skalierte geschlossene Fläche sähe statisch aus)
        store.size[id] = pixelGroesse;
        store.sizeTgt[id] = pixelGroesse;
        store.state[id] = STATE.IMAGE;
        store.targetX[id] = wx;
        store.targetY[id] = wy;
        store.tgtR[id] = W[0];
        store.tgtG[id] = W[1];
        store.tgtB[id] = W[2];
        ids.push(id);
      }
    }
    store.needsRebuild = true;
    return true;
  }

  function aufloesen(tNow = 0) {
    if (ids.length === 0 && carriers.length === 0) return false;
    dissolveIds(ids);
    for (const c of carriers) revert(c.id);
    ids = [];
    carriers = [];
    return true;
  }

  return {
    ausloesen, aufloesen,
    get aktiv() { return ids.length > 0 || carriers.length > 0; },
  };
}
