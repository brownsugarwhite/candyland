// Gemeinsames Instanz-Format für WebGPU- und WebGL2-Renderer — die eine
// Quelle der Wahrheit fürs Packing. Ein Agent = eine Instanz (Quad):
//   [x, y, size, rot, r, g, b, shapeA, shapeB, shapeT, aspect, frei] = 12 f32
//   (48 B; aspect = anisotrope Streckung entlang der rot-Achse, 1 = rund)
// Koordinaten/Größe in WELTEINHEITEN; Farbe bereits mit Helligkeit
// multipliziert (premultiplied über dunklem Grund).
import { CONFIG } from './config.js';
import { STATE } from './swarm.js';

export const INST_FLOATS = 12;

// ---- ECHTES 3D ------------------------------------------------------------
// Der Schwarm lebt auf der Ebene z = 0 (z zeigt in den Boden) und wird
// IMMER durch eine echte Lochkamera projiziert: Sie hängt in Höhe hc über
// dem Kamera-Pivot (kamera.cx/cy) und blickt senkrecht nach unten —
// GELOCKTE Perspektive. Für flache Punkte (z = 0, tilt = 0) ist diese
// Projektion mathematisch EXAKT die bisherige direkte Abbildung: der
// Grundlook ändert sich nie um ein Pixel. Alles mit Tiefe (der Wurmloch-
// Schlund ist ein unendlich tiefer Tubus) zeigt echte Perspektive und
// echte Parallaxe. store.p3d hält den Kamerazustand: hc = aktuelle Höhe
// (der Wurmloch-Flug taucht damit WIRKLICH durch die Oberfläche), h0 =
// Ruhehöhe, tilt = Neigung der entsperrten Perspektive („frei"-Befehl).
// Die Ausgabe sind Pseudo-Welt-Koordinaten — die Backend-Shader rechnen
// unverändert screen = (p − cam)·scale + mitte. Solange p3d.aktiv falsch
// ist (kein Tunnel, keine Neigung, kein Flug), läuft der schnelle
// Originalpfad ganz ohne Projektion.

// SCHWARZES LOCH, Weltebene: sorgt dafür, dass die QUELLFLÄCHE des
// Lochs immer komplett leer ist (Agenten innerhalb schluck·r werden
// weich verschluckt) und verdichtet die Umgebung sanft Richtung Ring.
// Die ECHTE Linsenverzerrung (gekrümmte Bögen) passiert danach pro
// Pixel im Post-Shader (Punktmassen-Linse) — dieser Warp liefert ihr
// nur eine saubere, leere Quelle. h.st blendet weich ein, nie snappend.
export function lochWarp(P, x, y, out) {
  out.x = x; out.y = y; out.f = 1; out.hidden = false;
  const holes = P.holes;
  for (let k = 0; k < holes.length; k++) {
    const h = holes[k];
    const dx = out.x - h.x, dy = out.y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
    if (d >= h.reich) continue;
    if (d <= h.schluck) {
      // verschluckt — die Quellfläche der Linse ist immer leer
      out.f *= Math.max(0, 1 - h.st * 1.5);
      if (out.f <= 0.02) { out.hidden = true; return out; }
      continue;
    }
    const u = (d - h.schluck) / (h.reich - h.schluck); // 0 innen … 1 außen
    const rp = h.schluck + (h.reich - h.schluck) * Math.pow(u, h.kruemm);
    out.x += ((h.x + (dx / d) * rp) - out.x) * h.st;
    out.y += ((h.y + (dy / d) * rp) - out.y) * h.st;
    out.f *= 1 - 0.3 * (1 - u) * h.st; // sanft kleiner Richtung Loch
  }
  return out;
}

// Lochkamera-Projektion → Pseudo-Welt; k = Größenfaktor, dim = Tiefenlicht
export function project3d(P, kamera, x, y, z, out) {
  // Wurmloch-Durchflug: ECHTE Drehung der Welt um die vertikale Achse
  // durch das Loch (kein Screen-Effekt) — 0 → 180° während der Reise
  if (P.yaw !== 0) {
    const dxp = x - P.yawX, dyp = y - P.yawY;
    x = P.yawX + dxp * P.cosYaw - dyp * P.sinYaw;
    y = P.yawY + dxp * P.sinYaw + dyp * P.cosYaw;
  }
  let rx = x - kamera.cx, ry = y - kamera.cy, rz = z;
  if (P.tilt !== 0) {
    const vy = P.cosT * ry - P.sinT * rz;
    rz = P.sinT * ry + P.cosT * rz;
    ry = vy;
  }
  const depth = P.hc + rz;
  if (depth < 1.0) { out.hidden = true; return out; } // Near-Plane der Kamera
  let k = P.h0 / depth;
  if (P.ortho > 0) k += (1 - k) * P.ortho; // 2d/iso: orthografisch (k → 1)
  out.x = kamera.cx + rx * k;
  out.y = kamera.cy + ry * k;
  out.k = k;
  out.dim = z > 0.001 ? Math.exp(-z * P.dimm) : 1;
  out.hidden = false;
  return out;
}

