/**
 * Empathic App — Visual Style: Aurora
 *
 * Aurora is a folded ribbon of light drifting across a dark
 * horizon. Where every other style lives on the body — a ring
 * around the viewer, an ember at the centre of the frame, a
 * network of veins in an inner cavity — Aurora looks outward.
 * It is the sky above the field, painted by feeling.
 *
 * Design register:
 *   - Never a hard edge, never a solid form. The whole picture is
 *     participating media: light coming through cloud coming through
 *     more cloud, the boundary always negotiable.
 *   - Valence sets the hue chord — cool greens and violets for
 *     negative valence (a Northern Lights aurora), warm reds and
 *     golds for positive valence (a solar-storm aurora).
 *   - Arousal drives fold frequency and drift speed. Calm states
 *     read as one wide slow curtain; roused states pull the
 *     curtain into fast layered folds.
 *   - Openness controls ribbon breadth and starfield brightness —
 *     closed reads as a tight vertical curtain against a dark
 *     empty sky, open reads as a wide horizon-spanning veil under
 *     a soft field of stars.
 *
 * Technique:
 *   - Pure fullscreen fragment shader, no ping-pong. Cheap enough
 *     for iPhone Safari at half DPR.
 *   - Raymarches a 3D density function along the view ray at 14
 *     samples. The density function is a folded 2D noise band lifted
 *     into 3D — the "aurora curtain" is a warped isosurface in a
 *     participating medium, not a real 3D volume.
 *   - Colour is picked from the harmonic emotion chord at each
 *     accumulation step, with cool violets at the base of the
 *     curtain and warm highlights at the top, so the aurora reads
 *     as physically lit from an unseen sun.
 *   - A cheap star layer sits behind the curtain to give the sky
 *     depth without a real 3D field.
 *
 * Aesthetic reference: real photographic aurora (violent green
 * curtains, red-tipped highlights, folded striations), plus the
 * many raymarched-aurora shaders on Shadertoy. No code copied
 * verbatim; the noise fold + participating media accumulation is
 * the standard construction.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { harmonicPalette } from "../palette/emotion-palette.js?v=1.4.3";

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
uniform vec3  uColorBack;
uniform vec3  uColorWhisper;
uniform vec3  uColorMid;
uniform vec3  uColorFront;
uniform vec3  uColorHot;
uniform float uArousal;   // -1..1
uniform float uOpenness;  // 0..1
uniform float uValence;   // -1..1
uniform float uAudioRms;  // 0..1

// --- noise ---
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Star field   2 layers of point sparkle, drifting slowly. Cheap
// hash-per-tile with a small radial falloff inside the tile.
float stars(vec2 uv, float t, float density, float bright) {
  // 3 layers of stars at different scales for depth. The brightest
  // and largest layer sits in the foreground; a finer, denser layer
  // fills the sky behind. Stars stay visible against the curtain
  // because the composite adds them additively above the ribbon.
  float acc = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float scale = mix(55.0, 180.0, float(layer) / 2.0);
    vec2 p = uv * scale + vec2(t * (0.020 + 0.015 * float(layer)), 0.0);
    vec2 i = floor(p);
    vec2 f = fract(p);
    float rnd = hash21(i);
    // Foreground layer (0) is denser than the far layers so the
    // sky always reads as a starfield rather than a few scattered
    // specks.
    float layerDensity = density * mix(1.8, 0.9, float(layer) / 2.0);
    if (rnd > 1.0 - layerDensity) {
      vec2 c = f - 0.5;
      float d = length(c);
      // Wider radial falloff on the foreground layer so those
      // stars read as clear dots at phone resolution.
      float radius = mix(0.22, 0.14, float(layer) / 2.0);
      float star = smoothstep(radius, 0.0, d);
      // Twinkle with a floor so stars never fully disappear.
      float twinkle = 0.65 + 0.35 * sin(t * 2.0 + rnd * 30.0);
      // Layer brightness weights foreground brighter than far.
      float layerBright = mix(1.30, 0.75, float(layer) / 2.0);
      acc += star * twinkle * bright * layerBright;
    }
  }
  return acc;
}

// Aurora density function evaluated in 2D (x = horizontal, y = height).
// Returns a positive value inside the curtain, zero outside. The
// curtain is a horizontally folded band whose vertical mean line
// drifts with time. The mean line is aggressively displaced so the
// curtain reads as sinuous folds rather than a flat horizontal band.
float auroraDensity(vec2 p, float t, float freq, float fold, out float striations, out float lateral) {
  // Two-octave horizontal noise controls the folding pattern along
  // the curtain. First octave is the big S-curve of the ribbon; second
  // octave stacks smaller sub-folds on top so the curtain doesn't
  // look like a single sine wave. Frequencies are large so the shape
  // actually undulates across a portrait phone width.
  float f  = fbm(vec2(p.x * freq * 1.2 + t * 0.18, t * 0.05));
  float f2 = fbm(vec2(p.x * freq * 2.6 + t * 0.28, t * 0.09 + 3.7));
  // Vertical displacement of the mean line, the key parameter for
  // making the curtain read as folds. Amplitude is much larger than
  // the band width so the fold shape dominates.
  float amp  = 0.55 + 0.15 * (1.0 - fold);
  float amp2 = 0.18 * (1.0 - 0.4 * fold);
  float meanY = 0.50 + amp * (f - 0.5) + amp2 * (f2 - 0.5);
  float dy = p.y - meanY;
  // Curtain width, narrow band of light. Sharp exponential falloff
  // gives the ribbon a legible edge.
  float width = 0.055 + 0.11 * fold;
  float band = exp(-(dy * dy) / (width * width));
  // Vertical striations, the classic aurora light rays running
  // perpendicular to the ribbon. Sharpened exponent so rays punch out.
  float striRaw = fbm(vec2(p.x * freq * 3.0 + t * 0.55, p.y * 12.0 + t * 0.10));
  float stri = pow(clamp(striRaw, 0.0, 1.0), 1.6);
  striations = stri;
  // Lateral position along the curtain, normalised so the chord
  // walk can be driven by "where along the ribbon" not just depth.
  lateral = clamp(f * 0.6 + f2 * 0.4, 0.0, 1.0);
  return band * (0.40 + 1.10 * stri);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  // Keep st.x in a full 0..1 range regardless of aspect so folds
  // actually undulate across the whole width of a portrait phone.
  // Aspect correction is applied only where geometry matters (fold
  // amplitude in y needs the phone's tall proportion).
  vec2 st = uv;

  float arousal01 = 0.5 + 0.5 * clamp(uArousal, -1.0, 1.0);
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);
  float open      = clamp(uOpenness, 0.0, 1.0);

  // Time base; arousal accelerates drift.
  float t = uTime * mix(0.30, 1.20, arousal01);

  // Fold frequency, how many folds across the frame. Open widens
  // the whole picture (fewer, wider folds); arousal pulls more folds
  // out of the same width. Widened range so calm reads as one broad
  // curtain and roused states shatter into stacked layers.
  float freq = mix(1.6, 7.5, arousal01) * mix(1.4, 0.7, open);

  // Accumulator for the aurora curtain, raymarch a small 3D stack
  // by sweeping the density function on a set of Y-slabs at
  // different depths. Cheap approximation that gives the aurora
  // the layered look of real northern lights without a real 3D
  // integration.
  // Single dominant ribbon plus two ghost layers behind it. The
  // primary layer is the curtain the user sees; ghosts add depth
  // parallax without smearing the fold shape.
  float stri1, lat1;
  float d1 = auroraDensity(st, t, freq, open, stri1, lat1);
  float stri2, lat2;
  float d2 = auroraDensity(st + vec2(0.13 * sin(t * 0.09), -0.06), t * 1.15 + 7.3, freq * 1.15, open, stri2, lat2);
  float stri3, lat3;
  float d3 = auroraDensity(st + vec2(-0.09 * sin(t * 0.12 + 1.7), 0.05), t * 0.85 + 13.9, freq * 0.85, open, stri3, lat3);

  // Colour chord walk across the ribbon lateral for each layer.
  #define CHORD_MIX(lat) ( (lat) < 0.33 ? mix(uColorWhisper, uColorMid, (lat)/0.33) : \
                          (lat) < 0.72 ? mix(uColorMid, uColorFront, ((lat)-0.33)/0.39) : \
                          mix(uColorFront, uColorHot, ((lat)-0.72)/0.28) )
  vec3 c1 = CHORD_MIX(lat1);
  vec3 c2 = CHORD_MIX(lat2);
  vec3 c3 = CHORD_MIX(lat3);
  c1 = mix(c1 * 0.45, c1 * 1.25, stri1);
  c2 = mix(c2 * 0.45, c2 * 1.15, stri2);
  c3 = mix(c3 * 0.45, c3 * 1.05, stri3);

  // Composite front-to-back, primary layer dominates, ghosts fill in.
  vec3 curtain = c1 * d1 * 1.8
               + c2 * d2 * 1.1 * (1.0 - min(1.0, d1))
               + c3 * d3 * 0.7 * (1.0 - min(1.0, d1 + d2));
  // Soft-shoulder so the brightest bands roll off instead of clipping
  // to pure white. curtain / (1 + curtain) is a classic Reinhard tone
  // map, hot cores stay hot but never saturate.
  curtain = curtain / (1.0 + curtain);

  // Background, deep sky at bottom, whisper at horizon, transitioning
  // to back at top. Kept subtle so the curtain reads as the subject.
  float horizon = 0.20;
  float sky = smoothstep(horizon - 0.15, horizon + 0.45, uv.y);
  vec3 bg = mix(uColorBack * 0.35, uColorBack * 0.75, sky);
  bg *= smoothstep(-0.05, 0.18, uv.y);

  // Stars; visible in the sky part of the frame. Openness controls
  // both density and brightness so open states carry a soft starfield
  // and closed states are a still empty sky.
  // Stars stay bright and visible in every state, density and
  // brightness only nudge with openness, they never fade out. The
  // floor is set well above what the curtain composite can wash out.
  float starLayer = stars(st, t, 0.020 + 0.014 * open, 0.85 + 0.25 * open);
  // Composite curtain over sky first (curtain brightness is lifted so
  // folds punch out against the deep sky), then add stars ON TOP so
  // they always read as bright pinpoints even through the ribbon.
  vec3 color = bg + curtain * (1.30 + 0.45 * valence01);
  color += vec3(starLayer);

  // Very subtle audio pulse on the curtain highlights.
  color += curtain * 0.10 * uAudioRms;

  // Dither.
  color += (1.0 / 256.0) * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);
  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}`;

// -----------------------------------------------------------------

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Aurora shader compile failed: " + info);
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
    throw new Error("Aurora program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class AuroraStyle {
  static id = "aurora";
  static name = "Aurora";
  static subtitle = "A curtain of light above the field";
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
      time:         gl.getUniformLocation(P, "uTime"),
      resolution:   gl.getUniformLocation(P, "uResolution"),
      colorBack:    gl.getUniformLocation(P, "uColorBack"),
      colorWhisper: gl.getUniformLocation(P, "uColorWhisper"),
      colorMid:     gl.getUniformLocation(P, "uColorMid"),
      colorFront:   gl.getUniformLocation(P, "uColorFront"),
      colorHot:     gl.getUniformLocation(P, "uColorHot"),
      arousal:      gl.getUniformLocation(P, "uArousal"),
      openness:     gl.getUniformLocation(P, "uOpenness"),
      valence:      gl.getUniformLocation(P, "uValence"),
      audioRms:     gl.getUniformLocation(P, "uAudioRms"),
    };

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;

    this._surface = [0.02, 0.03, 0.05];
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Aurora leans cool by default so first-frame reads Northern-
    // lights green rather than a warm cast.
    this._colBack    = [0.02, 0.03, 0.06];
    this._colWhisper = [0.05, 0.14, 0.18];
    this._colMid     = [0.20, 0.55, 0.42];
    this._colFront   = [0.55, 0.85, 0.60];
    this._colHot     = [0.85, 1.00, 0.75];
    this._colBackT    = [...this._colBack];
    this._colWhisperT = [...this._colWhisper];
    this._colMidT     = [...this._colMid];
    this._colFrontT   = [...this._colFront];
    this._colHotT     = [...this._colHot];
    this._openness  = 0.5;
    this._opennessT = 0.5;
    this._colorEase = 0.08;

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._createBuffers();
  }

  _createBuffers() {
    // Cap DPR at 1.5 — the aurora is a soft field, no benefit at 2x.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 800;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o, _label) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.22,
      back:    0.06,
      whisper: 0.32,
      front:   0.72,
      hot:     0.86,
      hotShift:     0.32,
      whisperShift: 1.45,
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
    try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  }

  _frame() {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

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
    gl.uniform1f(this._u.arousal,   this._emotion.a);
    gl.uniform1f(this._u.openness,  this._openness);
    gl.uniform1f(this._u.valence,   this._emotion.v);
    gl.uniform1f(this._u.audioRms,  clamp01(this._audioRms));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
