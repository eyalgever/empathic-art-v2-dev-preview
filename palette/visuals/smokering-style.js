/**
 * Empathic App — Visual Style: Smokering
 *
 * Smokering is a turbulent ring of curling smoke around the viewer:
 * a fibrous, multi-layered corona painted by polar-domain fbm noise
 * driven by the live emotion signal. Where Halo is a soft radial
 * glow and Threshold is a discrete pulsing edge, Smokering is a
 * living annulus — you can see the strands twist inside the band,
 * as if the composition is breathing through smoke.
 *
 * Design register:
 *   - Polar-space fbm noise deforms a ring into curling wisps and
 *     tendrils rather than a clean radial gradient
 *   - Arousal → more fbm iterations + finer noise scale (more detail,
 *     more turbulence)
 *   - Openness → wider radius + softer thickness (open reads as a
 *     large diffuse cloud around the viewer; closed reads as a tight
 *     dense ring near the body)
 *   - Valence → palette warmth via the harmonic chord + gentle bloom
 *     lift on the front / hot stops; inner-shape fills more of the
 *     ring core on positive valence and hollows it on negative
 *   - Audio RMS → very gentle radial pulse coupling
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - 2-D value noise inlined (no texture asset) — matches Threshold
 *     and Ember so the wave-2 family stays self-contained
 *   - Two independent noise streams cross-fade over a 6-second cycle
 *     so the ring is never a static texture — it breathes and
 *     reshapes on its own tempo
 *   - Colour is mixed across the harmonic chord (back, whisper, mid,
 *     front, hot) as a 5-stop radial gradient, so each emotion
 *     anchor reads as a full multi-hue smoke ring
 *
 * Aesthetic reference: the Smoke Ring shader from the Paper Design
 * shader library (Apache 2.0, https://github.com/paper-design/shaders).
 * The core structure — polar-space fbm noise + timeblend cross-fade
 * + radial ring shape with inner-shape modulation — is a direct
 * port of that algorithm, adapted from a decorative ring pattern
 * into an emotion-driven fullscreen field. The Paper Design shader
 * takes a JS colour list plus a bitmap noise texture; Smokering
 * replaces both with the live harmonic palette and an inline
 * hash-noise so no asset is required and the field responds in
 * real time to valence, arousal, and openness.
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

// Five-stop chord, shared layout with Drift, Threshold, and Ember so
// the same palette module paints every wave-2 style from the same
// emotion anchor.
uniform vec3  uColorBack;
uniform vec3  uColorWhisper;
uniform vec3  uColorMid;
uniform vec3  uColorFront;
uniform vec3  uColorHot;

uniform float uArousal;     // -1..1  → drives noise iterations + tempo
uniform float uOpenness;    // 0..1   → drives radius + thickness
uniform float uValence;     // -1..1  → drives bloom + inner-shape fill
uniform float uAudioRms;    // 0..1   → very gentle radial pulse

#define PI      3.14159265358979323846
#define TWO_PI  6.28318530717958647692
#define MAX_ITER 8

/*
 * Inline 2-D value noise, same hash as Threshold and Ember. The
 * Paper Design smoke-ring samples a pre-baked randomiser texture;
 * this port inlines the hash so the shader stays asset-free and
 * portable across web, iPhone, and Watch.
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
 * Layered fbm; arousal drives the iteration count (2-7). Two
 * parallel streams (n0, n1) so getNoise() can select left or right
 * side of the ring from different sample points, matching Paper
 * Design's polar seam trick.
 */
vec2 fbm(vec2 n0, vec2 n1, int iters) {
  vec2 total = vec2(0.0);
  float amplitude = 0.4;
  for (int i = 0; i < MAX_ITER; i++) {
    if (i >= iters) break;
    total.x += valueNoise(n0) * amplitude;
    total.y += valueNoise(n1) * amplitude;
    n0 *= 1.99;
    n1 *= 1.99;
    amplitude *= 0.65;
  }
  return total;
}

/*
 * Sample the polar-warped noise. pUvLeft and pUvRight are two
 * different phase offsets so the seam of the polar coord (theta
 * wraps at ±PI) blends smoothly. smoothstep on uv.x picks between
 * left and right so we never get a visible tear on the ring.
 */