const PJ_A = { x: 0, y: 0, k: 1, dim: 1, hidden: false };
const PJ_B = { x: 0, y: 0, k: 1, dim: 1, hidden: false };

// Tiefennebel: tiefe Agenten versinken in der HINTERGRUNDFARBE (nicht in
// Schwarz) — dim = 1 obenauf, dim = 0 unten = unsichtbar vor dem Grund
const FOG = hexToRgb01('#31353a');

const LW_A = { x: 0, y: 0, f: 1, hidden: false };
const LW_B = { x: 0, y: 0, f: 1, hidden: false };

// Aktive, sichtbare Agenten in arr packen (Kamera-Culling inklusive).
// → Anzahl geschriebener Instanzen.
export function packInstances(store, kamera, arr) {
  const {
    activeList, activeCount, active, posX, posY, size, brightness,
    colR, colG, colB, rot, shapeA, shapeB, shapeT, aspekt,
  } = store;
  const P = store.p3d;
  const aktiv = !!(P && P.aktiv);
  const scale = kamera.scale;
  const cx = kamera.cx, cy = kamera.cy;
  const halfW = kamera.viewW / 2 / scale;
  const halfH = kamera.viewH / 2 / scale;
  const inv = 1 / 255;
  let w = 0;

  // Maler-Reihenfolge: mit Tiefe (zPos, z. B. Rex) wird fern → nah
  // gezeichnet, damit Näheres Ferneres verdeckt
  let liste = null;
  if (aktiv) {
    liste = [];
    for (let kk = 0; kk < activeCount; kk++) {
      const i = activeList[kk];
      if (active[i] === 0) continue;
      const z = store.zPos[i];
      const rz = P.tilt !== 0 ? P.sinT * (posY[i] - cy) + P.cosT * z : z;
      liste.push({ i, z, dep: P.hc + rz });
    }
    liste.sort((a, b) => b.dep - a.dep);
  }

  const n = aktiv ? liste.length : activeCount;
  for (let k = 0; k < n; k++) {
    let i, z = 0;
    if (aktiv) {
      i = liste[k].i;
      z = liste[k].z;
    } else {
      i = activeList[k];
      if (active[i] === 0) continue;
    }
    let b = brightness[i];
    if (b <= 0.01) continue;
    let px = posX[i], py = posY[i], sz = size[i];
    let fog = 1, rotV = rot[i], aspect = aspekt[i];
    if (aktiv) {
      // Schwarzes-Loch-Warp (Weltebene) — nur gebundene Gitteragenten
      if (P.holes.length > 0 && i < store.latticeCount &&
          store.state[i] <= STATE.RETURNING) {
        lochWarp(P, px, py, LW_A);
        if (LW_A.hidden) continue;
        px = LW_A.x;
        py = LW_A.y;
        sz *= LW_A.f;
      }
      project3d(P, kamera, px, py, z, PJ_A);
      if (PJ_A.hidden) continue;
      px = PJ_A.x;
      py = PJ_A.y;
      sz *= PJ_A.k;
      fog = PJ_A.dim;
      if (fog <= 0.03) continue; // ganz unten = eins mit dem Grund
    }
    const half = sz * 0.6; // etwas Luft für Rotation/AA
    if (px + half < cx - halfW || px - half > cx + halfW ||
        py + half < cy - halfH || py - half > cy + halfH) continue;
    arr[w++] = px;
    arr[w++] = py;
    arr[w++] = sz;
    arr[w++] = rotV;
    arr[w++] = colR[i] * b * inv * fog + FOG[0] * (1 - fog);
    arr[w++] = colG[i] * b * inv * fog + FOG[1] * (1 - fog);
    arr[w++] = colB[i] * b * inv * fog + FOG[2] * (1 - fog);
    arr[w++] = shapeA[i];
    arr[w++] = shapeB[i];
    arr[w++] = shapeT[i] < 0 ? 0 : shapeT[i];
    arr[w++] = aspect; // radiale Streckung (1 = rund) — Slot 10
    arr[w++] = 0;
  }
  return w / INST_FLOATS;
}

