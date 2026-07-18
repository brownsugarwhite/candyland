// REX IN 3D — der Dirigent erhebt sich als lebendiges Käfig-Drahtgitter
// aus dem Schwarm (Referenz: Blender-Screenshot mit 2× Subsurface).
// assets/obj/rex.obj liefert den GROBEN Käfig samt der gewölbten
// Squircle-Platte, aus der Rex herauswächst (die Platte liegt auf der
// Schwarmebene → nahtloser Übergang in den Schwarm). Zwei Catmull-Clark-
// Schritte glätten die Geometrie; gezeichnet werden NUR die Ur-Käfig-
// kanten als weiche 4-Segment-Kurven — wie ein NICHT angewandter
// Subsurface-Modifier. Knoten = kleine runde Agenten, Kantensegmente =
// lang gestreckte Agenten (store.aspekt); die Liniendicke wächst
// perspektivisch zur Kamera (project3d + Instanzgröße·k). Der Kopf
// schaut dem Cursor nach.
import { CONFIG } from './config.js';
import { STATE, wakeAgent, allocReserve, CIRCLE } from './swarm.js';
import { project3d } from './renderformat.js';
import { shapeId } from './formen.js';

// ---- OBJ-Parser (nur v/f; f-Indizes "12/3/4" → 12) ------------------------
function parseObj(text) {
  const verts = [], faces = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith('f ')) {
      faces.push(line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1));
    }
  }
  return { verts, faces };
}

// Nur Rex behalten: die Beigaben des Exports (fein unterteilte Platte,
// Requisiten) liegen im Modell weit links (x-Mitte < −5)
function filterRex(mesh) {
  const parent = mesh.verts.map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (const f of mesh.faces) {
    for (let k = 1; k < f.length; k++) {
      const ra = find(f[0]), rb = find(f[k]);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const sumX = new Map(), num = new Map();
  mesh.verts.forEach((v, i) => {
    const r = find(i);
    sumX.set(r, (sumX.get(r) || 0) + v[0]);
    num.set(r, (num.get(r) || 0) + 1);
  });
  const keep = (i) => sumX.get(find(i)) / num.get(find(i)) > -5;
  const remap = new Map();
  const verts = [];
  mesh.verts.forEach((v, i) => {
    if (keep(i)) { remap.set(i, verts.length); verts.push(v); }
  });
  const faces = mesh.faces
    .filter((f) => keep(f[0]))
    .map((f) => f.map((i) => remap.get(i)));
  return { verts, faces };
}

// ---- Catmull-Clark mit Randregeln + Abbildungen fürs Kanten-Tracking ------
const eKey = (a, b) => (a < b ? a * 131072 + b : b * 131072 + a);

function ccStep(mesh) {
  const { verts, faces } = mesh;
  const nV = verts.length;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

  const facePts = faces.map((f) => {
    let p = [0, 0, 0];
    for (const i of f) p = add(p, verts[i]);
    return mul(p, 1 / f.length);
  });

  // Kanten sammeln
  const edges = new Map(); // key → { a, b, faces: [] }
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = eKey(a, b);
      if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
      edges.get(key).faces.push(fi);
    }
  });

  const newVerts = facePts.slice();
  const edgeIdx = new Map();
  for (const [key, e] of edges) {
    let p;
    if (e.faces.length === 2) {
      p = mul(add(add(verts[e.a], verts[e.b]),
        add(facePts[e.faces[0]], facePts[e.faces[1]])), 0.25);
    } else {
      p = mul(add(verts[e.a], verts[e.b]), 0.5); // Randkante
    }
    edgeIdx.set(key, newVerts.length);
    newVerts.push(p);
  }

  // Vertex-Punkte: Standard innen, (A + 6P + B)/8 am Rand
  const vFaces = Array.from({ length: nV }, () => []);
  const vEdges = Array.from({ length: nV }, () => []);
  const vRand = Array.from({ length: nV }, () => []);
  faces.forEach((f, fi) => { for (const i of f) vFaces[i].push(fi); });
  for (const e of edges.values()) {
    vEdges[e.a].push(e); vEdges[e.b].push(e);
    if (e.faces.length === 1) { vRand[e.a].push(e); vRand[e.b].push(e); }
  }
  const vertIdx = new Int32Array(nV);
  for (let i = 0; i < nV; i++) {
    let p;
    if (vRand[i].length >= 3) {
      p = verts[i]; // Ecke: bleibt
    } else if (vRand[i].length === 2) {
      const [e1, e2] = vRand[i];
      const a = e1.a === i ? e1.b : e1.a;
      const b = e2.a === i ? e2.b : e2.a;
      p = mul(add(add(verts[a], verts[b]), mul(verts[i], 6)), 1 / 8);
    } else {
      const n = vFaces[i].length;
      let F = [0, 0, 0];
      for (const fi of vFaces[i]) F = add(F, facePts[fi]);
      F = mul(F, 1 / n);
      let R = [0, 0, 0];
      for (const e of vEdges[i]) R = add(R, mul(add(verts[e.a], verts[e.b]), 0.5));
      R = mul(R, 1 / vEdges[i].length);
      p = mul(add(add(F, mul(R, 2)), mul(verts[i], n - 3)), 1 / n);
    }
    vertIdx[i] = newVerts.length;
    newVerts.push(p);
  }

  const newFaces = [];
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const prev = f[(k - 1 + f.length) % f.length];
      const cur = f[k], next = f[(k + 1) % f.length];
      newFaces.push([
        vertIdx[cur], edgeIdx.get(eKey(cur, next)),
        fi, edgeIdx.get(eKey(prev, cur)),
      ]);
    }
  });
  return { verts: newVerts, faces: newFaces, edgeIdx, vertIdx };
}