float getNoise(vec2 uv, vec2 pUv, float t, float noiseScale, int iters) {
  vec2 pUvLeft  = pUv + 0.03 * t;
  float period = max(abs(noiseScale * TWO_PI), 1e-6);
  vec2 pUvRight = vec2(fract(pUv.x / period) * period, pUv.y) + 0.03 * t;
  vec2 n = fbm(pUvLeft, pUvRight, iters);
  return mix(n.y, n.x, smoothstep(-0.25, 0.25, uv.x));
}

/*
 * Ring mask; outer edge falls off across radius..radius+thickness,
 * inner edge fills back in based on innerShape. When innerShape is
 * high the ring reads as a filled disc; low innerShape reads as a
 * hollow annulus.
 */
float getRingShape(vec2 uv, float radius, float thickness, float innerShape) {
  float d = length(uv);
  float ringValue = 1.0 - smoothstep(radius, radius + thickness, d);
  ringValue *= smoothstep(radius - pow(innerShape, 3.0) * thickness, radius, d);
  return ringValue;
}

float sst(float e0, float e1, float x) { return smoothstep(e0, e1, x); }

void main() {
  vec2 res = uResolution;
  float aspect = res.x / max(res.y, 1.0);

  // Center-anchored UV; y up, x scaled to aspect so the ring stays
  // circular on portrait iPhone and landscape watch/desktop framings.
  vec2 uv = (vUv - 0.5);
  uv.x *= aspect;

  // Slight zoom-out so the ring feels large in the frame rather than
  // pattern-sized. Portrait framings get a touch more zoom-out so the
  // ring doesn't crop against the vertical edges.
  uv *= 1.6;

  // Emotion scalars → shader controls.
  float arousal01 = 0.5 + 0.5 * clamp(uArousal, -1.0, 1.0);   // 0..1
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);   // 0..1
  float open      = clamp(uOpenness, 0.0, 1.0);

  // Time base; arousal accelerates the ring's rolling motion. The
  // static offset keeps the very first frame away from the noise
  // origin so we don't open on a flat frame.
  float tempo = mix(0.55, 1.75, arousal01);
  float t     = (uTime + 118.0) * (0.28 + 0.20 * tempo);

  // Noise iteration count   2 at rest, up to 7 at high arousal.
  // High-arousal rings look fibrous and turbulent; low-arousal rings
  // are smooth cloudlike halos.
  int iters = int(mix(2.5, 7.5, arousal01));

  // Noise scale, arousal also drives finer detail (higher scale =
  // finer strands). Openness quietly widens the noise texture so
  // open emotions read as broader, slower wisps.
  float noiseScale = mix(1.0, 1.8, arousal01) * mix(1.15, 0.85, open);

  // Ring geometry; openness widens both radius and thickness so
  // closed emotions read as a tight dense ring near the viewer and
  // open emotions read as a wide diffuse aperture. Radius max is
  // trimmed so the hollow eye can't grow to dominate the frame,
  // and thickness is generous even at low openness so the ring
  // reads as a substantial band rather than a hairline.
  float radius    = mix(0.20, 0.44, open);
  float thickness = mix(0.40, 0.72, open);

  // Slow radial pulse, the ring visibly inhales and exhales over
  // a slow beat so even at rest the composition breathes. Arousal
  // deepens the pulse amplitude.
  float pulse    = 0.5 + 0.5 * sin(t * 0.35);
  float pulseAmp = mix(0.020, 0.055, arousal01);
  radius    += (pulse - 0.5) * pulseAmp;
  thickness += (pulse - 0.5) * pulseAmp * 1.5;

  // Valence drives inner-shape fill, floor lifted so the dark eye
  // can never be larger than the ring itself; top reaches a
  // filled-disc read at high valence.
  float innerShape = mix(0.85, 1.60, valence01);

  // Audio RMS gently pulses the radius so the ring breathes with
  // the accompanying audio bed, very small so it never becomes
  // "reactive-media" flashy.
  radius += 0.015 * uAudioRms;

  // Two independent noise streams cycling over a 6-second beat.
  // timeBlend is a slow sine crossfade so the ring never repeats,
  // even at low arousal.
  float cycleDuration = 3.0;
  float period2       = 2.0 * cycleDuration;
  float localTime1 = fract((0.1 * t + cycleDuration) / period2) * period2;
  float localTime2 = fract((0.1 * t                 ) / period2) * period2;
  float timeBlend  = 0.5 + 0.5 * sin(0.1 * t * PI / cycleDuration - 0.5 * PI);

  // Polar coord, atan for theta, length for radius. radialOffset
  // adds a smooth inward pull at small radii so the noise doesn't
  // spin infinitely tight at the origin.
  float rotSpeed = mix(0.18, 0.55, arousal01);
  float atg = atan(uv.y, uv.x) + 0.001 + t * rotSpeed;
  float l   = length(uv);
  float radialOffset = 0.5 * l - inversesqrt(max(1e-4, l));

  vec2 polar_uv1 = vec2(atg, localTime1 - radialOffset) * noiseScale;
  vec2 polar_uv2 = vec2(atg, localTime2 - radialOffset) * noiseScale;

  float noise1 = getNoise(uv, polar_uv1, t, noiseScale, iters);
  float noise2 = getNoise(uv, polar_uv2, t, noiseScale, iters);
  float noise  = mix(noise1, noise2, timeBlend);

  // Warp uv by the noise so the ring shape itself is fibrous  
  // strands push in and out of the annulus. 0.8..2.0 range keeps
  // the ring recognisable as a ring even at heavy noise.
  vec2 warped = uv * (0.7 + 1.6 * noise);

  float ringShape = getRingShape(warped, radius, thickness, innerShape);

  // Five-stop palette mixer across the ring's density. mixer walks
  // 0..4 as ringShape^2 climbs, and each stop crossfades with a
  // small aa-softened smoothstep so transitions read as painted
  // rather than banded.
  float mixer = ringShape * ringShape * 4.0;
  float aa    = fwidth(ringShape);

  vec3 color = uColorBack;

  vec3 stops[4];
  stops[0] = uColorWhisper;
  stops[1] = uColorMid;
  stops[2] = uColorFront;
  stops[3] = uColorHot;

  for (int i = 0; i < 4; i++) {
    float m       = clamp(mixer - float(i), 0.0, 1.0);
    float localS  = 0.35 + fwidth(m);
    float smoothM = sst(max(0.0, 0.5 - localS - aa), min(1.0, 0.5 + localS + aa), m);
    color = mix(color, stops[i], smoothM);
  }

  // Composite against the back stop weighted by ringShape, outside
  // the ring the field settles into the back color so the composition
  // has a real "smoke on velvet" ground rather than pure black.
  vec3 bg = uColorBack * mix(0.35, 0.85, valence01);
  color   = mix(bg, color, ringShape);

  // Valence bloom, very gentle so the ring stays a ring rather than
  // a flare. Never lets a channel go past 1.0.
  float bloom = mix(0.60, 1.05, valence01);
  color *= bloom;

  // Subtle additive glow along the ring's brightest strands, the
  // hot stop is pushed slightly on positive valence so warm anchors
  // like Joy or Elation genuinely radiate.
  float ringGlow = smoothstep(0.55, 0.95, ringShape);
  float glow     = mix(0.00, 0.16, valence01);
  color += uColorHot * ringGlow * glow;

  // Soft ceiling, never let a channel go past 1.0. Prevents
  // blowout on saturated warm anchors.
  color = min(color, vec3(1.0));

  // Standard band-fix dither, matches Threshold, Drift, and Ember.
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
    throw new Error("Smokering shader compile failed: " + info);
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
    throw new Error("Smokering program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class SmokeringStyle {
  static id = "smokering";
  static name = "Smokering";
  static subtitle = "A living ring of feeling and smoke";
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
    this._surface = [0x0a / 255, 0x0a / 255, 0x0c / 255];
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Cold-start chord — a duskier neutral-warm smoke so first frame
    // reads as smoke on velvet rather than any specific anchor color.
    this._colBack    = [...this._surface];
    this._colWhisper = [0.20, 0.20, 0.24];
    this._colMid     = [0.42, 0.32, 0.36];
    this._colFront   = [0.78, 0.55, 0.42];
    this._colHot     = [0.96, 0.80, 0.60];
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

    // Smokering carries a full 5-stop chord — the same shape used by
    // Drift, Threshold, and Ember. Slightly warmer + more saturated
    // than Threshold so the ring reads as smoke lit from within
    // rather than a corona edge. hotShift is stronger than Ember's
    // so the innermost strands read as glowing embers even on
    // cooler anchors.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.10,
      back:    0.10,
      whisper: 0.38,
      // mid uses its intrinsic anchor lightness
      front:   0.74,
      hot:     0.90,
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

  // No-op — Smokering is procedural, no splats.
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
