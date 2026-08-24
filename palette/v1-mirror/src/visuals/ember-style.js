/**
 * Empathic App — Visual Style: Ember
 *
 * Ember is a warm, breathing color field warped by noise and swirls —
 * a Rothko-adjacent stratum of firelight and slow smoke driven by the
 * live emotion signal. Where Threshold draws a discrete luminous ring
 * and Drift paints slow marbled currents, Ember is a horizon that
 * shifts underfoot: colors fold, curl, and re-form the way embers
 * glow, dim, and re-ignite.
 *
 * Design register:
 *   - Slow domain-warping noise + iterated swirl passes lift the palette
 *     into curling ribbons and soft, cellular smoke
 *   - High arousal → faster swirl tempo, more iterations, sharper edge
 *   - Low arousal → quiet, wide gradient, minimal distortion
 *   - High openness → strong distortion, ribbons unfold and spread
 *   - Low openness → gradient crystallises, ribbons pull inward
 *   - Valence-positive → bright bloom lift + saturation glow
 *   - Valence-negative → smoked-down field, deep back tone dominates
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - 2-D value noise inlined (no texture asset) for portable domain-warp
 *   - Iterated swirl loop from the Paper Design warp algorithm
 *   - Edge / split base pattern gives the composition a horizon, so the
 *     lower two-thirds carry the warm palette while the sky quietly lifts
 *   - Colour is mixed across the harmonic chord (back, whisper, mid,
 *     front, hot) so each emotion anchor reads as a full multi-hue
 *     ember, not a monochrome tint
 *
 * Aesthetic reference: the Warp shader from the Paper Design shader
 * library (Apache 2.0, https://github.com/paper-design/shaders).
 * The core structure — domain-warp noise + iterated swirl loop +
 * base pattern accumulator — is a direct port of that algorithm,
 * adapted from a decorative pattern shader into an emotion-driven
 * fullscreen color field. The Paper Design shader accepts a JS colour
 * list and a bitmap noise texture; Ember replaces both with the live
 * harmonic palette and an inline hash-noise so no asset is required
 * and the field responds in real time to valence, arousal, and
 * openness.
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

// Five-stop chord, shared layout with Drift and Threshold so the
// same palette module paints every wave-2 style from the same
// emotion anchor.
uniform vec3  uColorBack;
uniform vec3  uColorWhisper;
uniform vec3  uColorMid;
uniform vec3  uColorFront;
uniform vec3  uColorHot;

uniform float uArousal;     // -1..1  → drives swirl tempo + iterations
uniform float uOpenness;    // 0..1   → drives distortion + swirl strength
uniform float uValence;     // -1..1  → drives bloom + brightness lift
uniform float uAudioRms;    // 0..1   → very gentle pulse coupling

#define TWO_PI 6.28318530717958647692

/*
 * Cheap 2-D value noise. The Paper Design warp implementation samples
 * a pre-baked randomiser texture; here we inline a hash so no image
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

float sst(float e0, float e1, float x) { return smoothstep(e0, e1, x); }

void main() {
  vec2 res = uResolution;
  float aspect = res.x / max(res.y, 1.0);

  // Center-anchored UV; y up, x scaled to aspect so the swirl reads
  // the same on portrait iPhone and landscape watch/desktop framings.
  vec2 uv = (vUv - 0.5);
  uv.x *= aspect;

  // Zoom slightly out so the field feels large rather than pattern-like.
  uv *= 0.65;

  // Emotion scalars mapped to warp / swirl controls.
  float arousal01 = 0.5 + 0.5 * clamp(uArousal, -1.0, 1.0);   // 0..1
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);   // 0..1
  float open      = clamp(uOpenness, 0.0, 1.0);

  // Time base; arousal accelerates domain drift. Static offset keeps
  // the very first frame away from the noise-lookup origin (matches
  // Paper Design's firstFrameOffset trick so the shader opens on a
  // rich frame rather than a flat one).
  float tempo   = mix(0.55, 1.75, arousal01);
  float t       = (uTime + 118.0) * (0.05 + 0.05 * tempo);

  // Distortion strength, openness widens the warp, so open emotions
  // read as fluid smoke and closed emotions read as tight, marbled
  // stone. Audio RMS adds a very gentle pulse.
  float distortion = mix(0.10, 0.55, open);
  distortion += 0.05 * uAudioRms;

  // Swirl strength + iterations, arousal drives both, so a calm
  // resting frame runs two or three swirl passes and a high-arousal
  // frame runs up to nine, layering fine detail on top of the base
  // warp without ever crossing into psychedelic noise.
  float swirl        = mix(0.12, 0.42, arousal01);
  float swirlIterF   = mix(2.5, 9.5, arousal01);
  int   swirlIter    = int(swirlIterF);

  // First-pass domain warp, same construction as Paper Design's warp:
  // sample two noises at different scales, use one as a direction and
  // one as a magnitude.
  float n1 = valueNoise(uv * 1.0 + t);
  float n2 = valueNoise(uv * 2.0 - t);
  float angle = n1 * TWO_PI;
  uv.x += 4.0 * distortion * n2 * cos(angle);
  uv.y += 4.0 * distortion * n2 * sin(angle);

  // Iterated swirl, cheap Kali-style folding that produces smoke ribbons
  // when combined with the domain warp above. Fixed 6-iteration loop so
  // WebKit/iOS can unroll cleanly; each iteration is masked by a smooth
  // step against the arousal-driven iteration budget so lower arousal
  // still costs the same but contributes less swirl.
  for (int i = 1; i <= 6; i++) {
    float iF   = float(i);
    float mask = 1.0 - smoothstep(swirlIterF - 0.5, swirlIterF + 0.5, iF);
    uv.x += mask * swirl / iF * cos(t + iF * 1.5 * uv.y);
    uv.y += mask * swirl / iF * cos(t + iF * 1.0 * uv.x);
  }

  // Base pattern, an "edge" split with a smoothstep across a
  // hybrid y coordinate that blends raw screen space with the
  // swirl-warped uv. This is what gives Ember its signature curling
  // horizon: the base gradient is smooth top-to-bottom, but the
  // horizon line itself is bent by the swirl loop above, so ember
  // ribbons can rise through the sky like smoke.
  //
  // yBase is raw screen space (0 bottom, 1 top); keeps the smoothstep
  // domain sane at any aspect ratio.
  // yWarp adds the swirl contribution back in as a signed offset so
  // the ember doesn't lie on a ruled line.
  float yBase       = clamp(vUv.y, 0.0, 1.0);
  float warpOffset  = clamp(uv.y * 0.35, -0.35, 0.35);
  float ySky        = clamp(yBase + warpOffset, 0.0, 1.0);

  float softness    = mix(0.06, 0.32, open);
  // Valence nudges the horizon slightly, pleasant moods raise the
  // ember higher into the frame, unpleasant press it low.
  float horizon     = 0.42 + 0.10 * (valence01 - 0.5);
  // Fine noise-driven jitter along the horizon so the boundary reads
  // as smoke rather than a ruled line. Distortion (openness) grows
  // the amplitude.
  float horizonWarp = 0.05 * distortion * (valueNoise(uv * 3.5 + t * 0.6) - 0.5);
  float shape       = 1.0 - sst(horizon - softness + horizonWarp,
                                horizon + softness + horizonWarp,
                                ySky);

  // Five-stop color mixer, walks across the chord in order.
  // Adjacent stops crossfade with a small aa-softened smoothstep so
  // the transitions look painted rather than banded.
  float mixer = shape * 4.0;              // 4 = colorsCount - 1
  float aa    = fwidth(shape);
  vec3  color = uColorBack;               // stop 0

  vec3 stops[4];
  stops[0] = uColorWhisper;
  stops[1] = uColorMid;
  stops[2] = uColorFront;
  stops[3] = uColorHot;

  // Hoist per-iteration cost: aa is already computed once outside the
  // loop; use a fixed softening constant instead of a per-iteration
  // fwidth(m) call so mobile Safari doesn't recompute derivatives four
  // times per fragment.
  float localS = 0.40;
  for (int i = 0; i < 4; i++) {
    float m       = clamp(mixer - float(i), 0.0, 1.0);
    float smooth1 = sst(max(0.0, 0.5 - localS - aa), min(1.0, 0.5 + localS + aa), m);
    color = mix(color, stops[i], smooth1);
  }

  // Valence lift, pleasant emotions warm and lift; unpleasant
  // emotions smoke down. Kept conservative so the ember stays a
  // ember rather than a flare (previous versions clipped hard to
  // white at high valence).
  float bloom = mix(0.60, 1.05, valence01);
  color *= bloom;

  // Glow along the ember band, subtle additive push of the hot
  // stop where the composition is warmest. Very gentle so the field
  // reads as glowing coal rather than direct sunlight.
  float emberBand = smoothstep(0.62, 0.95, shape);
  float glow      = mix(0.00, 0.14, valence01);
  color += uColorHot * emberBand * glow;

  // Very deep back at low valence, collapse into a smoky charcoal;
  // at high valence let the sky lift toward the back stop but never
  // brighten past the mid palette so we keep a rich contrast between
  // the sky and the ember horizon.
  vec3 bg = uColorBack * mix(0.35, 0.85, valence01);
  color   = mix(bg, color, sst(0.0, 0.20, shape));

  // Soft ceiling; never let a channel go past 1.0. Prevents the
  // Rothko-adjacent field from blowing out to paper white on
  // saturated warm anchors like Joy or Elation.
  color = min(color, vec3(1.0));

  // Standard band-fix dither, same as Threshold and Drift.
  color += (1.0 / 256.0) * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);

  fragColor = vec4(color, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Ember shader compile failed: " + info);
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
    throw new Error("Ember program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class EmberStyle {
  static id = "ember";
  static name = "Ember";
  static subtitle = "Warm smoke curling through feeling";
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

    // Live palette + targets — Ember favors a slightly warmer,
    // duskier default chord than Threshold so the field lands on
    // ember tones rather than corona whites at cold-start.
    this._colBack    = [...this._surface];
    this._colWhisper = [0.22, 0.18, 0.24];
    this._colMid     = [0.55, 0.32, 0.22];
    this._colFront   = [0.85, 0.52, 0.28];
    this._colHot     = [0.98, 0.82, 0.55];
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
    // Cap DPR at 1.5 — the horizon field is a smooth gradient so the
    // eye can't resolve the difference between 1.5x and 2x, but the
    // per-pixel shader cost scales quadratically. On iPhone Safari
    // this is the difference between smooth and chunky.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
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

    // Ember is a smoky color-field painting — pull the full harmonic
    // chord so the horizon carries the primary emotion plus its
    // circumplex neighbour and one analogous whisper. Slightly
    // warmer chord shaping than Threshold: the hot stop is pushed
    // brighter and the front is lifted so warm anchors like Joy or
    // Elation genuinely glow, and cool anchors like Melancholy or
    // Sadness read as deep charcoal without going flat.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.08,
      back:    0.12,   // deep — sky and shadow bed
      whisper: 0.42,
      // mid uses its intrinsic anchor lightness
      front:   0.72,
      hot:     0.88,
      hotShift:     0.28,
      whisperShift: 1.30,
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

  // No-op — Ember is procedural, no splats.
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
