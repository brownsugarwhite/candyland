// Quad-Mesh für den 3D-Editor: Würfel-Primitiv, Catmull-Clark-Subdivision
// (Referenz 07: der abgerundete Standard-Würfel) und Normalen. Agenten
// sind später die Knotenpunkte dieses Meshes.
import { add, sub, mul, norm, cross } from './mat3d.js';

export function cube(size = 1) {
  const s = size;
  return {
    verts: [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
    ],
    faces: [
      [3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4],
      [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ],
  };
}

export function meshEdges(mesh) {
  const seen = new Map();
  const edges = [];
  for (const f of mesh.faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      if (!seen.has(key)) {
        seen.set(key, edges.length);
        edges.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
  }
  return edges;
}

// Ein Schritt Catmull-Clark (Quad-Meshes bleiben Quads)
export function catmullClark(mesh) {
  const { verts, faces } = mesh;
  const nV = verts.length;

  const facePts = faces.map((f) => {
    let p = [0, 0, 0];
    for (const i of f) p = add(p, verts[i]);
    return mul(p, 1 / f.length);
  });

  // Kanten: key → { a, b, faces: [], mid, pt, idx }
  const edgeMap = new Map();
  const edgeKey = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      }
      edgeMap.get(key).faces.push(fi);
    }
  });
  for (const e of edgeMap.values()) {
    e.mid = mul(add(verts[e.a], verts[e.b]), 0.5);
    if (e.faces.length === 2) {
      e.pt = mul(
        add(add(verts[e.a], verts[e.b]), add(facePts[e.faces[0]], facePts[e.faces[1]])),
        0.25,
      );
    } else {
      e.pt = e.mid; // Randkante
    }
  }

  // Original-Punkte verschieben: (Q + 2R + (n-3)·S) / n
  const vFaces = Array.from({ length: nV }, () => []);
  faces.forEach((f, fi) => { for (const i of f) vFaces[i].push(fi); });
  const vEdges = Array.from({ length: nV }, () => []);
  for (const e of edgeMap.values()) {
    vEdges[e.a].push(e);
    vEdges[e.b].push(e);
  }
  const newOrig = verts.map((v, i) => {
    const n = vFaces[i].length;
    if (n === 0) return v;
    let Q = [0, 0, 0];
    for (const fi of vFaces[i]) Q = add(Q, facePts[fi]);
    Q = mul(Q, 1 / n);
    let R = [0, 0, 0];
    for (const e of vEdges[i]) R = add(R, e.mid);
    R = mul(R, 1 / vEdges[i].length);
    return mul(add(add(Q, mul(R, 2)), mul(v, n - 3)), 1 / n);
  });

  // Neues Mesh: Originale, dann Facepoints, dann Edgepoints
  const outVerts = [...newOrig, ...facePts];
  let idx = outVerts.length;
  for (const e of edgeMap.values()) {
    e.idx = idx++;
    outVerts.push(e.pt);
  }
  const outFaces = [];
  faces.forEach((f, fi) => {
    const fp = nV + fi;
    for (let k = 0; k < f.length; k++) {
      const a = f[k];
      const ePrev = edgeMap.get(edgeKey(f[(k - 1 + f.length) % f.length], a)).idx;
      const eNext = edgeMap.get(edgeKey(a, f[(k + 1) % f.length])).idx;
      outFaces.push([a, eNext, fp, ePrev]);
    }
  });
  return { verts: outVerts, faces: outFaces };
}

export function subdivide(mesh, levels) {
  let m = mesh;
  for (let k = 0; k < levels; k++) m = catmullClark(m);
  return m;
}

// Vertex-Normalen (Flächennormalen gemittelt)
export function vertexNormals(mesh) {
  const normals = mesh.verts.map(() => [0, 0, 0]);
  for (const f of mesh.faces) {
    const n = cross(
      sub(mesh.verts[f[1]], mesh.verts[f[0]]),
      sub(mesh.verts[f[2]], mesh.verts[f[0]]),
    );
    for (const i of f) normals[i] = add(normals[i], n);
  }
  return normals.map(norm);
}

export function faceCenter(mesh, f) {
  let p = [0, 0, 0];
  for (const i of f) p = add(p, mesh.verts[i]);
  return mul(p, 1 / f.length);
}

export function faceNormal(mesh, f) {
  return norm(cross(
    sub(mesh.verts[f[1]], mesh.verts[f[0]]),
    sub(mesh.verts[f[2]], mesh.verts[f[0]]),
  ));
}
