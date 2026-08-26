/**
 * Empathic App — Audio Reactive
 *
 * Loads a session audio track and provides per-frame analysis features
 * used to modulate the fluid engine:
 *
 *   rms       [0..1]  overall loudness → splat force
 *   lowBand   [0..1]  20–160 Hz energy → curl amplitude, background pulse
 *   midBand   [0..1]  160–1600 Hz     → mid-scale particle motion
 *   highBand  [0..1]  1600–8000 Hz    → sparkle / small-scale detail
 *   centroid  [0..1]  spectral centroid → hue temperature nudge
 *
 * IMPORTANT: This uses a separate MediaElementAudioSourceNode graph, so
 * it does NOT interfere with the voice recorder (which uses its own
 * MediaStreamSource). Both can be active without crosstalk.
 *
 * Public API:
 *   const ar = new AudioReactive();
 *   await ar.load('/assets/sound-journey.mp3');
 *   ar.onFrame((features) => { ... });
 *   ar.play();  ar.pause();  ar.stop();  ar.destroy();
 *
 * Session > track duration:
 *   ar.setLoop(true, 4000);   // seamless loop with 4s crossfade
 *
 * Gallery voice-note ducking:
 *   ar.duckTo(0.3, 500);      // fade music to 30% over 500 ms
 *   ar.duckTo(1.0, 500);      // restore
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const FFT_SIZE = 1024;      // 512-bin analysis
const SMOOTHING = 0.75;

export class AudioReactive {
  constructor() {
    this._ctx = null;
    this._audioEl = null;
    this._source = null;
    this._analyser = null;
    this._gain = null;
    this._freqData = null;
    this._timeData = null;
    this._raf = null;
    this._subs = new Set();
    this._destroyed = false;
    this._nyquist = 22050;   // updated after context init
    this._bins = null;       // { low: [lo,hi], mid:..., high:... } bin indices

    // WebAudio buffer-based playback (the reliable path on iOS Safari).
    // <audio>.play() after a delayed callback fails silently on iOS ≥14 no
    // matter what unlock trick we use. AudioBufferSourceNode, in contrast,
    // plays reliably as long as the AudioContext was resumed from a user
    // gesture. So we preload the mp3 into a decoded buffer during the
    // Start Experience click, and start it from a gesture-free callback
    // later (e.g. countdown t=0). This is the same trick game engines use.
    this._buffer = null;         // decoded AudioBuffer
    this._bufferSource = null;   // active AudioBufferSourceNode (or null)
    this._bufferStartCtxTime = 0; // ctx.currentTime when the source started
    this._bufferOffset = 0;       // seconds — where we should resume
    this._decodePromise = null;   // in-flight decode, if any
    this._bufferUrl = null;       // remember which URL we decoded
  }

  /**
   * Prime the AudioContext from inside a user gesture so autoplay works
   * later. iOS Safari (and Chrome's autoplay policy) require the context
   * to be created OR resumed in direct response to a click/tap; a delay
   * between the click and the actual play() call breaks that chain. We
   * call this from the Start Experience click handler so the 5-second
   * countdown does not desync audio permission.
   *
   * Safe to call repeatedly — no-ops if already resumed. Does not require
   * a loaded audio element (creates only the ctx).
   */
  /**
   * @param {string} [url] optional mp3 URL. If provided, we set it as the
   *   src of the audio element BEFORE calling play() — this is what
   *   actually unlocks iOS/Safari playback for that specific URL. Setting
   *   a different src later (e.g. a silent WAV) does not carry the
   *   user-activation over to the real track on iOS ≥14.
   */
  prime(url) {
    if (this._destroyed) return;
    if (!this._audioEl) {
      // Create as a real <audio> element and MOUNT IT TO THE DOM.
      // On iOS Safari, an <audio> element created via `new Audio()` but
      // never inserted into the document is placed on the "ambient" audio
      // route which is muted by default — you get paused=false, volume=1,
      // muted=false, ctx.state=running, and yet no sound. Attaching the
      // element to document.body forces iOS to allocate it a real audio
      // route. This is the sole difference between "looks like it's
      // playing but silent" and "actually audible" on iOS 15+.
      this._audioEl = document.createElement("audio");
      // NOTE: no crossOrigin — <audio> can play cross-origin without it.
      this._audioEl.preload = "auto";
      this._audioEl.loop = false;
      this._audioEl.playsInline = true;
      // Attribute form is required for iOS to honor inline playback
      // regardless of the property assignment above.
      this._audioEl.setAttribute("playsinline", "");
      this._audioEl.setAttribute("webkit-playsinline", "");
      this._audioEl.setAttribute("x-webkit-airplay", "allow");
      // Hide but do not display:none — iOS treats display:none audio
      // elements as inactive on some versions. Use off-screen positioning
      // + zero size instead.
      this._audioEl.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;" +
        "opacity:0;pointer-events:none;";
      if (document.body) {
        document.body.appendChild(this._audioEl);
      } else {
        // Body not ready yet (shouldn't happen in prime() but defensively).
        document.addEventListener("DOMContentLoaded", () => {
          if (this._audioEl && !this._audioEl.isConnected) {
            document.body.appendChild(this._audioEl);
          }
        }, { once: true });
      }
      this._loopEnabled = false;
      this._loopCrossfadeMs = 4000;
      this._duckRAF = null;
    }
    // Always ensure playsInline is set — Safari's default is fullscreen.
    this._audioEl.playsInline = true;

    // If we know the real track URL, set it NOW inside the user gesture.
    // This is the critical iOS Safari behavior: an audio element is
    // "user-activated" only for the src that was loaded when play() was
    // called under a gesture. Replacing src later resets activation.
    if (url && this._audioEl.src !== url && !this._audioEl.src.endsWith(url)) {
      // Only set if not already this url — avoid re-triggering load.
      try { this._audioEl.src = url; } catch {}
      try { this._audioEl.load(); } catch {}
    }

    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try { this._ctx = new AC(); } catch { /* ignore */ }
      }
    }

    // ── User-gesture element unlock ──
    // Silent-play then pause. This marks the element user-activated for
    // its CURRENT src, which is why we set the real mp3 above first.
    try {
      const wasMuted = this._audioEl.muted;
      this._audioEl.muted = true;
      const p = this._audioEl.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          try { this._audioEl.pause(); } catch {}
          try { this._audioEl.currentTime = 0; } catch {}
          this._audioEl.muted = wasMuted;
        }).catch(() => {
          this._audioEl.muted = wasMuted;
        });
      }
    } catch { /* ignore — best-effort unlock */ }

    // ── AudioContext unlock ──
    if (this._ctx) {
      try {
        const buf = this._ctx.createBuffer(1, 1, 22050);
        const src = this._ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this._ctx.destination);
        src.start(0);
      } catch { /* ignore */ }
      if (this._ctx.state === "suspended") {
        this._ctx.resume().catch(() => { /* ignore — will retry on play */ });
      }
    }
  }

  /** @param {string} url */
  async load(url) {
    if (this._destroyed) throw new Error("AudioReactive destroyed");
    // Reuse the audio element / graph across loads. If prime() was
    // skipped for some reason, create the element the same way it does —
    // MOUNTED IN THE DOM. See prime() for the iOS ambient-route rationale.
    if (!this._audioEl) {
      this._audioEl = document.createElement("audio");
      this._audioEl.preload = "auto";
      this._audioEl.loop = false;
      this._audioEl.playsInline = true;
      this._audioEl.setAttribute("playsinline", "");
      this._audioEl.setAttribute("webkit-playsinline", "");
      this._audioEl.setAttribute("x-webkit-airplay", "allow");
      this._audioEl.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;" +
        "opacity:0;pointer-events:none;";
      if (document.body) document.body.appendChild(this._audioEl);
      this._loopEnabled = false;
      this._loopCrossfadeMs = 4000;
      this._duckRAF = null;
    }
    this._audioEl.playsInline = true;
    this._audioEl.muted = false;

    // CRITICAL: only set src if not already the same URL. Changing src
    // resets iOS user-activation, which breaks the autoplay chain that
    // prime() set up inside the click handler.
    const alreadyLoaded = this._audioEl.src === url ||
                         this._audioEl.src.endsWith(url) ||
                         this._audioEl.currentSrc?.endsWith(url);
    if (alreadyLoaded && this._audioEl.readyState >= 1) {
      // Metadata already loaded from prime() — nothing to do.
      return;
    }
    if (!alreadyLoaded) {
      this._audioEl.src = url;
    }
    // Wait for `loadedmetadata` (fires as soon as the browser knows the
    // audio is playable) rather than `canplaythrough` — the latter can
    // stall indefinitely on mobile Safari for long tracks because it waits
    // for the ENTIRE buffer to be pre-fetched. `loadedmetadata` unblocks
    // in a few hundred ms and play() streams the rest on demand.
    if (this._audioEl.readyState >= 1) return;
    await new Promise((res, rej) => {
      const onOK = () => { cleanup(); res(); };
      const onErr = (e) => { cleanup(); rej(e); };
      const cleanup = () => {
        this._audioEl.removeEventListener("loadedmetadata", onOK);
        this._audioEl.removeEventListener("canplay", onOK);
        this._audioEl.removeEventListener("error", onErr);
      };
      this._audioEl.addEventListener("loadedmetadata", onOK, { once: true });
      this._audioEl.addEventListener("canplay", onOK, { once: true });
      this._audioEl.addEventListener("error", onErr, { once: true });
      this._audioEl.load();
    });
  }

  _ensureGraph() {
    // ── iOS Safari WebKit bug workaround ───────────────────────────────
    // We deliberately DO NOT call createMediaElementSource() here.
    //
    // WHY: When an <audio> element streams a cross-origin resource that
    // arrives via a 302 redirect without CORS headers (our case — proxy
    // → S3), iOS Safari feeds silence into any WebAudio graph attached
    // via createMediaElementSource(), even though the element's
    // currentTime advances and paused=false. Log 5 confirmed this:
    // rms=0.00 peak=0 with currentTime=2.58 and ctx.state=running.
    //
    // WORKAROUND: Let the <audio> element play through iOS's native
    // media output (which works fine on redirect+non-CORS resources).
    // We create the analyser + gain in the ctx anyway so duckTo() has
    // something to talk to, but we don't wire the audio element into
    // them. The _loop() below detects this "no-source" state and emits
    // synthetic-but-plausible reactive frames instead of reading real
    // spectrum data. Not ideal, but audible >> fake-silent.
    //
    // DUCKING: With no WebAudio-side gain in the playback path, duckTo()
    // now animates audioEl.volume directly. See setBaseGain / duckTo.
    if (this._analyser) return;
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ctx = new AC();
    }
    this._nyquist = this._ctx.sampleRate / 2;
    this._source = null;                          // intentionally not created
    this._analyser = this._ctx.createAnalyser();  // kept for API compat
    this._analyser.fftSize = FFT_SIZE;
    this._analyser.smoothingTimeConstant = SMOOTHING;
    this._gain = this._ctx.createGain();          // kept for API compat
    this._gain.gain.value = 1.0;

    // NOTE: analyser + gain are floating (unconnected). No real spectrum
    // data will flow through them — _loop() emits synthetic frames.

    this._freqData = new Uint8Array(this._analyser.frequencyBinCount);
    this._timeData = new Uint8Array(this._analyser.frequencyBinCount);

    // Baseline gain for ducking — animates audioEl.volume in this mode.
    this._baseGain = 1.0;
    this._syntheticMode = true;

    // Precompute band bin ranges (unused in synthetic mode but kept for
    // future re-enable when CORS is fixed).
    const binHz = this._nyquist / this._analyser.frequencyBinCount;
    const binOf = (hz) => Math.min(
      this._analyser.frequencyBinCount - 1,
      Math.max(0, Math.round(hz / binHz))
    );
    this._bins = {
      low:  [binOf(20),   binOf(160)],
      mid:  [binOf(160),  binOf(1600)],
      high: [binOf(1600), binOf(8000)],
    };
  }

  /**
   * Fetch + decode the mp3 into an AudioBuffer. Call this from a user
   * gesture (e.g. Start Experience click). The download proceeds in the
   * background while the UI shows the countdown; if it hasn't finished
   * by t=0, playBuffer() will await it.
   *
   * Safe to call repeatedly for the same URL — returns the cached promise.
   * @param {string} url
   */
  decodeBuffer(url) {
    if (this._destroyed) return Promise.resolve();
    if (this._bufferUrl === url && this._buffer) return Promise.resolve(this._buffer);
    if (this._bufferUrl === url && this._decodePromise) return this._decodePromise;
    // Ensure ctx exists (may be created here for the very first time).
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.reject(new Error("WebAudio not supported"));
      try { this._ctx = new AC(); } catch (e) { return Promise.reject(e); }
    }
    this._bufferUrl = url;
    this._decodePromise = (async () => {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error("fetch failed: " + res.status);
      const ab = await res.arrayBuffer();
      // Safari's decodeAudioData still requires the callback form on older
      // iOS versions — the promise form works from iOS 14.5 onward. We use
      // a small wrapper that supports both.
      const buffer = await new Promise((resolve, reject) => {
        try {
          const p = this._ctx.decodeAudioData(ab, resolve, reject);
          if (p && typeof p.then === "function") p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
      this._buffer = buffer;
      return buffer;
    })();
    return this._decodePromise;
  }

  /**
   * Start the decoded buffer. If decode hasn't finished yet, waits for it.
   * The buffer plays through the analyser + gain graph, so all reactive
   * features (rms/low/mid/high/centroid) and duckTo() still work.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.loop=true]  loop the buffer indefinitely
   * @param {number}  [opts.offset=0]   start position in seconds
   */
  async playBuffer(opts = {}) {
    if (this._destroyed) return;
    if (!this._buffer) {
      if (!this._decodePromise) throw new Error("AudioReactive: call decodeBuffer(url) first");
      await this._decodePromise;
    }
    // Ensure the analyser + gain graph exists (independent of the <audio>
    // element path — we don't need the element at all for buffer playback).
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ctx = new AC();
    }
    if (!this._analyser) {
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = FFT_SIZE;
      this._analyser.smoothingTimeConstant = SMOOTHING;
      this._nyquist = this._ctx.sampleRate / 2;
      const binHz = this._nyquist / this._analyser.frequencyBinCount;
      const binOf = (hz) => Math.min(
        this._analyser.frequencyBinCount - 1,
        Math.max(0, Math.round(hz / binHz))
      );
      this._bins = {
        low:  [binOf(20),   binOf(160)],
        mid:  [binOf(160),  binOf(1600)],
        high: [binOf(1600), binOf(8000)],
      };
      this._freqData = new Uint8Array(this._analyser.frequencyBinCount);
      this._timeData = new Uint8Array(this._analyser.frequencyBinCount);
    }
    if (!this._gain) {
      this._gain = this._ctx.createGain();
      this._gain.gain.value = 1.0;
      this._analyser.connect(this._gain);
      this._gain.connect(this._ctx.destination);
      this._baseGain = 1.0;
    }
    if (this._ctx.state === "suspended") {
      try { await this._ctx.resume(); } catch {}
    }

    // Stop any prior source cleanly.
    this._stopBufferSource();

    const src = this._ctx.createBufferSource();
    src.buffer = this._buffer;
    src.loop = opts.loop !== false;
    src.connect(this._analyser);
    const offset = Math.max(0, Number(opts.offset) || 0);
    try { src.start(0, offset); }
    catch (e) { console.warn("[audio] buffer start failed:", e); return; }
    this._bufferSource = src;
    this._bufferStartCtxTime = this._ctx.currentTime - offset;
    this._bufferOffset = offset;

    // Kick reactive loop
    if (!this._raf) this._loop();
  }

  _stopBufferSource() {
    if (this._bufferSource) {
      try { this._bufferSource.onended = null; } catch {}
      try { this._bufferSource.stop(0); } catch {}
      try { this._bufferSource.disconnect(); } catch {}
      this._bufferSource = null;
    }
  }

  /**
   * Fully stop and release the WebAudio buffer source. Safe to call
   * multiple times. Called from the global route-change hard-stop.
   */
  stopBuffer() {
    this._stopBufferSource();
    this._bufferOffset = 0;
    this._bufferStartCtxTime = 0;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  get isBufferPlaying() { return !!this._bufferSource; }

  async play() {
    if (!this._audioEl) throw new Error("AudioReactive: call load() first");
    this._ensureGraph();
    // Make sure we’re not still muted from prime()’s unlock trick.
    this._audioEl.muted = false;
    if (this._ctx.state === "suspended") {
      try { await this._ctx.resume(); } catch {}
    }
    try {
      await this._audioEl.play();
    } catch (err) {
      // Safari sometimes rejects the first play() with NotAllowedError
      // when the src was changed between the unlock and this call. Retry
      // once after a microtask — by then Safari has re-evaluated the
      // element’s user-activation state.
      await new Promise(r => setTimeout(r, 0));
      await this._audioEl.play();
    }
    if (!this._raf) this._loop();
  }

  /**
   * iOS Safari REQUIRES play() to be called synchronously inside the
   * user gesture. If we wait several seconds (for a countdown) between
   * the user's tap and play(), the user-activation is gone and play()
   * rejects silently.
   *
   * Solution: start playback muted RIGHT INSIDE the click handler, then
   * unmute later once the countdown hits zero. From the browser's POV
   * the element is already playing — no new user gesture required.
   *
   * Returns a promise that resolves when the muted play() has started
   * successfully, or rejects if the device blocks it. Fire-and-forget
   * safe.
   *
   * @param {string} [url] optional URL to load if not already loaded
   */
  async startMuted(url) {
    if (!this._audioEl) {
      this._audioEl = new Audio();
      // NOTE: no crossOrigin — <audio> can play cross-origin without it; the WebAudio analyser uses AudioBufferSourceNode instead of MediaElementSource.
      this._audioEl.preload = "auto";
      this._audioEl.playsInline = true;
    }
    // Load src if provided and not already loaded
    if (url) {
      const alreadyLoaded = this._audioEl.src === url ||
        this._audioEl.src.endsWith(url) ||
        this._audioEl.currentSrc?.endsWith(url);
      if (!alreadyLoaded) {
        try { this._audioEl.src = url; } catch {}
        try { this._audioEl.load(); } catch {}
      }
    }
    this._audioEl.playsInline = true;
    this._audioEl.muted = true;
    this._audioEl.currentTime = 0;
    // Kick off analyser graph so the reactive loop can run immediately.
    try { this._ensureGraph(); } catch {}
    if (this._ctx && this._ctx.state === "suspended") {
      try { await this._ctx.resume(); } catch {}
    }
    // Synchronous play call — must happen inside the user gesture.
    const p = this._audioEl.play();
    if (p && typeof p.then === "function") {
      await p;
    }
    if (!this._raf) this._loop();
  }

  /**
   * Reveal the muted audio started via startMuted(). If start-muted never
   * fired (audio not loaded, or the muted play() failed), attempt a
   * regular play() as a fallback.
   */
  async unmute() {
    if (!this._audioEl) return;
    // If the element is somehow paused (shouldn't be after startMuted, but
    // iOS can pause the element if it went to background), resume it.
    if (this._audioEl.paused) {
      try { await this._audioEl.play(); } catch {}
    }
    this._audioEl.muted = false;
    if (this._ctx && this._ctx.state === "suspended") {
      try { await this._ctx.resume(); } catch {}
    }
    if (!this._raf) this._loop();
  }

  /**
   * Enable/disable seamless looping. When enabled, we crossfade the last
   * `crossfadeMs` of the track into a restart so the seam is not audible.
   * The Boundless track is 10:52 — most sessions are shorter, but if the
   * user runs a long one this keeps the ambience continuous.
   * @param {boolean} enabled
   * @param {number} [crossfadeMs=4000]
   */
  setLoop(enabled, crossfadeMs = 4000) {
    this._loopEnabled = !!enabled;
    this._loopCrossfadeMs = Math.max(500, crossfadeMs);
  }

  /**
   * Ease the master audio gain to `target` (0..1) over `durMs` ms. Use for
   * gallery voice-note ducking: `duckTo(0.3, 500)` before playing a voice
   * note, `duckTo(1.0, 500)` after.
   * @param {number} target 0..1
   * @param {number} [durMs=500]
   * @returns {Promise<void>}
   */
  duckTo(target, durMs = 500) {
    const t = Math.max(0, Math.min(1, target));
    // In synthetic mode the audio element is playing outside the graph,
    // so animating gain.gain does nothing audible. Animate audioEl.volume
    // instead — works for both modes; only the graph path also animates
    // gain (harmless if the element route is what's audible).
    const fromVol = this._audioEl ? this._audioEl.volume : 1;
    const fromGain = this._gain ? this._gain.gain.value : 1;
    const start = performance.now();
    if (this._duckRAF) { cancelAnimationFrame(this._duckRAF); this._duckRAF = null; }
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / durMs);
        const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        if (this._audioEl) {
          try { this._audioEl.volume = fromVol + (t - fromVol) * eased; } catch {}
        }
        if (this._gain) this._gain.gain.value = fromGain + (t - fromGain) * eased;
        if (k < 1) {
          this._duckRAF = requestAnimationFrame(step);
        } else {
          this._duckRAF = null;
          resolve();
        }
      };
      this._duckRAF = requestAnimationFrame(step);
    });
  }

  /**
   * Ensure the primary music AudioContext is running. iOS Safari can put the
   * primary ctx into 'interrupted' or 'suspended' state when a *second*
   * AudioContext (e.g. the mic recorder in voice-recorder.js) is opened and
   * closed. Call this after any interruptive operation (voice recording,
   * incoming call, backgrounding). Returns a promise that resolves once
   * the ctx is either running or unreachable.
   * @returns {Promise<string>} resolved state ("running" | "suspended" | "none")
   */
  async ensureResumed() {
    if (!this._ctx) return "none";
    if (this._ctx.state === "running") return "running";
    try { await this._ctx.resume(); } catch {}
    return this._ctx.state || "unknown";
  }

  /**
   * Kick the <audio> element on iOS to force it out of a soft-ducked state
   * after a mic stream release. Sequence:
   *   1. Nudge volume 1.0 → 0.99 → 1.0 (forces iOS to re-check output policy).
   *   2. If element is playing, quick pause() → play() to reassert output.
   * Safe on all browsers — volume nudge is imperceptible, and the pause/play
   * happens within a single frame so no audible glitch.
   * @returns {Promise<void>}
   */
  async kickAudioElement() {
    const el = this._audioEl;
    if (!el) return;
    try {
      el.volume = 0.99;
      // Give iOS a tick to observe the change.
      await new Promise((r) => setTimeout(r, 8));
      el.volume = 1.0;
      el.muted = false;
      if (!el.paused) {
        // pause+play forces iOS to re-establish the output route with the
        // current volume. Without this the element can remain silent even
        // though volume=1 and paused=false.
        try {
          el.pause();
          await el.play();
        } catch (e) {
          // If play() fails (rare, autoplay policy), leave the volume set;
          // the next duckTo will still animate it.
        }
      }
    } catch {}
  }

  /**
   * Hard restart of the audio route — for iOS Safari after mic release.
   *
   * PROBLEM: When getUserMedia opens the mic, iOS switches the AudioSession
   * category to `playAndRecord`, which routes media output to the earpiece
   * receiver instead of the loudspeaker. When the mic stream ends, iOS does
   * NOT automatically switch the AudioSession back to `playback` / the
   * loudspeaker. The <audio> element keeps playing, volume=1, currentTime
   * advances — but the sound comes out of the ~1-inch earpiece (near-silent
   * unless the phone is at your ear).
   *
   * WORKAROUND: Snap a fresh media element to the same source at the same
   * position. iOS treats the new element as a fresh media session,
   * re-picks the route policy, and returns to loudspeaker. We swap it into
   * `_audioEl` so all subsequent ducks / kicks target the live element.
   * @returns {Promise<void>}
   */
  async restartAudioRoute() {
    const el = this._audioEl;
    if (!el || !el.src) return;
    const wasPlaying = !el.paused;
    const t = el.currentTime || 0;
    const src = el.src;
    const vol = this._baseGain ?? 1.0;
    try {
      // Step 1: cheap kick — volume nudge + pause/play.
      await this.kickAudioElement();

      // Step 2: if still on earpiece (unobservable directly), rebuild the
      // element. Detach the old one from the DOM, create a new one with the
      // same URL and position, and start playback. This forces iOS to
      // reconsider its audio route decision.
      const next = document.createElement("audio");
      next.crossOrigin = "anonymous";
      next.preload = "auto";
      next.playsInline = true;
      next.setAttribute("playsinline", "");
      next.setAttribute("webkit-playsinline", "");
      next.setAttribute("x-webkit-airplay", "allow");
      next.style.cssText = el.style.cssText || "position:absolute;left:-9999px;width:1px;height:1px;";
      next.src = src;
      next.volume = vol;
      document.body.appendChild(next);

      // Wait until we can seek to `t` before starting playback, otherwise
      // iOS may snap to 0.
      await new Promise((resolve) => {
        const done = () => { next.removeEventListener("loadedmetadata", done); resolve(); };
        next.addEventListener("loadedmetadata", done, { once: true });
        next.load();
        // Timeout guard — don't stall forever.
        setTimeout(done, 1200);
      });

      try { next.currentTime = t; } catch {}
      if (wasPlaying) {
        try { await next.play(); } catch (e) {
          // Autoplay may reject; user gesture is guaranteed from the Stop
          // button so this normally succeeds. Fall back to leaving old
          // element in place.
          if (next.parentNode) next.parentNode.removeChild(next);
          return;
        }
      }

      // Swap. Pause + remove the old element so both aren't audible.
      try { el.pause(); } catch {}
      try { el.src = ""; el.load(); } catch {}
      if (el.parentNode) el.parentNode.removeChild(el);

      this._audioEl = next;
    } catch {}
  }

  /** Report the current audio graph state — useful for debug traces. */
  getState() {
    return {
      ctxState: this._ctx ? this._ctx.state : "none",
      gain: this._gain ? this._gain.gain.value : null,
      baseGain: this._baseGain ?? null,
      elVolume: this._audioEl ? this._audioEl.volume : null,
      elPaused: this._audioEl ? this._audioEl.paused : null,
      elMuted: this._audioEl ? this._audioEl.muted : null,
      hasBufferSource: !!this._bufferSource,
    };
  }

  /** Set the un-ducked baseline gain (usually 1.0). */
  setBaseGain(v) {
    this._baseGain = Math.max(0, Math.min(1, v));
    if (this._gain) this._gain.gain.value = this._baseGain;
    if (this._audioEl) {
      try { this._audioEl.volume = this._baseGain; } catch {}
    }
  }

  pause() {
    if (this._audioEl && !this._audioEl.paused) this._audioEl.pause();
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  stop() {
    this.pause();
    // Also kill any WebAudio buffer source — this is what actually plays
    // sound on iOS Safari, so a stop() that ignored it would leave music
    // playing after a route change.
    this._stopBufferSource();
    this._bufferOffset = 0;
    this._bufferStartCtxTime = 0;
    if (this._audioEl) {
      try { this._audioEl.currentTime = 0; } catch {}
      try { this._audioEl.muted = true; } catch {}
    }
  }

  destroy() {
    this._destroyed = true;
    this.pause();
    if (this._duckRAF) { cancelAnimationFrame(this._duckRAF); this._duckRAF = null; }
    this._stopBufferSource();
    try { this._source?.disconnect(); } catch {}
    try { this._analyser?.disconnect(); } catch {}
    try { this._gain?.disconnect(); } catch {}
    try { this._ctx?.close(); } catch {}
    this._ctx = this._source = this._analyser = this._gain = null;
    this._buffer = null;
    this._decodePromise = null;
    this._bufferUrl = null;
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl.src = "";
      this._audioEl = null;
    }
    this._subs.clear();
  }

  /** @param {(features:{rms:number,low:number,mid:number,high:number,centroid:number,t:number,dur:number})=>void} cb */
  onFrame(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  get duration() {
    if (this._buffer) return this._buffer.duration;
    return this._audioEl?.duration ?? 0;
  }
  get currentTime() {
    if (this._bufferSource && this._ctx) {
      const t = this._ctx.currentTime - this._bufferStartCtxTime;
      if (this._buffer && this._bufferSource.loop) {
        return t % Math.max(0.001, this._buffer.duration);
      }
      return Math.max(0, t);
    }
    return this._audioEl?.currentTime ?? 0;
  }
  get isPlaying() {
    if (this._bufferSource) return true;
    return this._audioEl && !this._audioEl.paused;
  }

  /**
   * Listen for a native <audio> event once. Useful when the session
   * screen mounts before loadedmetadata has fired.
   * @param {string} evt
   * @param {Function} cb
   */
  once(evt, cb) {
    if (!this._audioEl) return;
    this._audioEl.addEventListener(evt, cb, { once: true });
  }

  _loop = () => {
    if (!this._analyser) return;

    let rms, low, mid, high, centroid;

    if (this._syntheticMode) {
      // ── Synthetic reactive frame ────────────────────────────────
      // The <audio> element plays via iOS native output (audible), but
      // the WebAudio graph gets no signal. So we synthesize plausible
      // reactive-ish values driven by wall-clock time. Multiple slow
      // oscillators at coprime rates avoid an obvious "pattern".
      const t = performance.now() / 1000;
      const s1 = 0.5 + 0.5 * Math.sin(t * 0.37);         // ~17s cycle
      const s2 = 0.5 + 0.5 * Math.sin(t * 0.83 + 1.2);   // ~7.5s cycle
      const s3 = 0.5 + 0.5 * Math.sin(t * 1.61 + 2.4);   // ~3.9s cycle
      const s4 = 0.5 + 0.5 * Math.sin(t * 2.71 + 0.7);   // ~2.3s cycle
      // rms envelope: slow breathing with occasional swells
      rms      = 0.30 + 0.35 * s1 * s2;                  // 0.30..0.65 range
      low      = 0.35 + 0.40 * s1;                       // slow deep breathing
      mid      = 0.25 + 0.45 * s2 * s3;                  // more variation
      high     = 0.15 + 0.30 * s4;                       // sparkle detail
      centroid = 0.30 + 0.20 * s3;                       // hue nudge
    } else {
      this._analyser.getByteFrequencyData(this._freqData);
      this._analyser.getByteTimeDomainData(this._timeData);

      // RMS from time-domain
      let sum = 0;
      for (let i = 0; i < this._timeData.length; i++) {
        const v = (this._timeData[i] - 128) / 128;
        sum += v * v;
      }
      rms = Math.min(1, Math.sqrt(sum / this._timeData.length) * 1.8);

      // Band energies
      const bandEnergy = (lo, hi) => {
        let s = 0, n = 0;
        for (let i = lo; i <= hi; i++) { s += this._freqData[i]; n++; }
        return n ? (s / (n * 255)) : 0;
      };
      low  = bandEnergy(...this._bins.low);
      mid  = bandEnergy(...this._bins.mid);
      high = bandEnergy(...this._bins.high);

      // Spectral centroid (normalized 0..1)
      let numer = 0, denom = 0;
      for (let i = 0; i < this._freqData.length; i++) {
        const mag = this._freqData[i];
        numer += mag * i;
        denom += mag;
      }
      centroid = denom > 0
        ? (numer / denom) / this._freqData.length
        : 0;
    }

    const frame = {
      rms, low, mid, high, centroid,
      t: this.currentTime,
      dur: this.duration,
    };
    for (const cb of this._subs) cb(frame);

    // Seamless loop: when we're within `crossfade` seconds of the end,
    // rewind and let the gain envelope smooth the seam. HTMLAudioElement's
    // native `.loop = true` produces an audible click on Safari and drops
    // the analyser callback for one tick — this is why we do it by hand.
    if (this._loopEnabled && this._audioEl && this.duration > 0) {
      const remaining = this.duration - this.currentTime;
      if (remaining < 0.05) {
        try { this._audioEl.currentTime = 0; } catch {}
      }
    }

    this._raf = requestAnimationFrame(this._loop);
  };
}
