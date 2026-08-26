# src/debug

An on-device debug overlay and a synthetic session-data preset, both gated behind URL flags so they add zero footprint in normal operation.

## Files

| File                  | Exports                              | Purpose                                              |
|------------------------|-----------------------------------------|---------------------------------------------------------|
| `debug-overlay.js`    | `dbg`, `isDebugOn`, `mountDebugOverlay` | Floating log pill + full-screen log viewer            |
| `seed-long-trail.js`  | `buildLongTrail`, `seedLongTrail`      | Synthetic multi-emotion sample trail for screenshots and demos |

## Enabling the overlay: `?debug=1`

The overlay is off by default. Append `?debug=1` to the app URL to turn it on, for example:

```
https://empathic-art.pplx.app/?debug=1
```

`mountDebugOverlay()` is called unconditionally from [`src/app.js`](../../ARCHITECTURE.md) at boot, but it checks `isDebugOn()` internally and does nothing if the flag is absent, so leaving the call in place has no effect on a production URL with no query string.

`isDebugOn()` simply reads the flag:

```js
export function isDebugOn() {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}
```

When the flag is present, `mountDebugOverlay()`:

- Renders a floating pill button labeled `DEBUG · <count>` fixed to the bottom-left of the screen (bottom-left specifically so it never overlaps the view switcher, which is fixed bottom-right at all breakpoints). The pill's background turns amber if any warnings have been logged and red if any errors have been logged, so a problem is visible without opening the log.
- Renders a full-screen log sheet (hidden until the pill is tapped) with a monospace scrolling log body and three action buttons: **COPY LOG**, **SHARE**, and **CLR**.
- Wraps `console.log`, `console.warn`, and `console.error` so every call to them is mirrored into the debug log automatically, in addition to still reaching the real browser console.
- Adds `window` listeners for `error` and `unhandledrejection`, so uncaught exceptions and unhandled promise rejections are captured into the log even if nothing in the app explicitly logs them.

**Log buffer:** capped at `MAX_LINES = 400` entries as a ring buffer, once full, the oldest entry is dropped as each new one is pushed, so the overlay cannot grow without bound during a long-running session.

**COPY LOG** builds a plain-text report (timestamp, page URL, user agent, then every buffered line) and writes it to the clipboard via the Clipboard API. If that API is unavailable, it falls back to inserting a selected, focused `<textarea>` with the same text so the user can long-press to copy manually.

**SHARE** uses the Web Share API, attempting to share the log as a downloadable `.txt` file first (supported on iOS 15+), falling back to a plain text share, and finally falling back to `copyLog()` if the Share API is not available at all.

**CLR** empties the in-memory buffer and the visible log body immediately.

### `dbg(level, ...args)`

```js
export function dbg(level, ...args)
```

The logging primitive used throughout the codebase (most heavily in `app.js`, but also in [`src/audio`](../audio/README.md), [`src/ui`](../ui/README.md), and [`src/after`](../after/README.md)) instead of calling `console.*` directly. `level` is one of `"log"`, `"warn"`, `"error"`, or `"ok"`, `"ok"` is a success/confirmation level with its own color, used for state transitions worth confirming (audio primed, playback started, and similar). Arguments are stringified (objects via `JSON.stringify`, everything else via `String()`) and joined with spaces, then appended to the ring buffer and, if the overlay is mounted, rendered as a new log row immediately.

Because `dbg()` is a normal function that no-ops safely when the overlay is not mounted (it always writes to the internal buffer regardless, but only paints a DOM row when `logEl` exists), it is safe to call from any module unconditionally, there is no need to guard call sites with `isDebugOn()` checks.

## Seeding a synthetic session: `?debug=1&preset=long-trail`

Add `&preset=long-trail` alongside `?debug=1` to seed a synthetic multi-emotion trail, useful for screenshots and demos without waiting out a real ten-minute session:

```
https://empathic-art.pplx.app/?debug=1&preset=long-trail
```

Inside `mountDebugOverlay()`, once the overlay itself has mounted, the code reads the `preset` query parameter and, if it equals `"long-trail"`, lazy-imports `seed-long-trail.js` and calls `seedLongTrail()`:

```js
const preset = new URLSearchParams(window.location.search).get("preset");
if (preset === "long-trail") {
  import("./seed-long-trail.js")
    .then((mod) => mod.seedLongTrail())
    .catch((err) => dbg("error", "seed-long-trail failed:", err && err.message));
}
```

