/**
 * Empathic App — Visual Style: Drift
 *
 * A slow, weightless field of layered colour drifting on two simplex-noise
 * currents. Drift reads the emotion the way a still pond reads a distant
 * wind: the surface never breaks, but every hue moves.
 *
 * Design register:
 *   - Weightless, low-frequency motion; the tempo of clouds, not water
 *   - High arousal → the currents pick up speed and the layers separate
 *   - High openness → wider gradient bands, softer edges, more sky
 *   - Low openness → banded striations, sharper stepped transitions
 *   - Valence colours the whole field via the palette, no explicit warm/cool
 *     switch inside the shader
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - Two rotated simplex-noise octaves added in time, exactly as in
 *     the Paper Design implementation — the field then quantises via
 *     a stepped-smoothstep against a live emotion gradient of up to
 *     five colours (back → mid → front → hot → cream)
 *   - No feedback buffers; entirely procedural, cheap on mobile
 *
 * Aesthetic reference: the "simplex noise" gradient pattern from the
 * Paper Design shader library (Apache 2.0,
 * https://github.com/paper-design/shaders). The `snoise` primitive and
 * the two-octave `getNoise` composition are direct ports of that
 * algorithm. Paper Design's gradient sampling uses a JS-side colour
 * array with `u_colorsCount`; here the palette is derived live from
 * the emotion valence/arousal via the app's palette module and eased
 * per frame. Openness maps to the stepped-smoothstep sharpness so the
 * field can travel from a photographic gradient (open) to a banded
 * poster print (closed) without a discontinuity.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 *          Shader algorithm: Apache 2.0 attribution retained above.
 */

import { harmonicPalette } from "../palette/emotion-palette.js";

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
uniform vec3  uColorBack;    // back layer (surface / ink)
uniform vec3  uColorWhisper; // quiet analogous stop (chord's minor third)
uniform vec3  uColorMid;     // mid layer (saturated emotion)
uniform vec3  uColorFront;   // front layer (bright accent of the emotion)
uniform vec3  uColorHot;     // hottest highlight (secondary emotion bleed)
uniform float uArousal;     // -1..1, drives motion speed
uniform float uOpenness;    // 0..1, drives gradient softness
uniform float uAudioRms;    // 0..1, gentle music-coupled shimmer

/*
 * 2-D simplex noise primitive (Paper Design / Apache 2.0). Fast,
 * bandlimited pseudo-noise suitable for real-time fragment work.
 */
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/*
 * Two counter-drifting simplex layers summed. This is the exact
 * decomposition from Paper Design's simplex-noise shader  
 * one large slow layer, one denser layer moving the opposite way
 * along Y, at slightly different tempos.
 */
float getNoise(vec2 uv, float t) {
  float n = 0.5 * snoise(uv       - vec2(0.0, 0.30 * t));
  n     += 0.5 * snoise(2.0 * uv + vec2(0.0, 0.32 * t));
  return n;
}

/*
 * A soft stepped smoothstep. Paper Design uses this to quantise
 * the colour gradient into visible bands; passing softness=0.5
 * matches their default. Here softness is driven by openness so
 * open → wide continuous gradient, closed → visible poster bands.
 */
float steppedSmooth(float m, float steps, float softness) {
  float stepT = floor(m * steps) / steps;
  float f = m * steps - floor(m * steps);
  float fw = steps * fwidth(m);
  float smoothed = smoothstep(0.5 - softness, min(1.0, 0.5 + softness + fw), f);
  return stepT + smoothed / steps;
}

