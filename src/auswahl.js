// AUSWAHL: der Cursor stößt den Schwarm magnetisch ab (Warp in swarm.js),
// aber genau EIN Agent nach dem anderen wird unter dem Cursor sanft
// vergrößert (Hover) — Klick öffnet seine Agentenkarte. Interaktiv sind
// die wachen Gitter-Kacheln sowie Logo- und Claws-Agenten.
import { CONFIG } from './config.js';
import { STATE } from './swarm.js';
import { nearestLit } from './gitter.js';

export function createAuswahl(store, logo) {
  const K = CONFIG.karte;
  let hovered = -1;
  const eased = new Set();     // Agenten mit hover > 0 (zum Abklingen)
  const baseSizes = new Map(); // Grundgröße gebundener Agenten (Logo/Claws)

  function pickAt(wx, wy) {
    // Logo/Claws zuerst (sitzen in Lücken)
    const special = [];
    for (const id of specialIds()) {
      if (id < 0 || store.active[id] === 0) continue;
      const dx = store.posX[id] - wx, dy = store.posY[id] - wy;
      const r = Math.max(0.45, store.size[id] * 0.7);
      if (dx * dx + dy * dy < r * r) special.push({ id, d2: dx * dx + dy * dy });
    }
    if (special.length > 0) {
      special.sort((a, b) => a.d2 - b.d2);
      return special[0].id;
    }
    const id = nearestLit(store.gitter, wx, wy, 0.72);
    if (id < 0 || store.active[id] === 0) return -1;
    if (store.state[id] > STATE.RETURNING) return -1; // Dienst-Agenten: kein Grid-Hover
    return id;
  }

  function* specialIds() {
    yield* logo.allIds();
  }

  return {
    get hovered() { return hovered; },

    update(dt, cursor, enabled) {
      hovered = (enabled && cursor.active) ? pickAt(cursor.wx, cursor.wy) : -1;
      if (hovered >= 0) eased.add(hovered);
      const rate = Math.min(1, 1 - Math.exp(-K.hoverEase * dt));
      for (const id of eased) {
        const tgt = id === hovered ? K.hoverGrow : 0;
        const h = store.hover[id] + (tgt - store.hover[id]) * rate;
        store.hover[id] = h;
        // Träger-Kacheln wachsen in postStep über hover[]; NUR die fest
        // verankerten Logo/Claws-Agenten direkt über sizeTgt. (Nie über
        // state entscheiden: ein Gitteragent kann WÄHREND des Hover-
        // Abklingens in einen Dienst wechseln — sonst würde hier seine
        // Dienst-Größe mit einem alten Wert überschrieben.)
        const gebunden = logo.isClaw(id) || logo.isLogo(id);
        if (gebunden) {
          if (!baseSizes.has(id)) baseSizes.set(id, store.sizeTgt[id]);
          store.sizeTgt[id] = baseSizes.get(id) * (1 + h);
        }
        if (id !== hovered && h < 0.004) {
          store.hover[id] = 0;
          if (gebunden && baseSizes.has(id)) {
            store.sizeTgt[id] = baseSizes.get(id);
          }
          baseSizes.delete(id);
          eased.delete(id);
        }
      }
    },
  };
}