The import is dynamic (lazy) specifically so this preset module, and the twelve-emotion path data it needs from `emotion-palette.js`, is never fetched or parsed on a production URL that doesn't request it.

### `buildLongTrail(totalMs = 600000)`

```js
export function buildLongTrail(totalMs = 10 * 60 * 1000)
```

Builds and returns an array of 5000 synthetic samples, each shaped exactly like a real session sample, `{ t, v, a, o, label, hex }`, matching [`SessionStore`'s documented sample shape](../store/README.md) and the frame fields produced by [`src/muse/muse-source.js`](../muse/README.md) during a live session.

The trail walks twelve named emotion anchors in this fixed order:

```
Fear -> Anger -> Awe -> Elation -> Joy -> Excitement -> Love ->
Peace -> Serenity -> Sadness -> Melancholy -> Apathy
```

Each of the eleven legs between anchors is eased with `easeInOutSine` from the departing anchor's `(v, a)` coordinates to the arriving anchor's, with a small sinusoidal jitter added to `v` and `a` so the path does not look like a mechanical straight-line interpolation. `label`/`hex` snap to the departing anchor for the first half of each leg and the arriving anchor for the second half, mirroring the nearest-anchor snapping used during a real live session. `t` values are spaced evenly across `totalMs` (defaulting to ten minutes) so the resulting trail can be scrubbed exactly like a recorded session in [`summary-playback.js`](../after/README.md).

### `seedLongTrail()`, and the TODO that matters for integrators

```js
export function seedLongTrail() {
  const samples = buildLongTrail();
  console.info(`[debug] seed-long-trail: generated ${samples.length} samples ...`);
  return samples;
}
```

**This function only logs.** It builds the 5000-sample array and prints a confirmation to the console (visible in the debug log if the overlay is on), then returns the array, it does not write anything into `SessionStore`, and no session appears in the after-session gallery just from loading `?debug=1&preset=long-trail`. The source contains an explicit TODO documenting this gap and the exact wiring needed to close it:

```js
/**
 * TODO: wire into SessionStore.commitSession({ samples, crossings,
 * dominantEmotion }) — see src/store/session-store.js for the sample
 * shape. SessionStore currently exposes no public method for injecting
 * samples into an in-progress session; commitSession() only accepts a
 * finished session's full sample array. Until that hook exists, this
 * function only builds and returns the synthetic array so callers
 * (or a future debug-overlay wiring) can pass it into commitSession()
 * directly, e.g.:
 *
 *   const samples = buildLongTrail();
 *   sessionStore.commitSession({
 *     samples,
 *     crossings: [],
 *     dominantEmotion: { name: samples[samples.length - 1].label,
 *                        hex: samples[samples.length - 1].hex },
 *   });
 */
```

To make `?debug=1&preset=long-trail` actually produce a browsable session in the gallery, an integrator needs to either:

1. Call the snippet above directly from `debug-overlay.js`'s existing `.then((mod) => mod.seedLongTrail())` chain, replacing it with a call that also has access to the live `sessionStore` instance from `app.js` (the overlay module does not currently import the store, so this requires either passing the store instance into `mountDebugOverlay()` or importing `session-store.js` directly inside `seed-long-trail.js` and constructing/reusing a store reference there), or
2. Call `buildLongTrail()` from application code that already holds a `SessionStore` instance (for example, a temporary debug-only button wired in `app.js`) and pass its result into `commitSession(...)` exactly as shown in the TODO.

Either approach is a small, well-scoped change, the sample shape, the anchor path, and the exact `commitSession` call signature are already fully specified by the code above; the only missing piece is a live reference to the `SessionStore` instance at the point the preset is detected.

### Depends on

`buildLongTrail` imports `EMOTIONS` from [`src/palette/emotion-palette.js`](../palette/README.md) to resolve each anchor name to its `(v, a)` coordinates and `hex` color.

### Consumed by

[`src/app.js`](../../ARCHITECTURE.md) calls `mountDebugOverlay()` once at boot and imports `dbg` for diagnostic logging throughout the session lifecycle (audio priming, playback start, voice recording, and more). `debug-overlay.js`'s own preset-detection code lazy-imports `seed-long-trail.js`; no other module imports it directly.
