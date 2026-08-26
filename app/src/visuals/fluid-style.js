/**
 * Fluid — real Navier–Stokes fluid, ink of the whole session.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A 2D grid fluid solver (velocity + dye advection, curl, divergence,
 * Jacobi pressure solve, vorticity confinement) that lives on the
 * session canvas and paints itself with a running memory of every
 * emotion the session has visited. When the emotion label changes, the
 * canvas erupts in a burst of that new colour; between transitions, a
 * quiet baseline splats a random hue drawn from the session's history.
 *
 * The result is a moving painting where past emotions never fully
 * disappear — they linger as dye in the fluid, mixing and drifting until
 * dissipation slowly reclaims them.
 *
 * ─── Emotion coupling ─────────────────────────────────────────────────
 *  · valence  → velocity dissipation (positive = colours linger)
 *  · arousal  → curl (vorticity) + splat force
 *  · openness → density dissipation (open = long, closed = quick fade)
 *  · label    → history entry; label change fires a splat burst
 *
 * ─── Attribution ──────────────────────────────────────────────────────
 * The solver (curl / vorticity / divergence / pressure Jacobi /
 * gradient-subtract / advect / splat) is ported from Pavel Dobryakov's
 * WebGL-Fluid-Simulation (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation),
 * MIT © 2017 Pavel Dobryakov. Bloom, sunrays, shading, checkerboard,
 * dithering and pointer input from the original demo are intentionally
 * omitted — the emotion-history splat scheduler replaces the pointer.
 *
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { harmonicPalette } from "../palette/emotion-palette.js";

// ═══════════════════════════════════════════════════════════════════════
// Small helpers
// ═══════════════════════════════════════════════════════════════════════

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function hexToRgb01(hex) {
  const s = String(hex || "").replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return [r || 0, g || 0, b || 0];
}

// ═══════════════════════════════════════════════════════════════════════
// Shader sources (WebGL 1 / GLSL ES 100, matching Pavel's originals)
// ═══════════════════════════════════════════════════════════════════════

const V_BASE = /* glsl */`
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;
  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const F_COPY = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  void main () { gl_FragColor = texture2D(uTexture, vUv); }
`;

const F_CLEAR = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
`;

const F_COLOR = /* glsl */`
  precision mediump float;
  uniform vec4 color;
  void main () { gl_FragColor = color; }
`;

const F_DISPLAY = /* glsl */`
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  void main () {
    vec3 c = texture2D(uTexture, vUv).rgb;
    float a = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c, a);
  }
`;

const F_SPLAT = /* glsl */`
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

const F_ADVECT = /* glsl */`
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform vec2 dyeTexelSize;
  uniform float dt;
  uniform float dissipation;
  vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
  }
  void main () {
  #ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
  #else
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
  #endif
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`;

const F_DIVERGENCE = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const F_CURL = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

const F_VORTICITY = /* glsl */`
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const F_PRESSURE = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const F_GRAD_SUB = /* glsl */`
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// ═══════════════════════════════════════════════════════════════════════
// GL context bootstrap — Pavel's exact webgl-context init, ported so we
// pick up half-float support the same way the original demo does.
// ═══════════════════════════════════════════════════════════════════════

function _getWebGLContext(canvas) {
  const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext("webgl2", params);
  const isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params);
  if (!gl) return null;

  let halfFloat, supportLinearFiltering;
  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    supportLinearFiltering = gl.getExtension("OES_texture_float_linear");
  } else {
    halfFloat = gl.getExtension("OES_texture_half_float");
    supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear");
  }
  gl.clearColor(0, 0, 0, 1);

  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);
  let formatRGBA, formatRG, formatR;
  if (isWebGL2) {
    formatRGBA = _getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
    formatRG   = _getSupportedFormat(gl, gl.RG16F,   gl.RG,   halfFloatTexType);
    formatR    = _getSupportedFormat(gl, gl.R16F,    gl.RED,  halfFloatTexType);
  } else {
    formatRGBA = _getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    formatRG   = _getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    formatR    = _getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
  }
  return { gl, isWebGL2, ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering } };
}

