// REX — der Dirigent morpht aus den VERBINDUNGSLINIEN des Schwarms
// (Referenz 12): Die Linien sind ECHTE Linien (Kapsel-Pass in den
// Renderern), KEINE Agenten; Agenten sitzen nur an den Knotenpunkten
// des subdividierten Käfigs — und nur auf der Platte. Ablauf beim
// Claws-Klick:
//   1. die betroffenen Gitteragenten skalieren nach Nähe zum Rex
//      (außen ~0.5 der Kachelgröße, am inneren Ring → 0),
//   2. die Linien im Kopfbereich werden mit Transition ~3px dick,
//   3. aus den geraden Gitterlinien formen sich smooth die gekrümmten
//      Kurven des Rexkopfs (Morph gerade → subdividierte Kurve,
//      gestaffelt von außen nach innen), während Kopf und Arme sich
//      von hinten durch das Gitter pressen (z-Hub).
// Die radialen Speichen laufen über den Plattenrand hinaus und docken
// an echte, volle Gitterkacheln an — der Schwarm ist sichtbar direkt
// mit Rex' Drahtgitter verbunden.
//
// VORBEREITUNG FÜR DIE BLENDER-ANIMATION: Catmull-Clark ist LINEAR in
// den Käfig-Vertices. Beim Laden entsteht die Gewichtsmatrix
// (geo.gewichte: Level-2-Punkt = Σ wᵢ·CageVertᵢ). Eine animierte Pose
// (glTF Shape Keys oder OBJ-Sequenz mit identischer Topologie) muss
// nur die Käfig-Vertices liefern — applyPose() erzeugt daraus die
// glatten Kurven, Linien und Knoten folgen automatisch. Der
// „Durchpress"-Eindruck: die Platte bleibt bei Modell-minZ fix,
// Kopf/Arme animieren primär in Modell-z Richtung Kamera.
import { CONFIG } from './config.js';
import { STATE, wakeAgent, allocReserve } from './swarm.js';
import { project3d } from './renderformat.js';

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

// ---- Catmull-Clark, GENERISCH über eine lineare Algebra -------------------
// add/mul arbeiten auf opaken Werten: mit Vektoren liefert der Schritt
// Positionen, mit Gewichts-Maps die Subdivisions-GEWICHTSMATRIX
// (Grundlage für spätere Käfig-Animationen). Randregeln inklusive.
const eKey = (a, b) => (a < b ? a * 131072 + b : b * 131072 + a);

