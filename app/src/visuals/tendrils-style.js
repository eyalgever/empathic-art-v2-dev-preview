/**
 * Empathic App — Visual Style: Tendrils
 *
 * Tendrils is a self-organising handwriting made by thirty thousand
 * particles that leave motion into a shared flow field, which then
 * carries the next generation of particles. Nothing writes the
 * strokes directly. Each stroke is the trace of a particle that
 * followed the collective breath of every particle before it.
 *
 * Design register:
 *   - Dark ink pigment on a warm neutral. The strokes never glow —
 *     they read as saturated pigment settling into the paper. The
 *     emotion is carried in the tint of the pigment, not in the
 *     luminance of the strokes, so calm states stay just as
 *     legible as roused ones.
 *   - Valence sets the pigment tint: warm valence pulls the ink
 *     toward sienna and oxblood, cool valence pulls it toward
 *     indigo and slate. The tint is always a low-saturation
 *     undertone of pure ink — never a coloured line.
 *   - Arousal drives noise amplitude and step size. Calm states
 *     produce long lazy meanders, roused states produce short
 *     sharp bursts that fork and rejoin.
 *   - Openness controls the fade rate of the trail buffer. Closed
 *     reads as a tight lattice of many overlapping strokes that
 *     never quite dissolve, open reads as a spare skywriting where
 *     each stroke is given room to fade before the next arrives.
 *
 * Technique:
 *   - Particle state (position + velocity) stored in an RGBA float
 *     texture, one texel per particle, ping-ponged each frame.
 *   - Flow field (RGB, xy = accumulated velocity, z = age-since-
 *     deposited) stored as a second ping-pong pair. Each particle
 *     deposits its velocity into the flow field at its current
 *     screen position, then the field decays and is sampled by the
 *     next generation as an additional force.
 *   - Trail buffer (RGB) accumulates line segments prev→pos each
 *     frame with additive blend and a slight per-frame fade so old
 *     tendrils dissolve gracefully.
 *   - Composite pass tints the trail through the emotion palette
 *     and paints it onto the warm neutral surface.
 *
 * Aesthetic reference: Eoghan O'Keeffe's Tendrils (MIT), which
 * proved the "particles write, particles read" feedback loop as a
 * live art medium. The GPGPU particle + flow field + trail
 * pipeline is faithful to his structure; all math, uniforms, and
 * shader code below are a fresh port to WebGL2 that matches
 * Empathic Art's engine conventions (no code copied verbatim).
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { harmonicPalette } from "../palette/emotion-palette.js?v=1.4.3";
import {
  createPingPong,
  createTarget,
  disposeTarget,
  compileProgram,
  createFullscreenQuad,
} from "./shared/fbo.js?v=1.4.3";

// ---------------- Shaders ----------------

const V_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Simplex-3D via classic Ashima port, inlined so we don't need a
// preprocessor. Public domain (Ian McEwan / Ashima Arts). Used to
// generate the analytic wander force that seeds each particle's
// motion when the flow field is quiet.
const GLSL_NOISE3 = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Particle update — the beating heart of the sim. Reads current
// state, samples the flow field at the particle's screen position,
// adds a small wander force from 3D simplex noise, integrates, and
// writes the new state. Follows the same accumulate-then-clamp
// structure as Tendrils' logic.frag.
const F_PARTICLE_UPDATE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uParticles;   // xy = pos in NDC (-1..1), zw = vel
uniform sampler2D uFlow;        // xy = accumulated velocity, z = age
uniform vec2  uParticlesSize;
uniform float uTime;
uniform float uDt;
uniform float uSpeedLimit;
uniform float uDamping;
uniform float uFlowWeight;
uniform float uNoiseWeight;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uFlowDecay;
uniform float uSeed;

${GLSL_NOISE3}

void main() {
  vec4 state = texture(uParticles, vUv);
  vec2 pos = state.xy;
  vec2 vel = state.zw;

  // Per-particle jitter index so groups of particles behave slightly
  // differently, prevents visible banding along the state texture.
  float i = (gl_FragCoord.x + gl_FragCoord.y * uParticlesSize.x) /
            (uParticlesSize.x * uParticlesSize.y);
  float jitter = 0.85 + 0.30 * i;

  // Wander force from 3D simplex noise (two independent slices).
  vec2 nPos = pos * (uNoiseScale * jitter);
  float nT  = uTime * (uNoiseSpeed * jitter) + uSeed;
  vec2 wander = vec2(
    snoise(vec3(nPos, nT)),
    snoise(vec3(nPos, nT + 137.31))
  );

  // Sample flow field with three-tap neighbourhood blend at lod 0.
  // (Float textures on iOS Safari don't reliably support mipmaps,
  // so we approximate multi-scale sampling with a manual offset
  // read at three different radii instead of textureLod.)
  vec2 flowUv = pos * 0.5 + 0.5;
  vec2 texel  = 1.0 / vec2(textureSize(uFlow, 0));
  vec4 f0 = texture(uFlow, flowUv);
  vec4 f1 = texture(uFlow, flowUv + texel * 2.0);
  vec4 f2 = texture(uFlow, flowUv + texel * 6.0);
  vec2 flowVel = (f0.xy + f1.xy * 0.5 + f2.xy * 0.25) / 1.75;

  // Decay flow by age so a particle that's been sitting in one
  // spot for a while stops re-following its own past self.
  float age = max(0.0, uTime - f0.z);
  flowVel *= max(0.0, 1.0 - age * uFlowDecay);

  // Accumulate forces.
  vec2 accel = flowVel * uFlowWeight + wander * uNoiseWeight;
  vec2 newVel = vel * uDamping + accel * uDt;

  // Speed clamp.
  float speed = length(newVel);
  if (speed > uSpeedLimit) newVel *= uSpeedLimit / speed;

  vec2 newPos = pos + newVel * uDt;

  // Soft wrap at NDC bounds so tendrils feel like they continue
  // off-screen instead of dying at the edge. Wrap adds 2.0 rather
  // than reflecting so the flow field stays continuous.
  if (newPos.x >  1.05) newPos.x -= 2.10;
  if (newPos.x < -1.05) newPos.x += 2.10;
  if (newPos.y >  1.05) newPos.y -= 2.10;
  if (newPos.y < -1.05) newPos.y += 2.10;

  fragColor = vec4(newPos, newVel);
}`;

// ---------------- Flow-field deposit ----------------
// Each particle writes its velocity into the flow field at its
// current screen position. Additive blend accumulates contributions
// from every particle that visits the same neighbourhood.

const V_DEPOSIT = `#version 300 es
in float aIdx;
uniform sampler2D uParticles;
uniform vec2  uParticlesSize;
uniform float uPointSize;
out vec2 vVel;
void main() {
  float x = mod(aIdx, uParticlesSize.x);
  float y = floor(aIdx / uParticlesSize.x);
  vec2 uv = (vec2(x, y) + 0.5) / uParticlesSize;
  vec4 s = texture(uParticles, uv);
  vec2 pos = s.xy;
  vVel = s.zw;
  gl_Position = vec4(pos, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

const F_DEPOSIT = `#version 300 es
precision highp float;
in vec2 vVel;
out vec4 fragColor;
uniform float uTime;
uniform float uDepositScale;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float k = smoothstep(0.5, 0.0, length(d));   // soft disc
  vec2  contrib = vVel * (uDepositScale * k);
  fragColor = vec4(contrib, uTime, 1.0);
}`;

// Flow field diffusion + decay pass. Slight blur so the field
// doesn't stay as sharp per-particle deposits, and multiplicative
// decay so the field slowly forgets what happened.
const F_FLOW_RELAX = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFlow;
uniform vec2  uFieldSize;
uniform float uDecay;
uniform float uDiffuse;
void main() {
  vec2 texel = 1.0 / uFieldSize;
  vec4 c  = texture(uFlow, vUv);
  vec4 nx = texture(uFlow, vUv + vec2( texel.x, 0.0));
  vec4 px = texture(uFlow, vUv + vec2(-texel.x, 0.0));
  vec4 ny = texture(uFlow, vUv + vec2(0.0,  texel.y));
  vec4 py = texture(uFlow, vUv + vec2(0.0, -texel.y));
  vec4 blur = mix(c, (nx + px + ny + py) * 0.25, uDiffuse);
  fragColor = vec4(blur.xy * uDecay, blur.z, 1.0);
}`;

// ---------------- Trail rendering ----------------
// Each particle draws a line segment from prev-position to current
// position onto the trail buffer with additive blend. Each frame
// the trail buffer is faded slightly toward the background so old
// tendrils dissolve; openness controls the fade strength.

const V_TRAIL = `#version 300 es
in float aIdx;
in float aEnd;                  // 0.0 = prev, 1.0 = current
uniform sampler2D uParticles;
uniform sampler2D uPrev;
uniform vec2  uParticlesSize;
out float vSpeed;
void main() {
  float x = mod(aIdx, uParticlesSize.x);
  float y = floor(aIdx / uParticlesSize.x);
  vec2 uv = (vec2(x, y) + 0.5) / uParticlesSize;
  vec4 s  = texture(uParticles, uv);
  vec4 sp = texture(uPrev, uv);
  vec2 pos  = mix(sp.xy, s.xy, aEnd);
  vec2 vel  = s.zw;
  vSpeed = length(vel);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const F_TRAIL = `#version 300 es
precision highp float;
in float vSpeed;
out vec4 fragColor;
uniform float uInkStrength;
void main() {
  // Ink strength grows a touch with speed so fast bursts leave
  // heavier marks. Clamped so it never exceeds the density set by
  // the composite pass, no glowing.
  float k = uInkStrength * (0.75 + 0.35 * clamp(vSpeed * 10.0, 0.0, 1.0));
  fragColor = vec4(k, k, k, 1.0);
}`;

// Fade the trail buffer each frame. Additive blending on the trail
// pass means we can't simply multiply the buffer in-place; we run
// a copy pass that reads and writes a faded version.
const F_TRAIL_FADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTrail;
uniform float uFade;
void main() {
  vec3 c = texture(uTrail, vUv).rgb;
  fragColor = vec4(c * uFade, 1.0);
}`;

// ---------------- Composite ----------------
// Takes the greyscale trail buffer and tints it toward the current
// emotion pigment. The output is always "dark pigment on warm
// paper" — the emotion never brightens the image, it only shifts
// the undertone of the pigment.

const F_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTrail;
uniform vec3  uPaper;           // warm neutral background
uniform vec3  uInk;              // pure dark ink baseline
uniform vec3  uPigment;          // emotion-tinted pigment
uniform float uTintAmount;       // 0 = pure ink, 1 = full emotion tint
uniform float uDensity;          // overall ink density
uniform float uContrast;
uniform float uVignette;

void main() {
  vec2 uv = vUv;
  float trail = texture(uTrail, uv).r;

  // Slight tonal squash so trails read as pigment, not sparks.
  trail = pow(clamp(trail, 0.0, 1.0), uContrast);
  trail *= uDensity;
  trail = clamp(trail, 0.0, 1.0);

  // Pigment always sits between pure ink and a low-saturation
  // tint of the current emotion. The tint is subtracted from the
  // paper (like real ink absorbing light), not added.
  vec3 pigment = mix(uInk, uPigment, uTintAmount);
  vec3 col = mix(uPaper, pigment, trail);

  // Radial vignette, warm-biased.
  vec2 c = uv - 0.5;
  float r = length(c);
  float vig = 1.0 - smoothstep(0.35, 0.9, r) * uVignette;
  col *= vig;

  // Very light film grain so the paper stays alive.
  float g = fract(sin(dot(uv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.010;

  fragColor = vec4(col, 1.0);
}`;

// Passthrough copy — reads a source texture and writes it verbatim.
// Used to keep the "previous frame's positions" texture in sync
// with the pre-update state, so trail lines have a valid prev end.
const F_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }`;

// Particle seed pass — writes initial positions and velocities into
// the state texture. Positions are jittered across the NDC square,
// velocities start at zero so the flow field builds up naturally.
const F_SEED = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uSeed;
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
void main() {
  float rx = hash21(vUv + uSeed);
  float ry = hash21(vUv + uSeed + 17.13);
  vec2 pos = vec2(rx, ry) * 2.0 - 1.0;
  // Seed a small random velocity so line segments have length on
  // frame one and the flow-field feedback can bootstrap.
  float vx = (hash21(vUv + uSeed + 91.7)  - 0.5) * 0.010;
  float vy = (hash21(vUv + uSeed + 213.4) - 0.5) * 0.010;
  fragColor = vec4(pos, vx, vy);
}`;

// ---------------- Helpers ----------------

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function isMobileLike() {
  if (typeof window === "undefined") return false;
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}

// Convert a hex string ("#a1b2c3") to a [0..1] RGB triple.
function hexToRgb(h) {
  const s = h.replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return [r, g, b];
}

// ---------------- Style class ----------------

export class TendrilsStyle {
  static id = "tendrils";
  static name = "Tendrils";
  static subtitle = "Handwriting of feeling";
  static tech = "webgl2";
  static requiresWebGPU = false;

  constructor(canvas, opts = {}) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: false, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    // Particle count: 128×128 = 16k on mobile, 192×192 = 36k on desktop.
    const mobile = opts.mobile ?? isMobileLike();
    const grid = mobile ? 128 : 192;
    this._particlesW = grid;
    this._particlesH = grid;
    this._particleCount = grid * grid;

    // Programs.
    this._progUpdate    = compileProgram(gl, V_QUAD,    F_PARTICLE_UPDATE, "tendrils-update");
    this._progDeposit   = compileProgram(gl, V_DEPOSIT, F_DEPOSIT,         "tendrils-deposit");
    this._progFlowRelax = compileProgram(gl, V_QUAD,    F_FLOW_RELAX,      "tendrils-flowrelax");
    this._progTrail     = compileProgram(gl, V_TRAIL,   F_TRAIL,           "tendrils-trail");
    this._progTrailFade = compileProgram(gl, V_QUAD,    F_TRAIL_FADE,      "tendrils-trailfade");
    this._progComposite = compileProgram(gl, V_QUAD,    F_COMPOSITE,       "tendrils-composite");
    this._progCopy      = compileProgram(gl, V_QUAD,    F_COPY,            "tendrils-copy");
    this._progSeed      = compileProgram(gl, V_QUAD,    F_SEED,            "tendrils-seed");

    // Fullscreen quad for the composite / seed / fade passes.
    this._quadVao = createFullscreenQuad(gl);

    // Deposit VAO: one gl.POINTS vertex per particle, aIdx = 0..N-1.
    this._depositVao = gl.createVertexArray();
    gl.bindVertexArray(this._depositVao);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
    const idx = new Float32Array(this._particleCount);
    for (let i = 0; i < this._particleCount; i++) idx[i] = i;
    gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const locDepIdx = gl.getAttribLocation(this._progDeposit, "aIdx");
    gl.enableVertexAttribArray(locDepIdx);
    gl.vertexAttribPointer(locDepIdx, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Trail VAO: two vertices per particle (prev end + current end),
    // drawn as gl.LINES. aIdx repeats, aEnd alternates 0/1.
    this._trailVao = gl.createVertexArray();
    gl.bindVertexArray(this._trailVao);
    const trailBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, trailBuf);
    const N = this._particleCount;
    const data = new Float32Array(N * 2 * 2);      // 2 verts × (idx,end)
    for (let i = 0; i < N; i++) {
      data[i * 4 + 0] = i; data[i * 4 + 1] = 0.0;  // prev
      data[i * 4 + 2] = i; data[i * 4 + 3] = 1.0;  // curr
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const locTIdx = gl.getAttribLocation(this._progTrail, "aIdx");
    const locTEnd = gl.getAttribLocation(this._progTrail, "aEnd");
    gl.enableVertexAttribArray(locTIdx);
    gl.vertexAttribPointer(locTIdx, 1, gl.FLOAT, false, 8, 0);
    gl.enableVertexAttribArray(locTEnd);
    gl.vertexAttribPointer(locTEnd, 1, gl.FLOAT, false, 8, 4);
    gl.bindVertexArray(null);

    // Particle state ping-pong. Two of them: one for the current
    // frame's positions and one for the previous frame's positions,
    // so the trail vertex shader can read both.
    this._particles = createPingPong(gl, this._particlesW, this._particlesH, {
      preferHighPrecision: true,
      filter: gl.NEAREST,
    });

    // Flow field ping-pong — smaller than the canvas; mipmaps enabled
    // so the update pass can do multi-scale sampling.
    this._flow = null;
    this._trail = null;

    this._fieldSize = [0, 0];
    this._trailSize = [0, 0];

    this._seeded = false;

    // Uniform locations.
    this._uU  = this._locs(this._progUpdate, [
      "uParticles","uFlow","uParticlesSize","uTime","uDt","uSpeedLimit","uDamping",
      "uFlowWeight","uNoiseWeight","uNoiseScale","uNoiseSpeed","uFlowDecay","uSeed",
    ]);
    this._uD  = this._locs(this._progDeposit, ["uParticles","uParticlesSize","uPointSize","uTime","uDepositScale"]);
    this._uFR = this._locs(this._progFlowRelax, ["uFlow","uFieldSize","uDecay","uDiffuse"]);
    this._uT  = this._locs(this._progTrail, ["uParticles","uPrev","uParticlesSize","uInkStrength"]);
    this._uTF = this._locs(this._progTrailFade, ["uTrail","uFade"]);
    this._uC  = this._locs(this._progComposite, [
      "uTrail","uPaper","uInk","uPigment","uTintAmount","uDensity","uContrast","uVignette",
    ]);
    this._uCP = this._locs(this._progCopy, ["uSrc"]);
    this._uS  = this._locs(this._progSeed, ["uSeed"]);

    // Emotion state.
    this._surface = [0.94, 0.90, 0.84];      // warm paper
    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._audioRms = 0;
    this._openness = 0.5;
    this._opennessT = 0.5;

    // Ink baseline — very dark, slightly warm so it never reads as
    // pure black on the warm paper.
    this._ink = [0.05, 0.04, 0.06];

    // Current pigment (emotion tint). Starts at ink baseline; eases
    // toward the harmonic-palette front colour each frame.
    this._pigment = [...this._ink];
    this._pigmentT = [...this._ink];
    this._paperT   = [...this._surface];
    this._colorEase = 0.06;

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._runSeed = Math.random() * 1000.0;

    // Second particle texture (previous frame) — used by trail
    // vertex shader as the "prev" end of each line segment.
    this._particlesPrev = createPingPong(gl, this._particlesW, this._particlesH, {
      preferHighPrecision: true,
      filter: gl.NEAREST,
    });

    this._createBuffers();
  }

  _locs(prog, names) {
    const gl = this.gl;
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  _createBuffers() {
    const gl = this.gl;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 800;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);

    // Flow field — quite small, mipmaps for multi-scale sampling.
    const fw = Math.max(64,  Math.min(384, Math.floor(cssW * 0.5)));
    const fh = Math.max(128, Math.min(512, Math.floor(cssH * 0.5)));
    if (this._flow) this._flow.dispose();
    this._flow = createPingPong(gl, fw, fh, {
      preferHighPrecision: true,
      filter: gl.LINEAR,
    });
    this._fieldSize = [fw, fh];

    // Note: we don't enable mipmaps on the flow textures — float
    // textures don't reliably support mipmap generation on iOS
    // Safari. The update shader samples multiple offsets at lod 0
    // instead.

    // Trail buffer — full-canvas so tendril lines land pixel-crisp.
    const tw = this.canvas.width;
    const th = this.canvas.height;
    if (this._trail) this._trail.dispose();
    this._trail = createPingPong(gl, tw, th, {
      preferHighPrecision: false,
      filter: gl.LINEAR,
    });
    this._trailSize = [tw, th];

    // Clear the trail so we don't inherit garbage from an old buffer.
    for (const t of [this._trail.read, this._trail.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, tw, th);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Re-seed particles on resize so distribution stays even.
    this._seeded = false;
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o, label) {
    this._emotion = { v: clamp01((v + 1) * 0.5) * 2 - 1,
                      a: clamp01((a + 1) * 0.5) * 2 - 1,
                      o: clamp01(o) };
    this._opennessT = clamp01(o);

    // Ease the pigment toward the emotion palette's front colour,
    // but cap saturation so the ink never becomes a colored line.
    // harmonicPalette returns 0..1 RGB arrays for every stop; front
    // is the brightest primary-hued stop, which reads best as a
    // pigment undertone once darkened toward the ink baseline.
    const p = harmonicPalette(v, a, { openness: o });
    const fr = Array.isArray(p.front) ? p.front : hexToRgb(String(p.front ?? "#4a3220"));
    // Bring the palette front colour toward the ink baseline so the
    // pigment stays legibly dark. Blend 65% toward ink, 35% front.
    this._pigmentT[0] = this._ink[0] * 0.65 + fr[0] * 0.35;
    this._pigmentT[1] = this._ink[1] * 0.65 + fr[1] * 0.35;
    this._pigmentT[2] = this._ink[2] * 0.65 + fr[2] * 0.35;

    // Paper stays warm; a very slight cool bias when valence is
    // negative so the sheet feels colder to the eye.
    const cool = clamp01(-v);
    this._paperT[0] = this._surface[0] - 0.04 * cool;
    this._paperT[1] = this._surface[1] - 0.02 * cool;
    this._paperT[2] = this._surface[2] + 0.02 * cool;

    this._lastEmotionCss = label || null;
  }

  setSurface(/* r, g, b */) {
    // Tendrils inverts the ship convention: paper stays a warm cream and
    // the pigment (ink) is what the eye tracks. The app pipes
    // SESSION_INK (near-black) into every visual style via setSurface()
    // for the session-start crossfade — for Tendrils that would
    // paint the paper black and the composite would output solid
    // black wherever there is no ink. So we intentionally ignore
    // the app's surface request and keep the internal warm paper.
    // Emotion still tints the paper via setEmotion() below.
  }

  crossfadeSurfaceTo(/* target, durMs */) {
    // See setSurface(): Tendrils manages its own paper. The session
    // crossfade is a no-op here so the warm paper is preserved.
  }

  audioBeat(rms /*, ...*/) { this._audioRms = rms; }

  splat() { /* no interactive splats in Empathic Art */ }

  start() {
    if (this._running) return;
    this._running = true;
    this._t0 = performance.now();
    this._frameCount = 0;
    const loop = () => {
      if (!this._running) return;
      try {
        this._frame();
      } catch (err) {
        console.warn("[tendrils] frame error, halting:", err && err.message);
        this._running = false;
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._crossfadeRaf) cancelAnimationFrame(this._crossfadeRaf);
    this._crossfadeRaf = null;
  }

  destroy() {
    this.stop();
    const gl = this.gl;
    if (this._flow) this._flow.dispose();
    if (this._trail) this._trail.dispose();
    if (this._particles) this._particles.dispose();
    if (this._particlesPrev) this._particlesPrev.dispose();
    this._flow = this._trail = this._particles = this._particlesPrev = null;
  }

  _seedParticles() {
    const gl = this.gl;
    const [w, h] = [this._particlesW, this._particlesH];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._particles.write.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this._progSeed);
    gl.uniform1f(this._uS.uSeed, this._runSeed);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._particles.swap();

    // Copy to prev too, so the very first line segment has zero length.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._particlesPrev.write.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this._progSeed);
    gl.uniform1f(this._uS.uSeed, this._runSeed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._particlesPrev.swap();

    // Clear the flow field.
    for (const t of [this._flow.read, this._flow.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, this._fieldSize[0], this._fieldSize[1]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Clear the trail buffer.
    for (const t of [this._trail.read, this._trail.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, this._trailSize[0], this._trailSize[1]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    this._seeded = true;
  }

  _frame() {
    const gl = this.gl;
    if (!this._seeded) this._seedParticles();

    // Ease colour state toward targets.
    for (let i = 0; i < 3; i++) {
      this._pigment[i] += (this._pigmentT[i] - this._pigment[i]) * this._colorEase;
    }
    this._openness += (this._opennessT - this._openness) * 0.05;

    // Emotion-driven dynamics.
    const v = this._emotion.v;
    const a = this._emotion.a;
    const o = this._openness;
    const arousal = clamp01((a + 1) * 0.5);
    const rms = clamp01(this._audioRms);

    // Noise field frequency + speed grow with arousal so calm
    // states meander wide, roused states tighten and fork.
    const noiseScale = 0.7 + arousal * 1.9;
    const noiseSpeed = 0.10 + arousal * 0.55 + rms * 0.15;
    const noiseWeight = 0.55 + arousal * 0.75;
    const flowWeight  = 0.65 - 0.20 * arousal;    // roused = less inertia, more wander
    const damping     = 0.94 - 0.06 * arousal;
    const speedLimit  = 0.010 + arousal * 0.020;
    const flowDecay   = 0.35 + (1 - o) * 0.55;    // closed forgets flow faster
    const dt = 1.0;

    // Openness controls trail fade — open = long fade (persists),
    // closed = short fade (dissolves fast). This inverts intuition
    // slightly but reads correctly on screen: open leaves lots of
    // room, so residual strokes stay legible; closed piles new
    // strokes on top of the old and needs faster dissolution to
    // avoid a mud pit.
    const trailFade = 0.985 - (1 - o) * 0.020;

    // Emotion tint amount — full 1.0 by default. If the palette is
    // still easing toward the target, the pigment vec already
    // reflects that easing, so we can keep this at 1.0.
    const tintAmount = 1.0;
    const density   = 3.0 + 1.0 * (1 - o);
    const contrast  = 0.65;
    const vignette  = 0.55;
    const inkStrength = 0.25 + 0.15 * arousal;

    const now = (performance.now() - this._t0) / 1000.0;

    // 1) UPDATE particles — read current state + flow, write new state.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._particles.write.fbo);
    gl.viewport(0, 0, this._particlesW, this._particlesH);
    gl.useProgram(this._progUpdate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._particles.read.tex);
    gl.uniform1i(this._uU.uParticles, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._flow.read.tex);
    gl.uniform1i(this._uU.uFlow, 1);
    gl.uniform2f(this._uU.uParticlesSize, this._particlesW, this._particlesH);
    gl.uniform1f(this._uU.uTime, now);
    gl.uniform1f(this._uU.uDt, dt);
    gl.uniform1f(this._uU.uSpeedLimit, speedLimit);
    gl.uniform1f(this._uU.uDamping, damping);
    gl.uniform1f(this._uU.uFlowWeight, flowWeight);
    gl.uniform1f(this._uU.uNoiseWeight, noiseWeight);
    gl.uniform1f(this._uU.uNoiseScale, noiseScale);
    gl.uniform1f(this._uU.uNoiseSpeed, noiseSpeed);
    gl.uniform1f(this._uU.uFlowDecay, flowDecay);
    gl.uniform1f(this._uU.uSeed, this._runSeed);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2) DEPOSIT into flow field — additive blend.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._flow.write.fbo);
    gl.viewport(0, 0, this._fieldSize[0], this._fieldSize[1]);
    gl.useProgram(this._progDeposit);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._particles.write.tex);
    gl.uniform1i(this._uD.uParticles, 0);
    gl.uniform2f(this._uD.uParticlesSize, this._particlesW, this._particlesH);
    gl.uniform1f(this._uD.uPointSize, 2.0);
    gl.uniform1f(this._uD.uTime, now);
    gl.uniform1f(this._uD.uDepositScale, 0.20 * (0.5 + arousal * 0.7));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this._depositVao);
    // Draw the deposit ON TOP of the previous flow (which we copied
    // via the relax pass into the write buffer via a separate step)
    // — but for simplicity we do relax-then-deposit-then-swap.
    // First re-blit the read into the write with fade+diffuse:
    gl.disable(gl.BLEND);
    gl.useProgram(this._progFlowRelax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._flow.read.tex);
    gl.uniform1i(this._uFR.uFlow, 0);
    gl.uniform2f(this._uFR.uFieldSize, this._fieldSize[0], this._fieldSize[1]);
    gl.uniform1f(this._uFR.uDecay, 0.972);
    gl.uniform1f(this._uFR.uDiffuse, 0.12);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Now the deposit on top of the relaxed field.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this._progDeposit);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._particles.write.tex);
    gl.uniform1i(this._uD.uParticles, 0);
    gl.uniform2f(this._uD.uParticlesSize, this._particlesW, this._particlesH);
    gl.uniform1f(this._uD.uPointSize, 2.0);
    gl.uniform1f(this._uD.uTime, now);
    gl.uniform1f(this._uD.uDepositScale, 0.20 * (0.5 + arousal * 0.7));
    gl.bindVertexArray(this._depositVao);
    gl.drawArrays(gl.POINTS, 0, this._particleCount);
    gl.disable(gl.BLEND);
    this._flow.swap();

    // 3) FADE trail buffer — read old trail, write faded version into
    //    the write buffer. We DO NOT swap yet — the lines pass below
    //    also writes to _trail.write, ON TOP of the faded copy, so
    //    the composite sees fade + new lines in one buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._trail.write.fbo);
    gl.viewport(0, 0, this._trailSize[0], this._trailSize[1]);
    gl.useProgram(this._progTrailFade);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._trail.read.tex);
    gl.uniform1i(this._uTF.uTrail, 0);
    gl.uniform1f(this._uTF.uFade, trailFade);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 4) DRAW trail lines — prev→current per particle, additive, on
    //    top of the freshly-written faded buffer (still _trail.write).
    gl.useProgram(this._progTrail);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._particles.write.tex);
    gl.uniform1i(this._uT.uParticles, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._particlesPrev.read.tex);
    gl.uniform1i(this._uT.uPrev, 1);
    gl.uniform2f(this._uT.uParticlesSize, this._particlesW, this._particlesH);
    gl.uniform1f(this._uT.uInkStrength, inkStrength);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this._trailVao);
    gl.drawArrays(gl.LINES, 0, this._particleCount * 2);
    gl.disable(gl.BLEND);
    // Single swap: what we just wrote (fade + lines) becomes the new
    // .read for both the composite below and next frame's fade pass.
    this._trail.swap();

    // 5) COMPOSITE to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this._progComposite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._trail.read.tex);
    gl.uniform1i(this._uC.uTrail, 0);
    gl.uniform3fv(this._uC.uPaper, this._paperT);
    gl.uniform3fv(this._uC.uInk, this._ink);
    gl.uniform3fv(this._uC.uPigment, this._pigment);
    gl.uniform1f(this._uC.uTintAmount, tintAmount);
    gl.uniform1f(this._uC.uDensity, density);
    gl.uniform1f(this._uC.uContrast, contrast);
    gl.uniform1f(this._uC.uVignette, vignette);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 6) Copy the pre-update particle state (particles.read, since
    //    we have not yet swapped) into particlesPrev for next frame's
    //    trail rendering — the "prev" end of each line segment.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._particlesPrev.write.fbo);
    gl.viewport(0, 0, this._particlesW, this._particlesH);
    gl.useProgram(this._progCopy);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._particles.read.tex);
    gl.uniform1i(this._uCP.uSrc, 0);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._particlesPrev.swap();

    // Swap particle ping-pong for next frame's update.
    this._particles.swap();

    // Publish the current emotion CSS variable (so the chamber
    // container can drive its own reactive UI, e.g. the info dot).
    if (this._chamberEl && this._lastEmotionCss) {
      this._chamberEl.style.setProperty("--ea-emotion", this._lastEmotionCss);
    }
  }
}
