// WebGPU-Renderer: instanzierte Quads per Vertex-Pulling aus einem
// Storage-Buffer (12 f32 = 48 B pro Agent, Layout in renderformat.js).
// Distanzfeld-Shading identisch zum WebGL2-Renderer — beide teilen sich
// Packing und Atlas, damit die Backends nie auseinanderdriften.
// Interface { render(store, kamera), kind, dpr, dispose() }.
import { CONFIG } from './config.js';
import { formenInfo } from './formen.js';
import {
  INST_FLOATS, packInstances, LINE_FLOATS, packLines, lineCapacity, hexToRgb01,
} from './renderformat.js';

const WGSL = (grid) => /* wgsl */ `
struct Cam {
  center: vec2f,
  scale: f32,
  grad: f32,
  view: vec2f,
  sdfRange: f32,
  pad: f32,
  inner: vec4f,
  outer: vec4f,
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> inst: array<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

// ---- Hintergrund: radialer Verlauf ------------------------------------
struct BgOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vsBg(@builtin(vertex_index) vi: u32) -> BgOut {
  var out: BgOut;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.uv = p;
  out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

@fragment fn fsBg(in: BgOut) -> @location(0) vec4f {
  let d = (in.uv - 0.5) * cam.view;
  let r = length(d) / (0.55 * length(cam.view));
  return vec4f(mix(cam.inner.rgb, cam.outer.rgb, smoothstep(0.15, 1.0, r)), 1.0);
}

// ---- Agenten-Quads -----------------------------------------------------
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) shapeAB: vec2f,
  @location(3) morphT: f32,
};

@vertex fn vsInst(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let o = ii * ${INST_FLOATS}u;
  let pos = vec2f(inst[o], inst[o + 1u]);
  let size = inst[o + 2u];
  let rot = inst[o + 3u];
  let col = vec3f(inst[o + 4u], inst[o + 5u], inst[o + 6u]);
  let shape = vec3f(inst[o + 7u], inst[o + 8u], inst[o + 9u]);

  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let c = cos(rot);
  let s = sin(rot);
  let local = corner * (size * 0.5);
  let world = pos + vec2f(local.x * c - local.y * s, local.x * s + local.y * c);
  let screen = (world - cam.center) * cam.scale + cam.view * 0.5;
  let clip = screen / cam.view * 2.0 - 1.0;

  var out: VOut;
  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  out.p = corner;
  out.col = col;
  out.shapeAB = shape.xy;
  out.morphT = clamp(shape.z, 0.0, 1.0);
  return out;
}

// ---- Linien (Mesh + Vektor-Pfade) --------------------------------------
@group(0) @binding(4) var<storage, read> lines: array<f32>;

struct LOut { @builtin(position) pos: vec4f, @location(0) col: vec4f };

@vertex fn vsLine(@builtin(vertex_index) vi: u32) -> LOut {
  let o = vi * ${LINE_FLOATS}u;
  let p = vec2f(lines[o], lines[o + 1u]);
  let screen = (p - cam.center) * cam.scale + cam.view * 0.5;
  let clip = screen / cam.view * 2.0 - 1.0;
  var out: LOut;
  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  out.col = vec4f(lines[o + 2u], lines[o + 3u], lines[o + 4u], lines[o + 5u]);
  return out;
}

@fragment fn fsLine(in: LOut) -> @location(0) vec4f {
  return vec4f(in.col.rgb * in.col.a, in.col.a);
}

// ---- Post-Process: Wurmloch-Fahrt (Rolle + Aberration) -----------------
// Die Raumkrümmung des Wurmlochs selbst ist ECHTES 3D im Gitter
// (renderformat.funnelProject) — hier gibt es keine Linse mehr.
struct Fahrt {
  fx: vec4f, // rotWinkel, tcx, tcy, smear
};
@group(1) @binding(0) var<uniform> linse: Fahrt;
@group(1) @binding(1) var sceneTex: texture_2d<f32>;
@group(1) @binding(2) var sceneSamp: sampler;

struct PostOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vsPost(@builtin(vertex_index) vi: u32) -> PostOut {
  var out: PostOut;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.uv = p;
  out.pos = vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  return out;
}

fn szene(px: vec2f) -> vec3f {
  return textureSampleLevel(sceneTex, sceneSamp,
    clamp(px / cam.view, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
}

@fragment fn fsPost(in: PostOut) -> @location(0) vec4f {
  // sichtbarer Bereich des Fullscreen-Dreiecks: uv ∈ 0..1
  var px = in.uv * cam.view;

  // Durchflug: die ganze Sicht ROLLT um die Bildmitte (0 → 180°)
  let rot = linse.fx.x;
  if (abs(rot) > 0.0005) {
    let c = linse.fx.yz;
    let rel = px - c;
    let cs = cos(rot);
    let sn = sin(rot);
    px = c + vec2f(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  }

  var col = szene(px);

  // ruhige radiale Aberration während des Durchflugs (kein Geflacker)
  let sm = linse.fx.w;
  if (sm > 0.004) {
    let c = linse.fx.yz;
    let rel = px - c;
    var smear = col;
    for (var k = 1; k < 5; k++) {
      smear += szene(c + rel * (1.0 - (f32(k) / 4.0) * sm * 0.35));
    }
    smear /= 5.0;
    col = mix(col, smear, min(1.0, sm));
  }
  return vec4f(col, 1.0);
}

fn sdAnalytic(p: vec2f, s: f32) -> f32 {
  if (s < 0.5) { return length(p) - 0.92; }
  if (s < 1.5) { return max(abs(p.x), abs(p.y)) - 0.95; }
  var q = vec2f(p.x, -p.y + 0.22);
  let k = 1.7320508;
  let r = 0.9;
  q.x = abs(q.x) - r;
  q.y = q.y + r / k;
  if (q.x + k * q.y > 0.0) { q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0; }
  q.x = q.x - clamp(q.x, -2.0 * r, 0.0);
  return -length(q) * sign(q.y);
}

fn tileUV(s: f32, p: vec2f) -> vec2f {
  let t = max(s - 8.0, 0.0);
  let tile = vec2f(t % ${grid}.0, floor(t / ${grid}.0));
  return (tile + clamp(p * 0.5 + 0.5, vec2f(0.001), vec2f(0.999))) / ${grid}.0;
}

@fragment fn fsInst(in: VOut) -> @location(0) vec4f {
  // Samples in uniformem Kontrollfluss (implizite Ableitungen)
  let dA = (textureSample(atlas, samp, tileUV(in.shapeAB.x, in.p)).r - 0.5) * cam.sdfRange;
  let dB = (textureSample(atlas, samp, tileUV(in.shapeAB.y, in.p)).r - 0.5) * cam.sdfRange;
  var d0: f32;
  var d1: f32;
  if (in.shapeAB.x < 7.5) { d0 = sdAnalytic(in.p, in.shapeAB.x); } else { d0 = dA; }
  if (in.shapeAB.y < 7.5) { d1 = sdAnalytic(in.p, in.shapeAB.y); } else { d1 = dB; }
  let d = mix(d0, d1, in.morphT);
  let aa = fwidth(d) * 1.2 + 1e-4;
  let alpha = 1.0 - smoothstep(-aa, aa, d);
  if (alpha < 0.004) { discard; }
  let shade = 1.0 + cam.grad * in.p.y * 0.5;
  return vec4f(in.col * shade * alpha, alpha);
}
`;

