// WebGL2-Renderer: instanzierte Quads (4-Vertex-Strip), Form als
// Distanzfeld im Fragment-Shader — analytisch (Kreis/Quadrat/Dreieck) oder
// aus dem SDF-Atlas (Squircle, Claws, Glyphen, Komposit-Kacheln), stufenlos
// ineinander morphbar. Kamera-Transform im Vertex-Shader → Zoomen kostet
// nichts und ordnet nichts neu an. Interface { render(store, kamera), kind,
// dpr, dispose() } — identisch zum WebGPU- und Canvas2D-Renderer.
import { CONFIG } from './config.js';
import { formenInfo } from './formen.js';
import {
  INST_FLOATS, packInstances, LINE_FLOATS, packLines, lineCapacity,
  KAPSEL_FLOATS, packKapseln, kapselCapacity, hexToRgb01,
} from './renderformat.js';

const VS_BG = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_BG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec3 u_inner;
uniform vec3 u_outer;
uniform vec2 u_view;
out vec4 outColor;
void main() {
  vec2 d = (v_uv - 0.5) * u_view;
  float r = length(d) / (0.55 * length(u_view));
  outColor = vec4(mix(u_inner, u_outer, smoothstep(0.15, 1.0, r)), 1.0);
}`;

const VS_POST = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ECHTE GRAVITATIONSLINSE (Post-Process, Referenz 10): Punktmassen-
// Linsengleichung β = θ − θE²/θ — jeder PIXEL außerhalb des Einstein-
// Radius wird zur Quelle β hin umgelenkt, dadurch krümmen sich die
// Kacheln zu echten Bögen um den Ring. Die Quellfläche innerhalb
// schluck·θE ist leer (renderformat.lochWarp) und β wird nie kleiner
// als 0.8·θE gesampelt — deshalb liegt direkt außerhalb des Rings der
// leere Gap, es gibt keine Zweitbilder und KEINE Bandtönung (es wird
// ausschließlich die echte Szene gesampelt, nie ein synthetischer
// Hintergrund). Innerhalb θE: unverzerrt (Label bleibt lesbar). Dazu
// leichte chromatische Aberration, feine Ringlinie und die ruhige
// radiale Aberration des Durchflugs.
const FS_POST = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_view;
uniform vec4 u_holes[4]; // sx, sy, thetaE(px), aktiv
uniform vec4 u_fx;       // –, tcx, tcy, smear
uniform vec4 u_par;      // linsenReich(·θE), ringAlpha, chrom, –
out vec4 outColor;

// Screen-Koordinaten laufen oben-links los; GL-Texturen unten-links —
// deshalb hier die y-Umrechnung in beiden Richtungen
vec3 szene(vec2 px) {
  vec2 uv = vec2(px.x / u_view.x, 1.0 - px.y / u_view.y);
  return texture(u_scene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
  // sichtbarer Bereich des Fullscreen-Dreiecks: v_uv ∈ 0..1
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_view;

  vec2 pR = px;
  vec2 pG = px;
  vec2 pB = px;
  float ring = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 h = u_holes[i];
    if (h.w < 0.5) continue;
    vec2 rel = px - h.xy;
    float d = max(length(rel), 1e-3);
    float tE = h.z;
    float reich = tE * u_par.x;
    if (d > tE && d < reich) {
      vec2 dir = rel / d;
      float c = u_par.z;
      float bG = d - (tE * tE) / d;
      float bR = d - (tE * tE * (1.0 + c)) / d;
      float bB = d - (tE * tE * (1.0 - c)) / d;
      float lo = tE * 0.8; // Quelle nie aus dem Label-Zentrum
      bG = max(bG, lo); bR = max(bR, lo); bB = max(bB, lo);
      // am Außenrand weich in die unverzerrte Szene zurückblenden
      float fade = smoothstep(reich * 0.55, reich, d);
      pR = h.xy + dir * mix(bR, d, fade);
      pG = h.xy + dir * mix(bG, d, fade);
      pB = h.xy + dir * mix(bB, d, fade);
    }
    float rd = abs(d - tE);
    ring += u_par.y * exp(-rd * rd / 2.5); // feine Linie, kein Halo
  }
  vec3 col = vec3(szene(pR).r, szene(pG).g, szene(pB).b);
  col += vec3(0.85, 0.97, 0.93) * ring;

  // ruhige radiale Aberration während des Durchflugs (kein Geflacker)
  float sm = u_fx.w;
  if (sm > 0.004) {
    vec2 c = u_fx.yz;
    vec2 rel = px - c;
    vec3 smear = col;
    for (int k = 1; k < 5; k++) {
      smear += szene(c + rel * (1.0 - (float(k) / 4.0) * sm * 0.35));
    }
    smear /= 5.0;
    col = mix(col, smear, min(1.0, sm));
  }
  outColor = vec4(col, 1.0);
}`;

