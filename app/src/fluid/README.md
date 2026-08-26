The fluid folder contains the WebGL2 stable-fluids simulation and renderer that turns an emotion signal into moving color.

## Files

| File | Purpose |
|---|---|
| `fluid-engine.js` | `FluidEngine` class, GPU simulation, emotion-driven parameters, and on-screen rendering. |
| `shaders/index.js` | Shader loader, fetches every `.glsl` file once at import time and re-exports each source as a string, so `FluidEngine` stays synchronous. |
| `shaders/fullscreen.vert.glsl` | Fullscreen pass-through vertex shader, shared by every fluid pipeline pass. |
| `shaders/advect.frag.glsl` | Semi-Lagrangian advection, traces each pixel back along the velocity field. |
| `shaders/splat.frag.glsl` | Additive gaussian splat for velocity impulses and paint deposition. |
| `shaders/divergence.frag.glsl` | Velocity divergence, right-hand side of the pressure Poisson equation. |
| `shaders/pressure.frag.glsl` | One Jacobi iteration of the pressure Poisson solver. |
| `shaders/gradient.frag.glsl` | Gradient subtraction / Helmholtz projection, enforces incompressibility. |
| `shaders/display.frag.glsl` | Final composite over the cream surface, with a soft radial vignette. |

GLSL files under `shaders/` are the canonical source of truth for every pipeline pass. Editing them requires no rebuild, they are fetched at runtime the first time `fluid-engine.js` is imported.

## Public API

```js
import { FluidEngine } from "./fluid-engine.js";

const fluid = new FluidEngine(canvasEl, {
  simRes: 128,
  dyeRes: 512,
  dt: 0.016,
  velDiss: 0.15,
  densityDiss: 0.4,
  pressureIterations: 20,
});

fluid.start();
fluid.setEmotion(valence, arousal, openness, label);
fluid.setSurface(r, g, b);
await fluid.crossfadeSurfaceTo({ r, g, b }, 1800);
fluid.audioBeat(rms, low, mid, high, centroid);
fluid.splat(x, y, dx, dy, color, 0.0015);
fluid.resize();
fluid.stop();
fluid.destroy();
```

| Method | Signature | Notes |
|---|---|---|
| `constructor` | `(canvas, opts = {})` | Requires a WebGL2 context with `EXT_color_buffer_float`. Throws if unsupported. |
| `resize` | `()` | Recomputes framebuffer sizes on canvas/container resize. Call on window resize. |
| `setEmotion` | `(valence, arousal, openness, label)` | Drives turbulence, force, and brightness curves for the current frame. Called once per emotion-signal tick. |
| `setSurface` | `(r, g, b)` | Sets the dye color instantly, no transition. |
| `crossfadeSurfaceTo` | `(target, durMs = 1800)` | Eases the dye color to `target` over `durMs`. Returns a Promise that resolves when the fade completes. Called when the nearest named emotion changes. |
| `audioBeat` | `(rms, low, mid, high, centroid)` | Feeds music/beat energy into the sim, independent of the emotion signal. Fed by `AudioReactive`. |
| `splat` | `(x, y, dx, dy, color, radius = 0.0015)` | Injects a manual force/color splat at a point, e.g. from a touch or voice amplitude. |
| `start` / `stop` | `()` | Starts/stops the internal render loop. |
| `destroy` | `()` | Releases GPU resources. Call when tearing down the canvas (e.g. leaving the session or summary screen). |

## Default configuration

| Option | Default | Effect |
|---|---|---|
| `simRes` | 128 | Simulation grid resolution. Lower = cheaper, blockier motion. |
| `dyeRes` | 512 | Visible dye/density resolution. Lower = cheaper, softer visuals, same underlying motion. |
| `dt` | 0.016 | Fixed simulation timestep. |
| `velDiss` | 0.15 | Velocity dissipation per step, higher settles motion faster. |
| `densityDiss` | 0.4 | Dye dissipation per step, higher fades color faster. |
| `pressureIterations` | 20 | Jacobi solver iteration count. Higher = more incompressible, more GPU cost. |

## Per-frame pipeline

Internally, `_frame()` runs each tick:

1. Automatic low-force ambient splat, roughly every 60ms, so the field is never fully still.
2. Advect velocity (`_runAdvect`).
3. Advect density/dye (`_runAdvect` with `densityDiss`).
4. Compute divergence (`_runDivergence`).
5. Solve pressure (`_runPressure`, `pressureIterations` Jacobi passes).
6. Subtract pressure gradient from velocity (`_runGradient`).
7. Composite to screen (`_runDisplay`).

## Depends on

- `src/palette/emotion-palette.js`, imports `emotionToColor` to translate `(valence, arousal, openness)` into the dye color used by `setEmotion`/`crossfadeSurfaceTo`.

## Consumed by

- `src/app.js`, the live session screen instantiates one `FluidEngine` bound to the main canvas.
- `src/after/summary-playback.js`, instantiates a second, independent `FluidEngine` bound to the replay canvas, so a session replay never shares GPU state with a live session.

## Notes for integrators

WebGL2 with `EXT_color_buffer_float` is a hard requirement, there is no WebGL1 or CPU fallback path. On older iPhone models or lower-end laptops, lowering `dyeRes` first (before `simRes`) is the cheapest way to recover frame budget, since it only affects render resolution rather than simulation fidelity. See [ARCHITECTURE.md](../../ARCHITECTURE.md#performance-notes) for more.

Author: Eyal Gever. Copyright (c) 2026 Eyal Gever. Code licensed under [MIT](../../LICENSE); generative visual output is covered separately by [ARTWORK-LICENSE.md](../../ARTWORK-LICENSE.md).