// Mip-Kette für den R8-Atlas (Box-Filter) — WebGPU generiert keine Mips
function buildMips(data, size) {
  const mips = [{ data, size }];
  let src = data, s = size;
  while (s > 1) {
    const h = s >> 1;
    const dst = new Uint8Array(h * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const o = 2 * y * s + 2 * x;
        dst[y * h + x] = (src[o] + src[o + 1] + src[o + s] + src[o + s + 1] + 2) >> 2;
      }
    }
    mips.push({ data: dst, size: h });
    src = dst; s = h;
  }
  return mips;
}

export async function createRendererGPU(canvas, view) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;

  const dpr = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
  canvas.width = view.w * dpr;
  canvas.height = view.h * dpr;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const formen = formenInfo();
  let atlasVersion = -1;
  const mipCount = Math.log2(formen.size) + 1;
  const atlasTex = device.createTexture({
    size: [formen.size, formen.size],
    format: 'r8unorm',
    mipLevelCount: mipCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  function uploadAtlas() {
    const mips = buildMips(formen.data, formen.size);
    for (let level = 0; level < mips.length; level++) {
      const m = mips[level];
      device.queue.writeTexture(
        { texture: atlasTex, mipLevel: level },
        m.data, { bytesPerRow: m.size }, [m.size, m.size],
      );
    }
    atlasVersion = formen.version;
  }
  uploadAtlas();

  const sampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
  });
  const sceneTex = device.createTexture({
    size: [view.w * dpr, view.h * dpr],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const sceneSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const module = device.createShaderModule({ code: WGSL(formen.grid) });

  const uniform = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let instCap = 1 << 16;
  let instBuf = device.createBuffer({
    size: instCap * INST_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let lineCap = 1 << 14; // Vertices
  let lineBuf = device.createBuffer({
    size: lineCap * LINE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const makeBindGroup = () => device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: instBuf } },
      { binding: 2, resource: atlasTex.createView() },
      { binding: 3, resource: sampler },
      { binding: 4, resource: { buffer: lineBuf } },
    ],
  });
  let bindGroup = makeBindGroup();

  const linseBuf = device.createBuffer({
    size: 16, // Fahrt: eine vec4f (rot, tcx, tcy, smear)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const layoutPost = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const bindPost = device.createBindGroup({
    layout: layoutPost,
    entries: [
      { binding: 0, resource: { buffer: linseBuf } },
      { binding: 1, resource: sceneTex.createView() },
      { binding: 2, resource: sceneSampler },
    ],
  });

  const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeLayoutPost = device.createPipelineLayout({ bindGroupLayouts: [layout, layoutPost] });
  const blend = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  };
  const pipeBg = device.createRenderPipeline({
    layout: pipeLayout,
    vertex: { module, entryPoint: 'vsBg' },
    fragment: { module, entryPoint: 'fsBg', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const pipeInst = device.createRenderPipeline({
    layout: pipeLayout,
    vertex: { module, entryPoint: 'vsInst' },
    fragment: { module, entryPoint: 'fsInst', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-strip' },
  });
  const pipeLine = device.createRenderPipeline({
    layout: pipeLayout,
    vertex: { module, entryPoint: 'vsLine' },
    fragment: { module, entryPoint: 'fsLine', targets: [{ format, blend }] },
    primitive: { topology: 'line-list' },
  });
  const pipePost = device.createRenderPipeline({
    layout: pipeLayoutPost,
    vertex: { module, entryPoint: 'vsPost' },
    fragment: { module, entryPoint: 'fsPost', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const linseData = new Float32Array(4);

  const inner = hexToRgb01(CONFIG.colors.bgInner);
  const outer = hexToRgb01(CONFIG.colors.bgOuter);
  const uniData = new Float32Array(16);
  uniData.set([...inner, 1], 8);
  uniData.set([...outer, 1], 12);
  uniData[3] = CONFIG.gradient;
  uniData[4] = view.w;
  uniData[5] = view.h;
  uniData[6] = formen.sdfRange;

  let arr = new Float32Array(instCap * INST_FLOATS);
  let lnArr = new Float32Array(lineCap * LINE_FLOATS);

  function render(store, kamera) {
    if (formen.version !== atlasVersion) uploadAtlas();

    if (store.activeCount > instCap) {
      instCap = Math.ceil(store.activeCount * 1.3);
      instBuf.destroy();
      instBuf = device.createBuffer({
        size: instCap * INST_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      arr = new Float32Array(instCap * INST_FLOATS);
      bindGroup = makeBindGroup();
    }
    if (lineCapacity(store) > lineCap) {
      lineCap = Math.ceil(lineCapacity(store) * 1.3);
      lineBuf.destroy();
      lineBuf = device.createBuffer({
        size: lineCap * LINE_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      lnArr = new Float32Array(lineCap * LINE_FLOATS);
      bindGroup = makeBindGroup();
    }
    const n = packInstances(store, kamera, arr);
    const ln = packLines(store, kamera, lnArr);

    uniData[0] = kamera.cx;
    uniData[1] = kamera.cy;
    uniData[2] = kamera.scale;
    device.queue.writeBuffer(uniform, 0, uniData);
    if (n > 0) {
      device.queue.writeBuffer(instBuf, 0, arr, 0, n * INST_FLOATS);
    }
    if (ln.nTotal > 0) {
      device.queue.writeBuffer(lineBuf, 0, lnArr, 0, ln.nTotal * LINE_FLOATS);
    }

    const L = store.linse || { rot: 0, tcx: 0, tcy: 0, smear: 0 };
    linseData[0] = L.rot || 0;
    linseData[1] = L.tcx;
    linseData[2] = L.tcy;
    linseData[3] = L.smear || 0;
    device.queue.writeBuffer(linseBuf, 0, linseData);

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: sceneTex.createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeBg);
    pass.draw(3);
    if (ln.nMesh > 0) {
      pass.setPipeline(pipeLine);
      pass.draw(ln.nMesh);
    }
    if (n > 0) {
      pass.setPipeline(pipeInst);
      pass.draw(4, n);
    }
    if (ln.nTotal > ln.nMesh) {
      pass.setPipeline(pipeLine);
      pass.draw(ln.nTotal - ln.nMesh, 1, ln.nMesh);
    }
    pass.end();

    // Post-Process: Linse + Fahrt auf den Screen
    const post = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    post.setBindGroup(0, bindGroup);
    post.setBindGroup(1, bindPost);
    post.setPipeline(pipePost);
    post.draw(3);
    post.end();
    device.queue.submit([enc.finish()]);
  }

  return {
    render, dpr, kind: 'webgpu',
    dispose() {
      instBuf.destroy();
      lineBuf.destroy();
      linseBuf.destroy();
      uniform.destroy();
      atlasTex.destroy();
      sceneTex.destroy();
      device.destroy();
    },
  };
}
