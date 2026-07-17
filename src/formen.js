// FORMEN: hybrides SDF-System. Analytische Grundformen (Kreis, Quadrat,
// Dreieck) plus ein zur Laufzeit gebauter Distanzfeld-Atlas für beliebige
// Formen: der Squircle aus shape.svg (Standardform aller Agenten), die
// beiden Claw-Kratzer, Poppins-Glyphen und Komposit-Kacheln (DI-Logo,
// Augen-Kachel der Agentenkarte). Alles sind Distanzfelder → jede Form
// kann stufenlos in jede andere morphen.
//
// Kachel-Layout: grid×grid Kacheln à tile px; Form-Id = 8 + Kachelindex.
// Kodierung: byte = 0.5 + d/(2·spread), d in px (positiv = außen).
import { CONFIG } from './config.js';

export const CIRCLE = 0;
export const SQUARE = 1;
export const TRIANGLE = 2;

const F = CONFIG.formen;
const ATLAS = F.tile * F.grid;

const state = {
  data: new Uint8Array(ATLAS * ATLAS).fill(255), // 255 ≈ weit außen
  nextTile: 0,
  ids: new Map(),      // name → shapeId
  glyphIds: new Map(), // "600:A" → shapeId
  version: 0,          // Renderer laden den Atlas neu, wenn sich das ändert
  svg: null,           // { squircle: Path2D, klaue1: Path2D, klaue2: Path2D, … }
};

// ---- Felzenszwalb: exakte euklidische Distanztransformation (2×1D) ---------

const INF = 1e20;
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// mask (0/1, n×n) → quadrierte Distanz zum nächsten gesetzten Pixel
function edt2d(binary, n) {
  const g = new Float64Array(n * n);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {           // Spalten
    for (let y = 0; y < n; y++) f[y] = binary[y * n + x] ? 0 : INF;
    edt1d(f, d, v, z, n);
    for (let y = 0; y < n; y++) g[y * n + x] = d[y];
  }
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {           // Zeilen
    for (let x = 0; x < n; x++) f[x] = g[y * n + x];
    edt1d(f, d, v, z, n);
    for (let x = 0; x < n; x++) out[y * n + x] = d[x];
  }
  return out;
}

// ---- Kachel-Erzeugung -------------------------------------------------------

const tileCv = document.createElement('canvas');
tileCv.width = F.tile;
tileCv.height = F.tile;
const tileCtx = tileCv.getContext('2d', { willReadFrequently: true });

// draw(ctx, box) zeichnet die Form WEISS in die Box { x, y, w, h }
// (Span-Bereich der Kachel); danach Maske → signiertes Distanzfeld → Atlas.
function buildTile(draw) {
  if (state.nextTile >= F.grid * F.grid) throw new Error('formen: atlas voll');
  const T = F.tile;
  const margin = (1 - F.span) * T * 0.5;
  tileCtx.clearRect(0, 0, T, T);
  tileCtx.save();
  draw(tileCtx, { x: margin, y: margin, w: T - 2 * margin, h: T - 2 * margin });
  tileCtx.restore();

  const img = tileCtx.getImageData(0, 0, T, T).data;
  const inside = new Uint8Array(T * T);
  const outside = new Uint8Array(T * T);
  for (let p = 0; p < T * T; p++) {
    const a = img[p * 4 + 3] > 127 ? 1 : 0;
    inside[p] = a;
    outside[p] = 1 - a;
  }
  const dIn = edt2d(inside, T);   // Abstand zum Inneren (für Außenpixel)
  const dOut = edt2d(outside, T); // Abstand zum Äußeren (für Innenpixel)

  const t = state.nextTile++;
  const tx = (t % F.grid) * T;
  const ty = ((t / F.grid) | 0) * T;
  for (let y = 0; y < T; y++) {
    const row = (ty + y) * ATLAS + tx;
    for (let x = 0; x < T; x++) {
      const p = y * T + x;
      const d = inside[p] ? -Math.sqrt(dOut[p]) : Math.sqrt(dIn[p]);
      let v = 0.5 + d / (2 * F.spread);
      if (v < 0) v = 0; else if (v > 1) v = 1;
      state.data[row + x] = (v * 255) | 0;
    }
  }
  state.version++;
  return 8 + t;
}

