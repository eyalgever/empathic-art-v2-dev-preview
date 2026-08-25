/**
 * Empathic App — Visual Style: Threshold
 *
 * Threshold draws a single luminous ring of colour that pulses and orbits
 * around the viewer's emotion. Where Halo is a static luminous corona
 * and Chapel is a stacked field, Threshold is a boundary — the edge
 * between the inner state and everything outside. Colour-spots travel
 * the ring at different speeds; the whole ring breathes with arousal
 * and blooms brighter with pleasant valence.
 *
 * Design register:
 *   - Slow, breath-tempo pulse (roughly 5–7 beats per minute at rest,
 *     scaling with arousal)
 *   - High arousal → faster orbiting spots, brighter pulse, sharper edge
 *   - Low arousal → single quiet ring, wide softness
 *   - High openness → ring thins, softness grows, spots spread further apart
 *   - Low openness → ring thickens, spots cluster, edge crystallises
 *   - Valence-positive → additive-glow blending (bloom) → the ring seems
 *     to radiate; valence-negative → normal blending → the ring seems
 *     to absorb
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - Signed distance from viewport-centered circle → smoothstep border
 *   - Angular sweep of five colour-spots orbiting the ring; each spot
 *     travels on its own micro-tempo derived from a stable hash so the
 *     motion has variety but reproducibility
 *   - Optional value-noise smoke extending the ring inward and outward
 *     for depth, coupled subtly to arousal
 *   - Palette is the harmonicPalette chord — back, whisper, mid, front,
 *     hot — so even at a single wheel anchor the ring reads as a
 *     multi-hue corona rather than a monochrome tint
 *
 * Aesthetic reference: the Pulsing Border shader from the Paper Design
 * shader library (Apache 2.0, https://github.com/paper-design/shaders).
 * The core structure — rounded signed-distance boundary + angular
 * colour-sector accumulation + optional smoke — is a direct port of
 * that algorithm, adapted from a UI border frame around a rounded
 * rectangle into a fullscreen circular corona centered on the viewer,
 * and driven live by the emotion palette rather than a JS colour list.
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

// Five-stop chord, same layout as Drift, so a shared palette module
// paints both styles from the same emotion anchor.
uniform vec3  uColorBack;
uniform vec3  uColorWhisper;
uniform vec3  uColorMid;
uniform vec3  uColorFront;
uniform vec3  uColorHot;

uniform float uArousal;     // -1..1  → drives pulse rate + spot speed
uniform float uOpenness;    // 0..1   → drives ring softness + spread
uniform float uValence;     // -1..1  → drives bloom (additive glow)
uniform float uAudioRms;    // 0..1   → very gentle pulse coupling

#define TWO_PI 6.28318530717958647692

/*
 * Cheap 2-D value noise. The Paper Design implementation samples a
 * pre-baked randomizer texture; here we inline a hash so no image
 * asset is required and the shader stays self-contained.
 */
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float valueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/*
 * Breath tempo; a compound sine that spikes on-beat and rests off. The
 * curve is direct from Paper Design's beat(t) helper and gives the ring
 * a physiological, non-mechanical pulse.
 */
float beat(float t) {
  float first  = pow(abs(sin(t * TWO_PI)), 10.0);
  float second = pow(abs(sin((t - 0.15) * TWO_PI)), 10.0);
  return clamp(first + 0.6 * second, 0.0, 1.0);
}

float sst(float e0, float e1, float x) { return smoothstep(e0, e1, x); }

