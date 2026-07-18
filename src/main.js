// swarmOS-Bootstrap: async Boot (Poppins → SDF-Atlas → Renderer-Kaskade
// WebGPU → WebGL2 → Canvas2D), dann Hauptschleife mit fixen Physik-
// Substeps. Der wide|high-Toggle baut die Welt für den jeweiligen Modus
// komplett neu auf. ?renderer=gl|2d erzwingt ein Backend (Vergleichstest).
import { CONFIG } from './config.js';
import { buildGitter } from './gitter.js';
import { createKamera } from './kamera.js';
import { createWellen } from './wellen.js';
import { initFormen, shapeId } from './formen.js';
import { createSwarm, stepSwarm, postStep, rebuildActiveList, STATE } from './swarm.js';
import { createRendererGPU } from './rendererGPU.js';
import { createRendererGL } from './rendererGL.js';
import { createRenderer2D } from './renderer2d.js';
import { createDirigent } from './dirigent.js';
import { attachInput } from './input.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('feld');
const hud = createHud();
const params = new URLSearchParams(location.search);

let world = null; // { store, kamera, dirigent, renderer, wellen, detach, raf, tSim }

async function createRenderer(view) {
  const want = params.get('renderer');
  if (want !== 'gl' && want !== '2d') {
    try {
      const gpu = await createRendererGPU(canvas, view);
      if (gpu) return gpu;
    } catch (err) {
      console.warn('[ludi] webgpu nicht verfügbar:', err);
    }
  }
  if (want !== '2d') {
    try {
      const gl = createRendererGL(canvas, view);
      if (gl) return gl;
    } catch (err) {
      console.warn('[ludi] webgl2 nicht verfügbar:', err);
    }
  }
  return createRenderer2D(canvas, view);
}

async function build(mode, viewW, viewH) {
  if (world) {
    cancelAnimationFrame(world.raf);
    world.detach();
    world.renderer.dispose();
    world = null;
  }

  const gitter = buildGitter(mode, viewW, viewH);
  canvas.style.width = gitter.view.w + 'px';
  canvas.style.height = gitter.view.h + 'px';
  const rahmenEl = document.getElementById('rahmen');
  rahmenEl.style.width = gitter.view.w + 'px';
  rahmenEl.style.height = gitter.view.h + 'px';

  const kamera = createKamera(gitter);
  const wellen = createWellen(gitter);
  const store = createSwarm(gitter, shapeId('squircle'));
  const dirigent = createDirigent(store, kamera);
  const renderer = await createRenderer(gitter.view);
  const detach = attachInput(canvas, dirigent, kamera, {
    toggleHud: () => hud.toggle(),
  });

  const w = {
    mode, store, kamera, dirigent, renderer, wellen, detach,
    tSim: 0, raf: 0,
  };

  let prev = performance.now();
  let acc = 0;
  let hudFrames = 0;
  let emaMs = null;

  function frame(frameMs) {
    acc += frameMs / 1000;
    const dt = CONFIG.physics.dt;
    while (acc >= dt) {
      stepSwarm(store, dt, w.tSim);
      w.tSim += dt;
      acc -= dt;
    }
    const dtF = frameMs / 1000;
    kamera.update(dtF);
    wellen.update(dtF, w.tSim);
    postStep(store, w.tSim, dtF, {
      cursor: dirigent.cursor,
      kamera,
      warpRects: dirigent.warpRects,
      veil: dirigent.veil,
      holes: dirigent.holes,
      anchors: dirigent.anchors,
      wellen,
    });
    dirigent.update(w.tSim);
    renderer.render(store, kamera);
  }

  function loop(now) {
    const frameMs = Math.min(CONFIG.physics.maxFrameMs, now - prev);
    prev = now;
    emaMs = emaMs === null ? frameMs : emaMs + 0.1 * (frameMs - emaMs);
    frame(frameMs);
    if (++hudFrames >= 20) {
      hudFrames = 0;
      hud.update({
        fps: emaMs ? 1000 / emaMs : 0,
        wach: store.activeCount,
        slots: store.count,
        mode: dirigent.mode,
        renderer: renderer.kind,
        zoom: kamera.scale,
        hovered: dirigent.hovered,
      });
    }
    w.raf = requestAnimationFrame(loop);
  }
  w.raf = requestAnimationFrame((t) => { prev = t; w.raf = requestAnimationFrame(loop); });

  // Simulation deterministisch vortreiben (Tests/Headless)
  w.advance = (sec) => {
    const frames = Math.max(1, Math.round(sec * 60));
    for (let f = 0; f < frames; f++) frame(1000 / 60);
    renderer.render(store, kamera);
  };

  w.selftest = () => {
    const { activeList, activeCount, active, state, frozen, carrier } = store;
    const hist = { idle: 0, displaced: 0, returning: 0, text: 0, image: 0 };
    let frozenN = 0, carrierAwake = 0, poolAwake = 0;
    for (let k = 0; k < activeCount; k++) {
      const i = activeList[k];
      if (active[i] === 0) continue;
      const st = state[i];
      if (st === STATE.IDLE) hist.idle++;
      else if (st === STATE.DISPLACED) hist.displaced++;
      else if (st === STATE.RETURNING) hist.returning++;
      else if (st === STATE.TEXT) hist.text++;
      else if (st === STATE.IMAGE) hist.image++;
      if (frozen[i] === 1) frozenN++;
      if (carrier[i] === 1) carrierAwake++;
      else poolAwake++;
    }
    return {
      mode: w.mode,
      gitter: `${gitter.cols}×${gitter.rows}`,
      slots: store.count,
      wach: activeCount,
      traegerWach: carrierAwake,
      poolWach: poolAwake,
      eingefroren: frozenN,
      hist,
      dirigentMode: dirigent.mode,
      zoom: +kamera.scale.toFixed(2),
      zoomBereich: [+kamera.minScale.toFixed(2), +kamera.maxScale.toFixed(2)],
      renderer: renderer.kind,
      fps: emaMs ? +(1000 / emaMs).toFixed(1) : 0,
    };
  };

  world = w;
  window.__candy = {
    get store() { return world.store; },
    get dirigent() { return world.dirigent; },
    get renderer() { return world.renderer; },
    get kamera() { return world.kamera; },
    config: CONFIG,
    STATE,
    selftest: () => world.selftest(),
    advance: (s) => world.advance(s),
    get tSim() { return world.tSim; },
    rebuild: () => rebuildActiveList(world.store),
  };
}

