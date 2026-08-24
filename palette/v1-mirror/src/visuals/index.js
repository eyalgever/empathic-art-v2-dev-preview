/**
 * Empathic App — Visual Styles Barrel
 *
 * Registers every built-in visual style on import and re-exports the
 * registry + the individual classes. Import once from app.js to make the
 * gallery + session code style-agnostic:
 *
 *   import { StyleRegistry } from "./visuals/index.js";
 *   const Cls = StyleRegistry.getOrFallback(store.state.visualStyle);
 *   const style = new Cls(canvas);
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { StyleRegistry, detectWebGPU } from "./visual-style.js";
import { CurrentStyle } from "./current-style.js";
import { HaloStyle } from "./halo-style.js";
import { SkyspaceStyle } from "./skyspace-style.js";
import { ApertureStyle } from "./aperture-style.js";
import { ChapelStyle } from "./chapel-style.js";
import { FilamentStyle } from "./filament-style.js";
import { NervesStyle } from "./nerves-style.js";
import { DriftStyle } from "./drift-style.js";
import { ThresholdStyle } from "./threshold-style.js";
import { EmberStyle } from "./ember-style.js";
import { SmokeringStyle } from "./smokering-style.js";
import { PhysarumStyle } from "./physarum-style.js";
import { CurlStyle } from "./curl-style.js";
import { AuroraStyle } from "./aurora-style.js";
import { FluidStyle } from "./fluid-style.js";
// Tendrils is parked at v1.5.0-alpha6 pending a fix to the trail-lines
// alpha/blend path. Two structural bugs were resolved (setSurface no-op,
// TRIANGLES→TRIANGLE_STRIP for the 4-vert fullscreen quad) but the ink
// strokes still don't accumulate visibly. Kept in the repo so the next
// session can pick up mid-diagnosis; not registered so it doesn't ship.
// import { TendrilsStyle } from "./tendrils-style.js";

// Registration order = gallery display order.
StyleRegistry.register(CurrentStyle);
StyleRegistry.register(HaloStyle);
StyleRegistry.register(SkyspaceStyle);
StyleRegistry.register(ApertureStyle);
StyleRegistry.register(ChapelStyle);
StyleRegistry.register(FilamentStyle);
StyleRegistry.register(NervesStyle);
StyleRegistry.register(DriftStyle);
StyleRegistry.register(ThresholdStyle);
StyleRegistry.register(EmberStyle);
StyleRegistry.register(SmokeringStyle);
StyleRegistry.register(PhysarumStyle);
StyleRegistry.register(CurlStyle);
StyleRegistry.register(AuroraStyle);
StyleRegistry.register(FluidStyle);
// StyleRegistry.register(TendrilsStyle);  // parked — see comment on import

export {
  StyleRegistry, detectWebGPU,
  CurrentStyle, HaloStyle, SkyspaceStyle, ApertureStyle, ChapelStyle,
  FilamentStyle, NervesStyle, DriftStyle, ThresholdStyle, EmberStyle, SmokeringStyle,
  PhysarumStyle, CurlStyle, AuroraStyle, FluidStyle,
};
