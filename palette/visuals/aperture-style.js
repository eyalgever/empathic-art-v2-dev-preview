/**
 * Empathic App — Aperture visual style
 *
 * Companion to Skyspace. Where Skyspace is a room-filling Turrell
 * chamber whose aperture morphs from circle at the core to a rounded
 * rectangle at the frame edge, Aperture is Turrell's Circular Glass /
 * Elliptical Glass mode — a defined luminous disc floating on a matte
 * tinted wall, with a soft radial gradient inside the disc and a
 * feathered edge dissolving into the surrounding wall.
 *
 * Semantics — permeability + size (shared with every visual style):
 *   • Closed (o = 0)  → small held disc; visible matte wall around it;
 *                       edge is firmer (more defined shape).
 *   • Open (o = 1)    → large disc that floods the wall with colour;
 *                       edge dissolves into a soft haze; no visible
 *                       matte surround.
 *
 * Placement — same mode contract as Skyspace/Halo:
 *   "chamber" (Before screen)   — anchor disc at the wheel-square centre.
 *   "centered" (immersive)      — dead-middle at (0.5, 0.5).
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { nearestEmotions, harmonicPalette } from "../palette/emotion-palette.js?v=1.3.1";

/* ── shaders ───────────────────────────────────────────────── */

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

uniform vec2  uResolution;
uniform vec2  uCenter;      // disc centre in vUv
uniform float uRadius;      // disc radius in short-axis units
uniform float uEdge;        // edge feather width (fraction of radius)
uniform float uWallVisibility; // 1 = matte wall present, 0 = wall flooded by disc
uniform vec3  uDiscCore;    // linear RGB, inner bloom colour
uniform vec3  uDiscRim;     // linear RGB, outer disc edge colour
uniform vec3  uWallColor;   // linear RGB, matte wall
uniform float uCoreBreath;  // -1..1 slow lightness pulse on core
uniform float uLumBreath;   // -1..1 whole-field luminance pulse

/* sRGB <-> linear (approx gamma 2.2. Turrell chambers are read
   from photographs which already sit in sRGB, so 2.2 is close
   enough and cheaper than the piecewise sRGB curve). */
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
  // Aspect-correct sample. Short axis maps to [-1, 1] so the disc
  // is a real circle regardless of container aspect.
  vec2 uv = (vUv - uCenter) * 2.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv;
  if (aspect >= 1.0) p.x = uv.x * aspect;
  else               p.y = uv.y / aspect;

  float d = length(p);
  float rNorm = d / max(uRadius, 0.001);

  // Inside the disc: radial gradient core → rim, gamma-eased so the
  // pearl reads bright. The rim colour is the emotion's rim; the core
  // is a lighter, cooler counter-hue like the reference photos
  // (orange with red-hot core, or yellow with cyan-blue core).
  vec3 coreL = uDiscCore * (1.0 + uCoreBreath * 0.05);
  vec3 rimL  = uDiscRim;
  float tInside = smoothstep(0.0, 1.0, rNorm);
  vec3 discColor = mix(coreL, rimL, tInside);

  // Bloom kernel at the very centre.
  float bloom = smoothstep(0.42, 0.0, rNorm) * 0.18;
  discColor += bloom * coreL;

  // Edge feather. uEdge is fractional band width in radius units.
  // Openness modulates uEdge upstream. Closed edge is crisp, Open
  // edge dissolves into the wall.
  float edgeInner = 1.0 - uEdge * 0.35;
  float edgeOuter = 1.0 + uEdge;
  float discMask = 1.0 - smoothstep(edgeInner, edgeOuter, rNorm);

  // Outside the disc: matte wall. When Open, uWallVisibility drops
  // and we let the disc colour flood into the wall so there is no
  // sharp boundary. When Closed, the wall retains its own matte tint
  // and the surround reads as absence around a held pool of light.
  //
  // We blend the wall toward the rim colour by (1 - uWallVisibility),
  // so Open effectively paints the whole frame with disc colour with
  // just a slow luminance falloff outward from the disc.
  vec3 wallC = mix(rimL * 0.45, uWallColor, clamp(uWallVisibility, 0.0, 1.0));

  // Add a soft outward glow so the disc doesn't sit on the wall
  // like a decal. Turrell discs cast a subtle halo onto the wall.
  float glow = exp(-max(rNorm - 1.0, 0.0) * 3.0) * 0.35;
  vec3 wallLit = wallC + rimL * glow * uWallVisibility;

  vec3 fieldL = mix(wallLit, discColor, discMask);

  // Whole-field breath, very subtle, gives the piece life.
  fieldL *= 1.0 + uLumBreath * 0.02;

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
    throw new Error("Aperture shader compile failed: " + info);
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
    throw new Error("Aperture program link failed: " + info);
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