// Linien-Vertices packen: [x, y, r, g, b, a] — Mesh-Kanten (Aktivität
// lässt Synapsen aufleuchten) + freie Linien aus store.extraLines
// (Vektor-Pfade, 3D-Drahtgitter, Handle-Arme).
export const LINE_FLOATS = 6;

// → { nMesh, nTotal }: Mesh-Linien [0, nMesh) unter den Agenten,
// freie Linien [nMesh, nTotal) DARÜBER (Vektor-Pfade, 3D-Kanten)
export function packLines(store, kamera, arr) {
  let w = 0;
  const P = store.p3d;
  const aktiv = !!(P && P.aktiv);
  const scale = kamera.scale;
  const cx = kamera.cx, cy = kamera.cy;
  const halfW = kamera.viewW / 2 / scale + 1;
  const halfH = kamera.viewH / 2 / scale + 1;
  const onScreen = (x, y) =>
    x > cx - halfW && x < cx + halfW && y > cy - halfH && y < cy + halfH;

  if (store.meshEnabled && store.edges && store.edges.length > 0) {
    const N = CONFIG.neural;
    const T = N.tint;
    const { posX, posY, targetX, targetY, state, active, brightness } = store;
    const edges = store.edges;
    for (let e = 0; e < edges.length; e += 2) {
      const i = edges[e], j = edges[e + 1];
      if (active[i] === 0 || active[j] === 0) continue;
      if (state[i] > STATE.RETURNING || state[j] > STATE.RETURNING) continue;
      if (!onScreen(posX[i], posY[i]) && !onScreen(posX[j], posY[j])) continue;
      // überdehnte Federn (verdrängte Nachbarn) zeichnen keine Linien —
      // sonst spannt sich ein Netz quer über Apps und Karten
      const ldx = posX[i] - posX[j], ldy = posY[i] - posY[j];
      if (ldx * ldx + ldy * ldy > 6.8) continue;
      const act =
        Math.abs(posX[i] - targetX[i]) + Math.abs(posY[i] - targetY[i]) +
        Math.abs(posX[j] - targetX[j]) + Math.abs(posY[j] - targetY[j]);
      const glow = brightness[i] + brightness[j] - 1.3;
      let a = N.baseAlpha + N.gainAlpha * act + (glow > 0 ? N.glowAlpha * glow : 0);
      if (a > N.maxAlpha) a = N.maxAlpha;
      if (a < 0.012) continue;
      let x0 = posX[i], y0 = posY[i], x1 = posX[j], y1 = posY[j];
      // das Raumnetz krümmt sich mit ins Loch und folgt der 3D-Kamera
      if (aktiv) {
        if (P.holes.length > 0) {
          lochWarp(P, x0, y0, LW_A);
          lochWarp(P, x1, y1, LW_B);
          if (LW_A.hidden || LW_B.hidden) continue;
          x0 = LW_A.x; y0 = LW_A.y; x1 = LW_B.x; y1 = LW_B.y;
        }
        project3d(P, kamera, x0, y0, 0, PJ_A);
        project3d(P, kamera, x1, y1, 0, PJ_B);
        if (PJ_A.hidden || PJ_B.hidden) continue;
        x0 = PJ_A.x; y0 = PJ_A.y; x1 = PJ_B.x; y1 = PJ_B.y;
        // nahe der Near-Plane explodiert die Projektion — solche
        // extrem gestreckten Kanten fächern hässlich: weglassen
        const pdx = x1 - x0, pdy = y1 - y0;
        if (pdx * pdx + pdy * pdy > 40) continue;
      }
      arr[w++] = x0; arr[w++] = y0;
      arr[w++] = T[0]; arr[w++] = T[1]; arr[w++] = T[2]; arr[w++] = a;
      arr[w++] = x1; arr[w++] = y1;
      arr[w++] = T[0]; arr[w++] = T[1]; arr[w++] = T[2]; arr[w++] = a;
    }
  }

  const nMesh = w / LINE_FLOATS;
  const ex = store.extraLines;
  for (let k = 0; k + 7 < ex.length; k += 8) {
    arr[w++] = ex[k]; arr[w++] = ex[k + 1];
    arr[w++] = ex[k + 4]; arr[w++] = ex[k + 5]; arr[w++] = ex[k + 6]; arr[w++] = ex[k + 7];
    arr[w++] = ex[k + 2]; arr[w++] = ex[k + 3];
    arr[w++] = ex[k + 4]; arr[w++] = ex[k + 5]; arr[w++] = ex[k + 6]; arr[w++] = ex[k + 7];
  }
  return { nMesh, nTotal: w / LINE_FLOATS };
}

export function lineCapacity(store) {
  return (store.edges ? store.edges.length : 0) + store.extraLines.length / 4 + 64;
}

export function hexToRgb01(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
