The voice folder captures spoken voice notes during a session and helps users recover from denied microphone permission.

## Files

| File | Purpose |
|---|---|
| `voice-recorder.js` | `VoiceRecorder` class, mic capture, per-frame amplitude, and a guaranteed-clean stop/teardown. |
| `mic-help.js` | `showMicHelp()` / `hideMicHelp()`, a browser-aware help sheet shown when `getUserMedia()` is denied, plus `detectBrowserContext()` and `queryMicPermission()`. |

## Public API, VoiceRecorder

```js
import { VoiceRecorder } from "./voice-recorder.js";

const recorder = new VoiceRecorder();
const unsubscribe = recorder.onAmplitude(amp => { /* 0..1, per animation frame while recording */ });

await recorder.start();
// ... later
const result = await recorder.stop();
// result: { blob, url, mime, durationMs }  or  null if nothing was captured

recorder.revokeAll();   // call once at session end to free all blob URLs
```

| Member | Notes |
|---|---|
| `state` (getter) | `"idle"` \| `"recording"` \| `"stopping"`. |
| `elapsedMs` (getter) | Milliseconds since `start()`, `0` when not recording. |
| `onAmplitude(cb)` | Subscribes to per-frame amplitude (0..1), used to modulate fluid splat force from voice energy during recording. Returns an unsubscribe function. Automatically emits a final `0` on stop so listeners fade out immediately. |
| `start()` | Async. Requests the microphone with all browser audio processing disabled (`echoCancellation`, `noiseSuppression`, `autoGainControl` all `false`, see rationale below), retries once on a transient `NotReadableError`/`AbortError`/`OverconstrainedError`, then starts a `MediaRecorder` at 128 kbps. |
| `stop()` | Async, resolves to `{ blob, url, mime, durationMs }` or `null`. Guarantees the mic track is stopped, the analyser graph is disconnected, and the `AudioContext` is closed before resolving. |
| `revokeAll()` | Revokes every blob URL created this session (`URL.revokeObjectURL`). Call once when the session ends. |

### Why every audio-processing flag is disabled

`echoCancellation`, `noiseSuppression`, and `autoGainControl` are all explicitly set to `false` in the `getUserMedia` constraints. On iOS Safari, enabling any of them was found to auto-duck the entire audio output pipeline while the mic is active, including the session's `<audio>` music element, and that duck did not always release cleanly on stream teardown. Disabling all three removes the browser-managed duck and also removes iOS's aggressive automatic gain control, which was compressing dynamic range and adding noise on quiet input. Because sessions are expected to use headphones (no acoustic feedback loop), the raw, unprocessed capture at 128 kbps is already clean without this processing.

### MIME selection strategy

The recorder probes a browser-specific ordered candidate list and keeps the first MIME type that a real `MediaRecorder` accepts, rather than trusting `MediaRecorder.isTypeSupported()` alone (which was found to report incorrectly on some iOS Safari builds):

- Safari (all iOS/iPadOS browsers, and macOS Safari): `audio/mp4`, then `audio/mp4;codecs=mp4a.40.2`, then `audio/mp4;codecs=aac`, then `audio/aac`. Safari's opus encoder is measurably muddier than its native AAC encoder at the same bitrate, so webm/opus is deliberately excluded from the Safari candidate list entirely, if every explicit candidate fails to construct, the recorder falls back to no MIME hint at all, letting Safari pick its native default (mp4/aac), rather than risk falling through to webm/opus.
- All other engines: `audio/webm;codecs=opus`, then `audio/webm`, then `audio/mp4;codecs=mp4a.40.2`, then `audio/mp4`.

Recording bitrate is fixed at 128 kbps (`audioBitsPerSecond: 128000`), noticeably cleaner than the browser default of 64 kbps for a voice note the artist may replay in a gallery setting.

### Guaranteed-clean stop

`stop()` requests a final data chunk (`requestData()`) before calling `MediaRecorder.stop()`, because iOS Safari can fire `onstop` before the last `ondataavailable` chunk arrives; if the chunk buffer is still empty when `onstop` fires, finalization is deferred by one macrotask (60ms) to give the pending chunk a chance to land, avoiding an empty blob on a very fast tap-to-stop.

## Public API, mic-help.js

```js
import { showMicHelp, hideMicHelp, detectBrowserContext, queryMicPermission } from "./mic-help.js";

showMicHelp({ onRetry: async () => { await recorder.start(); } });
hideMicHelp();

const ctx = detectBrowserContext();
// "safari-ios" | "chrome-ios" | "firefox-ios" | "edge-ios" | "in-app-browser-ios"
// | "android-chrome" | "android-firefox" | "desktop" | "unknown"

const permState = await queryMicPermission();
// "granted" | "denied" | "prompt" | "unknown"
```

`showMicHelp(opts)` opens a modal sheet with browser-specific, numbered remediation steps. iOS gates microphone access at two independent layers, app-level (Settings &rarr; Privacy &rarr; Microphone) and a per-site, per-browser prompt memory that cannot be reset from JavaScript, so the sheet gives precise, screenshot-free textual instructions per detected browser context rather than attempting to re-trigger a browser permission prompt directly. A "Try Again" button calls `opts.onRetry()`, typically re-invoking `VoiceRecorder.start()`.

`detectBrowserContext()` distinguishes real iOS Safari from Chrome/Firefox/Edge for iOS (all WebKit under the hood, but each with separate permission memory) and from in-app WKWebView browsers (which have the strictest, often non-recoverable mic restrictions, the recommended fix there is simply "open this page in Safari").

`queryMicPermission()` best-effort checks the Permissions API where available; returns `"unknown"` rather than throwing when unsupported, since callers should treat this as advisory only and still attempt `getUserMedia()` directly.

## Depends on

Neither file in this folder has any internal repository imports.

## Consumed by

- `src/app.js`, owns the single `VoiceRecorder` instance for the session screen, and wires `showMicHelp`/`detectBrowserContext` for permission-denial recovery.

Author: Eyal Gever. Copyright (c) 2026 Eyal Gever. Licensed under [MIT](../../LICENSE).
