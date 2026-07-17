// 3D-EDITOR (Referenz 07): Blender-artiges Grid, in der Mitte der
// Standard-WÜRFEL (wie in Blender, ohne Subdivision). Drei lila Buttons
// wählen die Darstellung: Drahtgitter · geshaded · Subdivision (dann die
// runde Referenz-07-Hülle). Der BODEN entsteht aus den Gitteragenten
// selbst — das 2D-Grid fließt ins 3D-Grid. Kanten sind echte Linien
// (Linien-Pass), Agenten sind die KNOTEN des Meshes.
// Tab: Object/Edit · 1/2/3: Vertex/Edge/Face · G/R/S: Transform ·
// E: Extrude (Face) · Drag: Orbit · Rad: Dolly · Klick bestätigt.
import { CONFIG } from '../config.js';
import { STATE, allocReserve, wakeAgent } from '../swarm.js';
import { shapeId } from '../formen.js';
import { createAppShell } from './app.js';
import { assignTargets } from '../assign.js';
import { createOrbit, add, sub, mul, dot, norm } from '../mat3d.js';
import {
  cube, meshEdges, subdivide, vertexNormals, faceCenter, faceNormal,
} from '../mesh3d.js';

const LIGHT = norm([0.45, -0.5, 0.75]);
const BASE = [201, 206, 203];
const ORANGE = [240, 150, 60];

