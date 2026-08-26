# src/after

The post-session gallery: a scrollable ribbon timeline of past sessions, and a full replay of any single session's fluid, circumplex trail, brainwaves, and voice notes.

## Files

| File                    | Exports                              | Purpose                                            |
|--------------------------|----------------------------------------|------------------------------------------------------|
| `session-history.js`    | `computeDominant`, `mountAfterView`   | Ribbon timeline gallery of completed sessions        |
| `summary-playback.js`   | `mountSummaryPlayback`                | Full replay of a single completed session            |

## session-history.js

Renders every completed session (from [`SessionStore.history`](../store/README.md)) as a vertical ribbon of thin colored lines, one ribbon segment per sample, so the overall emotional shape of a session is visible at a glance before opening it.

**Public API:**

```js
computeDominant(samples)
mountAfterView({ container, sessions, onOpen })
```

- `computeDominant(samples)`, given a session's `samples` array (each `{ t, v, a, o, label, hex }`, see [`SessionStore` record shape](../store/README.md)), returns the emotion that appears most often by sample count. Used both when building a ribbon's summary color and as a fallback if a session record has no `dominantEmotion` already attached.
- `mountAfterView({ container, sessions, onOpen })`, renders the gallery into `container`. `sessions` is the array from `store.history`. `onOpen(session)` is called when the user selects a session, and is expected to route to the summary/replay screen for that record.

**Ribbon rendering:**

Each session becomes one ribbon: a horizontal strip of adjacent colored lines, one per sample, colored with that sample's `hex`. Line width is computed from the current zoom level and the number of samples so ribbons stay readable whether a session had a hundred samples or several thousand:

- `RIBBON_GAP = 2`, pixel gap between adjacent lines.
- `MIN_LINE_PX = 3`, minimum line width, enforced at the "fit" zoom level so very long sessions do not shrink to invisible slivers.
- `MAX_LINE_PX = 18`, maximum line width, enforced at the highest zoom level so short sessions do not stretch into blocky bars.

**Zoom and navigation:**

- `ZOOM_LADDER = ["fit", 2, 4, 8]`, four discrete zoom steps. `"fit"` computes a line width that fits the whole session into the visible width; `2`, `4`, and `8` are explicit multipliers over the fit width, each clamped to the `MIN_LINE_PX`/`MAX_LINE_PX` range.
- Mouse drag pans the timeline horizontally.
- Mouse wheel combined with Ctrl or Cmd zooms in and out, stepping through `ZOOM_LADDER` anchored at the cursor position.
- Touch pinch gestures zoom the same way on touch devices.
- Axis ticks are drawn at month boundaries along the timeline so a gallery accumulating months of sessions still has a readable time axis.

### Depends on

`EMOTIONS` from [`src/palette/emotion-palette.js`](../palette/README.md), used to resolve emotion names to colors when a sample or record does not already carry a `hex`.

### Consumed by

[`src/app.js`](../../ARCHITECTURE.md) imports both `mountAfterView` and `computeDominant` to render the gallery screen from `store.history`.

## summary-playback.js

Replays one completed session record in full: the fluid simulation seeded from the recorded samples, the emotion circumplex trail, brainwave lanes (when the session recorded live or simulated Muse data), and voice notes, synchronized to a scrub bar.

**Public API:**

```js
mountSummaryPlayback({ session, container, audio, audioSrc })
```

Mounts the replay into `container` for the given `session` record (the same shape returned by [`SessionStore.commitSession()`](../store/README.md)). `audio` is an optional shared audio-context handle; `audioSrc` is the URL of the music track to replay under the session. Returns a `destroy()` function that the caller must invoke when leaving the screen, it stops playback, releases the dedicated `<audio>` element, and stops any voice note that is still playing.

**Two synchronized clocks:**

Playback creates its own dedicated `<audio>` element (`new Audio(audioSrc)`) rather than reusing the shared [`AudioReactive`](../audio/README.md) instance used during a live session, the live instance is tied to the microphone-reactive visualization pipeline, while summary playback only needs a plain, seekable audio element to scrub against.

If that audio element fails to load or the browser blocks autoplay, playback falls back to a synthetic clock (`fallbackStartMs` / `fallbackAccMs`, driven by `performance.now()`) so the replay still advances in real time even with no audible track. The scrub bar, fluid seeding, and circumplex trail all read from whichever clock is authoritative at that moment, so a session recorded over ten minutes replays over ten minutes regardless of whether audio is available.

**Scrub bar:**

Dragging the scrub bar seeks both clocks: it sets the fallback accumulator directly and, if the audio element is present, seeks its `currentTime` to match, so scrubbing feels like a normal media player even when audio silently fails behind the scenes.

**Voice notes:**

Recorded voice notes are shown as dots along the scrub bar at their recorded timestamp, plus clickable pills below the bar. Selecting one plays it back via [`playVoiceNote`](../audio/README.md), ducking the music track for its duration the same way live playback does.

### Depends on

| Module                                            | Used for                                                      |
|-----------------------------------------------------|------------------------------------------------------------------|
| [`FluidEngine`](../fluid/README.md)                | Re-seeding and rendering the fluid canvas during replay          |
| [`mountMuseVis`](../muse/README.md)                | Redrawing the emotion circumplex trail from recorded samples      |
| [`mountBrainWaves`](../muse/README.md)             | Redrawing brainwave band lanes when the session recorded live Muse data |
| [`playVoiceNote`](../audio/README.md)              | Playing back recorded voice notes with music ducking              |
| [`emotionToLabel`](../palette/README.md)           | Resolving sample valence/arousal back to a display label          |
| `dbg` from [`src/debug/debug-overlay.js`](../debug/README.md) | Diagnostic logging when the debug overlay is on         |

### Consumed by

[`src/app.js`](../../ARCHITECTURE.md) imports `mountSummaryPlayback` and calls it when the user opens a session from the gallery (via `session-history.js`'s `onOpen` callback) or immediately after a live session ends, using the record returned by `SessionStore.commitSession()`.
