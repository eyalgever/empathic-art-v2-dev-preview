/**
 * Empathic App — Voice Recorder
 *
 * Hard-stop, no-hiss voice recorder. Root cause of previous "hiss after
 * stop": the analyser + MediaStreamSource stayed connected and the mic
 * track wasn't fully released, so ambient noise kept flowing through
 * the graph. This module guarantees a clean teardown.
 *
 * Invariants:
 *   1. Mic source is NEVER connected to AudioContext.destination.
 *      (No live monitoring — impossible to hear the mic during recording.)
 *   2. On stop():
 *        - mediaRecorder.stop()
 *        - stream.getTracks().forEach(t => t.stop())   ← releases mic
 *        - analyser.disconnect() + source.disconnect()
 *        - RAF loop cancelled
 *        - AudioContext closed (fully)
 *   3. Playback of saved clips uses a separate MediaElementAudioSourceNode
 *      graph — not the recording graph.
 *   4. Blob URLs are session-only. revokeAll() on session end.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * MIME preference lists, ordered by observed encode quality per engine.
 *
 * Cycle 15 fix (voice quality on iPhone / iOS Safari 26.5 confirmed):
 *   Debug log from Eyal on iOS Safari 26.5 / iOS 18.7 shows the recorder
 *   picked `audio/webm;codecs=opus` even though Safari is preferred as
 *   mp4/aac. Root cause: `new MediaRecorder(stream, { mimeType:
 *   "audio/mp4;codecs=mp4a.40.2" })` THROWS on this specific WebKit build
 *   even though the plain `audio/mp4` form is accepted. The constructor
 *   probe fell through to the next candidate — webm/opus.
 *
 *   Fix: put plain `audio/mp4` FIRST on Safari (widest support), and
 *   only add codec-suffixed variants as backups. Also remove webm from
 *   the Safari list entirely — if plain `audio/mp4` fails, letting the
 *   browser pick a default with no mimeType (empty string) yields
 *   Safari's native container, which is always mp4/aac. Never fall
 *   through to webm/opus on Safari — its opus encoder is measurably
 *   muddier than its native AAC.
 *
 * Cycle 12 background: iOS Safari 26 advertises support for BOTH mp4
 *   and webm/opus but its opus encoder produces thin, muddy voice at
 *   128 kbps mono. AAC at 128 kbps is broadcast-clean.
 */
const MIME_CANDIDATES_SAFARI = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4;codecs=aac",
  "audio/aac",
];
const MIME_CANDIDATES_DEFAULT = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

/**
 * True on WebKit-based Safari (macOS Safari, iOS Safari, iPadOS Safari,
 * and all iOS/iPadOS browsers which are forced to use WebKit). Excludes
 * Chrome, Edge, Firefox on desktop — those all report a `Chrome` or
 * `Firefox` token in the UA even when running on macOS.
 */
function isSafariEngine() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  // iOS/iPadOS — always WebKit regardless of browser brand
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // macOS Safari desktop — has "Safari" but not "Chrome"/"Chromium"/"Edg"/"Firefox"
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) return true;
  return false;
}

export class VoiceRecorder {
  constructor() {
    this._stream = null;
    this._ctx = null;
    this._source = null;
    this._analyser = null;
    this._recorder = null;
    this._chunks = [];
    this._timeData = null;
    this._raf = null;
    this._amplitudeSubs = new Set();
    this._blobs = [];         // for revokeAll
    this._startTime = 0;
    this._mime = null;
    this._state = "idle";     // 'idle' | 'recording' | 'stopping'
    this._resolveStop = null;
  }

  get state() { return this._state; }
  get elapsedMs() {
    return this._state === "recording" ? Date.now() - this._startTime : 0;
  }

  /**
   * Subscribe to per-frame amplitude (0..1) — used to modulate splat
   * force from the user's voice during recording. Automatically stops
   * emitting on stop().
   * @param {(amp:number)=>void} cb
   */
  onAmplitude(cb) {
    this._amplitudeSubs.add(cb);
    return () => this._amplitudeSubs.delete(cb);
  }

