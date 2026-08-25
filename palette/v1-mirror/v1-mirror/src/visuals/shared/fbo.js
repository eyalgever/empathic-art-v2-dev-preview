/**
 * Empathic App — Ping-pong Framebuffer helper for style shaders.
 *
 * Small, dependency-free WebGL2 helper for building double-buffered
 * float textures — the standard scaffolding for any simulation style
 * (Physarum, Curl-ink, reaction-diffusion, mass-spring). All shader
 * styles that need feedback loops share this same helper so the
 * texture allocation, format negotiation, and swap logic live in
 * exactly one place.
 *
 * The helper does one thing: give a WebGL2 context, a size, and a
 * pixel format, and it returns a pair of framebuffers that can be
 * read from and written to on alternating frames. It never assumes
 * anything about what the caller is rendering — no shaders, no
 * uniforms, no attributes are involved.
 *
 * Format negotiation follows the strictest-first rule: try RGBA32F
 * with EXT_color_buffer_float, fall back to RGBA16F, fall back to
 * RGBA8 with a lossy warning. On iPhone Safari + WebKit only RGBA16F
 * is renderable without extensions, so most callers land there.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * Allocate one framebuffer + attached float texture at the given
 * size and internal format. Returns `{ fbo, tex }`. The caller owns
 * lifetime and must call `disposeTarget(gl, target)` to release it.
 */
export function createTarget(gl, w, h, internalFormat, format, type, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  return { fbo, tex, w, h, internalFormat, format, type, filter };
}

/**
 * Release a framebuffer and its attached texture. Safe to call on
 * `null` or a partially constructed target.
 */
export function disposeTarget(gl, t) {
  if (!t) return;
  try { if (t.fbo) gl.deleteFramebuffer(t.fbo); } catch {}
  try { if (t.tex) gl.deleteTexture(t.tex); } catch {}
}

/**
 * Allocate a ping-pong pair of float textures. Returns an object
 * with `.read` and `.write` targets and a `.swap()` method. Every
 * frame:
 *
 *   1. Read from `pp.read.tex` as an input sampler.
 *   2. Draw into `pp.write.fbo`.
 *   3. Call `pp.swap()`.
 *
 * Format is negotiated: RGBA32F → RGBA16F → RGBA8. The chosen format
 * is exposed as `pp.chosenFormat` so callers can decide whether the
 * simulation needs to downgrade (e.g. Physarum can survive at 16F
 * but shouldn't run at 8-bit, whereas dye advection is fine at 8-bit
 * for coarse frames).
 */
export function createPingPong(gl, w, h, {
  preferHighPrecision = true,
  filter = gl.LINEAR,
} = {}) {
  const formats = pickFormats(gl, preferHighPrecision);
  const chosen = formats[0];

  const read  = createTarget(gl, w, h, chosen.internalFormat, chosen.format, chosen.type, filter);
  const write = createTarget(gl, w, h, chosen.internalFormat, chosen.format, chosen.type, filter);

  const state = {
    read,
    write,
    w,
    h,
    chosenFormat: chosen.label,
    swap() {
      const tmp = this.read;
      this.read  = this.write;
      this.write = tmp;
    },
    dispose() {
      disposeTarget(gl, this.read);
      disposeTarget(gl, this.write);
      this.read = null;
      this.write = null;
    },
  };
  return state;
}

/**
 * Try the caller's preferred format list in strict-first order.
 * Requires EXT_color_buffer_float to render into RGBA32F/16F.
 */
function pickFormats(gl, preferHighPrecision) {
  const ext = gl.getExtension("EXT_color_buffer_float");
  const out = [];

  if (ext && preferHighPrecision) {
    out.push({
      label: "RGBA32F",
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
    });
  }
  if (ext) {
    out.push({
      label: "RGBA16F",
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
    });
  }
  // Last-resort fallback. Callers can inspect `chosenFormat` to warn.
  out.push({
    label: "RGBA8",
    internalFormat: gl.RGBA8,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });
  return out;
}

/**
 * Compile-and-link helper shared by every style shader in this
 * project. Attribute location 0 is bound to `aPos` by convention.
 */
export function compileProgram(gl, vs, fs, label = "program") {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(label + " shader compile failed: " + info);
    }
    return s;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(label + " program link failed: " + gl.getProgramInfoLog(p));
  }
  return p;
}

/**
 * Bind a fullscreen quad VAO to attribute 0. Returns the VAO handle.
 * Reused by every style since every style renders through at least
 * one fullscreen pass.
 */
export function createFullscreenQuad(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}
