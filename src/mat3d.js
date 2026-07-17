// Minimale 3D-Mathematik für den Schwarm-Editor: Vektoren + Orbit-Kamera
// (Blender-artig, Z nach oben). Keine Matrizen-Bibliothek nötig — die
// Projektion liefert direkt 2D-Weltkoordinaten fürs Gitter plus Tiefe.
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// Orbit-Kamera um ein Ziel; yaw um Z, pitch hebt/senkt den Blick.
export function createOrbit() {
  const cam = {
    target: [0, 0, 0.6],
    dist: 7.5,
    yaw: 0.72,      // Blender-Startansicht: schräg von vorn rechts
    pitch: 0.42,
    fov: 0.66,      // rad
  };

  function basis() {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // Auge auf der Kugel um target
    const eyeDir = [cy * cp, sy * cp, sp];
    const eye = add(cam.target, mul(eyeDir, cam.dist));
    const fwd = norm(sub(cam.target, eye));   // Blickrichtung
    const right = norm(cross(fwd, [0, 0, 1]));
    const up = cross(right, fwd);
    return { eye, fwd, right, up };
  }

  return {
    cam,
    basis,
    orbit(dx, dy) {
      cam.yaw -= dx;
      cam.pitch = Math.min(1.45, Math.max(-1.45, cam.pitch + dy));
    },
    dolly(f) {
      cam.dist = Math.min(30, Math.max(2.2, cam.dist * f));
    },
    // 3D-Punkt → { x, y (Kamera-Ebene, Einheiten), depth } — der Aufrufer
    // skaliert auf Welt-/Screen-Koordinaten. persp ∝ 1/Distanz.
    project(p) {
      const { eye, fwd, right, up } = basis();
      const rel = sub(p, eye);
      const depth = dot(rel, fwd);
      const persp = 1 / (Math.tan(cam.fov / 2) * Math.max(0.1, depth));
      return {
        x: dot(rel, right) * persp,
        y: -dot(rel, up) * persp,
        depth,
        persp,
      };
    },
  };
}
