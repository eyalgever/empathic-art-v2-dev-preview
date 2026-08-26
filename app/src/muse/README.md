The muse folder holds the app's single emotion-signal source and its two visualizers, the circumplex trail and the synthetic EEG band display.

## Why this folder is named `muse/`

The folder is named after the Muse EEG headband product line because that is the target device for a live biometric feed, and the codebase's naming, comments, and UI copy ("Connect Muse") reflect that design intent. `MuseSource` still runs a scripted simulated journey by default; it now also has a working Web Bluetooth path to real Muse hardware (see below). Treat "Muse" here as "the emotion-signal subsystem" — the simulated path has no device dependency at all, and the live path speaks the Muse GATT protocol in-tree rather than depending on Interaxon's SDK.

## Files

| File | Purpose |
|---|---|
| `muse-source.js` | `MuseSource` class, the single source of `(valence, arousal, openness)` frames, simulated or live. |
| `muse-vis.js` | `mountMuseVis(svgEl)`, renders the 19-emotion labeled circumplex wheel with a persistent trail and an animated position puck. |
| `muse-brainwaves.js` | `mountBrainWaves(canvas)`, renders five EEG band lanes (Delta, Theta, Alpha, Beta, Gamma). Uses real band powers when a headband is connected, and a stylized synthetic approximation derived from `(v, a, o)` otherwise. |
| `muse-ble.js` | `MuseClient` + `requestMuseDevice()`, the Web Bluetooth transport. Speaks the Muse GATT protocol directly (no `muse-js`, no `rxjs`, no build step). |
| `muse-bands.js` | `BandAnalyser`, turns raw µV samples into per-channel and aggregate band powers, with signal quality and 1/f background correction. |
| `muse-live-adapter.js` | `MuseLiveAdapter`, maps band powers to `(valence, arousal, openness)` and implements the `registerLiveAdapter` contract. |
| `muse-quality-dots.js` | `mountQualityDots(el)`, four dots showing per-electrode contact (green / amber / red / grey). |

## The live path

```
Muse headband
  → muse-ble.js       decode 12-bit EEG, 4 channels @ 256 Hz
  → muse-bands.js     Hann-DFT band powers, quality weighting, 1/f correction  (~2 Hz)
  → muse-live-adapter.js  band powers → (v, a, o), z-scored against the user  (~30 Hz)
  → muse-source.js    the same frames the simulated journey emits
  → everything downstream, unchanged
```

Three things are worth knowing before you tune any of it:

**The 1/f correction is not optional.** Raw EEG power falls off roughly as 1/f, so without dividing each band by its modelled background, delta and theta swamp everything and the numbers track electrode impedance more than the person. `muse-bands.js` fits `log₁₀(P) = a + b·log₁₀(f)` over the theta–gamma centre frequencies, refits every ~5 s, and emits nothing until the model has converged (~15 s). Delta is computed and displayed but deliberately excluded from the normalised sum: it is large and movement-prone.

**The mapping is calibrated per user, not absolute.** Skull thickness, hair, and electrode wetness move absolute band powers more than mood does, so every metric is z-scored against a running EMA baseline of that user in that session and squashed through `tanh`. What reaches the canvas is the person's movement relative to their own baseline. The `MIN_SPREAD_*` floors in `muse-live-adapter.js` stop a very steady user's shrinking variance from amplifying noise into full-scale swings.

**The three metrics.** Valence is frontal alpha asymmetry, `ln(alpha_AF8) − ln(alpha_AF7)` — alpha is inversely related to cortical activation, and relatively greater left-frontal activation is the established correlate of approach/positive affect. Arousal is `ln(beta / (alpha + theta))`, the classic engagement ratio. Openness is the alpha+theta share of relative power. This is an expressive mapping for an artwork, not a clinical measure: the honest claim is that the painting responds to your brain activity, not that it knows how you feel.

Browser support: Web Bluetooth is Chrome/Edge desktop and Chrome on Android. It does not exist in iOS Safari or WKWebView — on the iPhone build the CoreBluetooth bridge registers its own adapter and `muse-ble.js` is unused. `isWebBluetoothAvailable()` is exported so the UI can tell the difference.

### GATT identifiers

Verified by enumerating a Muse S: the `0000fe8d` service exposes exactly 18 characteristics, `273e0001`–`273e0012`, all sharing the base `4c4d-454d-96be-f03bac821358`. `muse-ble.js` builds every UUID from that one constant rather than listing them literally, so a transcription slip cannot affect a single characteristic in isolation. If a future headband revision uses a different base, that constant is the only thing to change.