void main() {
  // Base UV in a comfortable field size, the Paper Design default
  // is v_patternUV * 0.1 after the sizing pipeline. We centre on the
  // canvas and normalise by the shorter side so portrait and
  // landscape read the same density.
  vec2 pixel = (vUv - 0.5) * uResolution;
  float shortSide = min(uResolution.x, uResolution.y);
  vec2 uv = pixel / shortSide;
  // Zoom to a comfortable macro field, one full drift band takes
  // roughly a third of the shorter axis to traverse. Openness widens
  // the bands (zoom in) so the whole surface reads as sky; closed
  // pulls them tighter so bands stack like sedimentary rock.
  float zoom = mix(1.7, 0.9, uOpenness);
  uv *= zoom;

  // Baseline drift tempo. Arousal accelerates the flow up to 1.8×;
  // even peak arousal stays weightless.
  float speed = 0.28 * (1.0 + 0.8 * clamp(uArousal, -1.0, 1.0));
  float t = uTime * speed;

  float shape = 0.5 + 0.5 * getNoise(uv, t);

  // Five-stop chord across [back, whisper, mid, front, hot]. The
  // whisper stop sits between back and mid, an analogous emotion,
  // low saturation; so the darker bands carry a second colour and
  // the whole field reads as a Rothko-style chord instead of a
  // monochrome tint. We fake Paper Design's u_colors[] by unrolling
  // the mix, cheaper on mobile, no dynamic indexing.
  const float N = 5.0;
  float mixer = (shape - 0.5 / N) * N;

  // Openness controls how "banded" vs "continuous" the gradient
  // reads. Closed → 6 hard steps, open → 1 continuous ramp.
  float steps = mix(6.0, 1.0, uOpenness);
  float softness = 0.15 + 0.45 * uOpenness;

  float m1 = clamp(mixer - 0.0, 0.0, 1.0);
  float m2 = clamp(mixer - 1.0, 0.0, 1.0);
  float m3 = clamp(mixer - 2.0, 0.0, 1.0);
  float m4 = clamp(mixer - 3.0, 0.0, 1.0);
  m1 = steppedSmooth(m1, steps, 0.5 * softness);
  m2 = steppedSmooth(m2, steps, 0.5 * softness);
  m3 = steppedSmooth(m3, steps, 0.5 * softness);
  m4 = steppedSmooth(m4, steps, 0.5 * softness);

  vec3 col = uColorBack;
  col = mix(col, uColorWhisper, m1);
  col = mix(col, uColorMid,     m2);
  col = mix(col, uColorFront,   m3);
  col = mix(col, uColorHot,     m4);

  // Gentle audio-reactive shimmer on the hot layer only, never
  // more than a whisper, so quiet passages stay quiet.
  float shimmer = uAudioRms * 0.10;
  col += uColorHot * shimmer * clamp(shape - 0.7, 0.0, 0.3);

  // Standard band-fix dither, same magnitude as Nerves.
  col += (1.0 / 256.0) * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);

  fragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Drift shader compile failed: " + info);
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
    throw new Error("Drift program link failed: " + gl.getProgramInfoLog(p));
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

export class DriftStyle {
  static id = "drift";
  static name = "Drift";
  static subtitle = "A weightless field of colour";
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
      colorBack:    gl.getUniformLocation(P, "uColorBack"),
      colorWhisper: gl.getUniformLocation(P, "uColorWhisper"),
      colorMid:     gl.getUniformLocation(P, "uColorMid"),
      colorFront:   gl.getUniformLocation(P, "uColorFront"),
      colorHot:     gl.getUniformLocation(P, "uColorHot"),
      arousal:     gl.getUniformLocation(P, "uArousal"),
      openness:    gl.getUniformLocation(P, "uOpenness"),
      audioRms:    gl.getUniformLocation(P, "uAudioRms"),
    };

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._surface = [0x0d / 255, 0x0b / 255, 0x0a / 255];
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Live palette
    this._colBack    = [...this._surface];
    this._colWhisper = [0.30, 0.28, 0.32];
    this._colMid     = [0.45, 0.35, 0.30];
    this._colFront   = [0.75, 0.55, 0.35];
    this._colHot     = [0.95, 0.85, 0.65];
    // Targets
    this._colBackT    = [...this._colBack];
    this._colWhisperT = [...this._colWhisper];
    this._colMidT     = [...this._colMid];
    this._colFrontT   = [...this._colFront];
    this._colHotT     = [...this._colHot];

    this._openness  = 0.5;
    this._opennessT = 0.5;

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

    // Drift is a gradient painting — pull the full harmonic chord
    // (primary emotion + neighbour bleed + one analogous whisper) so
    // even at a single wheel anchor the field carries three visible
    // colours instead of one tonal ramp. Deliberately understated
    // saturationBoost (0.9) and modest hotShift (0.35) so the chord
    // reads as a Rothko-style micro-bleed, not a garish rainbow.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 0.9,
      back:    0.20,
      whisper: 0.42,
      // mid uses its intrinsic anchor lightness
      front:   0.62,
      hot:     0.78,
      hotShift:     0.35,
      whisperShift: 1.4,
    });

    this._colBackT    = [...this._surface];
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

  // No-op — Drift is procedural, no splats.
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
      this._colBack[i]    += (this._colBackT[i]    - this._colBack[i])    * e;
      this._colWhisper[i] += (this._colWhisperT[i] - this._colWhisper[i]) * e;
      this._colMid[i]     += (this._colMidT[i]     - this._colMid[i])     * e;
      this._colFront[i]   += (this._colFrontT[i]   - this._colFront[i])   * e;
      this._colHot[i]     += (this._colHotT[i]     - this._colHot[i])     * e;
    }
    this._openness += (this._opennessT - this._openness) * e;

    const t = (performance.now() - this._t0) / 1000;
    gl.uniform1f(this._u.time, t);
    gl.uniform2f(this._u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this._u.colorBack,    this._colBack);
    gl.uniform3fv(this._u.colorWhisper, this._colWhisper);
    gl.uniform3fv(this._u.colorMid,     this._colMid);
    gl.uniform3fv(this._u.colorFront,   this._colFront);
    gl.uniform3fv(this._u.colorHot,     this._colHot);
    gl.uniform1f(this._u.arousal,     this._emotion.a);
    gl.uniform1f(this._u.openness,    this._openness);
    gl.uniform1f(this._u.audioRms,    clamp01(this._audioRms));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
