/**
 * Empathic App — Visual Style: Physarum
 *
 * Physarum is a living network drawn by tens of thousands of GPU
 * agents. Each agent walks, sniffs a pheromone field ahead of it,
 * turns toward the strongest trace, and lays down a little more
 * pheromone as it moves. The pheromone field diffuses and decays
 * every frame. Out of these three rules — deposit, sniff, turn —
 * emerges a slow, continent-scale network of veins and highways
 * that reroutes itself as feeling shifts.
 *
 * Design register:
 *   - The whole style is a distributed drawing performed by the
 *     agents, not a painted field. There is no analytical function
 *     from screen space to color; every luminous strand is a place
 *     where enough walkers happened to reinforce each other.
 *   - Valence sets palette warmth (positive → warm chord, negative
 *     → cool chord).
 *   - Arousal drives agent speed and sensor angle. Calm states
 *     produce wide slow searches; roused states produce tight fast
 *     strands and finer detail.
 *   - Openness controls agent count via a soft mask (drops the
 *     population of agents that are eligible to move each frame,
 *     rather than reallocating the texture) and pheromone decay.
 *     Closed reads as a dense tight web near the viewer; open reads
 *     as a sparse continental network.
 *
 * Technique:
 *   - Agent state is stored in one RGBA float texture (one texel
 *     per agent). rgba = (posX, posY, heading, mask).
 *   - Pheromone field is a smaller float texture that survives
 *     across frames as a ping-pong pair.
 *   - Per frame: update agents → deposit pheromone → diffuse + decay
 *     → composite through the emotion palette to the screen.
 *   - Agent count: 32k on mobile (180×180 grid), 100k on desktop
 *     (316×316 grid). Auto-detected via matchMedia + coarse pointer.
 *
 * Aesthetic reference: Sage Jenson's Physarum simulations and Jeff
 * Jones's 2010 paper "Characteristics of pattern formation and
 * evolution in approximations of Physarum transport networks",
 * plus Amanda Ghassaei's gpu-io Physarum example (MIT). The three
 * transport rules — sense, rotate, deposit — are from that lineage.
 * The rendering pipeline (state texture + trail FBO + composite) is
 * a standard WebGL2 port; no code copied verbatim.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { harmonicPalette } from "../palette/emotion-palette.js";
import {
  createPingPong,
  createTarget,
  disposeTarget,
  compileProgram,
  createFullscreenQuad,
} from "./shared/fbo.js";

// ---------------- Shaders ----------------

const V_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Agent update fragment shader. Runs once per agent per frame.
// gl_FragCoord.xy is the texel index of the agent inside the state
// texture; the shader reads current state, samples the pheromone
// field at three sensor points (front-left, front, front-right),
// turns the agent toward the strongest reading, steps forward, and
// writes the new state.
const F_AGENT_UPDATE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAgents;      // agent state (this frame in)
uniform sampler2D uPheromone;   // pheromone field
uniform vec2  uAgentsSize;      // e.g. (180, 180)
uniform vec2  uFieldSize;       // pheromone resolution
uniform float uTime;
uniform float uSpeed;           // 0..1 driven by arousal
uniform float uSensorAngle;     // radians, driven by arousal
uniform float uSensorDist;      // pixels forward to sense
uniform float uTurnRate;        // radians per step
uniform float uOpenMask;        // 0..1 openness eligibility mask
uniform float uSeed;            // per-run randomness

// Cheap deterministic hash
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float sensePheromone(vec2 p) {
  // Read pheromone brightness at a normalized point. Sample the R
  // channel; the pheromone is stored as a scalar in R.
  return texture(uPheromone, p).r;
}

void main() {
  vec4 a = texture(uAgents, vUv);
  vec2 pos      = a.xy;              // 0..1
  float heading = a.z;
  float mask    = a.w;               // 1.0 = alive, 0..1 = suppressed

  // Sensor sample positions in normalized field space.
  vec2 fieldPx = 1.0 / uFieldSize;
  vec2 fwd     = vec2(cos(heading), sin(heading));
  vec2 lft     = vec2(cos(heading + uSensorAngle), sin(heading + uSensorAngle));
  vec2 rgt     = vec2(cos(heading - uSensorAngle), sin(heading - uSensorAngle));

  // uSensorDist is measured in field pixels. fieldPx = 1/uFieldSize
  // converts one pixel into normalized 0..1 texture space. Each
  // sensor sample also gets a small perpendicular jitter so agents
  // don't collectively lock into hard axis-aligned rails when the
  // field pheromone happens to align that way, a well-known Physarum
  // attractor state that produces boring horizontal bands.
  float distPx = uSensorDist;
  float jr = (hash(vec3(gl_FragCoord.xy * 3.1, uTime + uSeed)) - 0.5) * 0.35;
  vec2 jitter = vec2(-fwd.y, fwd.x) * jr * distPx;
  float sL = sensePheromone(pos + (lft * distPx + jitter) * fieldPx);
  float sF = sensePheromone(pos + (fwd * distPx + jitter) * fieldPx);
  float sR = sensePheromone(pos + (rgt * distPx + jitter) * fieldPx);

  // Turn toward the strongest sensor. If front is strongest, keep
  // heading. If left or right is strongest, rotate that way. If
  // both flanks equal but stronger than front, jitter randomly to
  // break ties (this is straight from the Jeff Jones paper).
  float turn = 0.0;
  if (sF >= sL && sF >= sR) {
    turn = 0.0;
  } else if (sL > sR) {
    turn = uTurnRate;
  } else if (sR > sL) {
    turn = -uTurnRate;
  } else {
    float r = hash(vec3(gl_FragCoord.xy, uTime + uSeed));
    turn = (r > 0.5 ? 1.0 : -1.0) * uTurnRate;
  }

  // Add a random wobble every frame so the network stays organic
  // instead of collapsing into hard axis-aligned rails. Larger than
  // the deterministic turn so no direction becomes a stable
  // attractor purely from field-aspect effects.
  float wobble = (hash(vec3(gl_FragCoord.xy * 1.7, uTime * 0.31 + uSeed)) - 0.5) * 0.30;
  heading += turn + wobble;

  // Step forward at a constant rate in *field pixels*, not in
  // normalized units. Without this correction, motion in the taller
  // axis of the field would cover more field pixels per frame than
  // motion in the shorter axis, and agents moving horizontally would
  // build denser trails than agents moving vertically, the network
  // then collapses into horizontal rails as a stable attractor.
  // uSpeed is expressed in normalized units; scale each component
  // inversely by the field aspect so both axes move at the same
  // pixel-per-frame rate on the field texture.
  vec2 axisScale = vec2(1.0) / (uFieldSize / max(uFieldSize.x, uFieldSize.y));
  // axisScale = (max/W, max/H). For a portrait field, the shorter
  // axis (W) gets scaled *up*, i.e. horizontal steps are boosted to
  // match the field-pixel rate of vertical steps. This equalises
  // trail density in both directions.
  vec2 stepVec = fwd * uSpeed * axisScale;
  pos += stepVec;

  // Torus wrap so agents never escape the field. The network reads
  // as continuous rather than clamped to a wall.
  pos = fract(pos + 1.0);

  // Openness eligibility mask, each agent has a persistent random
  // slot [0..1). If uOpenMask < slot, agent freezes this frame. The
  // frozen agents still exist and still deposit, so switching from
  // open to closed doesn't reallocate; it just wakes more of them.
  float slot = fract(sin(dot(vUv, vec2(45.7, 23.1))) * 12345.678);
  // step(edge, x) returns 1.0 when x >= edge, agent alive when its
  // random slot is at or below the openness mask threshold.
  float alive = step(slot, uOpenMask);

  if (alive < 0.5) {
    // Suppressed this frame, keep last position, don't move.
    fragColor = vec4(a.xy, heading, alive);
    return;
  }

  fragColor = vec4(pos, heading, alive);
}`;

// Trail deposit vertex shader — draws one point per agent at the
// agent's current position, size 1px, additive-blend into the
// pheromone field.
const V_DEPOSIT = `#version 300 es
in float aAgentIdx;             // 0..N-1 → agent index

uniform sampler2D uAgents;
uniform vec2  uAgentsSize;
uniform float uPointSize;

out float vAlive;

void main() {
  float N = uAgentsSize.x * uAgentsSize.y;
  float col = mod(aAgentIdx, uAgentsSize.x);
  float row = floor(aAgentIdx / uAgentsSize.x);
  vec2 texel = (vec2(col, row) + 0.5) / uAgentsSize;

  vec4 a = texture(uAgents, texel);
  vec2 pos   = a.xy;                 // 0..1
  vAlive = a.w;

  // Map 0..1 field coords to NDC.
  vec2 ndc = pos * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

const F_DEPOSIT = `#version 300 es
precision highp float;
in float vAlive;
out vec4 fragColor;

uniform float uDeposit;   // deposit strength per hit

void main() {
  if (vAlive < 0.5) discard;
  // Small radial falloff inside the point so each hit is a soft dot
  // rather than a hard 1×1 square. This keeps the network smoky
  // instead of pixel-crunchy at close range.
  vec2 d = gl_PointCoord - 0.5;
  float falloff = 1.0 - smoothstep(0.20, 0.50, length(d));
  float amount = uDeposit * falloff;
  fragColor = vec4(amount, amount, amount, 1.0);
}`;

// Diffuse + decay: 3×3 box blur of the pheromone field with a
// per-frame multiplicative decay.
const F_DIFFUSE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPheromone;
uniform vec2  uFieldSize;
uniform float uDecay;      // 0..1 multiplied every frame
uniform float uDiffuse;    // 0..1 blend toward neighbour average

void main() {
  vec2 px = 1.0 / uFieldSize;
  float s00 = texture(uPheromone, vUv + px * vec2(-1.0, -1.0)).r;
  float s01 = texture(uPheromone, vUv + px * vec2( 0.0, -1.0)).r;
  float s02 = texture(uPheromone, vUv + px * vec2( 1.0, -1.0)).r;
  float s10 = texture(uPheromone, vUv + px * vec2(-1.0,  0.0)).r;
  float s11 = texture(uPheromone, vUv                       ).r;
  float s12 = texture(uPheromone, vUv + px * vec2( 1.0,  0.0)).r;
  float s20 = texture(uPheromone, vUv + px * vec2(-1.0,  1.0)).r;
  float s21 = texture(uPheromone, vUv + px * vec2( 0.0,  1.0)).r;
  float s22 = texture(uPheromone, vUv + px * vec2( 1.0,  1.0)).r;

  float avg = (s00 + s01 + s02 + s10 + s11 + s12 + s20 + s21 + s22) / 9.0;
  float mixed = mix(s11, avg, uDiffuse);
  float decayed = mixed * uDecay;
  fragColor = vec4(decayed, decayed, decayed, 1.0);
}`;

// Composite: read the pheromone field, remap through the emotion
// palette, and write to the screen. Log-tone-map the intensity so
// dense highways glow without blowing out to paper white.
const F_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPheromone;
uniform vec3  uColorBack;
uniform vec3  uColorWhisper;
uniform vec3  uColorMid;
uniform vec3  uColorFront;
uniform vec3  uColorHot;
uniform float uValence;   // -1..1

float sst(float e0, float e1, float x) { return smoothstep(e0, e1, x); }

void main() {
  float p = texture(uPheromone, vUv).r;

  // Log-lift so the perceptual scale matches how the eye reads the
  // network, a lot of dim area, a few bright arteries. A softer
  // multiplier keeps a large range of intermediate intensities so
  // more of the chord shows across a single frame.
  float lifted = 1.0 - exp(-p * 2.6);
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);

  // Palette walk across the harmonic chord. Wider mixing windows
  // than before so neighbouring chord colors bleed into each other  
  // the walker density map reads as a *chord* of hues rather than
  // one dominant color plus a background.
  float mixer = lifted * 4.0;
  vec3 color = uColorBack;
  vec3 stops[4];
  stops[0] = uColorWhisper;
  stops[1] = uColorMid;
  stops[2] = uColorFront;
  stops[3] = uColorHot;
  float aa = fwidth(lifted);
  float localS = 0.70;
  for (int i = 0; i < 4; i++) {
    float m = clamp(mixer - float(i), 0.0, 1.0);
    float sm = sst(max(0.0, 0.5 - localS - aa), min(1.0, 0.5 + localS + aa), m);
    color = mix(color, stops[i], sm);
  }

  // Very subtle valence lift on the whole picture.
  float bloom = mix(0.70, 1.05, valence01);
  color *= bloom;

  // Dither so the very dark back doesn't band.
  color += (1.0 / 256.0) * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);

  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}`;

// Seed pass — writes the initial agent state on the very first
// frame. Positions are uniform-random across the screen; headings
// are random 0..2π; alive mask is 1.
const F_SEED = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float uSeed;

float rnd(vec2 p, float s) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + s) * 43758.5453);
}

void main() {
  float x = rnd(vUv, uSeed + 1.11);
  float y = rnd(vUv, uSeed + 2.22);
  float h = rnd(vUv, uSeed + 3.33) * 6.2831853;
  fragColor = vec4(x, y, h, 1.0);
}`;

// ---------------- Style class ----------------

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function isMobileLike() {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(pointer: coarse)").matches
      || matchMedia("(max-width: 900px)").matches;
}

export class PhysarumStyle {
  static id = "physarum";
  static name = "Physarum";
  static subtitle = "A living network of feeling";
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

    // Blending state for deposit pass.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    // Agent grid — 180×180 (32400 agents) on mobile, 316×316 (~100k)
    // on desktop. The 2D grid keeps texture size square and cache-
    // friendly for the update pass.
    const mobile = opts.mobile ?? isMobileLike();
    const grid = mobile ? 180 : 316;
    this._agentsW = grid;
    this._agentsH = grid;
    this._agentCount = grid * grid;

    // Pheromone field size — CSS-sized, capped at 512×1024 so mobile
    // Safari doesn't melt. The composite pass then upsamples to
    // screen automatically via bilinear filter.
    this._fieldSize = [0, 0];       // set in _createBuffers

    // Programs.
    this._progAgent    = compileProgram(gl, V_QUAD, F_AGENT_UPDATE, "physarum-agent");
    this._progDeposit  = compileProgram(gl, V_DEPOSIT, F_DEPOSIT,   "physarum-deposit");
    this._progDiffuse  = compileProgram(gl, V_QUAD, F_DIFFUSE,      "physarum-diffuse");
    this._progComposite= compileProgram(gl, V_QUAD, F_COMPOSITE,    "physarum-composite");
    this._progSeed     = compileProgram(gl, V_QUAD, F_SEED,         "physarum-seed");

    // Fullscreen quad for the quad passes.
    this._quadVao = createFullscreenQuad(gl);

    // Agent index buffer for the deposit gl.POINTS pass.
    this._agentIdxVao = gl.createVertexArray();
    gl.bindVertexArray(this._agentIdxVao);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
    const indices = new Float32Array(this._agentCount);
    for (let i = 0; i < this._agentCount; i++) indices[i] = i;
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const locAgentIdx = gl.getAttribLocation(this._progDeposit, "aAgentIdx");
    gl.enableVertexAttribArray(locAgentIdx);
    gl.vertexAttribPointer(locAgentIdx, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Agent ping-pong. RGBA16F is fine — positions live in 0..1 and
    // we only need a few hundred distinct headings.
    this._agents = createPingPong(gl, this._agentsW, this._agentsH, {
      preferHighPrecision: false, // 16F saves memory + bandwidth
      filter: gl.NEAREST,         // never interpolate agent state
    });

    // Seed agents on frame 0.
    this._seeded = false;

    // Pheromone ping-pong is created lazily in _createBuffers.
    this._pheromone = null;

    // Uniform locations.
    this._uA = this._locs(this._progAgent, [
      "uAgents","uPheromone","uAgentsSize","uFieldSize","uTime",
      "uSpeed","uSensorAngle","uSensorDist","uTurnRate","uOpenMask","uSeed",
    ]);
    this._uD = this._locs(this._progDeposit, ["uAgents","uAgentsSize","uPointSize","uDeposit"]);
    this._uDf = this._locs(this._progDiffuse, ["uPheromone","uFieldSize","uDecay","uDiffuse"]);
    this._uC = this._locs(this._progComposite, [
      "uPheromone","uColorBack","uColorWhisper","uColorMid","uColorFront","uColorHot","uValence",
    ]);
    this._uS = this._locs(this._progSeed, ["uSeed"]);

    // Emotion + palette state.
    this._surface = [0.02, 0.02, 0.03];
    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._audioRms = 0;
    this._openness  = 0.5;
    this._opennessT = 0.5;

    this._colBack    = [0.02, 0.02, 0.03];
    this._colWhisper = [0.20, 0.10, 0.14];
    this._colMid     = [0.55, 0.25, 0.22];
    this._colFront   = [0.90, 0.55, 0.30];
    this._colHot     = [1.00, 0.85, 0.55];
    this._colBackT    = [...this._colBack];
    this._colWhisperT = [...this._colWhisper];
    this._colMidT     = [...this._colMid];
    this._colFrontT   = [...this._colFront];
    this._colHotT     = [...this._colHot];
    this._colorEase = 0.08;

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._runSeed = Math.random() * 1000.0;

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

    // Pheromone field resolution — cap smaller than the canvas so
    // the sim itself stays cheap; composite upsamples with bilinear.
    // 0.6 of CSS pixels gives us a soft native scale without agent
    // pixel-crunch.
    const fw = Math.max(64, Math.min(768, Math.floor(cssW * 0.6)));
    const fh = Math.max(128, Math.min(1024, Math.floor(cssH * 0.6)));
    if (this._pheromone) this._pheromone.dispose();
    this._pheromone = createPingPong(gl, fw, fh, {
      preferHighPrecision: false,
      filter: gl.LINEAR,
    });
    this._fieldSize = [fw, fh];

    // Clear both pheromone buffers.
    for (const t of [this._pheromone.read, this._pheromone.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, fw, fh);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Re-seed agents on resize so they don't cluster in a wedge.
    this._seeded = false;
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o, _label) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    // Wider hue walk so the network reads as a *chord* across three
    // to four neighbouring emotions rather than one dominant hue plus
    // background. hotShift now leans halfway to the secondary and
    // whisperShift steps further around the wheel, so bright arteries
    // pick up secondary color while background whisper trails hint at
    // an analogous third emotion. This makes anger read as red-and-
    // amber, love as coral-and-magenta, and so on.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.15,
      back:    0.05,
      whisper: 0.30,
      front:   0.72,
      hot:     0.92,
      hotShift:     0.55,
      whisperShift: 1.85,
    });
    this._colBackT    = chord.back;
    this._colWhisperT = chord.whisper;
    this._colMidT     = chord.mid;
    this._colFrontT   = chord.front;
    this._colHotT     = chord.hot;

    this._opennessT = clamp01(o);

    if (this._chamberEl) {
      const mid = chord.mid;
      const R = Math.round(Math.min(255, mid[0] * 255));
      const G = Math.round(Math.min(255, mid[1] * 255));
      const B = Math.round(Math.min(255, mid[2] * 255));
      const key = `${R},${G},${B}`;
      if (this._lastEmotionCss !== key) {
        this._chamberEl.style.setProperty("--ea-emotion", `rgb(${R}, ${G}, ${B})`);
        this._lastEmotionCss = key;
      }
    }
  }

  setSurface(r, g, b) { this._surface = [r, g, b]; }

  crossfadeSurfaceTo(target, durMs = 1800) {
    return new Promise((resolve) => {
      const start = [...this._surface];
      const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / durMs);
        const e = ease(p);
        this._surface = [
          start[0] + (target.r - start[0]) * e,
          start[1] + (target.g - start[1]) * e,
          start[2] + (target.b - start[2]) * e,
        ];
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  audioBeat(rms /*, ...*/) { this._audioRms = rms; }

  splat() {}

  start() {
    if (this._running) return;
    this._running = true;
    const step = () => {
      if (!this._running) return;
      this._frame();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this.stop();
    try {
      this._agents?.dispose();
      this._pheromone?.dispose();
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }

  _seedAgents() {
    const gl = this.gl;
    gl.useProgram(this._progSeed);
    gl.uniform1f(this._uS.uSeed, this._runSeed);
    gl.bindVertexArray(this._quadVao);
    for (const t of [this._agents.read, this._agents.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, this._agentsW, this._agentsH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this._seeded = true;
  }

  _frame() {
    const gl = this.gl;

    // Ease palette + openness toward targets.
    const e = this._colorEase;
    for (let i = 0; i < 3; i++) {
      this._colBack[i]    += (this._colBackT[i]    - this._colBack[i])    * e;
      this._colWhisper[i] += (this._colWhisperT[i] - this._colWhisper[i]) * e;
      this._colMid[i]     += (this._colMidT[i]     - this._colMid[i])     * e;
      this._colFront[i]   += (this._colFrontT[i]   - this._colFront[i])   * e;
      this._colHot[i]     += (this._colHotT[i]     - this._colHot[i])     * e;
    }
    this._openness += (this._opennessT - this._openness) * e;

    if (!this._seeded) this._seedAgents();

    // Emotion → sim parameters.
    const t = (performance.now() - this._t0) / 1000;
    const a01 = 0.5 + 0.5 * Math.max(-1, Math.min(1, this._emotion.a));
    const op  = this._openness;

    // Speed in normalized units per frame. Roused states walk faster.
    const speed = 0.0018 + 0.0060 * a01;
    // Sensor angle — narrow at rest, wider when roused, so tight
    // states settle into rails and roused states branch.
    const sensorAngle = 0.25 + 0.45 * a01;
    // Sensor distance in *field pixels*. Open states search much
    // further ahead — so agents form long sparse continental strands
    // that reach across the frame. Closed states cluster tightly.
    // Range 3–36 gives an order-of-magnitude difference so the two
    // states read as fundamentally different networks.
    const sensorDist = 3.0 + 33.0 * op;
    // Turn rate. Slightly lower base than before so wobble dominates
    // when there is no gradient, keeping the network isotropic.
    const turnRate = 0.12 + 0.30 * a01;
    // Openness eligibility mask — fraction of agents allowed to move.
    // Closed = high mask (dense inner web); Open = low mask (sparse
    // network with visible dark gaps between strands).
    const openMask = 1.00 - 0.75 * op;
    // Pheromone decay + diffusion. Open states diffuse much more so
    // the network reads soft, wide, and cloud-like; closed states
    // barely diffuse so trails stay tight and pixel-sharp.
    const decay   = 0.945 - 0.055 * op;    // closed retains longer
    const diffuse = 0.30 + 0.55 * op;      // 0.30 tight → 0.85 soft

    // ---- Pass 1: agent update ----
    gl.useProgram(this._progAgent);
    gl.bindVertexArray(this._quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._agents.read.tex);
    gl.uniform1i(this._uA.uAgents, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._pheromone.read.tex);
    gl.uniform1i(this._uA.uPheromone, 1);
    gl.uniform2f(this._uA.uAgentsSize, this._agentsW, this._agentsH);
    gl.uniform2f(this._uA.uFieldSize,  this._fieldSize[0], this._fieldSize[1]);
    gl.uniform1f(this._uA.uTime,       t);
    gl.uniform1f(this._uA.uSpeed,      speed);
    gl.uniform1f(this._uA.uSensorAngle,sensorAngle);
    gl.uniform1f(this._uA.uSensorDist, sensorDist);
    gl.uniform1f(this._uA.uTurnRate,   turnRate);
    gl.uniform1f(this._uA.uOpenMask,   openMask);
    gl.uniform1f(this._uA.uSeed,       this._runSeed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._agents.write.fbo);
    gl.viewport(0, 0, this._agentsW, this._agentsH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._agents.swap();

    // ---- Pass 2: deposit ----
    // Additive blend into the pheromone read buffer directly. This
    // is legal because deposit only writes; no read-from-current is
    // needed. Diffusion happens as a separate pass afterward.
    gl.useProgram(this._progDeposit);
    gl.bindVertexArray(this._agentIdxVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._agents.read.tex);
    gl.uniform1i(this._uD.uAgents, 0);
    gl.uniform2f(this._uD.uAgentsSize, this._agentsW, this._agentsH);
    gl.uniform1f(this._uD.uPointSize, 2.0);
    // Deposit strength — more agents alive means more energy per
    // frame; scale so density feels equal across arousal levels.
    gl.uniform1f(this._uD.uDeposit, 0.045);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pheromone.read.fbo);
    gl.viewport(0, 0, this._fieldSize[0], this._fieldSize[1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this._agentCount);
    gl.disable(gl.BLEND);

    // ---- Pass 3: diffuse + decay ----
    gl.useProgram(this._progDiffuse);
    gl.bindVertexArray(this._quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._pheromone.read.tex);
    gl.uniform1i(this._uDf.uPheromone, 0);
    gl.uniform2f(this._uDf.uFieldSize, this._fieldSize[0], this._fieldSize[1]);
    gl.uniform1f(this._uDf.uDecay,   decay);
    gl.uniform1f(this._uDf.uDiffuse, diffuse);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pheromone.write.fbo);
    gl.viewport(0, 0, this._fieldSize[0], this._fieldSize[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._pheromone.swap();

    // ---- Pass 4: composite to screen ----
    gl.useProgram(this._progComposite);
    gl.bindVertexArray(this._quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._pheromone.read.tex);
    gl.uniform1i(this._uC.uPheromone, 0);
    gl.uniform3fv(this._uC.uColorBack,    this._colBack);
    gl.uniform3fv(this._uC.uColorWhisper, this._colWhisper);
    gl.uniform3fv(this._uC.uColorMid,     this._colMid);
    gl.uniform3fv(this._uC.uColorFront,   this._colFront);
    gl.uniform3fv(this._uC.uColorHot,     this._colHot);
    gl.uniform1f(this._uC.uValence,       this._emotion.v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