Beware that Web Bluetooth reports a dismissed device picker as `NotFoundError` — the same error name `getPrimaryService()` uses for an unresolvable service. Treating them alike makes a genuine hardware failure look like a user cancelling, and fail completely silently. `requestMuseDevice()` therefore throws a distinct `MusePickerCancelled` for the dismissal case, and that is the only error the UI is allowed to swallow.

### Reading the signal while developing

A connected headband logs one line per second to the console. It is on by default in this build; silence it with `__EA__.museAdapter.debug = false`, or set `.debug = true` on any adapter instance.

```
[muse] v  0.21  a -0.34  o 0.69 | θ 0.36  α 0.20  β 0.19  γ 0.25 | δ 0.99 | TP9 ok  AF7 ok  AF8 ~  TP10 xx | 80%
       valence held (need AF7+AF8 contact) · only 2/4 electrodes good — reseat/re-wet
```

Left to right: the emitted `(v, a, o)`, the four normalised band powers, delta on its own (it is excluded from the sum), per-electrode contact, and battery. The second line only appears when something needs attention.

**Read the contact markers before believing the numbers.** A headband sitting on a desk still produces a confident-looking `v -0.92`; it is measuring movement and muscle activity, and the giveaway is gamma and beta dominant with delta pinned near 1.0. The same information is in the UI as four dots (`mountQualityDots`), on the Active-screen card and beside the Emotion Map panel's eyebrow.

Two contact caveats worth knowing:

- Valence needs **both** AF7 and AF8. If either is dropped, valence holds its previous value rather than falling to zero — a frozen number, not an obviously broken one. The log says so explicitly.
- One good electrode outweighs three bad ones. The analyser will happily aggregate from a single channel (weights `[0, 1, 0, 0]`), which is the right call but means "the signal looks plausible" does not imply "the headband fits well".

## The sample/frame shape as an interface

Every frame emitted by `MuseSource.subscribe(cb)` has exactly this shape:

```js
{ valence: number, arousal: number, openness: number, timestamp: number }
```

`valence` and `arousal` are in `[-1, 1]`; `openness` is in `[0, 1]`; `timestamp` is a `Date.now()`-style millisecond epoch. This shape is the contract the rest of the app is built against, `mountMuseVis().update(frame, label)`, `mountBrainWaves().setState({ v, a, o })` (note the shorter keys expected there), and `FluidEngine.setEmotion(valence, arousal, openness, label)` all consume frames matching or derived from this shape. Any adapter you register with `MuseSource.registerLiveAdapter()` must ultimately produce frames in this shape for the rest of the pipeline to work unmodified.

Live frames carry two optional extras, and nothing breaks if an adapter omits them:

```js
{ …, bands: { delta, theta, alpha, beta, gamma } | null, calibrating: boolean }
```

`bands` is aperiodic-normalised relative power — the four active bands sum to 1, delta is reported on the same scale but excluded from that sum. `mountBrainWaves()` draws it when present. `calibrating` is true while the adapter is still blending from the seed toward the live signal. Consumers that do not know about these fields ignore them, and `SessionStore` strips them when it normalises a frame into a persisted sample.

The nearest named emotion is not part of the frame. It is computed separately:

```js
import { emotionToLabel } from "../palette/emotion-palette.js";
const label = emotionToLabel(frame.valence, frame.arousal);
```

Once a frame is committed into session history (via `SessionStore.commitSession()`), it is normalized to the shorter, persisted shape `{ t, v, a, o, label, hex }`, see [src/store/README.md](../store/README.md).

## MuseSource public API

```js
import { MuseSource } from "./muse-source.js";

MuseSource.registerLiveAdapter(myAdapter);   // static, call once before connect("live")

const muse = new MuseSource();
muse.setSeed({ valence, arousal, openness });
muse.setDuration(trackDurationMs);
const unsubscribe = muse.subscribe(frame => { /* every tick */ });
const unsubscribeLabel = muse.onEmotionChange(label => { /* only on named-emotion change */ });
const current = muse.snapshot();
await muse.connect("sim");     // or "live"
muse.pause();
muse.resume();
muse.disconnect();
```

