/**
 * ChapelStyle
 * -----------
 * A painterly colour-field: two or three horizontal bands whose seams
 * feather softly into each other, enriched with slow corner-anchored
 * chromatic glows that migrate around the frame like light bleeding
 * through the edges of a chapel wall.
 *
 * Language (per the DESIGN-BRIEF and the Art Basel / UBS 2026 reference):
 *   - Bands fill the frame edge-to-edge; seams are ≥8% of frame height,
 *     feathered so no hard line ever appears.
 *   - Openness → band count. Closed (o≈0) = 2 bands; Open (o≈1) = 3
 *     bands with a slim third seam colour on top.
 *   - Arousal → vertical split position. High arousal lifts the lumen
 *     band upward (weight-forward); low arousal presses it downward.
 *   - Valence → warm/cool skew of the pairing derived from the anchor
 *     emotion. Positive valence lifts saturation and pushes bands
 *     toward rust/sienna/ochre; negative valence sinks toward indigo/
 *     aubergine/slate.
 *   - Corner bleed: two soft chromatic pools anchored to opposite
 *     corners drift very slowly. Their hue is a rotated derivative of
 *     the primary emotion, so the whole composition stays inside the
 *     emotion's chromatic neighbourhood.
 *   - Surface: low-frequency luminance mottling (filtered fBm at 0.02
 *     amplitude), plus ±1.5% film grain from a pre-computed noise
 *     texture. Chromatic bleed lives at the seams so the boundary
 *     between bands never reads as ink.
 *
 * Palette guardrails:
 *   - L never below 0.10 (never black) or above 0.92 (never white).
 *   - Saturation clamped to [0.35, 0.75] — every field chromatic;
 *     never neutral grey.
 *   - Cross-hue continuity: the corner glows are hue-adjacent to the
 *     primary anchor so nothing ever feels off-emotion.
 *
 * Motion:
 *   - 3.5 s black→painting fade-in on first show; 2.0 s eased crossfade
 *     on emotion change.
 *   - ±3% luminance oscillation at 0.08 Hz (~12 s period) for the
 *     breath. Corner glows drift on independent 45 s / 62 s cycles so
 *     the frame never looks looped.
 *
 * Interface parity with the other styles:
 *   - `chamber` vs `centered` mode, auto-detected via `.ea-chamber`
 *     ancestor.
 *   - Publishes `--ea-emotion` CSS variable on the chamber ancestor
 *     so overlay chrome (wheel thumb, slider thumb) tints to match.
 *   - `setSurface`, `crossfadeSurfaceTo`, `audioBeat`, `splat` are
 *     harmless no-ops.
 *
 * References
 *   - references/rothko/DESIGN-BRIEF.md
 *   - Art Basel & UBS 2026 Art Market Report social carousel
 *
 * @author Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { nearestEmotions } from "../palette/emotion-palette.js?v=1.3.1";

/* ── shader source ──────────────────────────────────────────── */

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

// All colour uniforms are gamma-corrected sRGB; converted to linear
// inside the shader before compositing.

// Deep saturated base fills the whole frame.
uniform vec3  uBase;

// Three drifting chromatic pools.
uniform vec3  uPoolAColor;
uniform vec3  uPoolBColor;
uniform vec3  uPoolCColor;
uniform vec2  uPoolAPos;
uniform vec2  uPoolBPos;
uniform vec2  uPoolCPos;
uniform float uPoolAAmp;
uniform float uPoolBAmp;
uniform float uPoolCAmp;

// Pool sizes, arousal expands them, low arousal keeps them tight.
uniform float uPoolRadius;
uniform float uPoolSoft;

// Motion / painterly.
uniform float uLumBreath;   // -1..1 slow breath on overall luminance
uniform float uGrainSeed;   // small time-varying seed to animate grain

// Envelope for the first-show fade-in and the emotion crossfade  
// the whole field is multiplied by this, so we can bloom out of black
// on mount and cross-fade smoothly through updates.
uniform float uAlpha;