void main() {
  vec2 res = uResolution;
  float shortSide = min(res.x, res.y);

  // Centered UV where 1.0 == half the short side. The ring lives on
  // an ellipse in this space, sized to fit comfortably inside the
  // viewport on both portrait (iPhone) and landscape.
  vec2 uv = (2.0 * gl_FragCoord.xy - res) / shortSide;

  // Baseline breath tempo, roughly 6 breaths per minute at rest,
  // rising to ~10 at peak arousal. Arousal also nudges the orbiting
  // spot speed up.
  float arousal01 = 0.5 + 0.5 * clamp(uArousal, -1.0, 1.0);
  // Wider tempo swing: sleepy states drift; agitated states throb hard.
  float breathHz  = mix(0.07, 0.36, arousal01); // Hz; cycles per second
  float t = uTime;
  float pulse = beat(breathHz * t);
  // Arousal also drives pulse *amplitude*: low arousal → shallow throb,
  // high arousal → deep visceral kick. This is what turns tempo into
  // felt intensity.
  float pulseAmp = mix(0.35, 1.35, arousal01);

  // Ring geometry. Openness drives *all three* dimensions: closed →
  // small tight thick crystalline ring near the body; open → large
  // expansive thin diffuse ring that fills the frame.
  float ringRadius    = mix(0.32, 0.86, uOpenness);
  float ringThickness = mix(0.070, 0.024, uOpenness);
  float ringSoftness  = mix(0.024, 0.170, uOpenness);
  // Pulse now pushes the ring outward with real amplitude at high
  // arousal, the ring literally breathes larger under agitation.
  float ringR = ringRadius
              + 0.040 * pulse * pulseAmp
              + 0.012 * uAudioRms;
  // Thickness swells on the beat too, muscle, not decoration.
  ringThickness *= (1.0 + 0.35 * pulse * pulseAmp);

  float d = length(uv) - ringR;
  float ringMask = 1.0 - sst(0.0, ringThickness + ringSoftness, abs(d));
  // Slight inner falloff so the ring reads as an emitter, not a
  // stamped decal. Softness is stronger on the inside than outside
  // for a Rothko-style luminous edge.
  float innerBleed = 1.0 - sst(0.0, 1.5 * ringSoftness, max(0.0, -d));
  ringMask = clamp(ringMask + 0.35 * innerBleed, 0.0, 1.0);

  // Value-noise smoke, extending the ring inward and outward. Kept
  // subtle, this is a whisper of atmosphere, not the main event.
  vec2 smokeUV = uv * 3.5;
  float smokeT = 0.15 * t;
  float smoke = valueNoise(smokeUV + smokeT);
  smoke = clamp(3.0 * smoke - valueNoise(smokeUV * 1.6 - smokeT), 0.0, 1.0);
  float smokeMask = smoke * (1.0 - sst(0.0, 0.35, abs(d)));
  smokeMask *= mix(0.10, 0.75, arousal01);
  ringMask += smokeMask;
  ringMask = clamp(ringMask, 0.0, 1.0);

  // Angular position of this fragment on the ring (0..1 around the
  // circle). Each spot occupies a narrow arc at a phase that drifts
  // over time.
  float angle = atan(uv.y, uv.x) / TWO_PI; // -0.5..0.5
  angle = fract(angle);                     //  0..1

  // Orbit tempo, spots drift full revolutions on the order of 30–60
  // seconds so the motion is contemplative, not busy. Arousal raises
  // the base speed.
  // Much wider orbit-speed range so agitated states clearly race while
  // sleepy states barely drift.
  float orbitSpeed = mix(0.004, 0.075, arousal01); // revolutions/sec

  // Five colours ride the ring on five overlapping arcs.  Widths grow
  // with openness so an open state reads as broad chromatic zones
  // (Rothko), a closed state as tight pips (constellation).
  float spotSize = mix(0.09, 0.22, uOpenness);

  // Per-spot phase offset (a hand-tuned quasi-random spread so no two
  // spots share a phase). Direction alternates so the ring feels
  // alive rather than uniform.
  const float N_SPOTS = 5.0;

  vec3 blendColor = vec3(0.0);
  float blendAlpha = 0.0;
  vec3 addColor = vec3(0.0);
  float addAlpha = 0.0;

  // Unrolled spot loop, one iteration per chord stop. Each stop gets
  // a phase, a direction, and a spot-size jitter derived from its
  // index. Kept explicit (not a for-loop) to avoid dynamic array
  // indexing on the palette, which is cheaper on mobile GL.
  #define ACCUM(COLOR, PHASE, DIR, JITTER) { \
    float phase = fract(PHASE + DIR * orbitSpeed * t); \
    float da = abs(angle - phase); \
    da = min(da, 1.0 - da); \
    float sz = spotSize * (0.85 + 0.30 * JITTER); \
    float sector = 1.0 - sst(0.0, sz, da); \
    /* Each spot also has its own quiet micro-pulse offset from the */\
    /* main breath, so the ring doesn't strobe as one flat unit. */\
    float subPulse = mix(0.55, 0.20, pulseAmp) \
                   + mix(0.45, 1.00, pulseAmp) \
                     * beat(breathHz * (t + JITTER * 4.0)); \
    sector *= subPulse; \
    sector *= ringMask; \
    vec3 srcColor = COLOR * sector; \
    float srcAlpha = sector; \
    blendColor += (1.0 - blendAlpha) * srcColor; \
    blendAlpha  = blendAlpha + (1.0 - blendAlpha) * srcAlpha; \
    addColor += srcColor; \
    addAlpha += srcAlpha; \
  }

  ACCUM(uColorMid,     0.00,  1.0, 0.12)
  ACCUM(uColorFront,   0.20, -1.0, 0.63)
  ACCUM(uColorHot,     0.42,  1.0, 0.31)
  ACCUM(uColorWhisper, 0.66, -1.0, 0.87)
  ACCUM(uColorBack,    0.83,  1.0, 0.48)

  // Bloom; additive blending strength driven by valence. Pleasant
  // emotions glow outward; unpleasant emotions absorb.
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);
  // Bloom polars widened dramatically: unpleasant emotions collapse
  // into darkness, pleasant emotions blaze open.
  float bloom = mix(0.05, 1.80, valence01);

  // Push spots into extra brightness at high valence, additive glow
  // now over-drives past 1.0 so the ring genuinely glares.
  float glow = mix(0.85, 1.60, valence01);
  addColor *= glow;

  vec3 accumColor = mix(blendColor, addColor, clamp(bloom * 0.5, 0.0, 1.0));
  float accumAlpha = mix(blendAlpha, addAlpha, clamp(bloom * 0.5, 0.0, 1.0));
  accumAlpha = clamp(accumAlpha, 0.0, 1.0);

  // Background responds to valence: at low valence the void deepens
  // (near-black, absorbing); at high valence a soft halo of the back
  // stop opens up around the ring, so the field itself glows.
  float bgLevel = mix(0.10, 0.55, valence01);
  vec3 bg = uColorBack * bgLevel;
  // At high valence add a broad radial halo so the whole frame lifts.
  float haloFalloff = 1.0 - sst(ringR, ringR + 1.20, length(uv));
  bg += uColorFront * mix(0.00, 0.35, valence01) * haloFalloff * haloFalloff;

  vec3 col = accumColor + (1.0 - accumAlpha) * bg;

  // Standard band-fix dither.
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
    throw new Error("Threshold shader compile failed: " + info);
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
    throw new Error("Threshold program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class ThresholdStyle {
  static id = "threshold";
  static name = "Threshold";
  static subtitle = "The luminous edge of feeling";
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

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._surface = [0x0d / 255, 0x0b / 255, 0x0a / 255];
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Live palette + targets
    this._colBack    = [...this._surface];
    this._colWhisper = [0.30, 0.28, 0.32];
    this._colMid     = [0.45, 0.35, 0.30];
    this._colFront   = [0.75, 0.55, 0.35];
    this._colHot     = [0.95, 0.85, 0.65];
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

    // Threshold is a ring painting — pull the full harmonic chord so
    // the five orbiting spots carry the primary emotion plus its
    // circumplex neighbour and one analogous whisper. Same tuning
    // ethos as Drift (subtle, Rothko-style micro-bleed) but with a
    // slightly brighter front so the ring reads as an emitter rather
    // than a surface.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.05,
      back:    0.14,   // deep — used as bg tint + one orbiting spot
      whisper: 0.48,
      // mid uses its intrinsic anchor lightness
      front:   0.68,
      hot:     0.82,
      hotShift:     0.32,
      whisperShift: 1.35,
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

  setSurface(r, g, b) {
    this._surface = [r, g, b];
    // Surface influences the deep back only when the palette has not
    // yet been driven by an emotion (i.e. cold start on a tile).
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
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  audioBeat(rms /*, low, mid, high, centroid */) {
    this._audioRms = rms;
  }

  // No-op — Threshold is procedural, no splats.
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
    gl.uniform1f(this._u.arousal,   this._emotion.a);
    gl.uniform1f(this._u.openness,  this._openness);
    gl.uniform1f(this._u.valence,   this._emotion.v);
    gl.uniform1f(this._u.audioRms,  clamp01(this._audioRms));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
