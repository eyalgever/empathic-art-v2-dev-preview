/**
 * Empathic App — Visual Style: Breath
 *
 * The existing FluidEngine, wrapped as a VisualStyle. This is the default
 * style and preserves the ship experience of v1.0.3 byte-for-byte —
 * the wrapper only forwards calls, adds no behaviour.
 *
 * The internal id remains "current" for persistence stability (any
 * user who selected this style before the rename has "current" saved
 * in local storage); only the display name and subtitle changed to
 * "Breath" / "Colour, held as breath".
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { FluidEngine } from "../fluid/fluid-engine.js?v=1.3.8";
import { emotionToColor } from "../palette/emotion-palette.js?v=1.3.1";

export class CurrentStyle {
  static id = "current";
  static name = "Breath";
  static subtitle = "Colour, held as breath";
  // Breath uses the same live-preview path as every other style:
  // a real FluidEngine instance runs inside the picker tile at 60fps
  // and receives synthetic splats from the carousel's tick loop
  // (see style-carousel.js: SPLAT_INTERVAL_MS + splat injection).
  // This yields continuous, seam-free motion identical to Halo /
  // Skyspace / Aperture — no video, no sprite sheet, no loop cut.
  static tech = "webgl2";
  static requiresWebGPU = false;

  constructor(canvas, opts = {}) {
    this._engine = new FluidEngine(canvas, opts);
    // Chamber ancestor — publishes --ea-emotion so wheel + slider
    // thumbs pick up the fluid's current colour. Silent no-op when
    // the canvas is used outside a chamber (e.g. immersive view).
    this._chamberEl = canvas.closest ? canvas.closest(".ea-chamber") : null;
    this._lastEmotionCss = null;
  }

  setEmotion(v, a, o, label) {
    this._engine.setEmotion(v, a, o, label);
    if (this._chamberEl) {
      const c = emotionToColor(v, a, o == null ? 0.5 : o);
      const key = `${c.r},${c.g},${c.b}`;
      if (this._lastEmotionCss !== key) {
        this._chamberEl.style.setProperty("--ea-emotion", `rgb(${c.r}, ${c.g}, ${c.b})`);
        this._lastEmotionCss = key;
      }
    }
  }
  setSurface(r, g, b)         { this._engine.setSurface(r, g, b); }
  crossfadeSurfaceTo(t, ms)   { return this._engine.crossfadeSurfaceTo(t, ms); }
  audioBeat(...args)          { this._engine.audioBeat(...args); }
  splat(...args)              { this._engine.splat(...args); }
  resize()                    { this._engine.resize(); }
  start()                     { this._engine.start(); }
  stop()                      { this._engine.stop(); }
  destroy()                   { this._engine.destroy(); }
}