// ---- Modus-Toggle (wide | high) ------------------------------------------
const toggles = { wide: document.getElementById('m-wide'), high: document.getElementById('m-high') };
let mode = params.get('mode') || localStorage.getItem('ludi-mode') || 'wide';
if (!CONFIG.modes[mode]) mode = 'wide';

async function setMode(m) {
  mode = m;
  localStorage.setItem('ludi-mode', m);
  for (const [name, el] of Object.entries(toggles)) {
    el.classList.toggle('aktiv', name === m);
  }
  await build(m);
  document.getElementById('rahmen').classList
    .toggle('resizable', !!CONFIG.modes[m].resizable);
}

// Responsiveness-Simulation: das wide-Fenster ist per Drag skalierbar —
// der Landing-Schwarm passt sich jeder Größe neu an (debounced Rebuild)
let resizeTimer = 0;
new ResizeObserver((entries) => {
  if (!world || !CONFIG.modes[mode].resizable) return;
  const r = entries[0].contentRect;
  const w = Math.round(r.width), h = Math.round(r.height);
  if (w < 240 || h < 200) return;
  if (w === world.store.gitter.view.w && h === world.store.gitter.view.h) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => build(mode, w, h), 220);
}).observe(document.getElementById('rahmen'));
toggles.wide.addEventListener('click', () => mode !== 'wide' && setMode('wide'));
toggles.high.addEventListener('click', () => mode !== 'high' && setMode('high'));

