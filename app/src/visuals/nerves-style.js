/**
 * Empathic App — Visual Style: Filament
 *
 * A glowing, web-like structure of fluid lines and soft intersections —
 * an atmospheric organic-yet-futuristic reading of the current emotion,
 * as if the feeling were a living network of nerves lit from inside.
 *
 * Design register:
 *   - Slow, breathing pulse; never twitchy
 *   - High arousal → hotter crossings and faster drift
 *   - High openness → softer, wider veins (lower contrast)
 *   - Low openness → sharper filaments (crisper edges)
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - No feedback buffers; pure procedural, cheap on mobile
 *   - Colour driven live from the palette module — no per-shader
 *     uniforms for individual anchors, just a three-colour ramp
 *     (front / mid / back) updated on setEmotion()
 *
 * Aesthetic reference: the "neuro noise" pattern (Paper Design
 * shader library, Apache 2.0, https://github.com/paper-design/shaders).
 * The core GLSL loop is a direct port of the algorithm published by
 * @zozuar (https://x.com/zozuar/status/1625182758745128981/) and used
 * by Paper Design. Vertex shader, uniform surface, colour easing,
 * chamber placement, palette derivation and emotion mapping are
 * original to this app.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 *          Shader algorithm: Apache 2.0 attribution retained above.
 */

import { harmonicPalette } from "../palette/emotion-palette.js?v=1.3.1";

const V_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const F_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uColorFront;   // hotspots at line crossings
uniform vec3  uColorMid;     // body of the filaments (saturated emotion)
uniform vec3  uColorBack;    // background surface (ink or cream in transitions)
uniform float uBrightness;   // 0..1, driven by arousal
uniform float uContrast;     // 0..1, driven by inverse openness
uniform float uArousal;      // -1..1, drives motion speed
uniform float uOpenness;     // 0..1, fundamentally reshapes wire density
uniform vec2  uCenter;       // vUv-space centre for chamber placement

vec2 rotate2(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

/*
 * Neuro-noise shape function. Fifteen rotated octaves of layered
 * cos/sin, each accumulating a running sine offset so successive
 * layers pull toward one another and form the characteristic
 * filament crossings. Direct port of the Paper Design / @zozuar
 * algorithm, see file header for attribution.
 */
float neuroShape(vec2 uv, float t) {
  vec2 sine_acc = vec2(0.);
  vec2 res = vec2(0.);
  float scale = 8.;
  for (int j = 0; j < 15; j++) {
    uv = rotate2(uv, 1.);
    sine_acc = rotate2(sine_acc, 1.);
    vec2 layer = uv * scale + float(j) + sine_acc - t;
    sine_acc += sin(layer);
    res += (.5 + .5 * cos(layer)) / scale;
    scale *= 1.2;
  }
  return res.x + res.y;
}

void main() {
  // Build a world-space UV so the 15-octave neuro pattern has
  // enough spatial extent to actually resolve on screen. Paper's
  // original scaled by resolution and then multiplied by .13; we
  // do the same but re-centre first so the structure orbits the
  // chamber's aperture centre (wheel square in chamber mode, dead
  // middle in centered mode).
  vec2 pixel = (vUv - uCenter) * uResolution;
  // Normalise by the shorter axis so aspect ratio does not distort
  // filament density between portrait and landscape.
  float shortSide = min(uResolution.x, uResolution.y);
  vec2 uv = pixel / shortSide;
  // Denser network still. Nerves emphasises the bright veins
  // rather than the negative-space chambers, so it reads as a
  // synaptic web instead of a cellular structure.
  // Openness reshapes the synaptic web:
  // open (1.0) → sparse, wide, luminous arcs; feels like deep-space
  //              neural highways between distant nodes.
  // closed (0.0) → extremely tight buzzing lattice, feels like
  //                cortical overload, every nerve firing at once.
  // Nerves runs a denser baseline than Filament (2.5 vs 1.8 open)
  // since its aesthetic is already more electrified.
  float density = mix(2.5, 6.5, 1.0 - uOpenness);
  uv *= density;

  // Slow the animation to the "breathing" tempo Empathic Art uses
  // across every style; arousal accelerates modestly, at most 1.7×
  // baseline, so even peak-arousal never becomes twitchy.
  float speed = 0.35 * (1.0 + 0.7 * clamp(uArousal, -1.0, 1.0));
  float t = uTime * speed;

  // Bright-dominant inversion of the Filament algorithm. We keep
  // the same 15-octave neuro summation but push the response curve
  // so the veins bloom instead of the chambers dominating.
  float noise = neuroShape(uv, t);
  noise = (1. + uBrightness) * noise * noise;
  // Openness shapes edge character: open → wide diffuse bloom;
  // closed → razor-sharp crackling filaments.
  float edgeSharpness = mix(0.2, 5.0, 1.0 - uOpenness);
  noise = pow(noise, 0.35 + edgeSharpness * uContrast);
  noise = min(1.6, noise);

  float blend = smoothstep(0.15, 1.1, noise);
  vec3 filamentColour = mix(uColorMid, uColorFront, blend);

  float safeNoise = max(noise, 0.0);
  vec3 col = filamentColour * clamp(safeNoise * 1.15, 0.0, 1.2)
           + uColorBack * (0.15 + 0.55 * (1.0 - clamp(safeNoise, 0.0, 1.0)));

  // Subtle dither breaks banding on smooth gradients without
  // reading as noise texture.
  col += (1./256.) * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - .5);

  fragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Nerves shader compile failed: " + info);
  }
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Nerves program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function hexToRgb01(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [clamp01(hue(h + 1 / 3)), clamp01(hue(h)), clamp01(hue(h - 1 / 3))];
}

