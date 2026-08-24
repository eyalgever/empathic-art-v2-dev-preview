/**
 * Empathic App — Visual Style: Halo
 *
 * A radiant, peaceful, held emotional field. A soft radial gradient
 * shaped by layered simplex noise, mapped to a 3-colour palette drawn
 * from the current emotion + its two nearest neighbours on the
 * Russell circumplex.
 *
 * Design register:
 *   - Warm, breathing, luminous
 *   - Slow drift; arousal only accelerates modestly
 *   - Openness widens the ring; low openness draws it inward
 *
 * Technique:
 *   - WebGL2, single fullscreen fragment pass
 *   - No feedback buffers; pure procedural, cheap on mobile
 *   - Colour driven live from the palette module — no per-shader uniforms
 *     for individual anchors, just a three-colour ramp updated on
 *     setEmotion()
 *
 * Aesthetic reference: the "radial multi-coloured gradient shaped with
 * layered noise for a natural, smoky aesthetic" register. Implementation
 * is original, written for this app.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
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
uniform vec3  uColorLight;  // outer edge   (lighter tint of primary)
uniform vec3  uColorMid;    // ring / body  (saturated primary)
uniform vec3  uColorDeep;   // core         (deeper tint of primary, never black)
uniform vec3  uColorAccent; // secondary anchor (used only as a subtle angular tint)
uniform vec3  uSurface;     // paper colour, blended only at the outermost margin
uniform float uArousal;     // -1..1
uniform float uOpenness;    // 0..1
uniform float uAudioRms;    // 0..1
uniform vec2  uCenter;      // aperture centre in vUv (0..1); wheel-centre when in a non-square chamber

/*
 * Cheap 2D hash + value noise. Two octaves are enough for the smoky
 * organic ripple, three or more starts to look "AI-perlin", which we
 * don't want. See design tokens for the anti-noise principle.
 */
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.65 + noise(p * 2.03) * 0.35;
}