  async start() {
    if (this._state !== "idle") throw new Error("VoiceRecorder busy");
    this._state = "recording";

    // Ask for mic. Some iOS Safari builds return NotReadableError briefly
    // if a previous session's mic track hasn't been fully released by the
    // OS yet — retry once after a short delay before giving up.
    //
    // ── Audio processing flags: ALL OFF ──────────────────────────────────────────
    // On iOS Safari, ANY of {echoCancellation, noiseSuppression, autoGainControl}
    // enabled will auto-duck the ENTIRE audio output pipeline while the mic is
    // hot — including the sound-journey <audio> element. The duck often does
    // not release cleanly on stream teardown, which is what Eyal was hearing
    // ("music went down, never came back").
    // Disabling all three flags eliminates the browser-managed duck and gives
    // us a raw, clean voice capture. It also removes iOS Safari's aggressive
    // AGC which was compressing dynamic range and adding noise on quiet input.
    // The recorded voice is naturally clean because sessions use headphones
    // (no acoustic feedback loop) and MediaRecorder at 128 kbps opus/mp4a is
    // already broadcast-clean without post-processing.
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Aim for 48 kHz stereo where supported; iOS Safari will negotiate down.
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
      },
    };
    try {
      this._stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Retry once for transient busy errors (iOS Safari between sessions).
      const name = err && err.name;
      if (name === "NotReadableError" || name === "AbortError" || name === "OverconstrainedError") {
        await new Promise(r => setTimeout(r, 500));
        try {
          this._stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err2) {
          this._state = "idle";
          const e2 = new Error(err2.message || String(err2));
          e2.name = err2.name || name || "MicError";
          e2.cause = err2;
          throw e2;
        }
      } else {
        this._state = "idle";
        throw err;
      }
    }

    // Choose supported MIME. On Safari prefer AAC (audio/mp4) — its native
    // encoder is measurably cleaner than Safari's opus encoder at 128 kbps.
    // On Chrome/Firefox prefer opus for the higher perceived quality per
    // bitrate. See MIME_CANDIDATES_* above for the full rationale.
    //
    // Cycle 15: keep the constructor-probe strategy (isTypeSupported
    // lies on iOS Safari) but change the candidate order. Safari's plain
    // `audio/mp4` is the most reliably accepted form on iOS 18.x. If
    // every mp4 variant fails on Safari, fall back to NO mimeType (the
    // browser picks its default — which is mp4/aac on WebKit). We
    // NEVER let Safari fall through to webm/opus: even if it constructs,
    // its opus encoder produces the muddy voice quality Eyal reported.
    const onSafari = isSafariEngine();
    const candidates = onSafari ? MIME_CANDIDATES_SAFARI : MIME_CANDIDATES_DEFAULT;
    this._mime = "";
    for (const m of candidates) {
      try {
        const probe = new MediaRecorder(this._stream, { mimeType: m });
        // Discard immediately — we only wanted to know it constructs.
        try { probe.stream === this._stream; } catch {}
        this._mime = m;
        break;
      } catch { /* try next */ }
    }
    // Safari safety net: if no explicit mp4 variant worked, note it and
    // let the browser pick its native default (mp4/aac on WebKit). We
    // signal that with `_useDefaultMime` so the real MediaRecorder below
    // is constructed WITHOUT a mimeType hint. `_mime` is still populated
    // (from probe.mimeType) so the blob type and debug log stay accurate.
    this._useDefaultMime = false;
    if (onSafari && !this._mime) {
      try {
        const probe = new MediaRecorder(this._stream);
        this._mime = probe.mimeType || "audio/mp4";
        this._useDefaultMime = true;
      } catch { /* extremely unlikely */ }
    }

    // Analyser graph — analyser only, NEVER connected to destination
    const AC = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AC();
    this._source = this._ctx.createMediaStreamSource(this._stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 512;
    this._analyser.smoothingTimeConstant = 0.7;
    this._source.connect(this._analyser);
    // ⚠️ do NOT connect analyser or source to destination

    this._timeData = new Uint8Array(this._analyser.frequencyBinCount);
    this._raf = requestAnimationFrame(this._amplitudeLoop);

    // Recorder
    // 128 kbps opus/mp4a: broadcast-clean without post-processing. Default
    // browser bitrate is 64 kbps which sounds thin — the extra bandwidth
    // is worth it for a voice-note the artist will replay on the gallery.
    this._chunks = [];
    const recorderOpts = { audioBitsPerSecond: 128000 };
    // Only pass mimeType if we successfully probed an explicit format.
    // On the Safari fallback path (_useDefaultMime=true), omit the hint
    // so the browser picks its native encoder (mp4/aac on WebKit).
    if (this._mime && !this._useDefaultMime) {
      recorderOpts.mimeType = this._mime;
    }
    this._recorder = new MediaRecorder(this._stream, recorderOpts);
    // After construction, refresh _mime from the actual recorder so
    // the blob type and log always reflect what's really being encoded.
    if (this._recorder.mimeType) this._mime = this._recorder.mimeType;
    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this._chunks.push(e.data);
    };
    this._recorder.onstop = () => this._finalizeStop();
    this._recorder.onerror = (e) => {
      console.warn("[voice] MediaRecorder error:", e?.error || e);
      // If we're already stopping, let _finalizeStop resolve normally.
      // Otherwise force a clean teardown so the state machine can recover.
      if (this._state === "recording") {
        this._state = "stopping";
        try { this._recorder.stop(); } catch { this._finalizeStop(); }
      }
    };
    this._recorder.start(250);   // fetch data every 250 ms
    this._startTime = Date.now();
  }

  /**
   * Stop recording. Returns the resulting Blob + a session-scoped URL.
   * Guarantees: no audio, no analyser callbacks, no mic track after resolve.
   * @returns {Promise<{blob:Blob, url:string, mime:string, durationMs:number}>}
   */
  stop() {
    if (this._state !== "recording") return Promise.resolve(null);
    this._state = "stopping";
    return new Promise((resolve) => {
      this._resolveStop = resolve;
      // On iOS Safari, `MediaRecorder.stop()` sometimes fires `onstop` BEFORE
      // the last `ondataavailable` chunk arrives. Explicitly request a final
      // chunk before stopping so we never get an empty blob on a fast tap.
      try {
        if (typeof this._recorder.requestData === "function") {
          this._recorder.requestData();
        }
      } catch {}
      // Trigger the onstop chain
      try { this._recorder.stop(); } catch { this._finalizeStop(); }
    });
  }

  _finalizeStop() {
    // 1. Stop mic tracks — releases the microphone at the OS level
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
    }
    // 2. Tear down analyser graph
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    try { this._source?.disconnect();  } catch {}
    try { this._analyser?.disconnect(); } catch {}
    // 3. Close context fully so no background silence path remains
    try { this._ctx?.close(); } catch {}

    // 4. Emit one final amplitude=0 so listeners fade out immediately
    for (const cb of this._amplitudeSubs) cb(0);

    // 5. Build blob. iOS Safari occasionally fires onstop before the final
    // dataavailable chunk arrives — if _chunks is empty right now, defer
    // finalization one macrotask to let any pending chunk land.
    if (this._chunks.length === 0) {
      setTimeout(() => this._doFinalize(), 60);
      return;
    }
    this._doFinalize();
  }

  _doFinalize() {
    const durationMs = Date.now() - this._startTime;
    const blob = new Blob(this._chunks, { type: this._mime || "audio/webm" });
    let url = null;
    let result = null;
    if (blob.size > 0) {
      url = URL.createObjectURL(blob);
      this._blobs.push(url);
      result = { blob, url, mime: this._mime || "audio/webm", durationMs };
    }

    // 6. Clear refs
    this._stream = this._ctx = this._source = this._analyser = null;
    this._recorder = null;
    this._chunks = [];
    this._timeData = null;
    this._state = "idle";

    this._resolveStop?.(result);
    this._resolveStop = null;
  }

  _amplitudeLoop = () => {
    if (this._state !== "recording" || !this._analyser) return;
    this._analyser.getByteTimeDomainData(this._timeData);
    let sum = 0;
    for (let i = 0; i < this._timeData.length; i++) {
      const v = (this._timeData[i] - 128) / 128;
      sum += v * v;
    }
    const amp = Math.min(1, Math.sqrt(sum / this._timeData.length) * 2.2);
    for (const cb of this._amplitudeSubs) cb(amp);
    this._raf = requestAnimationFrame(this._amplitudeLoop);
  };

  /** Revoke every blob URL created this session. */
  revokeAll() {
    for (const url of this._blobs) URL.revokeObjectURL(url);
    this._blobs = [];
  }
}