// Approximate sRGB → linear so shader math sits in linear space.
function toLinear01(rgb) {
  return rgb.map((c) => Math.pow(Math.max(0, c), 2.2));
}

/**
 * Aperture-mode two-tone. Rim = the emotion's primary anchor.
 * Core = the same hue tilted toward the ACTUAL neighbouring emotion
 * on the circumplex (not a synthetic ±hue offset) so the inner glow
 * reads as one emotion bleeding into its neighbour — the Rothko-style
 * micro-chord inside a single Turrell-style disc.
 */
function derivePairing(v, arousal) {
  const chord = harmonicPalette(v, arousal, {
    saturationBoost: 1.15,
    front: 0.82, // core L
    hot:   0.82, // core L (used as neighbour-biased highlight)
    back:  0.24, // wall L
    hotShift: 0.35, // subtle neighbour tilt in the inner glow
  });

  // Rim = primary anchor lifted for the disc surface.
  const primaryHsl = _rgbToHsl(chord.mid);
  const rimSat = Math.min(1, Math.max(primaryHsl.s, 0.75) * 1.15);
  const rim    = _hslToRgb({ h: primaryHsl.h, s: rimSat, l: 0.60 });

  // Core = the chord's hot stop, which already sits at high L and
  // tilts toward the neighbour hue by hotShift. This is the Rothko
  // "inner colour" the artist asked for.
  const core = chord.hot;

  // Wall stays a low-chroma neutral pulled toward the rim hue so
  // the disc doesn't feel cut out of a grey background.
  const aNorm = Math.max(0, Math.min(1, (arousal + 1) * 0.5));
  const wallSat = 0.05 + 0.05 * (1 - aNorm);
  const wall    = _hslToRgb({ h: primaryHsl.h, s: wallSat, l: 0.24 });

  return { rim, core, wall };
}

/* ── the style class ───────────────────────────────────────── */

