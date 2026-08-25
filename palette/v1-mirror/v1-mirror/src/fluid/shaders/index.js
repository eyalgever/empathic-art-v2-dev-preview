/**
 * Empathic Art — Shader loader
 *
 * Loads every GLSL source file used by the fluid engine once, at
 * module-import time, using top-level await. Consumers import the
 * named exports as plain strings and can build WebGL programs
 * synchronously — no per-shader await, no async FluidEngine
 * constructor.
 *
 * The GLSL source files are the canonical source of truth for every
 * fluid pipeline pass. They live alongside this loader in
 * src/fluid/shaders/ and are named after the pipeline stage they
 * implement (advect, splat, divergence, pressure, gradient, display,
 * plus the shared fullscreen vertex shader).
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const BASE = new URL("./", import.meta.url);

async function load(file) {
  const res = await fetch(new URL(file, BASE));
  if (!res.ok) {
    throw new Error(
      `Shader load failed: ${file} (HTTP ${res.status} ${res.statusText})`,
    );
  }
  return await res.text();
}

const [
  V_SHADER,
  F_ADVECT,
  F_SPLAT,
  F_DIVERGENCE,
  F_PRESSURE,
  F_GRADIENT,
  F_DISPLAY,
] = await Promise.all([
  load("fullscreen.vert.glsl"),
  load("advect.frag.glsl"),
  load("splat.frag.glsl"),
  load("divergence.frag.glsl"),
  load("pressure.frag.glsl"),
  load("gradient.frag.glsl"),
  load("display.frag.glsl"),
]);

export { V_SHADER, F_ADVECT, F_SPLAT, F_DIVERGENCE, F_PRESSURE, F_GRADIENT, F_DISPLAY };