// ---- Boot ----------------------------------------------------------------
(async () => {
  await Promise.all([
    document.fonts.load('400 17px Poppins'),
    document.fonts.load('600 200px Poppins'),
    document.fonts.load('700 24px Poppins'),
    document.fonts.load('italic 600 16px Poppins'),
  ]);
  await document.fonts.ready;
  await initFormen(); // SDF-Atlas (braucht Poppins für Glyphen)
  if (params.has('vw') && CONFIG.modes[mode].resizable) {
    await build(mode, parseInt(params.get('vw'), 10), parseInt(params.get('vh'), 10) || 600);
  } else {
    await setMode(mode);
  }
  // Screenshot-/Test-Hilfen: ?advance=5 treibt die Simulation vor,
  // ?zoom=min|max zoomt, ?klick=x,y klickt (Screen-px), ?tippe=… tippt.
  const adv = parseFloat(params.get('advance') || '0');
  if (adv > 0) world.advance(adv);
  if (params.has('zoom')) {
    const z = params.get('zoom');
    const f = z === 'min' ? 1e-4 : z === 'max' ? 1e4 : parseFloat(z);
    world.kamera.zoomAt(world.kamera.viewW / 2, world.kamera.viewH / 2, f);
    world.advance(3);
  }
  if (params.has('klick')) {
    const [sx, sy] = params.get('klick').split(',').map(Number);
    world.dirigent.onPointerMove(sx, sy);
    world.advance(0.6);
    world.dirigent.onClick(sx, sy);
    world.advance(2.5);
    world.dirigent.onPointerLeave();
    world.advance(0.4);
  }
  if (params.has('tippe')) {
    for (const ch of params.get('tippe')) world.dirigent.onKey({ key: ch });
    world.advance(2);
  }
  if (params.has('taste')) { // benannte Tasten, je 0.7 s Abstand
    for (const k of params.get('taste').split(',')) {
      world.dirigent.onKey({ key: k });
      world.advance(0.7);
    }
    world.advance(1.5);
  }
  // frei sequenzierbar: ?skript=klick:x,y;tippe:3d;taste:Enter;maus:x,y;warte:2
  if (params.has('skript')) {
    for (const op of params.get('skript').split(';').filter(Boolean)) {
      const [cmd, arg = ''] = op.split(':');
      const nums = arg.split(',').map(Number);
      if (cmd === 'klick') {
        world.dirigent.onPointerMove(nums[0], nums[1]);
        world.advance(0.5);
        world.dirigent.onClick(nums[0], nums[1]);
        world.advance(0.5);
      } else if (cmd === 'maus') {
        world.dirigent.onPointerMove(nums[0], nums[1]);
        world.advance(0.4);
      } else if (cmd === 'runter') {
        world.dirigent.onPointerDown(nums[0], nums[1]);
        world.advance(0.3);
      } else if (cmd === 'hoch') {
        world.dirigent.onPointerUp();
        world.advance(0.3);
      } else if (cmd === 'tippe') {
        for (const ch of arg) world.dirigent.onKey({ key: ch });
        world.advance(0.8);
      } else if (cmd === 'taste') {
        world.dirigent.onKey({ key: arg });
        world.advance(0.7);
      } else if (cmd === 'warte') {
        world.advance(nums[0] || 1);
      } else if (cmd === 'zieh') {
        world.dirigent.onPointerMove(nums[0], nums[1]);
        world.dirigent.onPointerDown(nums[0], nums[1]);
        for (let k = 1; k <= 16; k++) {
          const x = nums[0] + ((nums[2] - nums[0]) * k) / 16;
          const y = nums[1] + ((nums[3] - nums[1]) * k) / 16;
          world.dirigent.onPointerMove(x, y);
          world.dirigent.onPointerDrag(x, y);
          if (k % 4 === 0) world.advance(0.08);
        }
        world.dirigent.onPointerUp();
        world.advance(0.5);
      }
    }
  }
  for (const spec of params.getAll('zieh')) { // Drag x0,y0,x1,y1 (Screen-px)
    const [x0, y0, x1, y1] = spec.split(',').map(Number);
    world.dirigent.onPointerMove(x0, y0);
    world.dirigent.onPointerDown(x0, y0);
    for (let k = 1; k <= 24; k++) {
      const x = x0 + ((x1 - x0) * k) / 24;
      const y = y0 + ((y1 - y0) * k) / 24;
      world.dirigent.onPointerMove(x, y);
      world.dirigent.onPointerDrag(x, y);
      if (k % 6 === 0) world.advance(0.1);
    }
    world.dirigent.onPointerUp();
    world.advance(0.8);
  }
  if (params.has('dump')) {
    const s = world.store;
    const g = s.gitter;
    const rows = [];
    const y0 = g.start.row0, x0 = g.start.col0 + g.start.cols / 2 - 3;
    for (let k = 0; k < s.activeCount; k++) {
      const i = s.activeList[k];
      if (s.active[i] === 0) continue;
      if (s.posY[i] < y0 || s.posY[i] > y0 + 1.2) continue;
      if (s.posX[i] < x0 || s.posX[i] > x0 + 7) continue;
      rows.push({
        id: i, cell: i < s.latticeCount ? `${i % g.cols},${(i / g.cols) | 0}` : 'pool',
        x: +s.posX[i].toFixed(2), y: +s.posY[i].toFixed(2),
        tx: +s.targetX[i].toFixed(2), size: +s.size[i].toFixed(2),
        st: s.state[i], shape: s.shapeB[i], bri: +s.brightness[i].toFixed(2),
      });
    }
    const cells = [];
    for (const spec of (params.get('zellen') || '').split(';').filter(Boolean)) {
      const [c, r] = spec.split(',').map(Number);
      const i = r * g.cols + c;
      cells.push({
        cell: spec, id: i, active: s.active[i], carrier: s.carrier[i],
        x: +s.posX[i].toFixed(2), y: +s.posY[i].toFixed(2),
        tx: +s.targetX[i].toFixed(2), ty: +s.targetY[i].toFixed(2),
        size: +s.size[i].toFixed(3), sizeTgt: +s.sizeTgt[i].toFixed(3),
        st: s.state[i], bri: +s.brightness[i].toFixed(2),
        col: [s.colR[i] | 0, s.colG[i] | 0, s.colB[i] | 0],
      });
    }
    const pre = document.createElement('pre');
    pre.id = 'dump';
    pre.textContent = JSON.stringify({ selftest: world.selftest(), logoRow: rows, cells }, null, 1);
    document.body.appendChild(pre);
  }
})();