function _getSupportedFormat(gl, internalFormat, format, type) {
  if (!_supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:    return _getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      case gl.RG16F:   return _getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      default: return null;
    }
  }
  return { internalFormat, format };
}

function _supportRenderTextureFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  return status === gl.FRAMEBUFFER_COMPLETE;
}

function _compileShader(gl, type, source, keywords) {
  let src = source;
  if (keywords && keywords.length) {
    let head = "";
    for (const k of keywords) head += `#define ${k}\n`;
    src = head + src;
  }
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("[fluid-style] shader compile:", gl.getShaderInfoLog(s));
  }
  return s;
}

function _createProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("[fluid-style] program link:", gl.getProgramInfoLog(p));
  }
  return p;
}

function _getUniforms(gl, program) {
  const out = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    out[info.name] = gl.getUniformLocation(program, info.name);
  }
  return out;
}

class Program {
  constructor(gl, vs, fs) {
    this.gl = gl;
    this.program = _createProgram(gl, vs, fs);
    this.uniforms = _getUniforms(gl, this.program);
  }
  bind() { this.gl.useProgram(this.program); }
}

function _createFBO(gl, w, h, internalFormat, format, type, param) {
  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    texture, fbo, width: w, height: h,
    texelSizeX: 1.0 / w,
    texelSizeY: 1.0 / h,
    attach(id) {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return id;
    },
  };
}