export class NervesStyle {
  static id = "nerves";
  static name = "Nerves";
  static subtitle = "A luminous synaptic web";
  static tech = "webgl2";
  static requiresWebGPU = false;

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const explicitMode = opts.mode;
    const hasChamberAncestor = canvas.closest ? !!canvas.closest(".ea-chamber") : false;
    this._mode = explicitMode || (hasChamberAncestor ? "chamber" : "centered");

    const gl = canvas.getContext("webgl2", {
      alpha: false, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, V_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, F_SHADER);
    this._prog = link(gl, vs, fs);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, 1,1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._vao = vao;

    const P = this._prog;
    this._u = {
      time:        gl.getUniformLocation(P, "uTime"),
      resolution:  gl.getUniformLocation(P, "uResolution"),
      colorFront:  gl.getUniformLocation(P, "uColorFront"),
      colorMid:    gl.getUniformLocation(P, "uColorMid"),
      colorBack:   gl.getUniformLocation(P, "uColorBack"),
      brightness:  gl.getUniformLocation(P, "uBrightness"),
      contrast:    gl.getUniformLocation(P, "uContrast"),
      arousal:     gl.getUniformLocation(P, "uArousal"),
      openness:    gl.getUniformLocation(P, "uOpenness"),
      center:      gl.getUniformLocation(P, "uCenter"),
    };

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._surface = [0x0d / 255, 0x0b / 255, 0x0a / 255]; // ink by default
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Live palette
    this._colFront = [0.95, 0.85, 0.65];
    this._colMid   = [0.75, 0.55, 0.35];
    this._colBack  = [...this._surface];
    // Targets
    this._colFrontT = [...this._colFront];
    this._colMidT   = [...this._colMid];
    this._colBackT  = [...this._colBack];

    // Filament brightness/contrast targets — eased for smoothness
    this._brightness  = 0.6;
    this._contrast    = 0.55;
    this._openness    = 0.5;
    this._brightnessT = 0.6;
    this._contrastT   = 0.55;
    this._opennessT   = 0.5;

    this._colorEase = 0.08;

    this._createBuffers();
  }