void main() {
  // Aspect-corrected UV centred at the aperture centre. In a
  // rectangular chamber (wheel + slider) that centre sits at the
  // wheel's mid-point, not the geometric middle of the canvas.
  vec2 uv = vUv - uCenter;
  uv.x *= uResolution.x / uResolution.y;

  float r = length(uv);

  // Time speed: gentle base, arousal accelerates
  float t = uTime * (0.06 + max(0.0, uArousal) * 0.08);

  // Radial angular coordinate for a barely-there swirl accent
  float ang = atan(uv.y, uv.x);

  // Two-octave fbm warp, keeps the radial tonal ramp from ever reading
  // as a clean geometric circle. Softens edges of every band.
  vec2 warp = vec2(
    fbm(uv * 2.3 + vec2(t, -t * 0.7)),
    fbm(uv * 2.3 + vec2(-t * 0.6, t))
  ) - 0.5;
  float warpAmt = 0.10 + 0.05 * uAudioRms;
  float d = length(uv + warp * warpAmt);

  // Openness controls both the size of the coloured field AND how
  // permeable its outer edge is. Same semantic across every visual
  // style: Open → field grows, edges dissolve, colour reaches every
  // corner. Closed → field pulls inward to a held pool, edges
  // firm up, more of the frame reads as "outside" the field.
  //   openScale controls how quickly rNorm reaches 1 (the visible
  //   colour band). Smaller openScale means the field fills a larger
  //   share of the frame (rn hits 1 sooner as d grows). We push
  //   the extremes so the difference reads clearly.
  float openScale = mix(1.10, 0.42, uOpenness);
  float rn = clamp(d / openScale, 0.0, 1.6);

  // Openness also reshapes the tonal ramp so the dark core shrinks
  // as we open. Closed keeps a wide "deep" pool around the very
  // centre (the emotion held tight); Open compresses the deep zone
  // to a small kernel and lets the mid/light bands take over.
  //   deepEnd , outer edge of the deep→mid transition
  //   lightIn , inner edge of the mid→light transition
  //   lightOut, outer edge of the mid→light transition (edge softness)
  float deepEnd  = mix(0.55, 0.14, uOpenness);
  float lightIn  = mix(1.10, 0.55, uOpenness);
  float lightOut = mix(1.30, 1.05, uOpenness);
  float toMid   = smoothstep(0.00, deepEnd, rn);
  float toLight = smoothstep(lightIn, lightOut, rn);
  vec3 col = mix(uColorDeep, uColorMid,   toMid);
  col      = mix(col,         uColorLight, toLight);

  // A hint of the secondary anchor as an angular tint in the mid band  
  // barely visible, but stops the visual from ever reading as monotone.
  float band   = smoothstep(0.20, 0.50, rn) * (1.0 - smoothstep(0.80, 1.10, rn));
  float angMod = 0.5 + 0.5 * sin(ang * 2.0 + t * 0.7);
  col = mix(col, uColorAccent, band * angMod * 0.12);

  // Outer surface bleed, the paper cream is only allowed to touch
  // the field at the very margin, and only when Closed. When Open
  // the coloured field must reach every corner uninterrupted.
  float vigStart = mix(1.10, 1.60, uOpenness);
  float vigEnd   = mix(1.35, 1.80, uOpenness);
  float vignette = smoothstep(vigStart, vigEnd, r);
  col = mix(col, uSurface, vignette);

  fragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Halo shader compile failed: " + info);
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
    throw new Error("Halo program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

/**
 * Convert one of our #RRGGBB anchor hexes to a linear-ish [0..1] float
 * triple. We stay in sRGB space rather than converting to linear — the
 * palette was authored on-screen and looks correct without gamma.
 */
function hexToRgb01(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export class HaloStyle {
  static id = "halo";
  static name = "Halo";
  static subtitle = "Radiant, peaceful, held";
  static tech = "webgl2";
  static requiresWebGPU = false;

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // Placement mode — mirrors Skyspace. "chamber" offsets the halo
    // upward so it centres on the wheel square; "centered" places it
    // dead-middle for immersive/Active screen full-viewport rendering
    // and picker preview thumbnails.
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

    // Uniform locations cached
    const P = this._prog;
    this._u = {
      time:       gl.getUniformLocation(P, "uTime"),
      resolution: gl.getUniformLocation(P, "uResolution"),
      colorLight: gl.getUniformLocation(P, "uColorLight"),
      colorMid:   gl.getUniformLocation(P, "uColorMid"),
      colorDeep:  gl.getUniformLocation(P, "uColorDeep"),
      colorAccent:gl.getUniformLocation(P, "uColorAccent"),
      surface:    gl.getUniformLocation(P, "uSurface"),
      arousal:    gl.getUniformLocation(P, "uArousal"),
      openness:   gl.getUniformLocation(P, "uOpenness"),
      audioRms:   gl.getUniformLocation(P, "uAudioRms"),
      center:     gl.getUniformLocation(P, "uCenter"),
    };

    // Chamber ancestor — used to publish --ea-emotion so overlay
    // chrome tints itself to match. Silent no-op if the canvas is
    // used standalone (immersive view).
    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    // Initial state — seeded to a neutral warm; setEmotion() overwrites
    // on first frame. All four palette slots are eased toward their
    // "target" values every frame to eliminate colour flicker when the
    // muse stream emits rapid emotion updates.
    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._surface = [0xFB / 255, 0xF6 / 255, 0xEC / 255];
    this._audioRms = 0;
    this._emotion = { v: 0, a: 0, o: 0.5 };

    // Live palette (rendered each frame)
    this._colLight  = [0.90, 0.85, 0.75];
    this._colMid    = [0.75, 0.65, 0.45];
    this._colDeep   = [0.45, 0.35, 0.20];
    this._colAccent = [0.75, 0.65, 0.45];

    // Target palette (updated by setEmotion, eased into live palette)
    this._colLightT  = [...this._colLight];
    this._colMidT    = [...this._colMid];
    this._colDeepT   = [...this._colDeep];
    this._colAccentT = [...this._colAccent];

    // Colour easing constant — fraction of the gap closed per frame
    // (~60fps). At 0.08 a full crossfade completes in ~500–700 ms which
    // reads as "gliding" rather than snapping.
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

    // Palette derivation: pull the full harmonic chord so the ring
    // carries three colours — the primary body, a light tint biased
    // toward the neighbour emotion, and a whisper stop as the angular
    // accent. The radial ramp still deepens through the primary hue
    // (deep → mid → light), but the light stop tilts toward the
    // neighbouring emotion, so the halo reads as a chord instead of a
    // single note.
    const chord = harmonicPalette(v, a, {
      saturationBoost: 1.15,
      // mid uses primary anchor's intrinsic L
      front:   0.78, // light
      hot:     0.80, // neighbour bleed at high L — blended into light
      whisper: 0.62, // accent stop
      back:    0.28, // deep
      hotShift:     0.30, // subtle neighbour tilt in the highlight
      whisperShift: 1.3,  // whisper closer to the primary/secondary line
    });

    // Only 20% neighbour bleed in the light stop — keeps the ring
    // reading primarily as the primary emotion with a whisper of
    // the adjacent hue at the highlight.
    const light = [
      chord.front[0] * 0.8 + chord.hot[0] * 0.2,
      chord.front[1] * 0.8 + chord.hot[1] * 0.2,
      chord.front[2] * 0.8 + chord.hot[2] * 0.2,
    ];
    const midVibrant = chord.mid;
    const deep       = chord.back;

    this._colLightT  = light;
    this._colMidT    = midVibrant;
    this._colDeepT   = deep;
    // Angular accent now uses the whisper (one analogous step past
    // secondary, reduced saturation) instead of the raw secondary
    // hex — gives a quieter, painterly accent rather than a hard
    // colour swap.
    this._colAccentT = chord.whisper;

    // Publish the mid tone (the emotion's identity colour) to CSS
    // so overlay chrome (wheel thumb, slider thumb) tints to match
    // the chamber. Mid is chosen because it's the most saturated,
    // legible reading of the emotion.
    if (this._chamberEl) {
      const R = Math.round(Math.min(255, midVibrant[0] * 255));
      const G = Math.round(Math.min(255, midVibrant[1] * 255));
      const B = Math.round(Math.min(255, midVibrant[2] * 255));
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

  // No-op — Halo is procedural, no splats.
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

    // Ease each palette channel toward its target. This is what fixes
    // the flicker: setEmotion() updates targets only, and the visible
    // colours glide toward them over ~500 ms.
    const e = this._colorEase;
    for (let i = 0; i < 3; i++) {
      this._colLight[i]  += (this._colLightT[i]  - this._colLight[i])  * e;
      this._colMid[i]    += (this._colMidT[i]    - this._colMid[i])    * e;
      this._colDeep[i]   += (this._colDeepT[i]   - this._colDeep[i])   * e;
      this._colAccent[i] += (this._colAccentT[i] - this._colAccent[i]) * e;
    }

    const t = (performance.now() - this._t0) / 1000;
    gl.uniform1f(this._u.time, t);
    gl.uniform2f(this._u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this._u.colorLight,  this._colLight);
    gl.uniform3fv(this._u.colorMid,    this._colMid);
    gl.uniform3fv(this._u.colorDeep,   this._colDeep);
    gl.uniform3fv(this._u.colorAccent, this._colAccent);
    gl.uniform3fv(this._u.surface,     this._surface);
    gl.uniform1f(this._u.arousal,      this._emotion.a);
    gl.uniform1f(this._u.openness,     this._emotion.o);
    gl.uniform1f(this._u.audioRms,     this._audioRms);
    // Aperture centre in vUv space.
    //   "chamber" mode — canvas spans wheel + slider; the halo
    //     should orbit the wheel-square centre, which in vUv
    //     (Y up) is (0.5, 1 - W/(2H)).
    //   "centered" mode — dead-middle at (0.5, 0.5) for immersive
    //     view and picker previews.
    let _cx = 0.5, _cy = 0.5;
    if (this._mode === "chamber") {
      const _cyTop = this.canvas.height > 0
        ? Math.min(0.5, (this.canvas.width * 0.5) / this.canvas.height)
        : 0.5;
      _cy = 1.0 - _cyTop;
    }
    gl.uniform2f(this._u.center, _cx, _cy);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/**
 * Push chroma away from grey by `amount` (negative amounts desaturate).
 * Cheap: subtract luminance from each channel and scale the residual.
 * Preserves the hue exactly.
 */
function _boostChroma(rgb, amount) {
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [
    _clamp01(lum + (rgb[0] - lum) * (1 + amount)),
    _clamp01(lum + (rgb[1] - lum) * (1 + amount)),
    _clamp01(lum + (rgb[2] - lum) * (1 + amount)),
  ];
}

function _clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/**
 * RGB (0..1) → HSL (h in 0..1, s in 0..1, l in 0..1). Standard textbook.
 * Hue is a normalized angle, matching CSS conventions.
 */
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

/**
 * HSL (h in 0..1, s in 0..1, l in 0..1) → RGB (0..1). Standard textbook.
 */
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
  return [_clamp01(hue(h + 1 / 3)), _clamp01(hue(h)), _clamp01(hue(h - 1 / 3))];
}