function ccStep(verts, faces, add, mul) {
  const nV = verts.length;

  const facePts = faces.map((f) => {
    let p = null;
    for (const i of f) p = p === null ? verts[i] : add(p, verts[i]);
    return mul(p, 1 / f.length);
  });

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
      let F = null;
      for (const fi of vFaces[i]) F = F === null ? facePts[fi] : add(F, facePts[fi]);
      F = mul(F, 1 / n);
      let R = null;
      for (const e of vEdges[i]) {
        const m = mul(add(verts[e.a], verts[e.b]), 0.5);
        R = R === null ? m : add(R, m);
      }
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

// Gewichts-Algebra: ein Wert = Map(cageIdx → Gewicht)
const wAdd = (a, b) => {
  const m = new Map(a);
  for (const [k, v] of b) m.set(k, (m.get(k) || 0) + v);
  return m;
};
const wMul = (a, s) => {
  const m = new Map();
  for (const [k, v] of a) m.set(k, v * s);
  return m;
};

// Käfig-Pose → glatte Level-2-Positionen (linear, deshalb animierbar)
function applyPose(cage, gewichte) {
  return gewichte.map((g) => {
    let x = 0, y = 0, z = 0;
    for (const [i, w] of g) {
      const v = cage[i];
      x += v[0] * w; y += v[1] * w; z += v[2] * w;
    }
    return [x, y, z];
  });
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
  const { kamera, registerTask, dissolveIds, revert, cursor } = deps;
  const R = CONFIG.rex3d;
  let geo = null;
  let offen = false;
  let t0 = 0;
  let mitte = { x: 0, y: 0 };
  let yaw = 0;
  let taskId = 0;
  let knotIds = [];       // { id, gitter, k } — nur Platten-Knoten
  let anschluss = [];     // { k (Knoten-Index), carrier (Gitteragent) }
  const PR = { x: 0, y: 0, k: 1, dim: 1, hidden: false };
  const PR2 = { x: 0, y: 0, k: 1, dim: 1, hidden: false };
  const W1 = { x: 0, y: 0, z: 0 };
  const W2 = { x: 0, y: 0, z: 0 };
  const glatt = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  const log = (m) => {
    (window.__rexLog = window.__rexLog || []).push(m);
  };

  let ladePromise = null;

  async function lade() {
    const text = await (await fetch('assets/obj/rex.obj')).text();
    const cage = filterRex(parseObj(text));
    // Käfig-Polylinien: jede Ur-Kante; Knoten: jeder Ur-Vertex
    let polys = [];
    const seen = new Set();
    for (const f of cage.faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k], b = f[(k + 1) % f.length];
        const key = eKey(a, b);
        if (!seen.has(key)) { seen.add(key); polys.push([a, b]); }
      }
    }
    // ZWEI Subdivisionsschritte auf der GEWICHTSMATRIX (linear →
    // animierbar); Positionen kommen aus applyPose(cage-Pose)
    let wVerts = cage.verts.map((_, i) => new Map([[i, 1]]));
    let faces = cage.faces;
    let knoten = cage.verts.map((_, i) => i);
    for (let s = 0; s < 2; s++) {
      const step = ccStep(wVerts, faces, wAdd, wMul);
      polys = refine(polys, step);
      knoten = knoten.map((i) => step.vertIdx[i]);
      wVerts = step.verts;
      faces = step.faces;
    }
    const pos = applyPose(cage.verts, wVerts);

    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const v of cage.verts) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
    const spanX = maxX - minX;
    const spanZ = Math.max(1e-3, maxZ - minZ);
    const halbePlatte = spanX / 2;
    const hoehe = (v) => glatt((v[2] - minZ) / spanZ); // 0 Platte … 1 Kopf

    // je Polyline: Endknoten (Level-2), Kopf-Faktor, Stagger-Delay
    const polyInfo = polys.map((poly) => {
      const a = pos[poly[0]], b = pos[poly[poly.length - 1]];
      const h = Math.max(hoehe(a), hoehe(b));
      const r = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) / halbePlatte;
      return { h, delay: 1 - Math.min(1, r) }; // außen zuerst, innen später
    });

    // Knoten: nur die PLATTE bekommt Agenten; radiale Lage fürs
    // Größen-Gefälle außen 0.5 → innen 0
    const knotInfo = knoten.map((ki) => {
      const v = pos[ki];
      const h = hoehe(v);
      const r = Math.min(1.2, Math.hypot(v[0], v[1]) / halbePlatte);
      return { h, r, platte: h < 0.16, rand: h < 0.16 && r > 0.82 };
    });

    geo = {
      pos, polys, polyInfo, knoten, knotInfo, gewichte: wVerts,
      spanX, minZ, spanZ, halbePlatte,
    };
  }

  // Geometrie schon beim Boot vorladen — der erste Klick baut sofort
  ladePromise = lade().catch(() => { ladePromise = null; });

  function open(tNow) {
    log(`open t=${tNow.toFixed(2)} geo=${!!geo}`);
    if (offen) return;
    offen = true;
    t0 = tNow;
    // rechts unter der Bildmitte (Referenz 12), am Gitter ausgerichtet
    const w = kamera.screenToWorld(kamera.viewW * R.posX, kamera.viewH * R.posY);
    mitte = { x: Math.round(w.x) + 0.5, y: Math.round(w.y) + 0.5 };
    if (!taskId) taskId = registerTask('rex: erhebt sich', true);
    if (!geo) {
      (ladePromise || (ladePromise = lade())).then(() => {
        if (offen && !knotIds.length) baue();
      });
      return;
    }
    baue();
  }

  function baue() {
    log(`baue polys=${geo.polys.length} frei=${store.freeCount}`);
    knotIds = [];
    anschluss = [];
    const s0 = (R.breitePx / kamera.scale) / geo.spanX;
    // Platten-Knoten: die Gitteragenten unter Rex verdichten/lockern
    // sich auf diese Punkte — jeder übernimmt den nächstgelegenen
    const kPos = [];
    geo.knoten.forEach((ki, k) => {
      if (!geo.knotInfo[k].platte) return; // Körper: KEINE Knoten-Agenten
      const v = geo.pos[ki];
      kPos.push({ k, x: mitte.x + v[0] * s0, y: mitte.y - v[1] * s0, id: -1 });
    });
    const radius = (R.breitePx / kamera.scale) * 0.55;
    const unter = [];
    for (const i of store.carrierList) {
      if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
      const dx = store.homeX[i] - mitte.x, dy = store.homeY[i] - mitte.y;
      if (dx * dx + dy * dy < radius * radius) unter.push(i);
    }
    for (const i of unter) {
      let best = -1, bestD = Infinity;
      for (let k = 0; k < kPos.length; k++) {
        if (kPos[k].id >= 0) continue;
        const dx = kPos[k].x - store.homeX[i], dy = kPos[k].y - store.homeY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = k; }
      }
      if (best < 0) break;
      kPos[best].id = i;
      store.state[i] = STATE.TEXT;
      store.taskId[i] = taskId;
      store.frozen[i] = 0;
    }
    const AG = store.baseTint;
    knotIds = kPos.map((p) => {
      if (p.id >= 0) return { id: p.id, gitter: true, k: p.k };
      const id = allocReserve(store, p.x, p.y);
      if (id < 0) return null;
      wakeAgent(store, id, t0, Math.random() * 0.5, {
        size: 0.02, shape: store.globalShape, taskId, swirl: true,
        px: p.x + (Math.random() - 0.5) * 3,
        py: p.y + (Math.random() - 0.5) * 3,
      });
      store.state[id] = STATE.TEXT;
      store.tgtR[id] = store.colR[id] = AG[0] * 0.85;
      store.tgtG[id] = store.colG[id] = AG[1] * 0.85;
      store.tgtB[id] = store.colB[id] = AG[2] * 0.85;
      return { id, gitter: false, k: p.k };
    }).filter(Boolean);

    // Anschluss-Speichen: Rand-Knoten der Platte → nächste VOLLE
    // Gitterkachel (nicht rekrutiert) — der Schwarm läuft in Rex hinein
    for (const kn of knotIds) {
      if (!geo.knotInfo[kn.k].rand) continue;
      const v = geo.pos[geo.knoten[kn.k]];
      const wx = mitte.x + v[0] * s0, wy = mitte.y - v[1] * s0;
      let best = -1, bestD = Infinity;
      for (const i of store.carrierList) {
        if (store.active[i] === 0 || store.state[i] > STATE.RETURNING) continue;
        const dx = store.homeX[i] - wx, dy = store.homeY[i] - wy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD && d2 > 0.2) { bestD = d2; best = i; }
      }
      if (best >= 0 && bestD < 20) anschluss.push({ k: kn.k, carrier: best });
    }
    store.needsRebuild = true;
    log(`baue fertig knoten=${knotIds.length} anschluss=${anschluss.length}`);
  }

  function close() {
    if (!offen) return;
    log('close');
    offen = false;
    const reserveKnoten = [];
    for (const kn of knotIds) {
      store.zPos[kn.id] = 0;
      if (kn.gitter) revert(kn.id);
      else reserveKnoten.push(kn.id);
    }
    dissolveIds(reserveKnoten);
    knotIds = [];
    anschluss = [];
  }

  // Modellpunkt → Welt (x, y, z<0 = über der Fläche), mit Kopf-Yaw.
  // s = Weltmaßstab (Rex ist SCREEN-fest: beim Zoomen immer gleich groß)
  function welt(v, s, e, sinY, cosY, out) {
    let mx = v[0], my = v[1];
    // KOPF und Arme = der nach oben ragende Teil (großes Modell-z):
    // weich gewichtete Drehung um die Hochachse — Rex schaut dem Cursor
    // nach; die Hintergrundplatte (kleines z) bleibt ruhig
    const w = Math.min(1, Math.max(0, (v[2] - R.kopfAb) / R.kopfSpan));
    if (w > 0.001) {
      const cw = 1 + (cosY - 1) * w, sw = sinY * w;
      const rx = mx * cw - my * sw;
      my = mx * sw + my * cw;
      mx = rx;
    }
    out.x = mitte.x + mx * s;
    out.y = mitte.y - my * s;
    out.z = -(v[2] - geo.minZ) * s * e; // durchdrücken: hebt sich mit e
    return out;
  }

  function update(tNow, dt) {
    if (!offen || !geo || knotIds.length === 0) return;
    const P = store.p3d;
    const t = tNow - t0;
    // Phasen: (1) Agenten skalieren, (2) Linien verdicken sich im
    // Kopfbereich, (3) gerade → gekrümmt + Durchpressen — alles weich
    const dickeF = glatt((t - 0.2) / 0.9);
    const e = glatt((t - 0.7) / 1.5);
    const s = (R.breitePx / kamera.scale) / geo.spanX;
    const dickeBasis = R.dickeBasisPx;
    const dickeKopf = R.dickeKopfPx;
    // der Kopf folgt dem Cursor — weich, nie snappend
    const zielYaw = cursor.active
      ? Math.max(-R.maxYaw, Math.min(R.maxYaw, (cursor.wx - mitte.x) * 0.09))
      : 0;
    yaw += (zielYaw - yaw) * Math.min(1, 3.5 * dt);
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const atme = Math.sin(tNow * 0.9) * R.atmen;

    const pos = geo.pos;
    const K = store.kapseln;
    const WEISS = [0.93, 0.95, 0.94];

    for (let p = 0; p < geo.polys.length; p++) {
      const poly = geo.polys[p];
      const info = geo.polyInfo[p];
      // Morph gerade → gekrümmt, gestaffelt von außen nach innen
      const m = glatt((t - 0.35 - info.delay * R.morphSec * 0.5) / R.morphSec);
      const bri = R.briPlatte + (R.briKoerper - R.briPlatte) * info.h;
      const alpha = 0.68 + 0.3 * info.h;
      const dicke = dickeBasis + (dickeKopf - dickeBasis) * info.h * dickeF;
      const A = pos[poly[0]], B = pos[poly[poly.length - 1]];
      let habe = false;
      for (let k = 0; k < poly.length; k++) {
        const v = pos[poly[k]];
        const f = k / (poly.length - 1);
        // gerade Gitterlinie → subdividierte Kurve
        const mx = (A[0] + (B[0] - A[0]) * f) * (1 - m) + v[0] * m;
        const my = (A[1] + (B[1] - A[1]) * f) * (1 - m) + v[1] * m;
        const mz = (A[2] + (B[2] - A[2]) * f) * (1 - m) + v[2] * m;
        welt([mx, my, mz + atme * info.h], s, e, sinY, cosY, W2);
        project3d(P, kamera, W2.x, W2.y, W2.z, PR2);
        if (habe && !PR.hidden && !PR2.hidden) {
          const kM = (PR.k + PR2.k) / 2;
          K.push(PR.x, PR.y, PR2.x, PR2.y,
            WEISS[0] * bri, WEISS[1] * bri, WEISS[2] * bri, alpha,
            dicke * kM);
        }
        PR.x = PR2.x; PR.y = PR2.y; PR.k = PR2.k; PR.hidden = PR2.hidden;
        habe = true;
      }
    }

    // Anschluss-Speichen: Platte → volle Gitterkacheln des Schwarms
    const anBri = R.briPlatte * 0.9;
    for (const an of anschluss) {
      const v = pos[geo.knoten[an.k]];
      welt(v, s, e, sinY, cosY, W1);
      project3d(P, kamera, W1.x, W1.y, W1.z, PR);
      project3d(P, kamera, store.posX[an.carrier], store.posY[an.carrier], 0, PR2);
      if (PR.hidden || PR2.hidden) continue;
      K.push(PR.x, PR.y, PR2.x, PR2.y,
        WEISS[0] * anBri, WEISS[1] * anBri, WEISS[2] * anBri, 0.55,
        dickeBasis * (PR.k + PR2.k) / 2);
    }

    // Platten-Knoten: außen ~0.5 der Kachelgröße, innen → 0
    for (const kn of knotIds) {
      const v = pos[geo.knoten[kn.k]];
      welt(v, s, e, sinY, cosY, W1);
      store.homeX[kn.id] = W1.x;
      store.homeY[kn.id] = W1.y;
      store.targetX[kn.id] = W1.x;
      store.targetY[kn.id] = W1.y;
      store.zPos[kn.id] = W1.z;
      const r = geo.knotInfo[kn.k].r;
      store.sizeTgt[kn.id] = R.skalAussen * glatt((r - 0.3) / 0.6);
    }
  }

  // sanfter Anker-Warp: das umliegende Gitter weicht Rex organisch aus
  // und wird zu ihm hin kleiner — nahtloser Übergang (Referenz 12)
  function anchor() {
    if (!offen) return null;
    const b = R.breitePx / kamera.scale;
    return { wx: mitte.x, wy: mitte.y, sigmaW: b * 0.5, ampW: b * 0.16 };
  }

  return {
    open, close, update, anchor,
    toggle(tNow) { if (offen) close(); else open(tNow); },
    get isOpen() { return offen; },
    debug() { // Headless-Diagnose
      if (!knotIds.length) return { knoten: 0 };
      const kn = knotIds[0];
      return {
        knoten: knotIds.length,
        anschluss: anschluss.length,
        kapseln: store.kapseln.length / 9,
        knot0: {
          i: kn.id, gitter: kn.gitter,
          size: +store.size[kn.id].toFixed(3),
          sizeTgt: +store.sizeTgt[kn.id].toFixed(3),
          z: +store.zPos[kn.id].toFixed(2),
        },
      };
    },
  };
}