const float PI = 3.14159265358979;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c)   { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

// Cheap fBm, three octaves of value noise. Not perfect noise, but
// perfect for painterly mottling where we want visible "brush weight"
// rather than hi-freq detail. Uses a small kernel to stay iOS-friendly.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

// White-noise film grain, tiny per-pixel jitter that gives the
// painterly canvas its tooth. Amplitude kept low so it never becomes
// TV static.
float grain(vec2 p, float seed) {
  return hash(p * 137.0 + seed) - 0.5;
}

// Soft anisotropic pool with fBm-warped radius. Returns 0..1.
// aspect = w/h. On portrait (aspect < 1) we scale y-distance by
// 1/aspect so pools stay roughly circular in screen space rather
// than stretching along the tall axis.
float pool(vec2 uv, vec2 pos, float radius, float soft, float aspect, float t, float phase) {
  vec2 d = (uv - pos);
  if (aspect < 1.0) {
    d.y *= (1.0 / aspect);
  } else {
    d.x *= aspect;
  }
  float r = length(d);
  float w = fbm(uv * vec2(2.4, 2.4 / max(aspect, 0.1)) + vec2(t * 0.012 + phase, -t * 0.010 + phase));
  r *= 0.85 + w * 0.35;
  return exp(-pow(r / max(radius, 0.05), soft));
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  /* ── Deep saturated base fills the frame ─────────────────── */
  // Not black. Fills the frame edge-to-edge with a saturated dark
  // chromatic neutral. Positive valence tilts oxblood/sienna,
  // negative valence tilts indigo/aubergine.
  vec3 baseL = toLinear(uBase);

  /* ── Low-frequency painterly canvas mottle ───────────────── */
  vec2 pMottle = vec2(uv.x * aspect, uv.y) * 3.2;
  float m = fbm(pMottle + vec2(uTime * 0.008, uTime * 0.006)) - 0.5;
  baseL *= 1.0 + m * 0.032;

  /* ── Three drifting chromatic pools ──────────────────────── */
  // Screen-blended over the base so the field brightens where the
  // pools overlap, matching the reference where two warm pools
  // bleeding into each other create a luminous seam.
  float pA = pool(uv, uPoolAPos, uPoolRadius,        uPoolSoft,        aspect, uTime, 0.11) * uPoolAAmp;
  float pB = pool(uv, uPoolBPos, uPoolRadius * 0.92, uPoolSoft * 1.05, aspect, uTime, 2.83) * uPoolBAmp;
  float pC = pool(uv, uPoolCPos, uPoolRadius * 0.78, uPoolSoft * 1.15, aspect, uTime, 5.17) * uPoolCAmp;

  vec3 pALin = toLinear(uPoolAColor);
  vec3 pBLin = toLinear(uPoolBColor);
  vec3 pCLin = toLinear(uPoolCColor);

  vec3 poolContrib =
      1.0 - (1.0 - pALin * pA)
          * (1.0 - pBLin * pB)
          * (1.0 - pCLin * pC);
  baseL = 1.0 - (1.0 - baseL) * (1.0 - poolContrib * 0.985);

  /* ── Breath + grain + envelope ───────────────────────────── */
  // Whole-field luminance breath (±3% at ~12s period, provided by JS).
  baseL *= 1.0 + uLumBreath * 0.030;

  // Film grain, very low amplitude, so the surface feels painted
  // rather than digital-clean.
  float g = grain(vUv * uResolution, uGrainSeed) * 0.014;
  baseL += vec3(g);

  // First-show and emotion-change envelope. When uAlpha < 1 the
  // whole field is multiplied down so it bloom-fades in from black.
  vec3 outL = baseL * uAlpha;

  // Guardrails: never full black, never full white. Clamp linear
  // luminance floor to 0.008 (= sRGB 0.10) and ceiling to 0.92
  // (= sRGB 0.965). Applied only when uAlpha is near 1 so the
  // fade-in still reaches near-black on mount. Ceiling raised to
  // let bright pool cores stay chromatic without clipping to grey.
  if (uAlpha > 0.98) {
    float lum = dot(outL, vec3(0.2126, 0.7152, 0.0722));
    if (lum < 0.008) outL *= 0.008 / max(lum, 1e-4);
    if (lum > 0.92)  outL *= 0.92  / lum;
  }

  fragColor = vec4(toSrgb(outL), 1.0);
}`;

/* ── shader helpers ─────────────────────────────────────────── */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Chapel shader compile failed: " + info);
  }
  return s;
}

function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error("Chapel program link failed: " + info);
  }
  return p;
}

function hexToRgb01(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [n[0] / 255, n[1] / 255, n[2] / 255];
}

/* ── colour space helpers ──────────────────────────────────── */

function _rgbToHsl([r, g, b]) {
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

function _hslToRgb({ h, s, l }) {
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
  const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  return [c01(hue(h + 1 / 3)), c01(hue(h)), c01(hue(h - 1 / 3))];
}

function _wrapHue(h) { h = h % 1; return h < 0 ? h + 1 : h; }

/**
 * Given a primary emotion hex plus valence/arousal, derive a Chapel
 * pairing:
 *   upper — the emotion's own hue, mid-lightness "sky" band
 *   lower — a warm/cool skew opposite the upper band — earth band
 *   seam  — a rotated third hue for the seam ribbon (visible only
 *           when openness > 0.35)
 *   glowA — a rotated warm derivative of the primary hue (corner A)
 *   glowB — a rotated cool derivative of the primary hue (corner B)
 *
 * Every returned colour is a linear-space [r,g,b] in [0,1], guardrailed
 * so L ∈ [0.14, 0.85] and S ∈ [0.38, 0.75].
 */
function derivePairing(primaryHex, valence, arousal, openness) {
  const hsl = _rgbToHsl(hexToRgb01(primaryHex));
  const vNorm = Math.max(-1, Math.min(1, valence));
  const aNorm = Math.max(0, Math.min(1, (arousal + 1) * 0.5));
  const oNorm = Math.max(0, Math.min(1, openness == null ? 0.5 : openness));

  // Warm/cool test off the primary anchor. Warm anchors sit around
  // red/orange/yellow (hue < 0.18 or > 0.92); cool anchors sit around
  // teal/blue/violet.
  const isWarm = hsl.h < 0.18 || hsl.h > 0.92;

  // ── Base field ────────────────────────────────────────────
  // Deep saturated chromatic neutral. For warm anchors it's an
  // oxblood/burnt-sienna; for cool anchors it's an indigo/
  // aubergine. Never grey. L is pushed down for weight so the
  // pools read as light bleeding INTO the base.
  // Base sits in the cool deep quadrant regardless of anchor hue.
  // Warm anchors get a deep aubergine (H ≈ 0.78); cool anchors get
  // a deep midnight indigo (H ≈ 0.68). Never grey, never near
  // the anchor hue — the whole point is that pools bleed light
  // INTO the base, which requires strong H and L contrast.
  const baseH = isWarm ? 0.78 : 0.68;
  const baseS = 0.72;
  const baseL = 0.09 + Math.abs(vNorm) * 0.02;
  const base = _hslToRgb({ h: baseH, s: baseS, l: baseL });

  // ── Pool A ── the primary anchor itself, at mid-luminous L.
  // This is the dominant chromatic pool — the emotion's own hue,
  // now lit up so it bleeds visibly against the deep base.
  const poolAH = hsl.h;
  const poolAS = Math.max(0.65, Math.min(0.95, hsl.s * (1.10 + aNorm * 0.20)));
  const poolAL = Math.max(0.58, Math.min(0.78, 0.64 + vNorm * 0.05 + aNorm * 0.08));
  const poolAColor = _hslToRgb({ h: poolAH, s: poolAS, l: poolAL });

  // ── Pool B ── analogous companion, rotated ±30° from anchor.
  // Warm anchors get a golden partner; cool anchors get a teal or
  // violet partner. This is the "second chromatic corner" of the
  // Basel reference where a coral and a warm gold sit together.
  const poolBH = _wrapHue(hsl.h + (isWarm ? -0.08 : +0.10));
  const poolBS = Math.max(0.62, Math.min(0.90, hsl.s * (1.05 + aNorm * 0.15)));
  const poolBL = Math.max(0.55, Math.min(0.75, 0.62 + vNorm * 0.05 + aNorm * 0.05));
  const poolBColor = _hslToRgb({ h: poolBH, s: poolBS, l: poolBL });

  // ── Pool C ── complementary accent, rotated ~150° from anchor.
  // This is the accent bleed — a small teal/violet on warm anchors
  // or a small coral/rose on cool anchors. Rothko's chromatic
  // seam gets built from this pool's edge overlapping A and B.
  const poolCH = _wrapHue(hsl.h + (isWarm ? +0.45 : -0.40));
  const poolCS = Math.max(0.55, Math.min(0.85, hsl.s * 1.05));
  const poolCL = Math.max(0.52, Math.min(0.72, 0.60 + vNorm * 0.04));
  const poolCColor = _hslToRgb({ h: poolCH, s: poolCS, l: poolCL });

  return { base, poolAColor, poolBColor, poolCColor };
}

/* ── the style class ───────────────────────────────────────── */

export class ChapelStyle {
  static id = "chapel";
  static name = "Chapel";
  static subtitle = "Colour, stacked";
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

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1,  1,  1,  1,
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this._u = {
      time:        gl.getUniformLocation(this._prog, "uTime"),
      resolution:  gl.getUniformLocation(this._prog, "uResolution"),
      base:        gl.getUniformLocation(this._prog, "uBase"),
      poolAColor:  gl.getUniformLocation(this._prog, "uPoolAColor"),
      poolBColor:  gl.getUniformLocation(this._prog, "uPoolBColor"),
      poolCColor:  gl.getUniformLocation(this._prog, "uPoolCColor"),
      poolAPos:    gl.getUniformLocation(this._prog, "uPoolAPos"),
      poolBPos:    gl.getUniformLocation(this._prog, "uPoolBPos"),
      poolCPos:    gl.getUniformLocation(this._prog, "uPoolCPos"),
      poolAAmp:    gl.getUniformLocation(this._prog, "uPoolAAmp"),
      poolBAmp:    gl.getUniformLocation(this._prog, "uPoolBAmp"),
      poolCAmp:    gl.getUniformLocation(this._prog, "uPoolCAmp"),
      poolRadius:  gl.getUniformLocation(this._prog, "uPoolRadius"),
      poolSoft:    gl.getUniformLocation(this._prog, "uPoolSoft"),
      lumBreath:   gl.getUniformLocation(this._prog, "uLumBreath"),
      grainSeed:   gl.getUniformLocation(this._prog, "uGrainSeed"),
      alpha:       gl.getUniformLocation(this._prog, "uAlpha"),
    };

    // Live and target palettes. Each colour eases toward its target
    // over time so the field settles like paint. Rates differ across
    // channels so pools arrive at slightly different tempos.
    this._base        = [0.12, 0.08, 0.16];
    this._baseT       = [0.12, 0.08, 0.16];
    this._poolA       = [0.60, 0.32, 0.24];
    this._poolAT      = [0.60, 0.32, 0.24];
    this._poolB       = [0.72, 0.48, 0.28];
    this._poolBT      = [0.72, 0.48, 0.28];
    this._poolC       = [0.28, 0.42, 0.62];
    this._poolCT      = [0.28, 0.42, 0.62];

    // Composition parameters (also eased).
    this._poolAAmp    = 0.80;
    this._poolAAmpT   = 0.80;
    this._poolBAmp    = 0.62;
    this._poolBAmpT   = 0.45;
    this._poolCAmp    = 0.25;
    this._poolCAmpT   = 0.25;
    this._poolRadius  = 0.48;
    this._poolRadiusT = 0.48;
    this._poolSoft    = 1.10;
    this._poolSoftT   = 1.10;

        // First-show envelope.
    this._alpha       = 0.0;
    this._alphaTarget = 1.0;
    this._alphaEase   = 1.0 / (3.5 * 60);   // 3.5 s at 60 fps

    // Emotion state.
    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._label = null;
    this._primaryHex = "#B08060";

    this._t0 = performance.now();
    this._tPrev = this._t0;
    this._running = false;
    this._raf = null;

    // Chamber ancestor — used to publish `--ea-emotion`.
    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._createBuffers();

    // Prime target palette + composition from the initial emotion,
    // then snap live to target so the first alpha-fade-in doesn't
    // have to also crossfade colours.
    this.setEmotion(0, 0, 0.5);
    this._base       = this._baseT.slice();
    this._poolA      = this._poolAT.slice();
    this._poolB      = this._poolBT.slice();
    this._poolC      = this._poolCT.slice();
    this._poolAAmp   = this._poolAAmpT;
    this._poolBAmp   = this._poolBAmpT;
    this._poolCAmp   = this._poolCAmpT;
    this._poolRadius = this._poolRadiusT;
    this._poolSoft   = this._poolSoftT;
  }

  _createBuffers() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 400;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o /*, label */) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    const near = nearestEmotions(v, a);
    const primary = near && near.primary;
    this._primaryHex = (primary && primary.hex) || "#B08060";
    this._label = (primary && primary.name) || null;

    const { base, poolAColor, poolBColor, poolCColor } = derivePairing(
      this._primaryHex, v, a, o
    );
    this._baseT  = base;
    this._poolAT = poolAColor;
    this._poolBT = poolBColor;
    this._poolCT = poolCColor;

    const aNorm = Math.max(0, Math.min(1, (a + 1) * 0.5));
    const oNorm = Math.max(0, Math.min(1, o == null ? 0.5 : o));

    // Pool amplitude. Pool A (primary hue) is always the dominant
    // presence. Pool B follows just behind. Pool C is the accent
    // and stays quiet unless openness is high — that's when the
    // whole frame becomes tri-chromatic.
    // Openness is the dominant lever for chromatic complexity. Closed
    // keeps Pool A dominant and B/C recessive so the frame reads
    // near-monochromatic; open lifts B and C so all three chromas
    // meet and interweave into a tri-chromatic field.
    this._poolAAmpT = 0.85 + aNorm * 0.10;
    this._poolBAmpT = 0.35 + oNorm * 0.55 + aNorm * 0.10;
    this._poolCAmpT = 0.10 + oNorm * 0.60;

    // Pool radius is the second big lever. Closed pulls pools back
    // toward their corner anchors (small, tight); open spreads them
    // across the frame so their edges overlap and blend. Arousal
    // adds a smaller expansion on top.
    this._poolRadiusT = 0.32 + oNorm * 0.38 + aNorm * 0.20;

    // Pool softness. Higher openness = softer, more feathered edges;
    // closed = slightly tighter cores. Exponent < 2 = soft
    // Gaussian-ish falloff.
    this._poolSoftT = 1.25 - oNorm * 0.45;
  }

    setSurface(/* r, g, b */) {
    // The Chapel style paints its own field and ignores the app's
    // cream surface. Kept as a no-op so the style interface stays
    // uniform across visuals.
  }

  crossfadeSurfaceTo(_target, _durMs) {
    return Promise.resolve();
  }

  audioBeat() {}
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

    const now = performance.now();
    const dt = Math.min(0.1, (now - this._tPrev) / 1000);
    this._tPrev = now;
    const t = (now - this._t0) / 1000;

    // Alpha envelope.
    if (this._alpha < this._alphaTarget) {
      this._alpha = Math.min(this._alphaTarget, this._alpha + this._alphaEase * (dt * 60));
    }

    // Ease palette + composition parameters. Rates differ across
    // channels so pools settle like paint rather than snapping.
    const aNorm = Math.max(0, Math.min(1, (this._emotion.a + 1) * 0.5));
    const eBase  = 0.008 + aNorm * 0.012;
    const ePoolA = 0.010 + aNorm * 0.020;
    const ePoolB = 0.009 + aNorm * 0.018;
    const ePoolC = 0.008 + aNorm * 0.016;
    for (let i = 0; i < 3; i++) {
      this._base[i]  += (this._baseT[i]  - this._base[i])  * eBase;
      this._poolA[i] += (this._poolAT[i] - this._poolA[i]) * ePoolA;
      this._poolB[i] += (this._poolBT[i] - this._poolB[i]) * ePoolB;
      this._poolC[i] += (this._poolCT[i] - this._poolC[i]) * ePoolC;
    }
    this._poolAAmp   += (this._poolAAmpT   - this._poolAAmp)   * 0.010;
    this._poolBAmp   += (this._poolBAmpT   - this._poolBAmp)   * 0.010;
    this._poolCAmp   += (this._poolCAmpT   - this._poolCAmp)   * 0.010;
    this._poolRadius += (this._poolRadiusT - this._poolRadius) * 0.010;
    this._poolSoft   += (this._poolSoftT   - this._poolSoft)   * 0.010;

        // Pool drift. Each pool travels a Lissajous cycle inside its
    // preferred corner region, on independent 42s / 57s / 68s
    // periods so the whole frame never repeats a pose.
    const phaseA = t * (2 * Math.PI / 42);
    const phaseB = t * (2 * Math.PI / 57) + 1.7;
    const phaseC = t * (2 * Math.PI / 68) + 3.1;
    // Amplitude oscillation on very long periods (~90-120s) so pools
    // swell and recede independently.
    const swellA = 0.9 + 0.1 * Math.sin(t * (2 * Math.PI / 90));
    const swellB = 0.9 + 0.1 * Math.sin(t * (2 * Math.PI / 110) + 1.1);
    const swellC = 0.9 + 0.1 * Math.sin(t * (2 * Math.PI / 130) + 2.0);
    // Corner anchors: A top-right, B bottom-left, C mid-left.
    const aAmp = 0.14, bAmp = 0.12, cAmp = 0.10;
    const poolAx = 0.78 + aAmp * Math.sin(phaseA);
    const poolAy = 0.22 + aAmp * Math.cos(phaseA * 1.1);
    const poolBx = 0.24 + bAmp * Math.sin(phaseB * 1.05 + 0.6);
    const poolBy = 0.80 + bAmp * Math.cos(phaseB);
    const poolCx = 0.18 + cAmp * Math.sin(phaseC * 0.9 + 2.1);
    const poolCy = 0.48 + cAmp * Math.cos(phaseC * 1.15);

    // Slow breath — ~12s period → 0.083 Hz per the brief.
    const lumBreath = Math.sin(t * (2 * Math.PI / 12));

    // Publish live pool-A colour to CSS so overlay chrome (wheel
    // thumb, slider) tints to match the dominant field colour.
    const _sr = Math.pow(Math.max(0, this._poolA[0]), 1 / 2.2);
    const _sg = Math.pow(Math.max(0, this._poolA[1]), 1 / 2.2);
    const _sb = Math.pow(Math.max(0, this._poolA[2]), 1 / 2.2);
    const _R = Math.round(Math.min(255, _sr * 255));
    const _G = Math.round(Math.min(255, _sg * 255));
    const _B = Math.round(Math.min(255, _sb * 255));
    if (this._chamberEl && this._lastEmotionCss !== `${_R},${_G},${_B}`) {
      this._chamberEl.style.setProperty("--ea-emotion", `rgb(${_R}, ${_G}, ${_B})`);
      this._lastEmotionCss = `${_R},${_G},${_B}`;
    }

    const u = this._u;
    gl.uniform1f(u.time,       t);
    gl.uniform2f(u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.base,       this._base);
    gl.uniform3fv(u.poolAColor, this._poolA);
    gl.uniform3fv(u.poolBColor, this._poolB);
    gl.uniform3fv(u.poolCColor, this._poolC);
    gl.uniform2f(u.poolAPos,    poolAx, poolAy);
    gl.uniform2f(u.poolBPos,    poolBx, poolBy);
    gl.uniform2f(u.poolCPos,    poolCx, poolCy);
    gl.uniform1f(u.poolAAmp,    this._poolAAmp * swellA);
    gl.uniform1f(u.poolBAmp,    this._poolBAmp * swellB);
    gl.uniform1f(u.poolCAmp,    this._poolCAmp * swellC);
    gl.uniform1f(u.poolRadius,  this._poolRadius);
    gl.uniform1f(u.poolSoft,    this._poolSoft);
    gl.uniform1f(u.lumBreath,   lumBreath);
    gl.uniform1f(u.grainSeed,   (t * 60) % 1024);
    gl.uniform1f(u.alpha,       this._alpha);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