| Method | Notes |
|---|---|
| `static registerLiveAdapter(adapter)` | Registers the adapter used when `connect("live")` is called. Must be called before `connect("live")`. |
| `setSeed(seed)` | Seeds the simulated journey's starting point, normally the user's Before-screen circumplex placement. |
| `setDuration(ms)` | Sets the total simulated-journey duration, normally the chosen track's duration, so legs are timed to the music. |
| `subscribe(cb)` | Fires on every tick with a full frame. Returns an unsubscribe function. |
| `onEmotionChange(cb)` | Fires only when the nearest named emotion changes, with the new label. Returns an unsubscribe function. |
| `snapshot()` | Returns the current frame synchronously. |
| `connect(mode)` | Async. `mode` is `"sim"` or `"live"`. Starts frame emission. |
| `pause()` / `resume()` | Freezes/resumes emission without disconnecting. |
| `disconnect()` | Stops emission and tears down internal timers/adapters. |

## How to swap the EEG device

`MuseLiveAdapter` is one implementation of this contract; anything matching the shape below can replace it.

1. Write an adapter object that, once started, produces frames shaped `{ valence, arousal, openness, timestamp }` at a reasonable cadence (the simulated path ticks frequently enough for smooth fluid and circumplex motion, match that cadence, don't drop below a few frames per second). Two optional extras are honoured if present: an adapter may expose `setSeed(seed)` (called with the user's own circumplex placement before `start()`, useful if your signal needs a baseline to calibrate against), and frames may carry a `bands` object, which `mountBrainWaves()` will draw instead of its synthetic approximation.
2. Call `MuseSource.registerLiveAdapter(adapter)` once, before any session reaches the Active screen.
3. Route the Active screen's "Connect Muse" action to `museSource.connect("live")` instead of `"sim")`.
4. Everything downstream, `mountMuseVis()`, `mountBrainWaves()`, `FluidEngine`, and `SessionStore` sample recording, needs no changes, since all of it consumes `MuseSource.subscribe(cb)` output, not the adapter directly.

Full integration walkthrough: [INTEGRATION.md](../../INTEGRATION.md#wire-real-muse-hardware). On the iPhone native app this adapter is delivered by the Swift `MuseBridge` (CoreBluetooth); see the iOS section of INTEGRATION.md for the full bridge code.

## Simulated journey (`connect("sim")`)

`_buildJourney(seed, totalSeconds)` builds a scripted path through ten named legs, SEED, Contemplation, Sadness, Melancholy, Anger/Fear, Stress, Awe, Joy/Elation, Serenity, Peace, starting from `seed` and easing between each leg's anchor coordinates, timed to `totalSeconds` (normally the music track's duration).

## Visualizers

`mountMuseVis(svgEl)` returns `{ update(frame, label), destroy() }`. It renders all 19 named emotions on the circumplex ring, keeps a persistent trail of the user's path (capped at 12000 segments to bound redraw cost), and animates a "YOU" puck at the current position. It imports `showEmotionTip`/`hideTip` from `src/ui/tooltips.js` to show a bio-signature tooltip when an anchor emotion is tapped.

`mountBrainWaves(canvas)` returns `{ setState(frame), destroy() }`. It renders five 2D-canvas band lanes whose target amplitudes are derived from `(v, a, o)` per the formulas documented in the file header, this is a stylized, always-synthetic visualization, even when the underlying `MuseSource` is running in live mode. It does not read raw EEG band power from any device; treat it as an emotion-driven ambient readout, not a diagnostic EEG display.

## Depends on

- `src/palette/emotion-palette.js`, `EMOTIONS`, `nearestEmotions`, `emotionToColor`, `emotionToLabel`.
- `src/ui/tooltips.js`, `muse-vis.js` calls `showEmotionTip`/`hideTip` for anchor tooltips.

## Consumed by

- `src/app.js`, owns the one live `MuseSource`, `mountMuseVis`, and `mountBrainWaves` instances for the session screen.
- `src/after/summary-playback.js`, mounts its own `mountMuseVis`/`mountBrainWaves` instances to replay a stored session, entirely independent of the live instances.
- `src/debug/seed-long-trail.js`, imports `EMOTIONS` directly (not `MuseSource`) to build its synthetic trail through twelve named anchors.

Author: Eyal Gever. Copyright (c) 2026 Eyal Gever. Licensed under [MIT](../../LICENSE) (code); see [ARTWORK-LICENSE.md](../../ARTWORK-LICENSE.md) for the emotion-palette visual identity.
