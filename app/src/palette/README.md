The palette folder holds the single source of truth for the emotion-to-color and emotion-to-label mapping used across the entire app.

## Files

| File | Purpose |
|---|---|
| `emotion-palette.js` | The 19-anchor emotion lexicon and the functions that map `(valence, arousal, openness)` to a color, a label, or a full emotion record. |
| `color-legibility.js` | Single helper `liftForLegibility(hex)` that lifts an emotion hex into a lighter, more saturated variant which stays readable when the label sits directly on top of the fluid painting of that same emotion. Hue is preserved so the label still reads chromatically as the emotion. Used by the Session Replay reveal in `src/after/summary-playback.js`. Lives in its own leaf module to avoid a circular import back into `src/app.js`. |

## The model

```
valence  ∈ [-1, +1]    -1 = Negative        +1 = Positive
arousal  ∈ [-1, +1]    -1 = Tired           +1 = Energized
openness ∈ [ 0,  1]     0 = Closed           1 = Open
```

Nineteen named anchor emotions are placed around the circumplex by angle (0° = positive-valence axis, counterclockwise): Love, Excitement, Joy, Elation, Awe, Surprise, Fear, Anger, Stress, Anxiety, Despair, Sadness, Melancholy, Apathy, Boredom, Contemplation, Serenity, Calm, Peace. Each `EMOTIONS` entry is:

```js
{ name, hex, angle, comp, mood, v, a, rgb }
```

`v` and `a` are derived automatically from `angle` (`v = cos(angle)`, `a = sin(angle)`) at module load, do not hand-edit `v`/`a` independently of `angle`, they will disagree. `rgb` is derived from `hex` the same way. `comp` (`"veils" | "verticals" | "quadrants" | "multiform" | "nightfall"`) and `mood` (`"hot" | "warm" | "cool" | "deep" | "dark" | "calm"`) are descriptive metadata not consumed by the color math itself.

## Design intent

The file header states three explicit rules, preserved from the artist's earlier v2 lexicon work:

1. Never blend toward cream or neutral gray, flat blending toward a neutral color was found to kill visual vibrance in an earlier version.
2. Resolve the current `(v, a)` point to the nearest anchor emotion by circumplex angle, and use that anchor's saturated hex as the dominant color.
3. Openness only nudges lightness by up to about 14%, blending toward near-white when open and near-black when closed, it never overrides the anchor hue.
4. A weak blend toward the second-nearest anchor (capped at 55% of the angular blend factor) keeps transitions continuous rather than causing a visible hue snap as the user's state crosses between two anchors.

## Public API

```js
import { EMOTIONS, nearestEmotions, emotionToColor, emotionToLabel, emotionAt } from "./emotion-palette.js";

const { primary, secondary, tPrimary, mag } = nearestEmotions(valence, arousal);
const { r, g, b, hex, rgba } = emotionToColor(valence, arousal, openness);
const label = emotionToLabel(valence, arousal);   // e.g. "Serenity"
const record = emotionAt(valence, arousal);        // full Emotion object for the nearest anchor
```

| Export | Signature | Returns |
|---|---|---|
| `EMOTIONS` | array constant | All 19 emotion records, angle-sorted. |
| `nearestEmotions` | `(valence, arousal)` | `{ primary, secondary, tPrimary, mag }`, the two closest anchors by angular distance, blend weight, and point magnitude. |
| `emotionToColor` | `(valence, arousal, openness = 0.5)` | `{ r, g, b, hex, rgba }`, the final rendered color for the fluid dye. |
| `emotionToLabel` | `(valence, arousal)` | The nearest anchor's `name` string. |
| `emotionAt` | `(valence, arousal)` | The full nearest anchor `Emotion` record (name, hex, angle, comp, mood, v, a, rgb). |

Points near the circumplex center (`mag < 0.25`, i.e. low-intensity, ambiguous emotional signal) are not washed toward a neutral color, they are given a slightly darkened version of the same blended anchor color, described in the source as a deliberate "quiet" feel rather than desaturation.

## Adaptive ink over the fluid canvas