export function create3dEditor(store, deps) {
  const shell = createAppShell(store, deps, '3d');
  const orbitCam = createOrbit();

  let tNow = 0;
  let region = null;
  let center = null;
  let projScale = 1;
  let u = 1; // Welt pro Screen-px

  let cage = cube(1);
  cage.verts = cage.verts.map((v) => [v[0], v[1], v[2] + 1]);
  let cageEdges = meshEdges(cage);
  let surfPts = [];         // { p, n } — Oberflächen-Samples
  let meshDirty = true;

  let displayMode = 'shaded'; // 'grid' | 'shaded'
  let subdivOn = false;       // Subdivision (Referenz 07) zuschaltbar
  let mode = 'object';
  let selMode = 'vertex';
  let objectSel = false;
  let sel = null;
  let transform = null;
  let orbiting = null;

  let gridAgents = [];      // Boden: rekrutierte GITTER-Agenten
  let surfAgents = [];
  let cageVertAgents = [];
  let buttons = [];         // { id, key }

  const alloc = (shape, size) => {
    const id = allocReserve(store, center.x, center.y);
    if (id < 0) return -1;
    wakeAgent(store, id, tNow, Math.random() * 0.4, {
      size: 0.02, shape, taskId: shell.task, swirl: false,
      px: center.x + (Math.random() - 0.5) * 6,
      py: center.y + (Math.random() - 0.5) * 4,
    });
    store.state[id] = STATE.TEXT;
    store.sizeTgt[id] = size;
    store.needsRebuild = true;
    return id;
  };

  const project = (p3) => {
    const pr = orbitCam.project(p3);
    return {
      wx: center.x + pr.x * projScale,
      wy: center.y + pr.y * projScale,
      persp: pr.persp * projScale,
      depth: pr.depth,
    };
  };

  function setAgent(id, pr, size3, col, bri) {
    store.targetX[id] = pr.wx;
    store.targetY[id] = pr.wy;
    store.sizeTgt[id] = Math.max(0.02, size3 * pr.persp);
    store.tgtR[id] = col[0];
    store.tgtG[id] = col[1];
    store.tgtB[id] = col[2];
    store.brightness[id] = bri;
  }

  // Oberfläche neu sampeln: Würfel = flach geshadete Flächenraster,
  // mit Subdivision = glatte Punktwolke (Referenz 07)
  function rebuildSurface() {
    cageEdges = meshEdges(cage);
    surfPts = [];
    if (subdivOn) {
      const m = subdivide(cage, 3);
      const normals = vertexNormals(m);
      m.verts.forEach((v, i) => surfPts.push({ p: v, n: normals[i] }));
      m.faces.forEach((f) => surfPts.push({ p: faceCenter(m, f), n: faceNormal(m, f) }));
    } else {
      const nGrid = 7;
      for (const f of cage.faces) {
        const n = faceNormal(cage, f);
        const [a, b, c, d] = f.map((i) => cage.verts[i]);
        for (let iy = 0; iy < nGrid; iy++) {
          for (let ix = 0; ix < nGrid; ix++) {
            const s = (ix + 0.5) / nGrid, t = (iy + 0.5) / nGrid;
            const top = add(mul(a, 1 - s), mul(b, s));
            const bot = add(mul(d, 1 - s), mul(c, s));
            surfPts.push({ p: add(mul(top, 1 - t), mul(bot, t)), n });
          }
        }
      }
    }
    const want = displayMode === 'shaded' ? surfPts.length : 0;
    while (surfAgents.length < want) {
      const id = alloc(shapeId('squircle'), 0.05);
      if (id < 0) break;
      surfAgents.push({ id });
    }
    while (surfAgents.length > want) deps.revert(surfAgents.pop().id);

    while (cageVertAgents.length < cage.verts.length) {
      const id = alloc(shapeId('squircle'), 0.1);
      if (id < 0) break;
      cageVertAgents.push({ id });
    }
    while (cageVertAgents.length > cage.verts.length) deps.revert(cageVertAgents.pop().id);
    meshDirty = false;
  }

  function vertSelected(i) {
    if (mode === 'object') return objectSel;
    if (!sel) return false;
    if (sel.type === 'vertex') return sel.index === i;
    if (sel.type === 'edge') {
      const e = cageEdges[sel.index];
      return e && (e[0] === i || e[1] === i);
    }
    const f = cage.faces[sel.index];
    return f && f.includes(i);
  }

  function reproject() {
    for (const g of gridAgents) {
      const pr = project(g.p3);
      setAgent(g.id, pr, g.size, g.col, g.bri);
    }
    const tint = mode === 'object' && objectSel ? 0.25 : 0;
    for (let i = 0; i < surfAgents.length; i++) {
      const sp = surfPts[i];
      const pr = project(sp.p);
      const lam = Math.max(0, dot(sp.n, LIGHT));
      const sh = 0.38 + 0.62 * lam;
      const col = [
        BASE[0] * sh * (1 - tint) + ORANGE[0] * sh * tint,
        BASE[1] * sh * (1 - tint) + ORANGE[1] * sh * tint,
        BASE[2] * sh * (1 - tint) + ORANGE[2] * sh * tint,
      ];
      setAgent(surfAgents[i].id, pr, subdivOn ? 0.075 : 0.1, col, 1);
    }
    const cageBri = mode === 'edit' ? 1 : 0.8;
    for (let i = 0; i < cageVertAgents.length; i++) {
      const pr = project(cage.verts[i]);
      const hot = vertSelected(i);
      setAgent(cageVertAgents[i].id, pr,
        mode === 'edit' ? (hot ? 0.085 : 0.055) : 0.05,
        hot ? ORANGE : [232, 235, 233], cageBri);
    }
  }

  // Kanten + Bodenlinien als echte Linien (Linien-Pass)
  function pushLines() {
    const ex = store.extraLines;
    const edgeA = displayMode === 'grid' ? 0.55 : 0.22;
    for (let e = 0; e < cageEdges.length; e++) {
      const [i, j] = cageEdges[e];
      const a = project(cage.verts[i]);
      const b = project(cage.verts[j]);
      const hot = mode === 'edit' && sel && sel.type === 'edge' && sel.index === e;
      ex.push(a.wx, a.wy, b.wx, b.wy,
        hot ? 0.94 : 0.88, hot ? 0.59 : 0.9, hot ? 0.24 : 0.89, hot ? 0.85 : edgeA);
    }
    const EXT = 5;
    for (let a = -EXT; a <= EXT; a++) {
      const p1 = project([a, -EXT, 0]), p2 = project([a, EXT, 0]);
      const q1 = project([-EXT, a, 0]), q2 = project([EXT, a, 0]);
      const ax = a === 0;
      ex.push(p1.wx, p1.wy, p2.wx, p2.wy,
        ax ? 0.45 : 0.5, ax ? 0.78 : 0.52, ax ? 0.45 : 0.53, ax ? 0.4 : 0.1);
      ex.push(q1.wx, q1.wy, q2.wx, q2.wy,
        ax ? 0.82 : 0.5, ax ? 0.38 : 0.52, ax ? 0.42 : 0.53, ax ? 0.4 : 0.1);
    }
  }

  function pick(wx, wy) {
    const R2 = 0.32;
    let best = null, bestD = R2;
    const tryPick = (p3, type, index) => {
      const pr = project(p3);
      const dx = pr.wx - wx, dy = pr.wy - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = { type, index }; }
    };
    if (mode === 'edit') {
      if (selMode === 'vertex') cage.verts.forEach((v, i) => tryPick(v, 'vertex', i));
      else if (selMode === 'edge') {
        cageEdges.forEach((e, i) =>
          tryPick(mul(add(cage.verts[e[0]], cage.verts[e[1]]), 0.5), 'edge', i));
      } else {
        cage.faces.forEach((f, i) => tryPick(faceCenter(cage, f), 'face', i));
      }
    } else {
      cage.verts.forEach((v, i) => tryPick(v, 'vertex', i));
      cage.faces.forEach((f) => tryPick(faceCenter(cage, f), 'vertex', 0));
    }
    return best;
  }

  function selectedVertIndices() {
    if (mode === 'object') return cage.verts.map((_, i) => i);
    if (!sel) return [];
    if (sel.type === 'vertex') return [sel.index];
    if (sel.type === 'edge') return [...cageEdges[sel.index]];
    return [...cage.faces[sel.index]];
  }

  function startTransform(kind, cursor) {
    let indices = selectedVertIndices();
    if (indices.length === 0) return;
    let extrudeNormal = null;
    let preExtrude = null;
    if (kind === 'e') {
      if (mode !== 'edit' || !sel || sel.type !== 'face') {
        deps.showNote('extrude braucht eine gewählte fläche (3 im edit-mode)');
        return;
      }
      preExtrude = { vertLen: cage.verts.length, faces: cage.faces.map((f) => [...f]) };
      extrudeNormal = extrudeFace(sel.index);
      indices = selectedVertIndices();
    }
    transform = {
      kind, indices, preExtrude,
      snapshot: cage.verts.map((v) => [...v]),
      start: { wx: cursor.wx, wy: cursor.wy },
      normal: extrudeNormal,
    };
  }

  function extrudeFace(fi) {
    const f = cage.faces[fi];
    const n = faceNormal(cage, f);
    const base = cage.verts.length;
    const top = f.map((vi, k) => {
      cage.verts.push([...cage.verts[vi]]);
      return base + k;
    });
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      cage.faces.push([a, b, top[(k + 1) % f.length], top[k]]);
    }
    cage.faces[fi] = top;
    cageEdges = meshEdges(cage);
    sel = { type: 'face', index: fi };
    meshDirty = true;
    return n;
  }

  function applyTransform(cursor) {
    const t = transform;
    const indices = t.indices;
    let centroid = [0, 0, 0];
    for (const i of indices) centroid = add(centroid, t.snapshot[i]);
    centroid = mul(centroid, 1 / indices.length);
    const pr = project(centroid);
    const unit = Math.max(0.05, pr.persp);
    const dx = (cursor.wx - t.start.wx) / unit;
    const dy = (cursor.wy - t.start.wy) / unit;
    const { right, up, fwd } = orbitCam.basis();

    if (t.kind === 'g') {
      const d = add(mul(right, dx), mul(up, -dy));
      for (const i of indices) cage.verts[i] = add(t.snapshot[i], d);
    } else if (t.kind === 'e') {
      const amt = -dy + dx * 0.2;
      for (const i of indices) cage.verts[i] = add(t.snapshot[i], mul(t.normal, amt));
    } else if (t.kind === 's') {
      const f = Math.max(0.05, 1 + (dx - dy) * 0.5);
      for (const i of indices) {
        cage.verts[i] = add(centroid, mul(sub(t.snapshot[i], centroid), f));
      }
    } else if (t.kind === 'r') {
      const ang = dx * 0.9;
      const ax = fwd;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      for (const i of indices) {
        const rel = sub(t.snapshot[i], centroid);
        const rot = add(
          add(mul(rel, cos), mul([
            ax[1] * rel[2] - ax[2] * rel[1],
            ax[2] * rel[0] - ax[0] * rel[2],
            ax[0] * rel[1] - ax[1] * rel[0],
          ], sin)),
          mul(ax, dot(ax, rel) * (1 - cos)),
        );
        cage.verts[i] = add(centroid, rot);
      }
    }
    meshDirty = true;
  }

  function cancelTransform() {
    const t = transform;
    if (t.preExtrude) {
      cage.verts.length = t.preExtrude.vertLen;
      for (let i = 0; i < t.preExtrude.vertLen; i++) cage.verts[i] = t.snapshot[i];
      cage.faces = t.preExtrude.faces;
      cageEdges = meshEdges(cage);
      sel = null;
    } else {
      for (let i = 0; i < t.snapshot.length; i++) cage.verts[i] = t.snapshot[i];
    }
    transform = null;
    meshDirty = true;
  }

  function setDisplay(key) {
    if (key === 'draht') displayMode = 'grid';
    else if (key === 'shaded') displayMode = 'shaded';
    else if (key === 'subdiv') subdivOn = !subdivOn;
    meshDirty = true;
    deps.showNote(
      key === 'subdiv'
        ? (subdivOn ? 'subdivision an (catmull-clark)' : 'subdivision aus')
        : (displayMode === 'grid' ? 'drahtgitter' : 'geshaded'),
    );
  }

  return {
    name: '3d',
    warpRect: (t) => shell.warpRect(t),

    open(t) {
      tNow = t;
      region = shell.open(t);
      const kam = deps.kamera;
      u = 1 / kam.scale;
      center = { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 + 0.3 };
      projScale = Math.min(region.x1 - region.x0, region.y1 - region.y0) * 0.5;

      // BODEN aus dem 2D-Gitter: die nächsten Gitteragenten morphen zu
      // den Knoten des 3D-Bodens — flüssiger Übergang 2D → 3D
      gridAgents = [];
      const EXT = 5;
      const pts3 = [];
      for (let a = -EXT; a <= EXT; a++) {
        for (let b = -EXT; b <= EXT; b++) {
          pts3.push({ p3: [b, a, 0], axis: a === 0 || b === 0 });
        }
      }
      const flat = new Float32Array(pts3.length * 2);
      pts3.forEach((g, k) => {
        const pr = project(g.p3);
        flat[k * 2] = pr.wx;
        flat[k * 2 + 1] = pr.wy;
      });
      const carrierFrei = (i) => store.carrier[i] === 1 && store.state[i] <= STATE.RETURNING;
      const got = assignTargets(store, flat, pts3.length, STATE.TEXT, carrierFrei, shell.task);
      pts3.forEach((g, k) => {
        if (got[k] < 0) return;
        gridAgents.push({
          id: got[k], p3: g.p3,
          col: g.axis ? [150, 155, 158] : [126, 131, 134],
          size: g.axis ? 0.036 : 0.026,
          bri: g.axis ? 0.8 : 0.55,
        });
      });

      // 3 lila Darstellungs-Buttons unten links (Screen-px, zoomfest)
      buttons = [];
      const LI = CONFIG.colors.lila;
      ['draht', 'shaded', 'subdiv'].forEach((key, j) => {
        const bx = region.x0 + (26 + j * 52) * u;
        const by = region.y1 - 26 * u;
        const id = alloc(shapeId('squircle'), 34 * u);
        if (id < 0) return;
        store.targetX[id] = bx;
        store.targetY[id] = by;
        store.homeX[id] = bx;
        store.homeY[id] = by;
        store.tgtR[id] = LI[0];
        store.tgtG[id] = LI[1];
        store.tgtB[id] = LI[2];
        buttons.push({ id, key });
      });

      rebuildSurface();
      deps.showNote('3d: drag = orbit · rad = zoom · tab = edit · buttons: draht/shaded/subdiv');
    },

    close(t) {
      for (const g of gridAgents) deps.revert(g.id);
      for (const a of surfAgents) deps.revert(a.id);
      for (const a of cageVertAgents) deps.revert(a.id);
      for (const b of buttons) deps.revert(b.id);
      gridAgents = surfAgents = cageVertAgents = buttons = [];
      shell.close(t);
    },

    onKey(e) {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (transform) { cancelTransform(); return true; }
        if (sel || objectSel) { sel = null; objectSel = false; return true; }
        return false;
      }
      if (e.key === 'Tab') {
        mode = mode === 'object' ? 'edit' : 'object';
        sel = null;
        deps.showNote(mode === 'edit'
          ? 'edit-mode · 1 vertex · 2 edge · 3 face · g/r/s/e'
          : 'object-mode · klick wählt · g/r/s');
        return true;
      }
      if (mode === 'edit' && (k === '1' || k === '2' || k === '3')) {
        selMode = { 1: 'vertex', 2: 'edge', 3: 'face' }[k];
        sel = null;
        deps.showNote(`${selMode}-select`);
        return true;
      }
      if (k === 'g' || k === 'r' || k === 's' || k === 'e') {
        if (transform) return true;
        if (mode === 'object' && !objectSel && k !== 'e') objectSel = true;
        startTransform(k, deps.cursorRef());
        return true;
      }
      return false;
    },

    onWheel(deltaY) {
      orbitCam.dolly(Math.exp(deltaY * 0.0012));
    },

    onPointerDown(wx, wy) {
      for (const b of buttons) {
        const dx = store.posX[b.id] - wx, dy = store.posY[b.id] - wy;
        if (dx * dx + dy * dy < (26 * u) ** 2) {
          setDisplay(b.key);
          return true;
        }
      }
      if (transform) {
        transform = null;
        return true;
      }
      const hit = pick(wx, wy);
      if (mode === 'object') {
        objectSel = !!hit;
        if (!hit) orbiting = { wx, wy };
      } else if (hit) {
        sel = hit;
      } else {
        sel = null;
        orbiting = { wx, wy };
      }
      return true;
    },

    onPointerDrag(wx, wy) {
      if (transform) return;
      if (!orbiting) orbiting = { wx, wy };
      const kam = deps.kamera;
      orbitCam.orbit(
        ((wx - orbiting.wx) * kam.scale) * 0.008,
        ((wy - orbiting.wy) * kam.scale) * 0.008,
      );
      orbiting = { wx, wy };
    },

    onPointerUp() {
      orbiting = null;
    },

    onClick(wx, wy) {
      if (shell.hitClose(wx, wy)) return 'close';
      return true;
    },

    update(t, cursor) {
      tNow = t;
      if (transform && cursor && cursor.active) applyTransform(cursor);
      if (meshDirty) rebuildSurface();
      reproject();
      pushLines();
    },
  };
}