// Pfad (Path2D + viewBox) eingepasst in die Box, Seitenverhältnis erhalten
function drawPathFitted(ctx, box, path, vbW, vbH) {
  const s = Math.min(box.w / vbW, box.h / vbH);
  ctx.translate(box.x + (box.w - vbW * s) / 2, box.y + (box.h - vbH * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.fill(path);
}

// ---- Öffentliche Registrierung ---------------------------------------------

export function registerShape(name, draw) {
  if (state.ids.has(name)) return state.ids.get(name);
  const id = buildTile(draw);
  state.ids.set(name, id);
  return id;
}

export function shapeId(name) {
  const id = state.ids.get(name);
  if (id === undefined) throw new Error('formen: unbekannte Form ' + name);
  return id;
}

// Poppins-Glyphe als eigene Kachel (ein Buchstabe = ein Agent)
export function glyphShape(ch, weight = 600) {
  const key = weight + ':' + ch;
  if (state.glyphIds.has(key)) return state.glyphIds.get(key);
  const id = buildTile((ctx, box) => {
    const px = 200;
    ctx.font = `${weight} ${px}px Poppins`;
    const m = ctx.measureText(ch);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const s = Math.min(box.w / w, box.h / h);
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.scale(s, s);
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, -w / 2 + m.actualBoundingBoxLeft, -h / 2 + m.actualBoundingBoxAscent);
  });
  state.glyphIds.set(key, id);
  return id;
}

async function loadSvgPaths(url) {
  const text = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const vb = (doc.documentElement.getAttribute('viewBox') || '0 0 100 100')
    .split(/\s+/).map(Number);
  const paths = [...doc.querySelectorAll('path')].map((p) => new Path2D(p.getAttribute('d')));
  return { paths, w: vb[2], h: vb[3] };
}

// Atlas aufbauen: Squircle (Default), Claws, Logo-/Karten-Kacheln, L + U.
// Muss NACH document.fonts.ready laufen (Poppins-Glyphen).
export async function initFormen() {
  const [shape, claws] = await Promise.all([
    loadSvgPaths('assets/svg/shape.svg'),
    loadSvgPaths('assets/svg/claws.svg'),
  ]);
  state.svg = { shape, claws };

  registerShape('squircle', (ctx, box) =>
    drawPathFitted(ctx, box, shape.paths[0], shape.w, shape.h));

  // je ein Kratzer = ein Schwarmagent
  registerShape('klaue1', (ctx, box) =>
    drawPathFitted(ctx, box, claws.paths[0], claws.w, claws.h));
  registerShape('klaue2', (ctx, box) =>
    drawPathFitted(ctx, box, claws.paths[1], claws.w, claws.h));

  // DI-Kachel: Squircle mit ausgestanztem „D I" (Referenz 08)
  registerShape('diTile', (ctx, box) => {
    drawPathFitted(ctx, box, shape.paths[0], shape.w, shape.h);
    ctx.resetTransform();
    ctx.globalCompositeOperation = 'destination-out';
    const px = box.h * 0.42;
    ctx.font = `600 ${px}px Poppins`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2 + px * 0.04;
    ctx.fillText('D', cx - box.w * 0.16, cy);
    ctx.fillText('I', cx + box.w * 0.20, cy);
  });

  // Augen-Kachel: Squircle mit zwei Sehschlitzen (Referenz 04)
  registerShape('augenTile', (ctx, box) => {
    drawPathFitted(ctx, box, shape.paths[0], shape.w, shape.h);
    ctx.resetTransform();
    ctx.globalCompositeOperation = 'destination-out';
    const ew = box.w * 0.085, eh = box.h * 0.30;
    const ey = box.y + box.h * 0.47 - eh / 2;
    for (const off of [-0.185, 0.185]) {
      const ex = box.x + box.w * (0.5 + off) - ew / 2;
      ctx.beginPath();
      ctx.roundRect(ex, ey, ew, eh, ew / 2);
      ctx.fill();
    }
  });

  glyphShape('L');
  glyphShape('U');

  return formenInfo();
}

export function formenInfo() {
  return {
    data: state.data,
    size: ATLAS,
    tile: F.tile,
    grid: F.grid,
    // Shader: d_lokal = (byte/255 − 0.5) · sdfRange, Quad-Lokalraum [−1,1]
    sdfRange: (4 * F.spread) / F.tile,
    get version() { return state.version; },
  };
}
