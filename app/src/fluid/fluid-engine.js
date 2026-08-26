/**
 * Empathic App — Fluid Engine
 *
 * WebGL2 semi-Lagrangian fluid simulation. Renders a soft, painterly
 * emotional field that responds to splats (touch, voice amplitude,
 * audio RMS peaks) and to the current emotion color from the palette.
 *
 * Architecture:
 *   velocity — RG16F texture (u, v)
 *   density  — RGBA16F texture (r, g, b, a) — the visible "paint"
 *   pressure/divergence — R16F helpers
 *
 * Step per frame:
 *   1. advect velocity
 *   2. advect density
 *   3. apply forces (from splats)
 *   4. divergence → pressure jacobi → subtract gradient
 *   5. display density
 *
 * Public API:
 *   const eng = new FluidEngine(canvas);
 *   eng.setEmotion(v, a, o, label);
 *   eng.splat(x, y, dx, dy, color, radius);
 *   eng.audioBeat(rms, low, mid, high, centroid);
 *   eng.resize();  eng.start();  eng.stop();  eng.destroy();
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 *          Inspired by the classic GPU fluid method (Stam 1999).
 */

import { emotionToColor } from "../palette/emotion-palette.js?v=1.3.1";
// Shader sources live in ./shaders/*.glsl. The loader module fetches
// every GLSL file once at import time (top-level await) and re-exports
// each as a string, so the FluidEngine constructor and program()
// builder below stay fully synchronous.
import {
  V_SHADER,
  F_ADVECT,
  F_SPLAT,
  F_DIVERGENCE,
  F_PRESSURE,
  F_GRADIENT,
  F_DISPLAY,
} from "./shaders/index.js?v=1.3.1";

// Convenience: compile shader / program
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("Shader compile failed: " + info);
  }
  return s;
}
function program(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}
function fbo(gl, w, h, internal, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { fbo: f, tex, w, h };
}
function doubleFbo(gl, w, h, internal, format, type) {
  return {
    read: fbo(gl, w, h, internal, format, type),
    write: fbo(gl, w, h, internal, format, type),
    swap() { const t = this.read; this.read = this.write; this.write = t; }
  };
}

