// 2048 IM SCHWARM (Referenz 03). Jede Spielfigur ist GENAU EIN AGENT —
// ein flat geshadeter Squircle-Blob, pro Stufe andere Farbe und Größe.
// Bewegung und Verschmelzen fühlen sich flüssig an: der absorbierte Blob
// fließt in den Ziel-Blob hinein (weiche Squircle↔Kreis-Morphs beim
// Gleiten), der Ziel-Blob antwortet mit einem elastischen Größen-Puls.
// Züge per Pfeiltasten oder Swipe; pinker Schließen-Agent oben rechts.
import { CONFIG } from '../config.js';
import { STATE, allocReserve, wakeAgent, setAgentShape, CIRCLE } from '../swarm.js';
import { shapeId } from '../formen.js';
import { createAppShell } from './app.js';

export function createSpiel2048(store, deps) {
  const S = CONFIG.spiel2048;
  const shell = createAppShell(store, deps, '2048');

  let tNow = 0;
  let board = null;      // 4×4 → Tile-Id oder 0
  let tiles = new Map(); // id → { level, r, c, agent, dieAt, mergeInto, pulseT }
  let nextTile = 1;
  let center = null;
  let pitch = 1;
  let spawnAt = 0;
  let spawnQueue = 0;

  const cellPos = (r, c) => ({
    x: center.x + (c - 1.5) * pitch,
    y: center.y + (r - 1.5) * pitch,
  });
  const blobSize = (level) =>
    pitch * Math.min(S.sizeMax, S.sizeBase + S.sizePerLevel * (level - 1));
  const blobColor = (level) => S.palette[Math.min(level - 1, S.palette.length - 1)];

  function styleTile(tile) {
    const id = tile.agent;
    const col = blobColor(tile.level);
    store.tgtR[id] = col[0];
    store.tgtG[id] = col[1];
    store.tgtB[id] = col[2];
    store.sizeTgt[id] = blobSize(tile.level);
  }

  function moveTileTo(tile, r, c) {
    tile.r = r;
    tile.c = c;
    const p = cellPos(r, c);
    store.targetX[tile.agent] = p.x;
    store.targetY[tile.agent] = p.y;
    // beim Gleiten wird der Blob kurz weicher (Kreis) und kehrt zurück —
    // zusammen mit dem Feder-Überschwingen wirkt das flüssig
    setAgentShape(store, tile.agent, CIRCLE);
    tile.reshapeAt = tNow + 0.28;
  }

  function spawnTile(r, c, level) {
    const id = nextTile++;
    const p = cellPos(r, c);
    const agent = allocReserve(store, p.x, p.y);
    if (agent < 0) return null;
    wakeAgent(store, agent, tNow, 0, {
      size: 0.02, shape: shapeId('squircle'), taskId: shell.task, swirl: false,
      px: p.x, py: p.y,
    });
    store.state[agent] = STATE.TEXT;
    const tile = { id, level, r, c, agent, dieAt: 0, mergeInto: 0, pulseT: 0, reshapeAt: 0 };
    tiles.set(id, tile);
    board[r][c] = id;
    styleTile(tile);
    store.needsRebuild = true;
    return tile;
  }

  function spawnRandom() {
    const empty = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) if (board[r][c] === 0) empty.push([r, c]);
    }
    if (empty.length === 0) return;
    const [r, c] = empty[(Math.random() * empty.length) | 0];
    spawnTile(r, c, Math.random() < 0.9 ? 1 : 2);
  }

  function canMove() {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === 0) return true;
        const lv = tiles.get(board[r][c]).level;
        if (c < 3 && board[r][c + 1] !== 0 && tiles.get(board[r][c + 1]).level === lv) return true;
        if (r < 3 && board[r + 1][c] !== 0 && tiles.get(board[r + 1][c]).level === lv) return true;
      }
    }
    return false;
  }

  // Standard-2048-Zug. dir: 0 links, 1 rechts, 2 hoch, 3 runter
  function move(dir) {
    const horiz = dir === 0 || dir === 1;
    const rev = dir === 1 || dir === 3;
    let moved = false;

    for (let line = 0; line < 4; line++) {
      const ids = [];
      for (let k = 0; k < 4; k++) {
        const kk = rev ? 3 - k : k;
        const id = horiz ? board[line][kk] : board[kk][line];
        if (id !== 0) ids.push(id);
      }
      const out = [];
      for (let k = 0; k < ids.length; k++) {
        const cur = tiles.get(ids[k]);
        if (k + 1 < ids.length) {
          const nxt = tiles.get(ids[k + 1]);
          if (!cur.dieAt && !nxt.dieAt && cur.level === nxt.level) {
            cur.level++;
            nxt.dieAt = tNow + S.mergePause;
            nxt.mergeInto = cur.id;
            out.push(cur.id);
            k++;
            moved = true;
            continue;
          }
        }
        out.push(cur.id);
      }
      for (let k = 0; k < 4; k++) {
        const kk = rev ? 3 - k : k;
        const id = out[k] || 0;
        const prev = horiz ? board[line][kk] : board[kk][line];
        if (prev !== id) moved = true;
        if (horiz) board[line][kk] = id;
        else board[kk][line] = id;
        if (id !== 0) {
          const t = tiles.get(id);
          moveTileTo(t, horiz ? line : kk, horiz ? kk : line);
        }
      }
    }

    if (!moved) return;
    for (const tile of tiles.values()) {
      if (tile.dieAt) {
        // der absorbierte Blob fließt IN den Ziel-Blob (gleiche Position,
        // weiche Form) — beim Versinken wächst der Ziel-Blob elastisch
        const tgt = tiles.get(tile.mergeInto);
        const p = cellPos(tgt.r, tgt.c);
        store.targetX[tile.agent] = p.x;
        store.targetY[tile.agent] = p.y;
        setAgentShape(store, tile.agent, CIRCLE);
      }
    }
    spawnAt = tNow + S.spawnDelay;
    if (!canMove()) deps.showNote('kein zug mehr — esc beendet das spiel');
  }

  return {
    name: '2048',
    warpRect: (t) => shell.warpRect(t),

    open(t) {
      tNow = t;
      shell.open(t);
      const r = shell.region;
      center = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
      pitch = Math.min(r.x1 - r.x0, r.y1 - r.y0) / S.pitchDiv;
      board = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      tiles = new Map();
      spawnQueue = 2;               // Start-Blobs erscheinen NACH dem
      spawnAt = t + CONFIG.apps.growSec * 0.8; // Aufwachsen der Region
    },

    close(t) {
      for (const tile of tiles.values()) deps.revert(tile.agent);
      tiles.clear();
      board = null;
      shell.close(t);
    },

    onKey(e) {
      const dirs = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3 };
      if (e.key in dirs) {
        move(dirs[e.key]);
        return true;
      }
      return false;
    },

    onSwipe(dx, dy) {
      if (Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 0 : 1);
      else move(dy < 0 ? 2 : 3);
    },

    onClick(wx, wy) {
      if (shell.hitClose(wx, wy)) return 'close';
      return true;
    },

    update(t) {
      tNow = t;
      for (const [id, tile] of tiles) {
        // Gleit-Morph zurück zum Squircle
        if (tile.reshapeAt && t > tile.reshapeAt) {
          setAgentShape(store, tile.agent, shapeId('squircle'));
          tile.reshapeAt = 0;
        }
        // absorbierter Blob versinkt im Ziel → elastischer Puls dort
        if (tile.dieAt && t > tile.dieAt) {
          const tgt = tiles.get(tile.mergeInto);
          deps.revert(tile.agent);
          tiles.delete(id);
          if (tgt) {
            styleTile(tgt);
            setAgentShape(store, tgt.agent, shapeId('squircle'));
            tgt.pulseT = t;
          }
        }
        // Puls: gedämpfte Schwingung der Zielgröße (wie Flüssigkeit)
        if (tile.pulseT) {
          const dt = t - tile.pulseT;
          if (dt > 1.1) {
            tile.pulseT = 0;
            store.sizeTgt[tile.agent] = blobSize(tile.level);
          } else {
            const w = S.pulse * Math.exp(-3.5 * dt) * Math.cos(11 * dt);
            store.sizeTgt[tile.agent] = blobSize(tile.level) * (1 + w);
          }
        }
      }
      if (spawnAt > 0 && t > spawnAt) {
        spawnRandom();
        spawnQueue--;
        spawnAt = spawnQueue > 0 ? t + 0.25 : 0;
        if (spawnQueue < 0) spawnQueue = 0;
      }
    },
  };
}
