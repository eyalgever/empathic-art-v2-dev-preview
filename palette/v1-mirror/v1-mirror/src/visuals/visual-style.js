/**
 * Empathic App — VisualStyle interface + StyleRegistry
 *
 * A VisualStyle is a self-contained rendering backend that turns the
 * scripted-or-live emotion signal (valence, arousal, openness) into
 * an animated, colour-mapped visual on an HTMLCanvasElement.
 *
 * The interface intentionally mirrors the FluidEngine contract so the
 * existing engine can be wrapped as one style ("Breath") without any
 * behaviour change, and future styles (Halo/smoke-ring, Filament/neuro-noise,
 * Ember/warp, Vein/physarum, and desktop-only WebGPU styles) can plug in
 * behind the same picker + session hookup.
 *
 * Interface contract (every style MUST implement):
 *   new Style(canvas, opts?)          — set up own GL context on canvas
 *   .setEmotion(v, a, o, label)       — update emotion signal
 *   .setSurface(r, g, b)              — background colour, 0..1 floats
 *   .crossfadeSurfaceTo(target, ms)   — returns Promise<void>
 *   .audioBeat(rms, low, mid, high, centroid)  — optional; no-op is fine
 *   .splat(x, y, dx, dy, color, r)    — optional; no-op is fine
 *   .resize()                          — re-fit to canvas CSS box
 *   .start() / .stop() / .destroy()   — lifecycle
 *
 * Static metadata (every style MUST expose):
 *   Style.id            — stable string id, e.g. "current", "halo"
 *   Style.name          — poetic user-facing name, e.g. "Halo"
 *   Style.subtitle      — one-line register, e.g. "Radiant, peaceful, held"
 *   Style.tech          — "webgl2" | "webgpu"
 *   Style.requiresWebGPU — boolean; gallery filters iPhone builds
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * Registry of available visual styles.
 *
 * Registration order = display order in the gallery carousel.
 * Register with `StyleRegistry.register(Class)`; unregister is not needed —
 * this lives for the app lifetime.
 */
export const StyleRegistry = {
  _styles: [],

  register(StyleClass) {
    if (!StyleClass.id) {
      throw new Error("VisualStyle class missing static id");
    }
    if (this._styles.some((s) => s.id === StyleClass.id)) {
      // Idempotent — safe to import twice.
      return;
    }
    this._styles.push(StyleClass);
  },

  /**
   * All registered styles, optionally filtered by device capability.
   * Pass `{ webgpu: false }` on iPhone builds until iOS ships stable WebGPU.
   */
  list({ webgpu = detectWebGPU() } = {}) {
    return this._styles.filter((s) => webgpu || !s.requiresWebGPU);
  },

  /** Look up a style class by its stable id, or return null if absent. */
  get(id) {
    return this._styles.find((s) => s.id === id) || null;
  },

  /**
   * Get the class for `id`, falling back to `fallbackId` (usually "current")
   * if the requested style is missing or is WebGPU on a WebGPU-less device.
   * Returns null only if the fallback is also missing.
   */
  getOrFallback(id, fallbackId = "current") {
    const s = this.get(id);
    const canGpu = detectWebGPU();
    if (s && (canGpu || !s.requiresWebGPU)) return s;
    return this.get(fallbackId);
  },
};

/**
 * Fast, synchronous capability check. Does NOT initialize a WebGPU adapter;
 * only checks whether the API surface exists. iOS Safari 26 exposes
 * `navigator.gpu` only when the WebGPU feature flag is enabled.
 */
export function detectWebGPU() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}