export class ApertureStyle {
  static id = "aperture";
  static name = "Aperture";
  static subtitle = "Held light on a quiet wall";
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
      resolution:     gl.getUniformLocation(this._prog, "uResolution"),
      center:         gl.getUniformLocation(this._prog, "uCenter"),
      radius:         gl.getUniformLocation(this._prog, "uRadius"),
      edge:           gl.getUniformLocation(this._prog, "uEdge"),
      wallVisibility: gl.getUniformLocation(this._prog, "uWallVisibility"),
      discCore:       gl.getUniformLocation(this._prog, "uDiscCore"),
      discRim:        gl.getUniformLocation(this._prog, "uDiscRim"),
      wallColor:      gl.getUniformLocation(this._prog, "uWallColor"),
      coreBreath:     gl.getUniformLocation(this._prog, "uCoreBreath"),
      lumBreath:      gl.getUniformLocation(this._prog, "uLumBreath"),
    };

    // Live and target colours (linear RGB) — eased each frame.
    this._discCore  = [0.90, 0.75, 0.60];
    this._discRim   = [0.85, 0.55, 0.40];
    this._wallColor = [0.24, 0.22, 0.20];
    this._discCoreT  = [...this._discCore];
    this._discRimT   = [...this._discRim];
    this._wallColorT = [...this._wallColor];

    // Radius base — Turrell discs typically occupy ~30-45% of the
    // short axis. We map o=0..1 to 0.28..0.72 with linear scaling.
    this._radiusBase = 0.44;
    this._radius     = 0.44;

    // Edge softness base — larger = fuzzier edge.
    this._edgeBase = 0.08;
    this._edge     = 0.08;

    // Wall visibility — 1 = matte wall visible around disc, 0 = wall
    // is flooded by disc rim colour (Open extreme).
    this._wallVis = 1.0;

    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._label = null;

    this._t0 = performance.now();
    this._running = false;
    this._raf = null;

    // Chamber ancestor for CSS var publish (wheel/slider thumb tint).
    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._createBuffers();
    this.setEmotion(0, 0, 0.5);
    this._discCore  = [...this._discCoreT];
    this._discRim   = [...this._discRimT];
    this._wallColor = [...this._wallColorT];
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
    this._label = (primary && primary.name) || null;

    const { rim, core, wall } = derivePairing(v, a);
    this._discRimT   = toLinear01(rim);
    this._discCoreT  = toLinear01(core);
    this._wallColorT = toLinear01(wall);

    // Openness → disc size, edge softness, and wall permeability.
    //   Closed  → small held disc, crisp edge, wall fully visible.
    //   Open    → large disc, fuzzy edge, wall flooded by rim colour.
    const oClamped = Math.max(0, Math.min(1, o == null ? 0.5 : o));
    this._radius  = this._radiusBase * (0.60 + oClamped * 1.20);
    this._edge    = this._edgeBase   * (0.5  + oClamped * 3.5);
    this._wallVis = 1.0 - Math.pow(oClamped, 1.5) * 0.95;

    // Publish rim colour to CSS so overlay chrome tints along.
    if (this._chamberEl) {
      const [r0, g0, b0] = rim;
      const R = Math.round(Math.min(255, r0 * 255));
      const G = Math.round(Math.min(255, g0 * 255));
      const B = Math.round(Math.min(255, b0 * 255));
      const key = `${R},${G},${B}`;
      if (this._lastEmotionCss !== key) {
        this._chamberEl.style.setProperty("--ea-emotion", `rgb(${R}, ${G}, ${B})`);
        this._lastEmotionCss = key;
      }
    }
  }

  setSurface(/* r, g, b */) { /* Aperture owns its own wall. */ }
  crossfadeSurfaceTo(/* target, durMs */) { return Promise.resolve(); }
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

    // Ease palette toward targets — same cadence as Halo.
    const e = 0.08;
    for (let i = 0; i < 3; i++) {
      this._discCore[i]  += (this._discCoreT[i]  - this._discCore[i])  * e;
      this._discRim[i]   += (this._discRimT[i]   - this._discRim[i])   * e;
      this._wallColor[i] += (this._wallColorT[i] - this._wallColor[i]) * e;
    }

    const t = (performance.now() - this._t0) / 1000;
    const lumBreath  = Math.sin(t * 2 * Math.PI / 14);
    const coreBreath = Math.sin(t * 2 * Math.PI / 18 + 1.1);

    // Aperture is a disc on a wall in front of the viewer — the
    // Turrell Circular Glass reference sits at head height on a flat
    // wall, not on a ceiling. Unlike Skyspace (chamber oculus above)
    // Aperture always renders dead-centre in the frame, whether it's
    // in the Before chamber, an immersive viewport, or a picker tile.
    // The mode option is retained for API symmetry but does not shift
    // vertical placement.
    const cx = 0.5, cy = 0.5;

    const u = this._u;
    gl.uniform2f(u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform1f(u.radius, this._radius);
    gl.uniform1f(u.edge, this._edge);
    gl.uniform1f(u.wallVisibility, this._wallVis);
    gl.uniform3fv(u.discCore, this._discCore);
    gl.uniform3fv(u.discRim,  this._discRim);
    gl.uniform3fv(u.wallColor, this._wallColor);
    gl.uniform1f(u.coreBreath, coreBreath);
    gl.uniform1f(u.lumBreath, lumBreath);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