// KAPSELN: dicke weiche Linien (Rex' Drahtgitter) — instanzierte Quads,
// im Fragment-Shader die Kapsel-Distanz (runde Enden, weiches AA)
const VS_KAPSEL = `#version 300 es
layout(location=0) in vec4 a_seg;   // x0, y0, x1, y1 (Pseudo-Welt)
layout(location=1) in vec4 a_col;
layout(location=2) in float a_dicke; // Screen-px
uniform vec4 u_cam;   // cx, cy, scale, –
uniform vec2 u_view;
out vec2 v_pos;
flat out vec2 v_p0;
flat out vec2 v_p1;
flat out float v_halb;
out vec4 v_col;
void main() {
  vec2 s0 = (a_seg.xy - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 s1 = (a_seg.zw - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 dir = s1 - s0;
  float len = max(length(dir), 1e-4);
  dir /= len;
  vec2 n = vec2(-dir.y, dir.x);
  float halb = a_dicke * 0.5 + 1.0; // + AA-Rand
  float ax = float(gl_VertexID & 1);
  float ay = float(gl_VertexID >> 1) * 2.0 - 1.0;
  vec2 pos = mix(s0, s1, ax) + dir * (ax * 2.0 - 1.0) * halb + n * ay * halb;
  vec2 clip = pos / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_pos = pos;
  v_p0 = s0;
  v_p1 = s1;
  v_halb = a_dicke * 0.5;
  v_col = a_col;
}`;

const FS_KAPSEL = `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_p0;
flat in vec2 v_p1;
flat in float v_halb;
in vec4 v_col;
out vec4 outColor;
void main() {
  vec2 ab = v_p1 - v_p0;
  float t = clamp(dot(v_pos - v_p0, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(v_pos - (v_p0 + ab * t)) - v_halb;
  float alpha = (1.0 - smoothstep(-0.75, 0.75, d)) * v_col.a;
  if (alpha < 0.004) discard;
  outColor = vec4(v_col.rgb * alpha, alpha);
}`;