export class FluidEngine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // iPhone Safari perf pass (Eyal Gever, 2026-07):
    // The three biggest per-frame costs are dye buffer size, sim buffer
    // size, and pressure Jacobi iteration count. On a 14 Pro Max the old
    // dpr=2 * dyeRes=512 * simRes=128 * 20 iters combination dropped Breath
    // to ~30fps and Session Replay looked chunky because dropped frames
    // starve the setEmotion crossfade. Cutting dye to 384, sim to 96, and
    // pressure iterations to 14 restores 60fps on modern iPhones without
    // visibly softening the puff. DPR cap is now 1.5 (was 2) — see
    // _createBuffers below.
    this.opts = {
      simRes: 96,
      dyeRes: 384,
      dt: 0.016,
      velDiss: 0.15,
      densityDiss: 0.4,
      pressureIterations: 14,
      ...opts,
    };

    const gl = canvas.getContext("webgl2", {
      alpha: false, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float required");
    }

    // Fullscreen quad
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._vao = vao;

    // Programs
    this.P = {
      advect:     program(gl, V_SHADER, F_ADVECT),
      splat:      program(gl, V_SHADER, F_SPLAT),
      divergence: program(gl, V_SHADER, F_DIVERGENCE),
      pressure:   program(gl, V_SHADER, F_PRESSURE),
      gradient:   program(gl, V_SHADER, F_GRADIENT),
      display:    program(gl, V_SHADER, F_DISPLAY),
    };

    this._raf = null;
    this._running = false;
    this._emotion = { v: 0, a: 0, o: 0.5, color: emotionToColor(0, 0, 0.5) };
    this._audio = { rms: 0, low: 0, mid: 0, high: 0, centroid: 0.5 };
    this._surface = { r: 0xFB/255, g: 0xF6/255, b: 0xEC/255 };

    this._createBuffers();
    this._autoSplatT0 = performance.now();
  }

  _createBuffers() {
    const gl = this.gl;
    // Retina iPhones report dpr=3. Rendering the display quad at native
    // 3x is pure waste for a soft-edged fluid puff. Cap at 1.5 so we still
    // beat sub-pixel banding on non-retina but never pay the 4x fill-rate
    // cost that 3x demands.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 400;
    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    const aspect = this.canvas.width / this.canvas.height;
    this._aspect = aspect;

    const sim = this.opts.simRes;
    const dye = this.opts.dyeRes;
    const simW = aspect >= 1 ? sim : Math.round(sim / aspect);
    const simH = aspect >= 1 ? Math.round(sim / aspect) : sim;
    const dyeW = aspect >= 1 ? dye : Math.round(dye / aspect);
    const dyeH = aspect >= 1 ? Math.round(dye / aspect) : dye;

    this._simTexel = [1 / simW, 1 / simH];
    this._simSize = [simW, simH];
    this._dyeSize = [dyeW, dyeH];

    // velocity RG16F
    this._velocity = doubleFbo(gl, simW, simH, gl.RG16F, gl.RG, gl.HALF_FLOAT);
    // density RGBA16F
    this._density = doubleFbo(gl, dyeW, dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    // pressure + divergence R16F
    this._pressure = doubleFbo(gl, simW, simH, gl.R16F, gl.RED, gl.HALF_FLOAT);
    this._divergence = fbo(gl, simW, simH, gl.R16F, gl.RED, gl.HALF_FLOAT);
  }

  resize() {
    // Recreate buffers on size change
    this._createBuffers();
  }

  setEmotion(valence, arousal, openness, label) {
    this._emotion.v = valence;
    this._emotion.a = arousal;
    this._emotion.o = openness;
    this._emotion.color = emotionToColor(valence, arousal, openness);
    this._emotion.label = label;
  }

  /**
   * Set the background "paper" color the fluid is painted onto.
   * Values are 0..1 floats.
   */
  setSurface(r, g, b) {
    this._surface = { r, g, b };
  }

  /**
   * Smoothly interpolate the surface color to a target over `durMs` ms.
   * Used to cross-fade from cream (waiting-room) to near-black (session).
   * @param {{r:number,g:number,b:number}} target  - 0..1 floats
   * @param {number} durMs
   * @returns {Promise<void>} resolves when the fade completes
   */
  crossfadeSurfaceTo(target, durMs = 1800) {
    return new Promise((resolve) => {
      const start = { ...this._surface };
      const t0 = performance.now();
      // easeInOutCubic
      const ease = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / durMs);
        const e = ease(p);
        this._surface = {
          r: start.r + (target.r - start.r) * e,
          g: start.g + (target.g - start.g) * e,
          b: start.b + (target.b - start.b) * e,
        };
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  audioBeat(rms, low, mid, high, centroid) {
    this._audio = { rms, low, mid, high, centroid };
  }

  /**
   * Add a splat of paint + force at (x, y) in NORMALIZED [0..1] canvas coords.
   * dx/dy are velocity impulses; color is {r,g,b} 0..1.
   */
  splat(x, y, dx, dy, color, radius = 0.0015) {
    const gl = this.gl;
    const P = this.P.splat;
    gl.useProgram(P);

    // Velocity splat
    gl.viewport(0, 0, this._simSize[0], this._simSize[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._velocity.write.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uTarget"), 0);
    gl.uniform2f(gl.getUniformLocation(P, "uPoint"), x, y);
    gl.uniform3f(gl.getUniformLocation(P, "uColor"), dx, dy, 0);
    gl.uniform1f(gl.getUniformLocation(P, "uRadius"), radius);
    gl.uniform1f(gl.getUniformLocation(P, "uAspect"), this._aspect);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._velocity.swap();

    // Density splat
    gl.viewport(0, 0, this._dyeSize[0], this._dyeSize[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._density.write.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._density.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uTarget"), 0);
    gl.uniform2f(gl.getUniformLocation(P, "uPoint"), x, y);
    gl.uniform3f(gl.getUniformLocation(P, "uColor"), color.r, color.g, color.b);
    gl.uniform1f(gl.getUniformLocation(P, "uRadius"), radius);
    gl.uniform1f(gl.getUniformLocation(P, "uAspect"), this._aspect);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._density.swap();
  }

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
    const gl = this.gl;
    // Best-effort cleanup
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  }

  _frame() {
    const gl = this.gl;

    // Audio-driven ambient splat — always on so the fluid stays vibrant
    // even before the audio starts, with emotion color as the base and
    // audio energy modulating intensity/radius on top.
    const now = performance.now();
    if (now - this._autoSplatT0 > 60) {
      this._autoSplatT0 = now;
      // Splat position drifts on a Lissajous curve, hue from emotion
      const t = now * 0.0004;
      const x = 0.5 + 0.32 * Math.sin(t * 1.3);
      const y = 0.5 + 0.32 * Math.cos(t * 0.9 + this._emotion.o * 2);
      // Always guarantee a baseline motion so colors visibly fill the frame.
      const strength = 0.85 + this._audio.rms * 2.2 + this._audio.low * 1.4;
      const dx = (Math.cos(t * 2.1) - 0.5) * strength * 320;
      const dy = (Math.sin(t * 1.7) - 0.5) * strength * 320;
      const c = this._emotion.color;
      // audio centroid nudges hue toward high band (whiter/hotter)
      const cent = this._audio.centroid;
      // Keep color close to the anchor (0.95..1.2 range) so the fluid
      // reads as vibrantly saturated instead of washed-out.
      const gain = 1.05 + this._audio.mid * 0.35;
      const col = {
        r: Math.min(1, (c.r / 255) * gain + cent * 0.04),
        g: Math.min(1, (c.g / 255) * gain),
        b: Math.min(1, (c.b / 255) * gain + (1 - cent) * 0.03),
      };
      const radius = 0.0022 + this._audio.high * 0.005;
      this.splat(x, y, dx, dy, col, radius);
    }

    // 1. Advect velocity
    this._runAdvect(this._velocity, this._velocity, this.opts.velDiss);
    // 2. Advect density
    this._runAdvect(this._velocity, this._density, this.opts.densityDiss);
    // 3. Divergence
    this._runDivergence();
    // 4. Pressure jacobi
    this._runPressure();
    // 5. Subtract gradient
    this._runGradient();
    // 6. Display
    this._runDisplay();
  }

  _runAdvect(velocityFbo, targetFbo, dissipation) {
    const gl = this.gl;
    const P = this.P.advect;
    gl.useProgram(P);
    gl.viewport(0, 0, targetFbo.read.w, targetFbo.read.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo.write.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityFbo.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uVelocity"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targetFbo.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uSource"), 1);
    gl.uniform2f(gl.getUniformLocation(P, "uTexel"), this._simTexel[0], this._simTexel[1]);
    gl.uniform1f(gl.getUniformLocation(P, "uDt"), this.opts.dt);
    gl.uniform1f(gl.getUniformLocation(P, "uDissipation"), dissipation);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    targetFbo.swap();
  }

  _runDivergence() {
    const gl = this.gl;
    const P = this.P.divergence;
    gl.useProgram(P);
    gl.viewport(0, 0, this._simSize[0], this._simSize[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._divergence.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uVelocity"), 0);
    gl.uniform2f(gl.getUniformLocation(P, "uTexel"), this._simTexel[0], this._simTexel[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _runPressure() {
    const gl = this.gl;
    const P = this.P.pressure;
    gl.useProgram(P);
    gl.viewport(0, 0, this._simSize[0], this._simSize[1]);
    // Clear pressure
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pressure.read.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < this.opts.pressureIterations; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._pressure.write.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._pressure.read.tex);
      gl.uniform1i(gl.getUniformLocation(P, "uPressure"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._divergence.tex);
      gl.uniform1i(gl.getUniformLocation(P, "uDivergence"), 1);
      gl.uniform2f(gl.getUniformLocation(P, "uTexel"), this._simTexel[0], this._simTexel[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this._pressure.swap();
    }
  }

  _runGradient() {
    const gl = this.gl;
    const P = this.P.gradient;
    gl.useProgram(P);
    gl.viewport(0, 0, this._simSize[0], this._simSize[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._velocity.write.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._pressure.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uPressure"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uVelocity"), 1);
    gl.uniform2f(gl.getUniformLocation(P, "uTexel"), this._simTexel[0], this._simTexel[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._velocity.swap();
  }

  _runDisplay() {
    const gl = this.gl;
    const P = this.P.display;
    gl.useProgram(P);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._density.read.tex);
    gl.uniform1i(gl.getUniformLocation(P, "uDensity"), 0);
    gl.uniform3f(gl.getUniformLocation(P, "uSurface"), this._surface.r, this._surface.g, this._surface.b);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