function _createDoubleFBO(gl, w, h, internalFormat, format, type, param) {
  let a = _createFBO(gl, w, h, internalFormat, format, type, param);
  let b = _createFBO(gl, w, h, internalFormat, format, type, param);
  return {
    width: w, height: h,
    texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
    get read() { return a; },
    set read(v) { a = v; },
    get write() { return b; },
    set write(v) { b = v; },
    swap() { const t = a; a = b; b = t; },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// FluidStyle — the actual style class registered with StyleRegistry
// ═══════════════════════════════════════════════════════════════════════

export class FluidStyle {
  static id = "fluid";
  static name = "Fluid";
  static subtitle = "Ink of feeling in Navier–Stokes flow";
  static tech = "WebGL";
  static requiresWebGPU = false;

  constructor(canvas, opts) {
    this.canvas = canvas;
    // v1.5.0-alpha7 — optional flag: when true, this instance is a tile
    // preview in the style picker carousel. Tile previews run at a
    // much faster time-scale (60% of real time, not 10%) so the
    // gallery thumbnail is lively and seductive, not a still pond.
    // Full-screen sessions use the default meditative 10% pace.
    this._isTilePreview = !!(opts && opts.tilePreview);

    // Sensible defaults if canvas hasn't been sized yet — Empathic Art's
    // mount path calls resize() shortly after construction, which does
    // the real allocation.
    if (!canvas.width)  canvas.width  = canvas.clientWidth  || 393;
    if (!canvas.height) canvas.height = canvas.clientHeight || 852;

    const ctx = _getWebGLContext(canvas);
    if (!ctx) throw new Error("FluidStyle: WebGL not available");
    this.gl  = ctx.gl;
    this.ext = ctx.ext;
    this.isWebGL2 = ctx.isWebGL2;

    // Sim knobs — Empathic Art / mobile-first defaults.
    // v1.5.0-alpha4 — oil-on-water profile:
    //   the ink is always present, always slowly moving, and it
    //   evolves in colour as the emotion shifts. No burst events, no
    //   drop-drop-drop cadence. Currents drift, they never race.
    this._config = {
      SIM_RESOLUTION:      96,
      DYE_RESOLUTION:      512,
      DENSITY_DISSIPATION: 0.06,    // very low — dye lingers indefinitely, evolving
      VELOCITY_DISSIPATION:0.10,    // very low — currents keep flowing gently
      PRESSURE:            0.8,
      PRESSURE_ITERATIONS: 20,
      CURL:                6,       // gentle vorticity baseline — swirls but never violent
      SPLAT_RADIUS:        0.55,    // wide soft blobs so dye reads as continuous, not dots
      SPLAT_FORCE:         600,     // gentle impulse — arousal lifts it only a little
    };

    // Emotion state.
    this._emotion = { v: 0, a: 0, o: 0.5, label: null };
    this._audioRms = 0;
    this._surface  = [0.05, 0.04, 0.05]; // near-black (session ink); may be
                                         // overwritten by setSurface() but we
                                         // default to session-ink so the
                                         // circumplex preview looks right too.

    // ─── Emotion history (session memory the fluid paints from) ──────
    // Each entry: { v, a, o, palette, hex, mood: label, t }
    // Splats sample uniformly by index (recent and old count the same),
    // so the whole session-so-far stays visible in the ink.
    this._history = [];
    this._historyMax = 400;   // safe upper bound; sessions are short

    // ─── Splat scheduler state ───────────────────────────────────────
    // v1.5.0-alpha4 — continuous flow, not bursts. Instead of "one
    // big drop every 5s", we fire many tiny soft splats per second,
    // spread all over the canvas, so the ink is always present and
    // always evolving in colour. The _burstQueue is retained but no
    // longer used — label changes no longer schedule visible bursts.
    this._nextBaselineSplatT = 0;   // ms timestamp
    this._burstQueue = [];          // no longer written to (kept for compat)
    this._lastMoodLabel = null;

    // For "continuous flow": accumulate a floating point splat budget
    // per frame and fire whenever it crosses 1.
    this._splatBudget = 0;

    // Build shaders + programs.
    this._buildPrograms();

    // Build the quad blitter (index buffer with two triangles).
    this._buildBlitter();

    // Allocate all FBOs.
    this._initFramebuffers();

    // Start clock.
    this._t0 = performance.now();
    this._lastFrameT = this._t0;
    this._running = false;
    this._raf = null;
    this._crossfadeRaf = null;
  }

  _buildPrograms() {
    const gl = this.gl;
    const vs = _compileShader(gl, gl.VERTEX_SHADER, V_BASE);

    const advectKeywords = this.ext.supportLinearFiltering ? null : ["MANUAL_FILTERING"];
    this._progCopy       = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_COPY));
    this._progClear      = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_CLEAR));
    this._progColor      = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_COLOR));
    this._progDisplay    = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_DISPLAY));
    this._progSplat      = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_SPLAT));
    this._progAdvect     = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_ADVECT, advectKeywords));
    this._progDivergence = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_DIVERGENCE));
    this._progCurl       = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_CURL));
    this._progVorticity  = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_VORTICITY));
    this._progPressure   = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_PRESSURE));
    this._progGradSub    = new Program(gl, vs, _compileShader(gl, gl.FRAGMENT_SHADER, F_GRAD_SUB));
  }

  _buildBlitter() {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    this._vbo = vbo;
    this._ibo = ibo;
  }

  _blit(target, clearIt) {
    const gl = this.gl;
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    if (clearIt) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  _getResolution(res) {
    const gl = this.gl;
    let ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (ar < 1) ar = 1 / ar;
    const min = Math.round(res);
    const max = Math.round(res * ar);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
    return { width: min, height: max };
  }

  _initFramebuffers() {
    const gl = this.gl;
    const cfg = this._config;
    const simRes = this._getResolution(cfg.SIM_RESOLUTION);
    const dyeRes = this._getResolution(cfg.DYE_RESOLUTION);
    const texType = this.ext.halfFloatTexType;
    const rgba = this.ext.formatRGBA;
    const rg   = this.ext.formatRG;
    const r    = this.ext.formatR;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    this._dye        = _createDoubleFBO(gl, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    this._velocity   = _createDoubleFBO(gl, simRes.width, simRes.height, rg.internalFormat,   rg.format,   texType, filtering);
    this._divergence = _createFBO      (gl, simRes.width, simRes.height, r.internalFormat,    r.format,    texType, gl.NEAREST);
    this._curl       = _createFBO      (gl, simRes.width, simRes.height, r.internalFormat,    r.format,    texType, gl.NEAREST);
    this._pressure   = _createDoubleFBO(gl, simRes.width, simRes.height, r.internalFormat,    r.format,    texType, gl.NEAREST);

    this._simSize = [simRes.width, simRes.height];
    this._dyeSize = [dyeRes.width, dyeRes.height];
  }

  // ─── Public style contract ─────────────────────────────────────────

  resize() {
    // Match the drawing buffer to the CSS pixel size the app has laid
    // out. We rebuild FBOs at the same time — sim/dye resolutions are
    // aspect-fitted, so they need to follow.
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth  || c.width);
    const h = Math.max(1, c.clientHeight || c.height);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    // Reallocate FBOs so the aspect-fit resolutions match the new canvas.
    this._initFramebuffers();
  }

  setSurface(r, g, b) { this._surface = [r, g, b]; }

  crossfadeSurfaceTo(target, durMs = 1800) {
    if (typeof target === "string") target = hexToRgb01(target);
    if (!Array.isArray(target) || target.length < 3) return;
    const start = [...this._surface];
    const t0 = performance.now();
    const step = () => {
      const t = clamp01((performance.now() - t0) / durMs);
      const k = t * t * (3 - 2 * t);
      this._surface[0] = start[0] + (target[0] - start[0]) * k;
      this._surface[1] = start[1] + (target[1] - start[1]) * k;
      this._surface[2] = start[2] + (target[2] - start[2]) * k;
      if (t < 1 && this._running) this._crossfadeRaf = requestAnimationFrame(step);
    };
    if (this._crossfadeRaf) cancelAnimationFrame(this._crossfadeRaf);
    this._crossfadeRaf = requestAnimationFrame(step);
  }

  setEmotion(v, a, o, label) {
    this._emotion.v = v;
    this._emotion.a = a;
    this._emotion.o = o;
    this._emotion.label = label || null;

    // Compute palette + a representative hex for history.
    const p = harmonicPalette(v, a, { openness: o });
    const hex = p && p.primary && p.primary.hex ? p.primary.hex : "#a04020";

    // Push into the rolling history buffer.
    this._history.push({
      v, a, o,
      palette: p,
      hex,
      mood: label || (p.primary && p.primary.name) || "moment",
      t: performance.now(),
    });
    if (this._history.length > this._historyMax) {
      this._history.splice(0, this._history.length - this._historyMax);
    }

    // Label change → schedule a burst. First-ever label bootstraps
    // history without triggering an eruption (feels forced otherwise).
    const newLabel = this._emotion.label;
    if (this._lastMoodLabel != null && newLabel && newLabel !== this._lastMoodLabel) {
      this._scheduleBurst(newLabel);
    }
    if (newLabel) this._lastMoodLabel = newLabel;
  }

  audioBeat(rms) { this._audioRms = clamp01(rms); }
  splat() { /* Empathic Art doesn't wire manual splats. */ }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastFrameT = performance.now();
    // Seed a soft splat immediately so the canvas isn't dead-black at
    // the first frame. Uses whatever emotion is set (default neutral).
    this._nextBaselineSplatT = performance.now() + 300;
    const loop = () => {
      if (!this._running) return;
      try {
        this._frame();
      } catch (err) {
        console.warn("[fluid-style] frame error, halting:", err && err.message);
        this._running = false;
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._crossfadeRaf) cancelAnimationFrame(this._crossfadeRaf);
    this._crossfadeRaf = null;
  }

  destroy() {
    this.stop();
    // GC will collect the WebGL textures once we drop references.
    this._dye = this._velocity = this._divergence = this._curl = this._pressure = null;
    this._progCopy = this._progClear = this._progColor = this._progDisplay = null;
    this._progSplat = this._progAdvect = this._progDivergence = null;
    this._progCurl = this._progVorticity = this._progPressure = this._progGradSub = null;
  }

  // ─── Frame ─────────────────────────────────────────────────────────

  _frame() {
    const gl = this.gl;
    const now = performance.now();
    // dt in seconds, clamped so a tab that just came back doesn't
    // detonate the fluid with a 3-second step.
    let dt = (now - this._lastFrameT) / 1000;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 1 / 30); // clamp to at most 30 fps step
    this._lastFrameT = now;

    // v1.5.0-alpha7 — dual-mode global time scale.
    //   Full-screen (default): 10% of real time — meditative oil-on-water drift.
    //   Tile preview (carousel): 60% — lively and seductive at thumbnail size.
    // Every downstream number that depends on dt (advection distance,
    // splat rate, and the solver step) is derived from this scaled dt.
    const TIME_SCALE = this._isTilePreview ? 0.60 : 0.10;
    const wallDt = dt;
    dt = dt * TIME_SCALE;

    // Emotion-driven config for this frame.
    // ─── v1.5.0-alpha4 tuning — oil on water ─────────────────────
    // The ink is always on screen and always moving gently. Emotion
    // shifts the palette of the CONTINUOUS supply of colour and
    // gently biases current speed and swirl — it never triggers a
    // visible "drop" or "burst". Everything is dialled way down.
    const v = this._emotion.v;
    const a = this._emotion.a;
    const o = this._emotion.o;                        // 0..1 (closed → open)
    const arousal = clamp01((a + 1) * 0.5);
    const rms = clamp01(this._audioRms);

    // valence -> velocity dissipation. Positive valence keeps the
    // motion around slightly longer; the whole range is very low so
    // currents always drift, they never race.
    //   negative valence (v=-1): 0.20
    //   neutral         (v=0):   0.10
    //   positive        (v=+1): -0.05  → currents nearly conserved
    const velocityDissipation = 0.10 - v * 0.15 + arousal * 0.02;

    // openness -> density dissipation. Kept extremely low across the
    // entire range so colour always lingers. Closed still fades
    // faster than open, but even closed keeps ink around for many
    // seconds so the canvas never goes to black.
    //   closed (o=0): 0.14 → ink slowly fades over ~10s
    //   open   (o=1): 0.02 → ink persists indefinitely, whole canvas
    //                       accumulates a layered oil-on-water look
    // v1.5.0-alpha4c — middle ground: enough dissipation to prevent
    // saturation blow-out but low enough that colours linger and the
    // surface reads as a living ink layer.
    // v1.5.0-alpha7 — lifted so deep darks reassert between splats
    // and the composition has snap. Tile previews stay a touch lower
    // so their punchier flow doesn't strobe.
    const densityDissipation = this._isTilePreview
      ? 0.85 - o * 0.20                                // 0.65..0.85 (tile — fade so palette rotates but colour lingers on the small canvas)
      : 0.60 - o * 0.25;                               // 0.35..0.60 (full-screen)

    // arousal -> curl (vorticity confinement) & splat force.
    // v1.5.0-alpha7 — tile previews want slightly punchier motion
    // than full-screen sessions so the thumbnail feels alive.
    if (this._isTilePreview) {
      this._config.CURL        = 2  + arousal * 5  + rms * 1;   // ~2..8
      this._config.SPLAT_FORCE = 250 + arousal * 350 + rms * 100; // ~250..700
    } else {
      this._config.CURL        = 1  + arousal * 3  + rms * 1;   // ~1..5
      this._config.SPLAT_FORCE = 120 + arousal * 180 + rms * 80; // ~120..380
    }

    // ── Fire continuous-flow splats ───────────────────────────────
    this._tickSplatSchedule(now, arousal, dt);

    // ── Solver step ───────────────────────────────────────────────
    this._step(dt, velocityDissipation, densityDissipation);

    // ── Render to screen ──────────────────────────────────────────
    this._render(null);
  }

  _step(dt, velocityDissipation, densityDissipation) {
    const gl = this.gl;
    const cfg = this._config;
    gl.disable(gl.BLEND);

    // 1) curl
    this._progCurl.bind();
    gl.uniform2f(this._progCurl.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    gl.uniform1i(this._progCurl.uniforms.uVelocity, this._velocity.read.attach(0));
    this._blit(this._curl);

    // 2) vorticity confinement
    this._progVorticity.bind();
    gl.uniform2f(this._progVorticity.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    gl.uniform1i(this._progVorticity.uniforms.uVelocity, this._velocity.read.attach(0));
    gl.uniform1i(this._progVorticity.uniforms.uCurl,     this._curl.attach(1));
    gl.uniform1f(this._progVorticity.uniforms.curl, cfg.CURL);
    gl.uniform1f(this._progVorticity.uniforms.dt, dt);
    this._blit(this._velocity.write);
    this._velocity.swap();

    // 3) divergence
    this._progDivergence.bind();
    gl.uniform2f(this._progDivergence.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    gl.uniform1i(this._progDivergence.uniforms.uVelocity, this._velocity.read.attach(0));
    this._blit(this._divergence);

    // 4) clear pressure with decay
    this._progClear.bind();
    gl.uniform1i(this._progClear.uniforms.uTexture, this._pressure.read.attach(0));
    gl.uniform1f(this._progClear.uniforms.value, cfg.PRESSURE);
    this._blit(this._pressure.write);
    this._pressure.swap();

    // 5) pressure Jacobi
    this._progPressure.bind();
    gl.uniform2f(this._progPressure.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    gl.uniform1i(this._progPressure.uniforms.uDivergence, this._divergence.attach(0));
    for (let i = 0; i < cfg.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this._progPressure.uniforms.uPressure, this._pressure.read.attach(1));
      this._blit(this._pressure.write);
      this._pressure.swap();
    }

    // 6) gradient subtract
    this._progGradSub.bind();
    gl.uniform2f(this._progGradSub.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    gl.uniform1i(this._progGradSub.uniforms.uPressure, this._pressure.read.attach(0));
    gl.uniform1i(this._progGradSub.uniforms.uVelocity, this._velocity.read.attach(1));
    this._blit(this._velocity.write);
    this._velocity.swap();

    // 7) advect velocity
    this._progAdvect.bind();
    gl.uniform2f(this._progAdvect.uniforms.texelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    if (!this.ext.supportLinearFiltering) {
      gl.uniform2f(this._progAdvect.uniforms.dyeTexelSize, this._velocity.texelSizeX, this._velocity.texelSizeY);
    }
    let velId = this._velocity.read.attach(0);
    gl.uniform1i(this._progAdvect.uniforms.uVelocity, velId);
    gl.uniform1i(this._progAdvect.uniforms.uSource, velId);
    gl.uniform1f(this._progAdvect.uniforms.dt, dt);
    gl.uniform1f(this._progAdvect.uniforms.dissipation, velocityDissipation);
    this._blit(this._velocity.write);
    this._velocity.swap();

    // 8) advect dye
    if (!this.ext.supportLinearFiltering) {
      gl.uniform2f(this._progAdvect.uniforms.dyeTexelSize, this._dye.texelSizeX, this._dye.texelSizeY);
    }
    gl.uniform1i(this._progAdvect.uniforms.uVelocity, this._velocity.read.attach(0));
    gl.uniform1i(this._progAdvect.uniforms.uSource,   this._dye.read.attach(1));
    gl.uniform1f(this._progAdvect.uniforms.dissipation, densityDissipation);
    this._blit(this._dye.write);
    this._dye.swap();
  }

  _render(target) {
    const gl = this.gl;
    // Paint the session ink as background, then blend the dye on top.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    this._progColor.bind();
    const s = this._surface;
    gl.uniform4f(this._progColor.uniforms.color, s[0], s[1], s[2], 1);
    this._blit(target);
    this._progDisplay.bind();
    gl.uniform1i(this._progDisplay.uniforms.uTexture, this._dye.read.attach(0));
    this._blit(target);
    gl.disable(gl.BLEND);
  }

  // ─── Splats — the emotion-history painter ───────────────────────────

  _correctRadius(radius) {
    const ar = this.canvas.width / this.canvas.height;
    if (ar > 1) radius *= ar;
    return radius;
  }

  _splat(x, y, dx, dy, color, radiusScale = 1.0) {
    // x, y — unit UV coords inside the canvas (0..1)
    // dx, dy — velocity impulse
    // color — [r,g,b] in 0..1
    const gl = this.gl;
    const cfg = this._config;
    this._progSplat.bind();
    gl.uniform1i(this._progSplat.uniforms.uTarget, this._velocity.read.attach(0));
    gl.uniform1f(this._progSplat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    gl.uniform2f(this._progSplat.uniforms.point, x, y);
    gl.uniform3f(this._progSplat.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(this._progSplat.uniforms.radius,
      this._correctRadius((cfg.SPLAT_RADIUS * radiusScale) / 100.0));
    this._blit(this._velocity.write);
    this._velocity.swap();

    gl.uniform1i(this._progSplat.uniforms.uTarget, this._dye.read.attach(0));
    gl.uniform3f(this._progSplat.uniforms.color, color[0], color[1], color[2]);
    this._blit(this._dye.write);
    this._dye.swap();
  }

  /**
   * Pick a colour to splat.
   *
   * v1.5.0-alpha6 — openness signature:
   *   - saturation: closed=60%, open=100% of the anchor's chroma.
   *   - palette breadth: closed picks from a narrow 2-stop window
   *     (mid + back — monochromatic ink), open picks from all 5 stops
   *     (mid, front, hot, whisper, back — full harmonic spread).
   *   - ink budget (rate, radius, intensity) stays CONSTANT across
   *     openness so the composition envelope holds and the surface
   *     never blows out to white.
   *
   * Colour source blend (unchanged from alpha4):
   *   60% current emotion palette / 40% recency-weighted history.
   *
   * @returns {number[]} rgb in 0..1
   */
  _pickHistoryColor(/* biasHex */) {
    const o = clamp01(this._emotion.o);
    // Palette breadth by openness:
    //   closed (o=0): only [mid, back] — narrow, single-note ink
    //   mid   (o=0.5): [mid, back, front] — opens toward highlights
    //   open  (o=1): [mid, front, hot, whisper, back] — full spread
    const pickStopsForOpenness = (p) => {
      // v1.5.0-alpha7c — tile previews use only the 2 most saturated
      // stops (front + hot) so at 96×120 the palette reads as clear
      // seductive hue, not muddy palette average. Full-screen keeps
      // the layered breadth that makes a real session feel painterly.
      if (this._isTilePreview) return [p.front, p.hot];
      if (o < 0.25) return [p.mid, p.back];
      if (o < 0.55) return [p.mid, p.back, p.front];
      if (o < 0.80) return [p.mid, p.back, p.front, p.whisper];
      return [p.mid, p.front, p.hot, p.whisper, p.back];
    };

    // Source: 60% current emotion / 40% recency-weighted history.
    // v1.5.0-alpha7b — tile previews: 100% current emotion (no history).
    // The gallery loop rotates through distinct emotions every 8s; if
    // we let old emotions bleed in via history, the palette washes out
    // to muddy overlap. Full-screen keeps the 60/40 blend because that
    // is what makes a real session feel like a lived, layered painting.
    const currentBias = this._isTilePreview ? 1.0 : 0.60;
    let stops;
    if (this._history.length === 0 || Math.random() < currentBias) {
      const p = harmonicPalette(this._emotion.v, this._emotion.a, { openness: o });
      stops = pickStopsForOpenness(p);
    } else {
      const n = this._history.length;
      const r = Math.random();
      const idx = Math.min(n - 1, Math.floor(n * (1 - Math.pow(1 - r, 1 / 3))));
      const entry = this._history[idx];
      if (entry.palette) {
        stops = pickStopsForOpenness(entry.palette);
      } else {
        stops = [hexToRgb01(entry.hex)];
      }
    }

    let color = stops[Math.floor(Math.random() * stops.length)] || [0.5, 0.4, 0.3];

    // Saturation shift by openness: closed = 60% of anchor chroma,
    // open = 100%. Composition depth (L) is preserved so darks stay
    // dark and mids stay mid — only chromatic energy shifts.
    // sat multiplier: 0.60 at closed → 1.00 at open, linear.
    const satMul = 0.60 + o * 0.40;
    color = _rgbAdjustSaturation(color, satMul);
    return color;
  }

  /**
   * v1.5.0-alpha4 — bursts removed. Label changes no longer trigger
   * any visible splat event. The palette shift is expressed through
   * the CONTINUOUS supply of colour (the history sampler picks the
   * new label's palette more often as it becomes recent). Kept as a
   * no-op stub for API compatibility with external callers that may
   * still reference it.
   */
  _scheduleBurst(/* newLabel */) {
    /* intentionally empty — see class comment */
  }

  /**
   * Called every frame to fire continuous-flow splats.
   *
   * v1.5.0-alpha6 — openness NO LONGER affects rate. Ink budget is
   * constant across the openness range so the composition envelope
   * holds and open never blows out to white. Only arousal and audio
   * modulate rate, and only within a narrow band.
   */
  _tickSplatSchedule(now, arousal, dt) {
    const rms = clamp01(this._audioRms);
    // Wall-time splat rate. Constant across openness so ink budget
    // never spikes. Arousal is a whisper; audio a whisper on top.
    // v1.5.0-alpha7 — tile previews want a lush, dense flow so the
    // thumbnail stays saturated at all times.
    const baseRate = this._isTilePreview
      ? 22 + arousal * 8 + rms * 3        // ~22..33 splats/sec
      : 10 + arousal * 4 + rms * 2;       // ~10..16 splats/sec

    // Rate-to-dt reciprocal: whatever TIME_SCALE this instance uses,
    // multiply so wall-time supply stays equal to baseRate.
    // Full-screen: TIME_SCALE=0.10 → mul=10.  Tile: TIME_SCALE=0.60 → mul=1/0.60.
    const timeScale = this._isTilePreview ? 0.60 : 0.10;
    this._splatBudget += baseRate * dt * (1 / timeScale);
    // Cap so a frame stall doesn't dump a huge batch on catch-up.
    if (this._splatBudget > 6) this._splatBudget = 6;
    while (this._splatBudget >= 1) {
      this._fireOneSplat(null, 1.0);
      this._splatBudget -= 1;
    }
  }

  _fireOneSplat(biasHex, radiusScale) {
    // Splats scattered uniformly across the whole canvas so the ink
    // reads as an ever-present layer, and impulses are random-angle
    // gentle nudges (not upward jets) so nothing shoots off-screen.
    const x = 0.05 + Math.random() * 0.90;
    const y = 0.05 + Math.random() * 0.90;

    const arousal = clamp01((this._emotion.a + 1) * 0.5);
    const forceMag = this._config.SPLAT_FORCE * (0.15 + arousal * 0.35);
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.cos(angle) * forceMag;
    const dy = Math.sin(angle) * forceMag;

    // v1.5.0-alpha6 — radius CONSTANT across openness. Composition
    // depth held; openness lives entirely in colour space now.
    const constantRadiusScale = 1.00;

    // v1.5.0-alpha6 — intensity also CONSTANT across openness. The
    // dye buffer accumulates the same amount of ink at closed and
    // open, so darks and mids stay honest either way.
    // v1.5.0-alpha7 — tile previews get a chromatic boost so the
    // thumbnail reads as luminous and seductive next to the other
    // styles. Full-screen intensity slightly lifted too for contrast.
    const color = this._pickHistoryColor(biasHex);
    // v1.5.0-alpha7i — tile intensity that balances colour depth vs
    // pileup. 0.35 is high enough to see the palette clearly at 96px
    // but not so high that HDR-like whiteout washes the composition.
    const intensity = this._isTilePreview ? 0.35 : 0.13;
    const scaled = [
      color[0] * intensity,
      color[1] * intensity,
      color[2] * intensity,
    ];

    this._splat(x, y, dx, dy, scaled, radiusScale * constantRadiusScale);
  }
}

// ─── Small colour helper: saturation multiplier in HSL space ──────────────────────────────
//
// Used by _pickHistoryColor to shift chroma with openness while
// leaving lightness (composition depth) alone. Kept inline here so
// fluid-style.js doesn't depend on private helpers from the palette
// module. rgb in 0..1, returns rgb in 0..1.
function _rgbAdjustSaturation(rgb, satMul) {
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [r, g, b]; // grey — no chroma to shift
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;

  const s2 = Math.max(0, Math.min(1, s * satMul));

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s2 === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
