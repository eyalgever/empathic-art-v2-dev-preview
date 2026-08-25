/**
 * Empathic App — Visual Style: Curl
 *
 * Curl is ink released into a slow current of feeling. A dye field
 * is carried by an analytical curl-noise velocity field — a
 * divergence-free flow that never compresses or rarefies, so
 * colour is preserved as it drifts, folds, and marbles. This is
 * the painterly counterpart to the ship engine Breath: same
 * ink-in-water intuition, but without a full incompressible-fluid
 * pressure solve, so the shader is cheap enough to run at half-res
 * on a phone.
 *
 * Design register:
 *   - Ink drifting on a river of feeling — never sharp, never fast
 *   - Valence sets the ink palette (warm chord for pleasant, cool
 *     chord for unpleasant)
 *   - Arousal drives curl-noise frequency and advection speed —
 *     calm states produce wide slow marbling, roused states pull
 *     the ink into tight turbulent whorls
 *   - Openness controls diffusion — closed reads as tight sharp
 *     streaks that never soften, open reads as broad soft bleeds
 *     that dissolve into atmosphere
 *
 * Technique:
 *   - Two ping-pong RGBA float buffers hold the dye field.
 *   - Every frame: compute analytical curl-noise velocity per
 *     pixel, sample the previous frame with a backward-Euler step
 *     (advection), fade slightly toward zero (dissipation), then
 *     inject a small blob of fresh ink at the emotion anchor point
 *     so the composition never drains completely to background.
 *   - Curl of a scalar noise field is (∂n/∂y, -∂n/∂x). Two
 *     independent noise fields are used so the flow has both
 *     rotational and translational components; the result reads
 *     as a slow toroidal current instead of a spinning pattern.
 *
 * Aesthetic reference: classic curl-noise flow (Bridson et al.),
 * standard ink-in-water demos, and the paintings of Mark Rothko
 * for palette softness. No shader code copied from external
 * sources; the curl-noise derivation is the standard
 * finite-difference-of-analytic-noise construction.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { harmonicPalette } from "../palette/emotion-palette.js";
import {
  createPingPong,
  compileProgram,
  createFullscreenQuad,
} from "./shared/fbo.js";

const V_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Advect + inject fragment shader.
//
// Reads previous dye, advects it along the curl-noise velocity
// field, applies a gentle dissipation, then adds a small ink
// injection at the emotion anchor. All done in one pass so we only
// need one ping-pong swap per frame.
const F_ADVECT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDye;
uniform vec2  uResolution;
uniform float uTime;
uniform float uSpeed;         // 0..1, arousal
uniform float uNoiseScale;    // spatial frequency of curl noise
uniform float uOpenness;      // 0..1
uniform float uDissipation;   // 0..1  each frame

uniform vec3  uInkColor;      // current emotion anchor colour
uniform vec2  uInkPos;        // 0..1 injection point
uniform float uInkRadius;     // 0..1 (screen-normalized)
uniform float uInkStrength;   // 0..1

// --- 2D simplex-ish smooth noise ---------------------------------
// Cheap hash-based value noise with fract-based smoothing. Fine for
// a large soft flow field; no need for real simplex.
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
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}

// Curl of a 2D scalar noise = (∂n/∂y, -∂n/∂x). Finite-diff step.
vec2 curl(vec2 p, float t) {
  const float EPS = 0.05;
  vec2 e = vec2(EPS, 0.0);
  float n1 = fbm(p + e.yx + t) - fbm(p - e.yx + t);
  float n2 = fbm(p + e.xy + t) - fbm(p - e.xy + t);
  return vec2(n1, -n2) / (2.0 * EPS);
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  // Screen-space uv scaled to aspect so the curl reads the same on
  // portrait iPhone and any other framing.
  vec2 st = vec2(vUv.x * aspect, vUv.y);

  // Two orthogonal curl-noise fields at different phases give the
  // dye a slow toroidal drift rather than a pure rotation.
  float t1 = uTime * 0.13;
  float t2 = uTime * 0.09 + 17.0;
  vec2 vA = curl(st * uNoiseScale,           t1);
  vec2 vB = curl(st * uNoiseScale * 1.8 + 5.0, t2) * 0.5;

  vec2 vel = (vA + vB);

  // Advection step size, arousal drives it. Backward-Euler: sample
  // the previous dye field at (uv - vel * dt).
  float dt = mix(0.0020, 0.0090, clamp(uSpeed, 0.0, 1.0));
  vec2 prevUv = vUv - vel * dt;

  // Prevent boundary shear artifacts, softly clamp to a small
  // margin inside the field.
  prevUv = clamp(prevUv, vec2(0.001), vec2(0.999));

  vec4 prev = texture(uDye, prevUv);

  // Dissipation; dye slowly bleeds toward zero every frame. Openness
  // slows the dissipation (open field holds atmosphere longer) but we
  // also add a wider diffusion sampling to soften edges.
  float dissip = uDissipation;
  vec4 advected = prev * dissip;

  // Openness-driven wider diffusion, sample four neighbours at a
  // larger radius and mix in. Bandwidth-cheap because we already
  // paid for the advection tap.
  vec2 dpx = 2.0 / uResolution;
  vec4 n0 = texture(uDye, prevUv + vec2( dpx.x,  0.0));
  vec4 n1 = texture(uDye, prevUv + vec2(-dpx.x,  0.0));
  vec4 n2 = texture(uDye, prevUv + vec2( 0.0,  dpx.y));
  vec4 n3 = texture(uDye, prevUv + vec2( 0.0, -dpx.y));
  vec4 blur = (n0 + n1 + n2 + n3) * 0.25;
  advected = mix(advected, blur * dissip, uOpenness * 0.35);

  // Ink injection, a soft radial deposit at the emotion anchor.
  // Do NOT aspect-correct the distance here: on portrait iPhone the
  // aspect factor is ~0.46, which collapses the deposit radius from
  // uInkRadius to ~0.15 of the frame and leaves >80% of the canvas
  // permanently outside the deposit path. Sample in raw uv so the
  // full uInkRadius reads on-screen even on tall frames.
  vec2 d = (vUv - uInkPos);
  float dist = length(d);
  float ink = smoothstep(uInkRadius, 0.0, dist) * uInkStrength;

  advected.rgb += uInkColor * ink;
  advected.a = 1.0;

  fragColor = advected;
}`;

// Composite pass — tone-map the dye buffer, mix with a background
// tone from the palette so empty areas stay warm, and dither.
const F_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDye;
uniform vec3 uColorBack;
uniform vec3 uColorWhisper;
uniform float uValence;   // -1..1

void main() {
  vec4 d = texture(uDye, vUv);
  float valence01 = 0.5 + 0.5 * clamp(uValence, -1.0, 1.0);

  // Tone-map; exposure lift so low-density ink is already visible
  // and high-density ink asymptotes rather than clips. Matches v1.4.2
  // curl composite that read as a bright, always-present cloud.
  vec3 ink = 1.0 - exp(-d.rgb * 2.4);

  // Background, never pure black; a faint back-plus-whisper haze
  // that reads as warm paper (Rothko-adjacent) at pleasant states
  // and deep charcoal at unpleasant.
  vec3 bg = mix(uColorBack, uColorWhisper, 0.25);
  bg *= mix(0.70, 1.05, valence01);

  // Composite ink onto background: alpha blend using ink brightness as
  // the mix factor, threshold set low so the cloud is visible even at
  // low density (not gated behind a mid-range smoothstep).
  float lum = dot(ink, vec3(0.30, 0.59, 0.11));
  vec3 color = mix(bg, ink, smoothstep(0.0, 0.25, lum));

  // Bloom on the brighter ink for warm-anchor glow.
  color += ink * smoothstep(0.30, 0.80, lum) * 0.30;

  color += (1.0 / 256.0) * (fract(sin(dot(0.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);
  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}`;

// -----------------------------------------------------------------

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class CurlStyle {
  static id = "curl";
  static name = "Curl";
  static subtitle = "Ink released into a current of feeling";
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

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    this._progAdvect    = compileProgram(gl, V_QUAD, F_ADVECT,    "curl-advect");
    this._progComposite = compileProgram(gl, V_QUAD, F_COMPOSITE, "curl-composite");
    this._quadVao = createFullscreenQuad(gl);

    this._uA = this._locs(this._progAdvect, [
      "uDye","uResolution","uTime","uSpeed","uNoiseScale","uOpenness","uDissipation",
      "uInkColor","uInkPos","uInkRadius","uInkStrength",
    ]);
    this._uC = this._locs(this._progComposite, [
      "uDye","uColorBack","uColorWhisper","uValence",
    ]);

    this._surface = [0.03, 0.03, 0.04];
    this._emotion = { v: 0, a: 0, o: 0.5 };
    this._audioRms = 0;

    this._colBack    = [0.03, 0.03, 0.05];
    this._colWhisper = [0.14, 0.10, 0.16];
    this._colMid     = [0.55, 0.30, 0.35];
    this._colFront   = [0.85, 0.55, 0.40];
    this._colHot     = [1.00, 0.78, 0.50];
    this._colBackT    = [...this._colBack];
    this._colWhisperT = [...this._colWhisper];
    this._colMidT     = [...this._colMid];
    this._colFrontT   = [...this._colFront];
    this._colHotT     = [...this._colHot];
    this._openness  = 0.5;
    this._opennessT = 0.5;
    this._colorEase = 0.08;

    // Ink injection point drifts slowly around the frame so the
    // composition doesn't stagnate on the same axis.
    this._t0 = performance.now();
    this._running = false;
    this._raf = null;
    this._runSeed = Math.random() * 100.0;

    this._chamberEl = this.canvas.closest ? this.canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;

    this._dye = null;
    this._createBuffers();
  }

  _locs(prog, names) {
    const gl = this.gl;
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  _createBuffers() {
    const gl = this.gl;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 800;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);

    // Dye field at 0.6× CSS pixels — cheap advection without visible
    // pixel-crunch after upsample.
    const fw = Math.max(96, Math.floor(cssW * 0.6));
    const fh = Math.max(160, Math.floor(cssH * 0.6));
    if (this._dye) this._dye.dispose();
    this._dye = createPingPong(gl, fw, fh, {
      preferHighPrecision: false,
      filter: gl.LINEAR,
    });
    this._fw = fw;
    this._fh = fh;

    // Clear both dye buffers to zero.
    for (const t of [this._dye.read, this._dye.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, fw, fh);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  resize() { this._createBuffers(); }

  setEmotion(v, a, o, _label) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;

    // Chord picks stay in the deep-saturated range of each hue —
    // whisper/mid/front all sit below 55% luminosity so anger reads
    // as red-not-pink and joy reads as gold-not-cream. Hot is unused
    // by the ink walk; only whisper→mid→front carry pigment.
    const chord = harmonicPalette(v, a, {
      // v1.4.2 chord range (bright front + hot) restored so ink base
      // colour is saturated *and* luminous. Combined with the
      // exposure tone-map, this puts the cloud clearly on top of
      // the background at any density.
      saturationBoost: 1.18,
      back:    0.05,
      whisper: 0.28,
      front:   0.72,
      hot:     0.90,
      hotShift:     0.42,
      whisperShift: 1.05,
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
    try {
      this._dye?.dispose();
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }

  _frame() {
    const gl = this.gl;

    // Ease palette + openness.
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
    const a01 = 0.5 + 0.5 * Math.max(-1, Math.min(1, this._emotion.a));

    // Ink injection point — drifts on a slow Lissajous around the
    // center-of-frame so the composition never sits on one axis.
    // Arousal accelerates the drift, closed states pull it toward
    // center, open states let it wander wider.
    const op   = this._openness;
    // Primary ink stays near centre: closed states barely drift (0.06),
    // open states wander a little more (0.18) but never leave the
    // central column. Openness reshapes the CLOUD size via inkRadius,
    // not the deposit location — that keeps the composition anchored
    // and readable at every framerate.
    const swing = 0.06 + 0.12 * op;
    const rate  = 0.14 + 0.35 * a01;
    const px = 0.50 + swing * Math.sin(t * rate * 0.61 + this._runSeed);
    const py = 0.50 + swing * Math.cos(t * rate * 0.47 + this._runSeed * 1.3);

    // Two ink deposit points instead of one when openness is high,
    // so the composition reads as multiple cloud forms colliding —
    // one big, one small — rather than one central splash. The
    // second point is far offset and pulses on/off with openness.
    const px2 = 0.50 - (swing * 0.85) * Math.sin(t * rate * 0.44 + this._runSeed * 2.7);
    const py2 = 0.50 - (swing * 0.85) * Math.cos(t * rate * 0.38 + this._runSeed * 3.1);

    // Ink colour blend across the chord. We deliberately stay in the
    // saturated part of the palette (whisper→mid→front) and never
    // touch the pale `hot` stop, which is close to white by design
    // and would wash the ink toward pastel at high arousal. Low
    // arousal walks whisper→mid (deep dye), high arousal walks mid
    // →front (bright dye but still saturated).
    const t1 = Math.max(0, Math.min(1, a01 * 2));           // 0..1 walks whisper→mid
    const t2 = Math.max(0, Math.min(1, a01 * 2 - 1));       // 0..1 walks mid→front
    const cA = this._colWhisper, cB = this._colMid, cC = this._colFront;
    const mixR = cA[0] * (1 - t1) + cB[0] * t1;
    const mixG = cA[1] * (1 - t1) + cB[1] * t1;
    const mixB = cA[2] * (1 - t1) + cB[2] * t1;
    const inkR = mixR * (1 - t2) + cC[0] * t2;
    const inkG = mixG * (1 - t2) + cC[1] * t2;
    const inkB = mixB * (1 - t2) + cC[2] * t2;
    // Second injection colour uses a *different* chord stop — back
    // →whisper at low arousal, whisper→mid at high arousal — so the
    // two clouds carry visibly different chord neighbours.
    const cD = this._colBack, cE = this._colWhisper, cF = this._colMid;
    const s1 = Math.max(0, Math.min(1, a01 * 2));
    const s2 = Math.max(0, Math.min(1, a01 * 2 - 1));
    const midR = cD[0] * (1 - s1) + cE[0] * s1;
    const midG = cD[1] * (1 - s1) + cE[1] * s1;
    const midB = cD[2] * (1 - s1) + cE[2] * s1;
    const ink2R = midR * (1 - s2) + cF[0] * s2;
    const ink2G = midG * (1 - s2) + cF[1] * s2;
    const ink2B = midB * (1 - s2) + cF[2] * s2;

    // ---- Advect + inject pass ----
    gl.useProgram(this._progAdvect);
    gl.bindVertexArray(this._quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._dye.read.tex);
    gl.uniform1i(this._uA.uDye, 0);
    gl.uniform2f(this._uA.uResolution, this._fw, this._fh);
    gl.uniform1f(this._uA.uTime, t);
    gl.uniform1f(this._uA.uSpeed, a01);
    // Noise scale — small numbers are wide slow flows filling the
    // frame with cloud-sized structures, big numbers pack tight
    // turbulent whorls into every pixel. We use openness as the
    // *primary* driver here: open states read as huge cloud forms
    // (noise = 1.1), closed states read as many small tight whorls
    // seen from a distance (noise = 6.0). Arousal adds a smaller
    // secondary tightening on top.
    const noiseScale = (1.1 + 4.9 * (1.0 - op)) + 0.9 * a01;
    gl.uniform1f(this._uA.uNoiseScale, noiseScale);
    gl.uniform1f(this._uA.uOpenness, op);
    // Dissipation — wide range so open states hold ink long (broad
    // soft cloud bleeds that persist across the frame), closed states
    // fade fast (many small whorls that never dominate). Reversed
    // from before so open reads *bigger* and *softer*, not sharper.
    gl.uniform1f(this._uA.uDissipation, 0.984 + 0.012 * op);
    // ---- First (large) ink injection
    gl.uniform3f(this._uA.uInkColor, inkR, inkG, inkB);
    gl.uniform2f(this._uA.uInkPos, px, py);
    // Ink radius scales dramatically with openness: closed = 0.04
    // (small dot), open = 0.32 (huge blob filling much of the frame).
    const inkRadius = 0.04 + 0.28 * op;
    gl.uniform1f(this._uA.uInkRadius, inkRadius);
    // Ink strength stays roughly constant per-frame-total across
    // openness: closed states inject a small dense dot, open states
    // inject a wide but paler cloud so the field doesn't oversaturate
    // to grey/white after a few seconds. Total-ink budget is roughly
    // uInkStrength * uInkRadius^2 * (π), so scale by 1/radius^2 with
    // a cap around 3x the closed default.
    const baseStrength = 0.095 + 0.024 * clamp01(this._audioRms);
    const areaScale = (0.04 * 0.04) / (inkRadius * inkRadius);   // 1.0 closed, 0.016 open
    // Open states used to inject only ~35% of the closed per-frame
    // total, which faded to invisible over 8+ seconds. Raise the
    // floor to 1.30 so open actually injects MORE total ink per
    // frame than closed (because the huge cloud has to fill a much
    // larger area, and per-pixel density must stay above the
    // composite threshold to read as a cloud).
    const inkStrength = baseStrength * Math.min(3.0, Math.max(1.30, areaScale * 3.0));
    gl.uniform1f(this._uA.uInkStrength, inkStrength);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._dye.write.fbo);
    gl.viewport(0, 0, this._fw, this._fh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._dye.swap();

    // ---- Second (smaller) ink injection — only when openness > 0.35
    // so closed states remain single-point compositions. The second
    // blob uses a different chord colour and sits offset, so at high
    // openness the frame reads as two clouds (one big, one small)
    // meeting rather than one central splash.
    if (op > 0.35) {
      gl.useProgram(this._progAdvect);
      gl.bindVertexArray(this._quadVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._dye.read.tex);
      gl.uniform1i(this._uA.uDye, 0);
      gl.uniform2f(this._uA.uResolution, this._fw, this._fh);
      gl.uniform1f(this._uA.uTime, t + 100.0);   // decorrelate advection noise
      gl.uniform1f(this._uA.uSpeed, 0.0);         // no advection for the second inject — pure deposit
      gl.uniform1f(this._uA.uNoiseScale, noiseScale);
      gl.uniform1f(this._uA.uOpenness, op);
      gl.uniform1f(this._uA.uDissipation, 1.0);   // don't fade twice
      gl.uniform3f(this._uA.uInkColor, ink2R, ink2G, ink2B);
      gl.uniform2f(this._uA.uInkPos, px2, py2);
      // Second blob is roughly half the size of the first — openness
      // still scales it, but the range is 0.02 → 0.14 so it always
      // reads as the *smaller* of the two clouds.
      gl.uniform1f(this._uA.uInkRadius, 0.02 + 0.12 * op);
      gl.uniform1f(this._uA.uInkStrength, inkStrength * 0.7);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._dye.write.fbo);
      gl.viewport(0, 0, this._fw, this._fh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this._dye.swap();
    }

    // ---- Composite pass ----
    gl.useProgram(this._progComposite);
    gl.bindVertexArray(this._quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._dye.read.tex);
    gl.uniform1i(this._uC.uDye, 0);
    gl.uniform3fv(this._uC.uColorBack,    this._colBack);
    gl.uniform3fv(this._uC.uColorWhisper, this._colWhisper);
    gl.uniform1f(this._uC.uValence, this._emotion.v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