  _createBuffers() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 400;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o, _label) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    // Nerves is the electrified variant — push saturation harder,
    // lift the mid + front stops, and let the highlight tilt toward
    // the neighbouring emotion so the synaptic web reads as a chord
    // (primary hue → neighbour hot bleed) instead of a monochrome
    // filigree.
    // Keep Nerves' original electrified saturation (1.6) so the
    // synaptic web stays vivid, but let the front stop drift a small
    // amount toward the neighbour hue (hotShift 0.30, 25% blend) so
    // the brightest crossings carry a whisper of the adjacent
    // emotion instead of reading as one monochrome filigree.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.6,
      front:   0.90,
      hot:     0.90,
      hotShift: 0.30,
    });

    this._colMidT   = chord.mid;
    this._colFrontT = [
      chord.front[0] * 0.75 + chord.hot[0] * 0.25,
      chord.front[1] * 0.75 + chord.hot[1] * 0.25,
      chord.front[2] * 0.75 + chord.hot[2] * 0.25,
    ];
    this._colBackT  = [...this._surface];

    // Nerves: hotter brightness, openness drives wire structure directly.
    this._brightnessT = 0.35 + 0.45 * clamp01(0.5 * (a + 1));
    this._contrastT   = 0.55; // fixed — structure driven by uOpenness
    this._opennessT   = clamp01(o);

    if (this._chamberEl) {
      const R = Math.round(Math.min(255, chord.mid[0] * 255));
      const G = Math.round(Math.min(255, chord.mid[1] * 255));
      const B = Math.round(Math.min(255, chord.mid[2] * 255));
      const key = `${R},${G},${B}`;
      if (this._lastEmotionCss !== key) {
        this._chamberEl.style.setProperty("--ea-emotion", `rgb(${R}, ${G}, ${B})`);
        this._lastEmotionCss = key;
      }
    }
  }

  setSurface(r, g, b) {
    this._surface = [r, g, b];
    this._colBackT = [r, g, b];
  }

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
        this._colBackT = [...this._surface];
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  audioBeat(rms /*, low, mid, high, centroid */) {
    this._audioRms = rms;
  }

  // No-op — Filament is procedural, no splats.
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
    try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  }

  _frame() {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Ease palette + scalars toward targets each frame
    const e = this._colorEase;
    for (let i = 0; i < 3; i++) {
      this._colFront[i] += (this._colFrontT[i] - this._colFront[i]) * e;
      this._colMid[i]   += (this._colMidT[i]   - this._colMid[i])   * e;
      this._colBack[i]  += (this._colBackT[i]  - this._colBack[i])  * e;
    }
    this._brightness += (this._brightnessT - this._brightness) * e;
    this._contrast   += (this._contrastT   - this._contrast)   * e;
    this._openness   += (this._opennessT   - this._openness)   * e;

    // Small audio-reactive kick on the brightness — keeps the filaments
    // subtly breathing with the score without becoming reactive-strobe.
    const brightNow = clamp01(this._brightness + this._audioRms * 0.25);

    const t = (performance.now() - this._t0) / 1000;
    gl.uniform1f(this._u.time, t);
    gl.uniform2f(this._u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this._u.colorFront, this._colFront);
    gl.uniform3fv(this._u.colorMid,   this._colMid);
    gl.uniform3fv(this._u.colorBack,  this._colBack);
    gl.uniform1f(this._u.brightness,  brightNow);
    gl.uniform1f(this._u.contrast,    this._contrast);
    gl.uniform1f(this._u.arousal,     this._emotion.a);
    gl.uniform1f(this._u.openness,    this._openness);

    // Aperture centre in vUv (Y up):
    //   "chamber" — canvas spans wheel + slider; centre on wheel
    //     square at (0.5, 1 - W/(2H)).
    //   "centered" — dead middle for immersive + picker previews.
    let cx = 0.5, cy = 0.5;
    if (this._mode === "chamber") {
      const cyTop = this.canvas.height > 0
        ? Math.min(0.5, (this.canvas.width * 0.5) / this.canvas.height)
        : 0.5;
      cy = 1.0 - cyTop;
    }
    gl.uniform2f(this._u.center, cx, cy);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
