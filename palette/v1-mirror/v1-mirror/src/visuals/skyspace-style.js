/**
 * SkyspaceStyle
 * -------------
 * A single quiet glowing aperture floating on a dusty charcoal wall,
 * after James Turrell's Skyspaces.
 *
 * Composition
 *   - One centred circular aperture (~58% of the wheel), always in
 *     the geometric middle of the render surface. The user's dot on
 *     the wheel is a *separate* DOM control — this shader draws only
 *     the sphere and the surrounding wall.
 *   - Two-tone radial: rim hue on the outside, counter-hue in the
 *     core, meeting in a smooth mid-blend. No noise, no arcs, no
 *     rotation.
 *   - Slow luminosity breath (~12s) so the aperture never feels
 *     locked, and a very slow palette drift (~55s) through nearby
 *     hues so it evolves even when the user isn't moving the dot.
 *   - When the user does move the dot, both rim and core crossfade
 *     to the new emotion's pairing over ~2.5-3.5s. Rim and core
 *     ease at different rates so they arrive slightly out of phase.
 *
 * Palette derivation
 *   The current emotion picks an anchor hex. From that:
 *     rim  = anchor hue nudged warmer, high saturation
 *     core = counter-hue (opposition scales with arousal),
 *            moderate saturation, high lightness
 *   High-arousal joyful → warm peach rim + cyan-lavender core.
 *   Sadness → cool navy rim + peach core inverted.
 *
 * Wall
 *   A soft dusty-charcoal radial vignette from ~#2A2E33 (outer wheel
 *   corners) to ~#3A3E44 near the sphere, so the glow reads like a
 *   Turrell wall. This shader owns the whole wheel-area rectangle —
 *   the cream page still shows outside the wheel container.
 *
 * References
 *   - James Turrell, Skyspaces / Ganzfelds
 *   - The user's reference video and stills (IMG_1663, IMG_1666,
 *     IMG_1668) — sphere is centred, quiet, and singular.
 *
 * @author Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS, nearestEmotions } from "../palette/emotion-palette.js";

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
uniform float uRadius;      // sphere radius in wheel coords (~0.58)
uniform float uArousal;     // 0..1
uniform vec3  uWallInner;   // charcoal near the sphere
uniform vec3  uWallOuter;   // deeper charcoal at wheel corners
uniform vec3  uFillRim;     // outer edge of the sphere
uniform vec3  uFillCore;    // centre of the sphere
uniform float uLumBreath;   // -1..1 subtle luminosity modulation
uniform vec2  uCenter;      // aperture centre in vUv space (default 0.5, 0.5)
uniform float uNShape;      // -1..1 slow breathing bias on the superellipse exponent
uniform float uCoreBreath;  // -1..1 slow lightness bias applied to the core pearl
uniform float uTempBias;    // -1..1 openness-driven cool/warm bias on the wall

const float PI = 3.14159265358979;

// Gamma-correct blend helpers so mid-tones stay luminous rather
// than muddying to a grey midpoint (which is what naive linear RGB
// mixing gives you for opposition hues).
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c)   { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

/* Superellipse-morph radial coordinate.

   The Chamber's Turrell field starts circular at the core and
   morphs into a rounded rectangle at the edges, matching the
   chamber's own rounded-rectangle boundary. We do this by using
   a p-norm distance whose exponent grows with the base radius:

     - Near the centre  → exponent n ≈ 2         → pure circle
     - Near the edges   → exponent n ≈ 10 (large) → rounded box

   At any point p, we first compute the standard Euclidean radius
   d0 = length(p), use it to pick an exponent, then evaluate the
   p-norm  d = (|x|^n + |y|^n)^(1/n)  as the field's radial coord.

   Aspect handling: the canvas is no longer square (the chamber
   includes the openness zone below the wheel), so p is normalised
   so the shorter axis maps to [-1, 1] and the longer axis extends
   beyond. The field naturally elongates along the longer axis,
   which is what we want for a landscape aperture.
*/
float superellipseR(vec2 p, float shapeBias) {
  vec2 ap = abs(p);
  float d0 = length(p);
  // Circle at centre, rounded-rectangle at the outer field.
  // shapeBias in [-1..1] slowly morphs the edge exponent by ±0.6
  // so the aperture breathes between slightly-rounder and
  // slightly-more-rectangular over ~15s. The centre stays circular.
  float nEdge = 10.0 + shapeBias * 0.6;
  float n = mix(2.0, nEdge, smoothstep(0.15, 1.10, d0));
  return pow(pow(ap.x, n) + pow(ap.y, n), 1.0 / n);
}