// Polylinien der Ur-Kanten durch einen Subdivisionsschritt verfeinern
function refine(polys, step) {
  return polys.map((poly) => {
    const out = [step.vertIdx[poly[0]]];
    for (let k = 1; k < poly.length; k++) {
      out.push(step.edgeIdx.get(eKey(poly[k - 1], poly[k])));
      out.push(step.vertIdx[poly[k]]);
    }
    return out;
  });
}

export function createRex3d(store, deps) {
  const { kamera, registerTask, dissolveIds, cursor } = deps;
  const R = CONFIG.rex3d;
  let geo = null;        // { punkte: Float32Array(3n), polys, knoten, lade }
  let offen = false;
  let t0 = 0;
  let mitte = { x: 0, y: 0 };
  let yaw = 0;
  let taskId = 0;
  let segIds = [];       // ein Agent je Kantensegment
  let knotIds = [];      // ein Agent je Ur-Vertex
  const PR = { x: 0, y: 0, k: 1, dim: 1, hidden: false };
  const PR2 = { x: 0, y: 0, k: 1, dim: 1, hidden: false };

  let ladePromise = null;

  async function lade() {
    const text = await (await fetch('assets/obj/rex.obj')).text();
    const cage = filterRex(parseObj(text));
    // Käfig-Polylinien: jede Ur-Kante, Knoten: jeder Ur-Vertex
    let polys = [];
    const seen = new Set();
    for (const f of cage.faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k], b = f[(k + 1) % f.length];
        const key = eKey(a, b);
        if (!seen.has(key)) { seen.add(key); polys.push([a, b]); }
      }
    }
    let mesh = cage;
    let knoten = cage.verts.map((_, i) => i);
    for (let s = 0; s < 2; s++) {
      const step = ccStep(mesh);
      polys = refine(polys, step);
      knoten = knoten.map((i) => step.vertIdx[i]);
      mesh = step;
    }
    // Modell → Weltmaß: Platte (x/y-Ausdehnung) → R.breite Zellen,
    // Plattenebene (größtes Modell-z) → Schwarmebene z = 0
    let minX = 1e9, maxX = -1e9, maxZ = -1e9;
    for (const v of cage.verts) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[2] > maxZ) maxZ = v[2];
    }
    const s = R.breite / (maxX - minX);
    // Punkte in Modellkoordinaten behalten (Transform passiert je Frame)
    geo = { mesh, polys, knoten, s, maxZ };
  }

  // Geometrie schon beim Boot vorladen — der erste Klick baut sofort
  ladePromise = lade().catch(() => { ladePromise = null; });

  function open(tNow) {
    if (offen) return;
    offen = true;
    t0 = tNow;
    mitte = { x: Math.round(kamera.cx) + 0.5, y: Math.round(kamera.cy) + 0.5 };
    if (!taskId) taskId = registerTask('rex: erhebt sich', true);
    if (!geo) {
      (ladePromise || (ladePromise = lade())).then(() => { if (offen && !segIds.length) baue(); });
      return;
    }
    baue();
  }

  function baue() {
    const AG = store.baseTint;
    const nSeg = geo.polys.reduce((n, p) => n + p.length - 1, 0);
    segIds = [];
    knotIds = [];
    for (let k = 0; k < nSeg; k++) {
      const id = allocReserve(store, mitte.x, mitte.y);
      if (id < 0) break;
      wakeAgent(store, id, t0, Math.random() * 0.9, {
        size: 0.02, shape: shapeId('squircle'), taskId, swirl: true,
        px: mitte.x + (Math.random() - 0.5) * 10,
        py: mitte.y + (Math.random() - 0.5) * 8,
      });
      store.state[id] = STATE.TEXT;
      store.tgtR[id] = store.colR[id] = AG[0] * R.briKante;
      store.tgtG[id] = store.colG[id] = AG[1] * R.briKante;
      store.tgtB[id] = store.colB[id] = AG[2] * R.briKante;
      segIds.push(id);
    }
    for (let k = 0; k < geo.knoten.length; k++) {
      const id = allocReserve(store, mitte.x, mitte.y);
      if (id < 0) break;
      wakeAgent(store, id, t0, Math.random() * 0.9, {
        size: 0.02, shape: CIRCLE, taskId, swirl: true,
        px: mitte.x + (Math.random() - 0.5) * 10,
        py: mitte.y + (Math.random() - 0.5) * 8,
      });
      store.state[id] = STATE.TEXT;
      store.tgtR[id] = store.colR[id] = AG[0] * R.briKnoten;
      store.tgtG[id] = store.colG[id] = AG[1] * R.briKnoten;
      store.tgtB[id] = store.colB[id] = AG[2] * R.briKnoten;
      knotIds.push(id);
    }
    store.needsRebuild = true;
  }

  function close() {
    if (!offen) return;
    offen = false;
    dissolveIds(segIds);
    dissolveIds(knotIds);
    for (const id of [...segIds, ...knotIds]) {
      store.zPos[id] = 0;
      store.aspekt[id] = 1;
    }
    segIds = [];
    knotIds = [];
  }

  // Modellpunkt → Welt (x, y, z<0 = über der Fläche), mit Kopf-Yaw
  function welt(v, e, sinY, cosY, out) {
    let mx = v[0], my = v[1];
    // Kopf = der zur Kamera ragende Teil (Modell-z klein): weich
    // gewichtete Drehung um die Hochachse — Rex schaut dem Cursor nach
    const w = Math.min(1, Math.max(0, (R.kopfZ - v[2]) / 0.9));
    if (w > 0.001) {
      const cw = 1 + (cosY - 1) * w, sw = sinY * w;
      const rx = mx * cw - my * sw;
      my = mx * sw + my * cw;
      mx = rx;
    }
    out.x = mitte.x + mx * geo.s;
    out.y = mitte.y - my * geo.s;
    out.z = (v[2] - geo.maxZ) * geo.s * e;
    return out;
  }

  const W1 = { x: 0, y: 0, z: 0 };
  const W2 = { x: 0, y: 0, z: 0 };

  function update(tNow, dt) {
    if (!offen || !geo || segIds.length === 0) return;
    const P = store.p3d;
    const glatt = (x) => x * x * (3 - 2 * x);
    const e = glatt(Math.min(1, (tNow - t0) / R.hebSec));
    // der Kopf folgt dem Cursor — weich, nie snappend
    const zielYaw = cursor.active
      ? Math.max(-R.maxYaw, Math.min(R.maxYaw, (cursor.wx - mitte.x) * 0.09))
      : 0;
    yaw += (zielYaw - yaw) * Math.min(1, 3.5 * dt);
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);

    const verts = geo.mesh.verts;
    let sIdx = 0;
    for (const poly of geo.polys) {
      welt(verts[poly[0]], e, sinY, cosY, W1);
      project3d(P, kamera, W1.x, W1.y, W1.z, PR);
      for (let k = 1; k < poly.length; k++) {
        const id = segIds[sIdx++];
        if (id === undefined) return;
        welt(verts[poly[k]], e, sinY, cosY, W2);
        project3d(P, kamera, W2.x, W2.y, W2.z, PR2);
        if (PR.hidden || PR2.hidden) {
          store.sizeTgt[id] = 0;
        } else {
          // Agent = das Segment: Welt-Mitte + z; Länge/Winkel aus der
          // Projektion → Dicke wächst zur Kamera (·k im Packing)
          const mx = (W1.x + W2.x) / 2, my = (W1.y + W2.y) / 2;
          store.homeX[id] = mx;
          store.homeY[id] = my;
          store.targetX[id] = mx;
          store.targetY[id] = my;
          store.zPos[id] = (W1.z + W2.z) / 2;
          const len = Math.hypot(PR2.x - PR.x, PR2.y - PR.y);
          const kMid = (PR.k + PR2.k) / 2;
          store.sizeTgt[id] = R.dicke;
          store.rot[id] = Math.atan2(PR2.y - PR.y, PR2.x - PR.x);
          store.aspekt[id] = Math.max(0.2, len / Math.max(R.dicke * kMid, 1e-4));
        }
        PR.x = PR2.x; PR.y = PR2.y; PR.k = PR2.k; PR.hidden = PR2.hidden;
        W1.x = W2.x; W1.y = W2.y; W1.z = W2.z;
      }
    }
    for (let k = 0; k < knotIds.length; k++) {
      const id = knotIds[k];
      const v = verts[geo.knoten[k]];
      welt(v, e, sinY, cosY, W1);
      store.homeX[id] = W1.x;
      store.homeY[id] = W1.y;
      store.targetX[id] = W1.x;
      store.targetY[id] = W1.y;
      store.zPos[id] = W1.z;
      store.sizeTgt[id] = R.knoten;
      store.aspekt[id] = 1;
    }
  }

  return {
    open, close, update,
    toggle(tNow) { if (offen) close(); else open(tNow); },
    get isOpen() { return offen; },
  };
}
