The audio folder plays the session music, extracts real-time features for the fluid engine, and handles ducked voice-note playback.

## Files

| File | Purpose |
|---|---|
| `audio-reactive.js` | `AudioReactive` class, loads/plays the session track, exposes real-time loudness/band/centroid features, and provides gain-ducking for voice notes. |
| `gallery-voice.js` | `playVoiceNote(url, audioReactive, opts)`, plays back a single recorded voice note while ducking the music, with a clean restore. |

## Public API, AudioReactive

```js
import { AudioReactive } from "./audio-reactive.js";

const ar = new AudioReactive();
ar.prime(url);                 // call inside a user-gesture handler, before playback
await ar.decodeBuffer(url);    // WebAudio buffer path (reliable on iOS Safari)
ar.playBuffer?.();             // starts the decoded buffer (see source for exact trigger points)
ar.setLoop(true, 4000);        // seamless loop, 4s crossfade
ar.duckTo(0.3, 500);           // fade music to 30% over 500ms
ar.duckTo(1.0, 500);           // restore
const unsubscribe = ar.onFrame(features => { /* rms, low, mid, high, centroid */ });
ar.once("ended", () => { /* ... */ });
const state = ar.getState();
ar.setBaseGain(1.0);
ar.pause();
ar.stop();
ar.destroy();
```

| Method | Notes |
|---|---|
| `prime(url)` | Must be called synchronously inside a user-gesture handler (a click/tap) so iOS Safari and Chrome's autoplay policy allow later playback. Creates and mounts a real `<audio>` element to the DOM, an unmounted `new Audio()` is placed on iOS's muted "ambient" route. |
| `decodeBuffer(url)` | Decodes the track into an `AudioBuffer` for the WebAudio buffer-source playback path, the reliable path on iOS Safari, where `<audio>.play()` from a delayed callback fails silently on iOS 14+. |
| `stopBuffer()` / `_stopBufferSource()` | Stop the active `AudioBufferSourceNode`. |
| `setLoop(enabled, crossfadeMs = 4000)` | Seamlessly loops the track past its natural end for sessions longer than the track duration. |
| `duckTo(target, durMs = 500)` | Ramps the master gain to `target` (0..1) over `durMs`. Used directly by `gallery-voice.js`. |
| `getState()` | Returns a snapshot of playback state. |
| `setBaseGain(v)` | Sets the gain level treated as "full volume" for ducking math (`_baseGain`). |
| `pause()` / `stop()` / `destroy()` | Standard lifecycle teardown; `destroy()` releases the AudioContext. |
| `onFrame(cb)` | Fires on every analysis frame with `{ rms, low, mid, high, centroid }`, each normalized to `[0, 1]`. Returns an unsubscribe function. |
| `once(evt, cb)` | One-shot event subscription (e.g. `"ended"`). |

Feature meanings (from the file header):

| Feature | Range | Drives |
|---|---|---|
| `rms` | 0..1 | Overall loudness → splat force |
| `low` (20-160 Hz) | 0..1 | Curl amplitude, background pulse |
| `mid` (160-1600 Hz) | 0..1 | Mid-scale particle motion |
| `high` (1600-8000 Hz) | 0..1 | Sparkle / small-scale detail |
| `centroid` | 0..1 | Spectral centroid → hue temperature nudge |

Analysis uses a 1024-sample FFT (`FFT_SIZE = 1024`) with `SMOOTHING = 0.75`.

## Two playback paths, and why both exist

`AudioReactive` maintains two entirely separate playback mechanisms:

1. **`<audio>` element path** (`prime()`, `load()`, `play()`), used for straightforward playback. On iOS Safari, CORS/redirect handling can leave the analyser receiving no real signal even though the element reports `playing`; when that happens, the engine runs a **synthetic mode**, emitting plausible fabricated `rms/low/mid/high/centroid` values so the fluid still looks reactive to music rather than going flat.
2. **WebAudio buffer path** (`decodeBuffer()` / buffer-source start), decodes the full track into an `AudioBuffer` ahead of time (typically during the "Start Experience" click) and starts playback later from a gesture-free callback (e.g. countdown reaching zero). This path gives real analyser data reliably on iOS, because `AudioBufferSourceNode` playback survives the gap between the originating gesture and the later trigger in a way `<audio>.play()` does not on iOS 14+.

Additional iOS-specific methods referenced in the source comments and used internally for audio-routing recovery include `ensureResumed()`, `kickAudioElement()`, and `restartAudioRoute()`, these exist specifically to work around iOS Safari's audio session quirks and are not part of the everyday call surface; most integrations only need `prime`, `decodeBuffer`/playback trigger, `onFrame`, `duckTo`, and `destroy`.

## Public API, gallery-voice.js

```js
import { playVoiceNote } from "./gallery-voice.js";

const { stop, ended } = playVoiceNote(blobUrl, audioReactive, { duckLevel: 0.30, duckMs: 400 });
await ended;   // resolves when the note finishes, errors, or stop() is called
```

`playVoiceNote(url, audioReactive, opts)`:

1. Ducks `audioReactive`'s gain to `opts.duckLevel` (default 0.30) over `opts.duckMs` (default 400ms) via `AudioReactive.duckTo()`.
2. Plays the voice-note through a fresh, separate `<audio>` element, never through the analyser/reactive graph, so voice playback does not perturb the fluid's music-reactive features.
3. On `ended`, `error`, or an explicit `stop()`, restores gain to 1.0 over the same fade duration, then defensively snaps the gain to `audioReactive._baseGain` shortly after, as a safety net against a stale ramp leaving the music at the ducked level.

Pass `audioReactive: null` to play a voice note at full volume with no ducking (used when the gallery has no active music engine).

Voice-note blob URLs come from `VoiceRecorder` and are session-scoped; see [src/voice/README.md](../voice/README.md). This module does not create or revoke blob URLs itself.

## Depends on

- `gallery-voice.js` depends on the `AudioReactive` instance passed to it (typed via JSDoc import), but has no static import of `audio-reactive.js`, it only touches the object shape (`duckTo`, `_baseGain`, `_gain`, `_audioEl`) at runtime.
- Neither file in this folder imports from `src/palette/` or `src/muse/`.

## Consumed by

- `src/app.js`, owns the single live `AudioReactive` instance for the session screen and calls `FluidEngine.audioBeat(...)` from its `onFrame` callback.
- `src/after/summary-playback.js`, uses `playVoiceNote` for replaying pinned voice notes, and creates its own fresh `<audio>` element for the session-track replay rather than reusing the live `AudioReactive`.

Author: Eyal Gever. Copyright (c) 2026 Eyal Gever. Code licensed under [MIT](../../LICENSE). The bundled track `assets/sound-journey.mp3` is covered by [ARTWORK-LICENSE.md](../../ARTWORK-LICENSE.md), not MIT.