void main() {
  /* ── Aspect-aware sample coord ────────────────────────── */
  // vUv is 0..1; centre at 0.5. Map into aspect-preserving coords
  // where the shorter axis spans [-1, 1] and the longer axis
  // extends past 1. This lets the field fill non-square chambers
  // (wheel + openness zone) without stretching the core circle.
  // Aperture centre may be offset from the geometric centre of the
  // canvas, e.g. when the chamber includes an openness zone below
  // the wheel, we want the core to sit at the wheel's centre, not
  // between wheel and slider.
  vec2 uv = (vUv - uCenter) * 2.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv;
  if (aspect >= 1.0) {
    p.x = uv.x * aspect;
  } else {
    p.y = uv.y / aspect;
  }

  /* ── One continuous morphing field ──────────────────── */
  // Radial coord uses a superellipse whose exponent grows with
  // distance, circle at centre, rounded-rectangle at the edges.
  float r = superellipseR(p, uNShape);
  float rNorm = r / uRadius;

  // Core lightness breath, slow pulse on the pearl at the centre.
  // Multiplies the core in linear space by ~±4% over ~19s so the
  // aperture feels like it's inhaling. Independent of luminance
  // breath which acts on the whole field.
  vec3 coreL   = toLinear(uFillCore) * (1.0 + uCoreBreath * 0.04);
  vec3 rimL    = toLinear(uFillRim);
  // Turrell chambers are monochromatic, the wall itself takes the
  // emotion tint. We derive wall colours from the rim, deepened to
  // near-black. Fixed charcoals would fight bright rims (Joy) and
  // produce muddy sage in the transition band. Deepening the rim
  // keeps hue continuity from aperture to corner.
  //
  // Openness colour temperature: uTempBias in [-1..1]. Positive
  // (Open) warms the wall toward a soft amber; negative (Closed)
  // cools it toward blue-charcoal. This is on top of the emotion
  // hue so it reads as atmosphere, not palette override.
  vec3 warmShift = vec3(0.06, 0.03, 0.00);
  vec3 coolShift = vec3(0.00, 0.02, 0.06);
  vec3 tempShift = uTempBias >= 0.0
    ? warmShift * uTempBias
    : coolShift * (-uTempBias);
  vec3 wallInL = toLinear(uWallInner) + rimL * 0.20 + tempShift * 0.55;
  vec3 wallOutL= toLinear(uWallOuter) + rimL * 0.08 + tempShift * 0.35;

  // Inner: core → rim, gamma-eased so the pearl reads bright.
  float tCoreRim = smoothstep(0.0, 1.0, rNorm);
  vec3 apertureL = mix(coreL, rimL, tCoreRim);

  // Centre bloom. Turrell apertures always have a lit-from-behind
  // pearl at their heart.
  float bloom = smoothstep(0.55, 0.0, rNorm) * 0.18;
  apertureL += bloom * coreL;

  // Outside the rim peak (rNorm > 1): rim spills through a warm
  // mid-charcoal into the deep corner charcoal, following the
  // superellipse contours so the outer bands become progressively
  // more rectangular, exactly the Turrell chamber depth illusion.
  float outerT = clamp((rNorm - 1.0) / 0.85, 0.0, 1.0);
  vec3 outerNear = mix(rimL, wallInL, smoothstep(0.0, 1.0, outerT));

  // Continue to the corner charcoal. The far distance is the
  // superellipse radius of the corner, for the p-norm with n=10
  // that's essentially max(|x|,|y|) which is 1 for a square or
  // the aspect ratio for the wide chamber.
  float farR = max(1.0, aspect);
  float cornerT = clamp((r - uRadius * 1.85) / max(0.001, farR - uRadius * 1.85), 0.0, 1.0);
  vec3 outerFar = mix(outerNear, wallOutL, smoothstep(0.0, 1.0, cornerT));

  // Seam is a mathematical marker, colour is continuous.
  float sideT = smoothstep(0.92, 1.08, rNorm);
  vec3 fieldL = mix(apertureL, outerFar, sideT);

  // Very slow luminosity breath so the field never feels frozen.
  fieldL *= 1.0 + uLumBreath * 0.020;

  fragColor = vec4(toSrgb(fieldL), 1.0);
}`;

/* ── shader helpers ─────────────────────────────────────────── */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Skyspace shader compile failed: " + info);
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
    throw new Error("Skyspace program link failed: " + info);
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
function _lerpHue(from, to, t) {
  from = _wrapHue(from);
  to   = _wrapHue(to);
  let d = to - from;
  if (d >  0.5) d -= 1;
  if (d < -0.5) d += 1;
  return _wrapHue(from + d * t);
}

/**
 * Given a primary emotion hex and current arousal (in [-1, 1]),
 * return a two-tone { rim, core } pairing in linear [0, 1] RGB.
 * High arousal → strong Turrell-style hue opposition. Calm → an
 * analogous, whispered pairing.
 */
function derivePairing(primaryHex, arousal) {
  const hsl = _rgbToHsl(hexToRgb01(primaryHex));
  const aNorm = Math.max(0, Math.min(1, (arousal + 1) * 0.5));
  const opposition = 0.11 + 0.39 * aNorm; // 40° whisper → ~180° dyad

  // Rim = the emotion's own hue at high saturation, mid-high
  // lightness. Turrell rims are always pure hues, never greyed.
  // We floor saturation aggressively so muted anchors still
  // produce a crisp Turrell-style band — but we do NOT shift the
  // hue toward orange, or every emotion would end up looking
  // like the same warm chamber.
  const rimH   = hsl.h;
  const rimSat = Math.min(1, Math.max(hsl.s, 0.75) * 1.20);
  const rim    = _hslToRgb({ h: rimH, s: rimSat, l: 0.58 });

  // Core = counter-hue (opposition scales with arousal), high
  // saturation, high lightness — so the aperture centre glows
  // like the sky opening in a Turrell.
  const coreH   = _wrapHue(hsl.h + opposition);
  const coreSat = Math.min(1, Math.max(hsl.s, 0.60) * 1.10);
  const core    = _hslToRgb({ h: coreH, s: coreSat, l: 0.78 });

  return { rim, core };
}

/* ── the style class ───────────────────────────────────────── */

export class SkyspaceStyle {
  static id = "skyspace";
  static name = "Skyspace";
  static subtitle = "Aperture of light";
  static tech = "webgl2";
  static requiresWebGPU = false;

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // Placement mode governs where the aperture sits within the canvas.
    //   "chamber" (default) — for the Before screen chamber card. The
    //     aperture is offset upward so it sits at the wheel-square's
    //     centre; the field below the wheel receives the outer bands.
    //   "centered" — for the immersive/Active screen (and preview
    //     thumbnails). The aperture sits dead-middle at (0.5, 0.5) and
    //     the field radiates outward filling every corner.
    // Auto-detect when the flag is not passed: if the canvas has a
    // .ea-chamber ancestor, use chamber mode; otherwise centered.
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
      time:       gl.getUniformLocation(this._prog, "uTime"),
      resolution: gl.getUniformLocation(this._prog, "uResolution"),
      center:     gl.getUniformLocation(this._prog, "uCenter"),
      radius:     gl.getUniformLocation(this._prog, "uRadius"),
      arousal:    gl.getUniformLocation(this._prog, "uArousal"),
      wallInner:  gl.getUniformLocation(this._prog, "uWallInner"),
      wallOuter:  gl.getUniformLocation(this._prog, "uWallOuter"),
      fillRim:    gl.getUniformLocation(this._prog, "uFillRim"),
      fillCore:   gl.getUniformLocation(this._prog, "uFillCore"),
      lumBreath:  gl.getUniformLocation(this._prog, "uLumBreath"),
      nShape:     gl.getUniformLocation(this._prog, "uNShape"),
      coreBreath: gl.getUniformLocation(this._prog, "uCoreBreath"),
      tempBias:   gl.getUniformLocation(this._prog, "uTempBias"),
    };

    // Turrell gallery wall — the outer stops of the one continuous
    // aperture-to-wall gradient. `wallInner` is the mid-band the
    // rim colour blends into just outside the aperture peak, and
    // `wallOuter` is the deep charcoal in the far corners.
    this._wallInner = [0x34 / 255, 0x37 / 255, 0x3C / 255];
    this._wallOuter = [0x1B / 255, 0x1E / 255, 0x22 / 255];

    // Live and target palettes for the sphere. Rim eases faster
    // than core, so the two colours arrive slightly out of phase.
    this._fillRim   = [0.90, 0.60, 0.50];
    this._fillRimT  = [0.90, 0.60, 0.50];
    this._fillCore  = [0.78, 0.72, 0.90];
    this._fillCoreT = [0.78, 0.72, 0.90];
    this._rimEase   = 0.012;
    this._coreEase  = 0.008;

    // Aperture radius: this is the peak of the rim gradient, not
    // a hard sphere edge. The colour keeps bleeding outward from
    // here all the way to the chamber's corners.
    //
    // _radiusBase is the resting value; the live _radius is
    // modulated by openness in setEmotion. Closed → tight bright
    // core, Open → aperture expands and fills more of the wall.
    this._radiusBase = 0.62;
    this._radius     = 0.62;

    // Emotion state.
    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._label = null;

    // Palette drift — even when the user doesn't move the dot,
    // the sphere slowly evolves. We keep a `driftPhase` that
    // advances at a constant rate; when it hits the interval we
    // pick a small hue nudge around the current emotion and
    // fold it into the target palette.
    this._driftInterval = 8.5; // seconds between micro-nudges
    this._driftSince = 0;
    this._driftAmount = 0.06;  // small hue offset each nudge

    this._t0 = performance.now();
    this._tPrev = this._t0;
    this._running = false;
    this._raf = null;

    // Chamber ancestor — used to publish `--ea-emotion` so overlay
    // chrome (wheel thumb, slider thumb) tints itself to match. May
    // be null if the canvas is used standalone; we degrade cleanly.
    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._createBuffers();

    // Prime the target palette from the initial emotion.
    this.setEmotion(0, 0, 0.5);
    // Also snap live to target so the first frame is not a fade
    // from grey.
    this._fillRim = this._fillRimT.slice();
    this._fillCore = this._fillCoreT.slice();
  }

  _createBuffers() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 400;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  resize() { this._createBuffers(); }

  /**
   * Emotion update. The wheel dot is at (v, a) in [-1, 1] but the
   * sphere itself does NOT move — only its palette changes.
   */
  setEmotion(v, a, o /*, label */) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    const near = nearestEmotions(v, a);
    const primary = near && near.primary;
    this._primaryHex = (primary && primary.hex) || "#B08060";
    this._label = (primary && primary.name) || null;

    const { rim, core } = derivePairing(this._primaryHex, a);
    this._fillRimT  = rim;
    this._fillCoreT = core;

    // Openness drives the aperture size. Same permeability semantic
    // used by Halo: Closed → aperture held tight and small; Open →
    // aperture blooms outward and floods the wall with colour.
    //   o = 0 (Closed)  → radius × 0.55  — held, contained, small pool
    //   o = 0.5         → radius × 1.00  — resting Skyspace aperture
    //   o = 1 (Open)    → radius × 1.55  — aperture floods the wall
    const oClamped = Math.max(0, Math.min(1, o == null ? 0.5 : o));
    const scale = 0.55 + oClamped * 1.00;
    this._radius = this._radiusBase * scale;

    // Reset drift timer on any explicit user movement so the next
    // micro-nudge happens on a fresh clock.
    this._driftSince = 0;
  }

  setSurface(/* r, g, b */) {
    // The Skyspace style owns its own wall — we ignore the app's
    // cream surface here. Preserved as a no-op so the style
    // interface stays uniform across visuals.
  }

  crossfadeSurfaceTo(_target, _durMs) {
    // No-op: the wall is a fixed dusty charcoal.
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

  _applyMicroDrift() {
    // Small hue nudge on both rim and core targets, wrapping the
    // hue circle. Keeps the sphere alive over long looks without
    // ever making it look "cycled" or animated.
    const rimHsl  = _rgbToHsl(this._fillRimT);
    const coreHsl = _rgbToHsl(this._fillCoreT);
    const sign = Math.random() < 0.5 ? -1 : 1;
    const dH = this._driftAmount * (0.5 + Math.random() * 0.5) * sign;
    rimHsl.h  = _wrapHue(rimHsl.h  + dH * 0.6);
    coreHsl.h = _wrapHue(coreHsl.h + dH);
    this._fillRimT  = _hslToRgb(rimHsl);
    this._fillCoreT = _hslToRgb(coreHsl);
  }

  _frame() {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    const now = performance.now();
    const dt = Math.min(0.1, (now - this._tPrev) / 1000);
    this._tPrev = now;

    // Palette micro-drift — every _driftInterval seconds we fold
    // a small hue nudge into the target palette. The live palette
    // then eases toward it continuously.
    this._driftSince += dt;
    if (this._driftSince >= this._driftInterval) {
      this._driftSince = 0;
      this._applyMicroDrift();
    }

    // Eased crossfade toward target palette — arousal-dependent.
    // High arousal (Joy, Anger) snaps to the target so the palette
    // matches the emotional urgency; calm states (Contemplation,
    // Despair) drift in slowly so the chamber feels breathed into.
    // aNorm 0..1: 0 = calm, 1 = energised.
    const aNorm = Math.max(0, Math.min(1, (this._emotion.a + 1) * 0.5));
    // Ease per frame: 0.006 at calm → 0.030 at high arousal.
    // Rim eases faster than core so the two arrive out of phase.
    const eR = 0.006 + aNorm * 0.024;
    const eC = 0.004 + aNorm * 0.016;
    for (let i = 0; i < 3; i++) {
      this._fillRim[i]  += (this._fillRimT[i]  - this._fillRim[i])  * eR;
      this._fillCore[i] += (this._fillCoreT[i] - this._fillCore[i]) * eC;
    }

    const t = (now - this._t0) / 1000;
    // Very slow luminosity breath — ~12s period (0.083 Hz).
    const lumBreath  = Math.sin(t * 2 * Math.PI / 12);
    // Slow shape breath on the superellipse exponent — 15s period,
    // phase-shifted so it never lines up with lumBreath. Modulates
    // the outer field between slightly more circular and slightly
    // more rectangular.
    const nShape    = Math.sin(t * 2 * Math.PI / 15 + 1.7);
    // Deeper, slower core lightness breath — 19s period.
    const coreBreath = Math.sin(t * 2 * Math.PI / 19 + 0.9);
    // Openness biases wall temperature: 0.5 neutral, 0 fully cool,
    // 1 fully warm. Maps to [-1, +1].
    const tempBias  = (this._emotion.o - 0.5) * 2.0;

    // Publish the live rim colour to CSS so overlay chrome (wheel
    // thumb, slider thumb) can tint themselves to match the chamber.
    // Read from _fillRim (live, gamma-corrected linear) — convert
    // back to sRGB byte range before writing.
    const _sr = Math.pow(Math.max(0, this._fillRim[0]), 1 / 2.2);
    const _sg = Math.pow(Math.max(0, this._fillRim[1]), 1 / 2.2);
    const _sb = Math.pow(Math.max(0, this._fillRim[2]), 1 / 2.2);
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
    // Aperture centre in vUv coords.
    //   "chamber" mode — the canvas fills the chamber (wheel + slider).
    //     The circumplex wheel is a square whose width equals the canvas
    //     width and sits flush at the top. Its DOM centre is (W/2, W/2).
    //     WebGL vUv has (0, 0) bottom-left, so cy = 1 - W/(2*H).
    //   "centered" mode — aperture sits dead-middle at (0.5, 0.5) so
    //     the field radiates outward and reaches every corner. Used
    //     for immersive/Active screen full-viewport rendering and
    //     style-picker preview thumbnails.
    let _cx = 0.5, _cy = 0.5;
    if (this._mode === "chamber") {
      const _cyTop = this.canvas.height > 0
        ? Math.min(0.5, (this.canvas.width * 0.5) / this.canvas.height)
        : 0.5;
      _cy = 1.0 - _cyTop;
    }
    gl.uniform2f(u.center,     _cx, _cy);
    gl.uniform1f(u.radius,     this._radius);
    gl.uniform1f(u.arousal,    (this._emotion.a + 1) * 0.5);
    gl.uniform3fv(u.wallInner, this._wallInner);
    gl.uniform3fv(u.wallOuter, this._wallOuter);
    gl.uniform3fv(u.fillRim,   this._fillRim);
    gl.uniform3fv(u.fillCore,  this._fillCore);
    gl.uniform1f(u.lumBreath,  lumBreath);
    gl.uniform1f(u.nShape,     nShape);
    gl.uniform1f(u.coreBreath, coreBreath);
    gl.uniform1f(u.tempBias,   tempBias);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