Session Replay and Zen Mode paint titles, meta text, the narrative, timeline label, NEW SESSION label, whisper sentence, and the legal mark directly on top of the live fluid surface. That surface can be bright cream on one emotion and near-black on the next, so a single fixed text color is not readable across the palette. The v1.6.3 overlay layer (`src/ui/v163-layer.js` + `styles/v163.css`) drives a per-element adaptive-ink system that keeps every one of those slots legible regardless of what colour the fluid is painting behind them:

1. A 16 x 16 offscreen 2D probe samples the fluid canvas at 10 Hz beneath each tracked DOM element's bounding rect (drawImage from the fluid front buffer, so it works with any WebGL preserveDrawingBuffer setting and never touches the fluid engine).
2. Per region it computes the 60th-percentile Rec.709 luminance of the sampled pixels, then picks whichever of the two ink poles gives higher WCAG contrast: `INK_LIGHT` (`#FBF6EC` warm cream) or `INK_DARK` (`#0A0806` near-black warm).
3. The chosen ink is EMA-smoothed with alpha 0.22 (a roughly 500 ms glide time constant) and written to per-slot CSS variables (`--v163-ink-title`, `--v163-ink-meta`, `--v163-ink-narrative`, `--v163-ink-legal`, etc.). CSS crossfades over 250 ms so the ink never snaps mid-frame.
4. A hair-thin `-webkit-text-stroke` in the opposite pole is painted around each glyph as per-pixel insurance from the anti-interference literature. A one-pixel dark rim around cream text (or cream rim around dark text) keeps letterform edges crisp against high-frequency background detail without producing a soft halo.
5. For the rare grey dead zone where neither cream nor near-black clear a 4.5:1 ratio, a WCAG-gated `mix-blend-mode: difference` fallback is applied to that slot only, so the label still separates from the background at the cost of a slight chromatic shift.

Slots tracked: `eyebrow`, `title`, `meta`, `narrative`, `timeline`, `newsession`, `whisper`, `legal`. The legal (copyright) mark uses this same adaptive treatment in Replay and Zen, and switches to a pinned cream-on-dark treatment when the Emotion Map panel is open (the fluid is occluded by the panel, so sampling is skipped).

This system is a strictly additive overlay layer. It never modifies `src/app.js`, the fluid engine, the audio pipeline, the Muse stream, the palette module, the voice recorder, or the session store. All coordination happens by reading body-level data attributes (`data-v163-entropy`, `data-v163-recording`, `data-v163-replay`, `data-v163-zen`, `data-v163-zen-text`) and writing per-slot CSS variables. See the block comment at line 322 of `src/ui/v163-layer.js` for the full implementation and history (v1.6.3.13 introduced the global version, v1.6.3.15 split it per element, v1.6.3.17 extended it to the legal mark).

## Depends on

Nothing internal, this module has zero imports from elsewhere in the repository. It is a leaf module by design.

## Consumed by

`emotion-palette.js` is the most widely depended-on module in the codebase:

- `src/fluid/fluid-engine.js`, `emotionToColor` drives the fluid dye color.
- `src/muse/muse-source.js`, `EMOTIONS`, `nearestEmotions` build and step through the simulated journey.
- `src/muse/muse-vis.js`, `EMOTIONS`, `emotionToColor`, `emotionToLabel` render the circumplex wheel and trail.
- `src/after/session-history.js`, `EMOTIONS` resolves a session's dominant emotion name back to its display hex for the ribbon timeline.
- `src/after/summary-playback.js`, `emotionToLabel` re-labels replayed samples.
- `src/debug/seed-long-trail.js`, `EMOTIONS` supplies the twelve named anchors the synthetic long-trail preset walks through.
- `src/app.js`, imports `emotionToColor`, `emotionToLabel`, `EMOTIONS` directly for the live session pipeline.

## Notes for integrators

To rebrand the palette for an iPhone app or web build, edit the `hex` field of each `EMOTIONS` entry, do not rename the array or any exported function, since the six call sites above import them by exact name. See [INTEGRATION.md](../../INTEGRATION.md#custom-emotion-palette) for the full walkthrough.

Author: Eyal Gever. Copyright (c) 2026 Eyal Gever. Code licensed under [MIT](../../LICENSE). The emotion-palette color system itself is explicitly named as a covered asset in [ARTWORK-LICENSE.md](../../ARTWORK-LICENSE.md), recoloring it for your own brand is permitted per that license's "Permitted Uses" section, but the original artist-signed hex values are all rights reserved.