const VS_LINES = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_col;
uniform vec4 u_cam;
uniform vec2 u_view;
out vec4 v_col;
void main() {
  vec2 screen = (a_pos - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 clip = screen / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_col = a_col;
}`;

const FS_LINES = `#version 300 es
precision mediump float;
in vec4 v_col;
out vec4 outColor;
void main() {
  outColor = vec4(v_col.rgb * v_col.a, v_col.a);
}`;

const VS_INST = `#version 300 es
layout(location=0) in vec2 a_pos;    // Welt
layout(location=1) in float a_size;  // Welt (Kantenlänge)
layout(location=2) in float a_rot;
layout(location=3) in vec3 a_col;    // premultipliziert mit Helligkeit
layout(location=4) in vec3 a_shape;  // (formA, formB, morphT)
layout(location=5) in float a_aspect; // anisotrope Streckung (Wurmloch-Sog)
uniform vec4 u_cam;   // cx, cy, scale, –
uniform vec2 u_view;  // Viewport in CSS-px
out vec2 v_p;
out vec3 v_col;
out vec3 v_shape;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  float c = cos(a_rot), s = sin(a_rot);
  vec2 local = corner * (vec2(a_size * a_aspect, a_size) * 0.5);
  vec2 world = a_pos + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 screen = (world - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 clip = screen / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_p = corner;
  v_col = a_col;
  v_shape = a_shape;
}`;

const FS_INST = `#version 300 es
precision highp float;
in vec2 v_p;
in vec3 v_col;
in vec3 v_shape;
uniform sampler2D u_atlas;
uniform float u_sdfRange; // (byte-0.5) → lokale Einheiten
uniform float u_gridInv;  // 1 / Kachelraster
uniform float u_grad;     // vertikaler Farbverlauf im Agenten
out vec4 outColor;

float sdAnalytic(vec2 p, float s) {
  if (s < 0.5) return length(p) - 0.92;
  if (s < 1.5) return max(abs(p.x), abs(p.y)) - 0.95;
  vec2 q = vec2(p.x, -p.y + 0.22);
  const float k = 1.7320508;
  float r = 0.9;
  q.x = abs(q.x) - r;
  q.y = q.y + r / k;
  if (q.x + k * q.y > 0.0) q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0;
  q.x -= clamp(q.x, -2.0 * r, 0.0);
  return -length(q) * sign(q.y);
}

float sdOne(vec2 p, float s, float dAtlas) {
  if (s < 7.5) return sdAnalytic(p, s);
  return dAtlas;
}

vec2 tileUV(float s, vec2 p) {
  float t = max(s - 8.0, 0.0);
  vec2 tile = vec2(mod(t, 1.0 / u_gridInv), floor(t * u_gridInv));
  return (tile + clamp(p * 0.5 + 0.5, 0.001, 0.999)) * u_gridInv;
}

void main() {
  // Atlas-Samples UNBEDINGT in uniformem Kontrollfluss (fwidth/mip)
  float dA = (texture(u_atlas, tileUV(v_shape.x, v_p)).r - 0.5) * u_sdfRange;
  float dB = (texture(u_atlas, tileUV(v_shape.y, v_p)).r - 0.5) * u_sdfRange;
  float t = clamp(v_shape.z, 0.0, 1.0);
  float d = mix(sdOne(v_p, v_shape.x, dA), sdOne(v_p, v_shape.y, dB), t);
  float aa = fwidth(d) * 1.2 + 1e-4;
  float alpha = 1.0 - smoothstep(-aa, aa, d);
  if (alpha < 0.004) discard;
  float shade = 1.0 + u_grad * v_p.y * 0.5; // oben minimal dunkler
  outColor = vec4(v_col * shade * alpha, alpha);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Link: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

export function createRendererGL(canvas, view) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, premultipliedAlpha: true, depth: false, stencil: false,
  });
  if (!gl) return null;

  const dpr = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
  canvas.width = view.w * dpr;
  canvas.height = view.h * dpr;
  gl.viewport(0, 0, view.w * dpr, view.h * dpr);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Offscreen-Szene für den Linsen-/Tunnel-Pass
  const sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, view.w * dpr, view.h * dpr, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const progPost = link(gl, VS_POST, FS_POST);
  gl.useProgram(progPost);
  gl.uniform1i(gl.getUniformLocation(progPost, 'u_scene'), 1);
  gl.uniform2f(gl.getUniformLocation(progPost, 'u_view'), view.w, view.h);
  gl.uniform4f(gl.getUniformLocation(progPost, 'u_par'),
    CONFIG.tunnel.linse, CONFIG.tunnel.ringAlpha, 0.028, 0);
  const uFx = gl.getUniformLocation(progPost, 'u_fx');
  const uHoles = gl.getUniformLocation(progPost, 'u_holes');
  const holeArr = new Float32Array(16);
  const vaoPost = gl.createVertexArray();

  const formen = formenInfo();
  let atlasVersion = -1;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function uploadAtlas() {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, formen.size, formen.size, 0,
      gl.RED, gl.UNSIGNED_BYTE, formen.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    atlasVersion = formen.version;
  }
  uploadAtlas();

  // Hintergrund
  const progBg = link(gl, VS_BG, FS_BG);
  gl.useProgram(progBg);
  const inner = hexToRgb01(CONFIG.colors.bgInner);
  const outer = hexToRgb01(CONFIG.colors.bgOuter);
  gl.uniform3f(gl.getUniformLocation(progBg, 'u_inner'), inner[0], inner[1], inner[2]);
  gl.uniform3f(gl.getUniformLocation(progBg, 'u_outer'), outer[0], outer[1], outer[2]);
  gl.uniform2f(gl.getUniformLocation(progBg, 'u_view'), view.w, view.h);
  const vaoBg = gl.createVertexArray();

  // Instanzen
  const prog = link(gl, VS_INST, FS_INST);
  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_view'), view.w, view.h);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_sdfRange'), formen.sdfRange);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_gridInv'), 1 / formen.grid);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_grad'), CONFIG.gradient);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_atlas'), 0);
  const uCam = gl.getUniformLocation(prog, 'u_cam');

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const stride = INST_FLOATS * 4;
  const attribs = [[0, 2, 0], [1, 1, 8], [2, 1, 12], [3, 3, 16], [4, 3, 28], [5, 1, 40]];
  for (const [loc, n, off] of attribs) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(loc, 1);
  }

  // Linien (Mesh + Vektor-Pfade), gezeichnet UNTER den Agenten
  const progLn = link(gl, VS_LINES, FS_LINES);
  gl.useProgram(progLn);
  gl.uniform2f(gl.getUniformLocation(progLn, 'u_view'), view.w, view.h);
  const uCamLn = gl.getUniformLocation(progLn, 'u_cam');
  const vaoLn = gl.createVertexArray();
  gl.bindVertexArray(vaoLn);
  const vboLn = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboLn);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, LINE_FLOATS * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, LINE_FLOATS * 4, 8);

  // Kapseln (dicke weiche Linien) — instanzierte Quads
  const progKap = link(gl, VS_KAPSEL, FS_KAPSEL);
  gl.useProgram(progKap);
  gl.uniform2f(gl.getUniformLocation(progKap, 'u_view'), view.w, view.h);
  const uCamKap = gl.getUniformLocation(progKap, 'u_cam');
  const vaoKap = gl.createVertexArray();
  gl.bindVertexArray(vaoKap);
  const vboKap = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboKap);
  const strideKap = KAPSEL_FLOATS * 4;
  for (const [loc, n, off] of [[0, 4, 0], [1, 4, 16], [2, 1, 32]]) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, strideKap, off);
    gl.vertexAttribDivisor(loc, 1);
  }
  let kapArr = new Float32Array(256 * KAPSEL_FLOATS);

  let arr = new Float32Array(0);
  let lnArr = new Float32Array(0);

  function render(store, kamera) {
    if (formen.version !== atlasVersion) uploadAtlas();

    // Szene ins Offscreen-Ziel zeichnen
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, view.w * dpr, view.h * dpr);

    gl.useProgram(progBg);
    gl.bindVertexArray(vaoBg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const lnCap = lineCapacity(store) * LINE_FLOATS;
    if (lnArr.length < lnCap) lnArr = new Float32Array(Math.ceil(lnCap * 1.3));
    const ln = packLines(store, kamera, lnArr);
    if (ln.nTotal > 0) {
      gl.useProgram(progLn);
      gl.uniform4f(uCamLn, kamera.cx, kamera.cy, kamera.scale, 0);
      gl.bindVertexArray(vaoLn);
      gl.bindBuffer(gl.ARRAY_BUFFER, vboLn);
      gl.bufferData(gl.ARRAY_BUFFER, lnArr.subarray(0, ln.nTotal * LINE_FLOATS), gl.DYNAMIC_DRAW);
      if (ln.nMesh > 0) gl.drawArrays(gl.LINES, 0, ln.nMesh);
    }

    // Kapseln (Rex' Drahtgitter) — NACH den Mesh-Linien, VOR den Agenten
    const kapCap = kapselCapacity(store) * KAPSEL_FLOATS;
    if (kapArr.length < kapCap) kapArr = new Float32Array(Math.ceil(kapCap * 1.3));
    const nKap = packKapseln(store, kapArr);
    if (nKap > 0) {
      gl.useProgram(progKap);
      gl.uniform4f(uCamKap, kamera.cx, kamera.cy, kamera.scale, 0);
      gl.bindVertexArray(vaoKap);
      gl.bindBuffer(gl.ARRAY_BUFFER, vboKap);
      gl.bufferData(gl.ARRAY_BUFFER, kapArr.subarray(0, nKap * KAPSEL_FLOATS), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nKap);
    }

    if (arr.length < store.activeCount * INST_FLOATS) {
      arr = new Float32Array(Math.ceil(store.activeCount * 1.3) * INST_FLOATS);
    }
    const n = packInstances(store, kamera, arr);
    if (n === 0) return;

    gl.useProgram(prog);
    gl.uniform4f(uCam, kamera.cx, kamera.cy, kamera.scale, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * INST_FLOATS), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

    // freie Linien (Vektor-Pfade, 3D-Kanten) ÜBER den Agenten
    if (ln.nTotal > ln.nMesh) {
      gl.useProgram(progLn);
      gl.bindVertexArray(vaoLn);
      gl.drawArrays(gl.LINES, ln.nMesh, ln.nTotal - ln.nMesh);
    }

    // Post-Process: echte Gravitationslinse + Durchflug-Aberration
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w * dpr, view.h * dpr);
    const L = store.linse || { holes: [], tcx: 0, tcy: 0, smear: 0 };
    holeArr.fill(0);
    const nH = Math.min(4, L.holes ? L.holes.length : 0);
    for (let i = 0; i < nH; i++) {
      holeArr[i * 4] = L.holes[i].sx;
      holeArr[i * 4 + 1] = L.holes[i].sy;
      holeArr[i * 4 + 2] = L.holes[i].thetaE;
      holeArr[i * 4 + 3] = 1;
    }
    gl.useProgram(progPost);
    gl.uniform4fv(uHoles, holeArr);
    gl.uniform4f(uFx, 0, L.tcx, L.tcy, L.smear || 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.bindVertexArray(vaoPost);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
  }

  return {
    render, dpr, kind: 'webgl2',
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteProgram(progBg);
      gl.deleteProgram(progLn);
      gl.deleteProgram(progKap);
      gl.deleteProgram(progPost);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(vboLn);
      gl.deleteBuffer(vboKap);
      gl.deleteTexture(tex);
      gl.deleteTexture(sceneTex);
      gl.deleteFramebuffer(fbo);
    },
  };
}
