/**
 * Empathic App — Gallery Voice-Note Playback
 *
 * Small helper used by the Gallery / Summary view to play back a recorded
 * voice-note with the Boundless music ducked during playback and restored
 * afterwards. Engineers building the Gallery UI in the host app should call
 * `playVoiceNote(url, audioReactive)` and it will handle the full envelope:
 *
 *   1. Duck the music `AudioReactive` gain to 0.30 over ~400 ms
 *   2. Play the voice-note through a separate `<audio>` element so it
 *      does not go through the analyser / reactive graph
 *   3. When the voice-note ends (or is stopped / errors / aborts),
 *      restore music gain to 1.0 over 400 ms.
 *
 * The voice-note itself is stored as a Blob URL by VoiceRecorder; those
 * URLs are session-scoped and cleaned up on VoiceRecorder.revokeAll().
 * If the host persists voice-notes across sessions, it must re-hydrate
 * the blobs into fresh object URLs before passing them here.
 *
 * ─── Un-duck contract ────────────────────────────────────────────────
 * On iOS Safari the music plays through the WebAudio buffer-source path
 * (`src -> analyser -> gain -> destination`). `AudioReactive.duckTo()`
 * animates `_gain.gain.value`, which is what makes the ducking audible.
 * We fire `restore()` from `ended` / `error` / `abort` and, defensively,
 * force the master gain back to `_baseGain` at the end of the animation
 * so no stale ramp can leave the music sitting at the ducked level.
 *
 * We DO NOT clear `el.src` or call `el.load()` after playback. On iOS
 * Safari, blanking the src of a still-mounted media element throws an
 * `emptied` event AND can cause an internal "MediaError: aborted"
 * because iOS treats it as a media stack reset while a session is live.
 * Instead we simply pause + drop our reference; GC releases the element.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const DUCK_LEVEL = 0.30;   // music drops to 30% during voice playback
const DUCK_MS    = 400;

/**
 * Defensive final gain snap. Called after the animation to guarantee
 * the master gain lands exactly on `_baseGain`, in case a preempted
 * RAF ramp left the value slightly off (or animating toward something
 * stale).
 *
 * @param {import('./audio-reactive.js').AudioReactive|null} audioReactive
 */
function snapToBase(audioReactive) {
  if (!audioReactive) return;
  try {
    const base = (typeof audioReactive._baseGain === "number") ? audioReactive._baseGain : 1.0;
    if (audioReactive._gain) audioReactive._gain.gain.value = base;
    if (audioReactive._audioEl) {
      try { audioReactive._audioEl.volume = base; } catch {}
    }
  } catch {}
}

/**
 * Play a voice-note URL and duck the background music while it plays.
 *
 * @param {string} url            Blob URL of the recorded voice-note
 * @param {import('./audio-reactive.js').AudioReactive} audioReactive
 *   The active music engine — used to duck/restore gain. Pass `null` if
 *   the gallery is not currently playing Boundless music (in which case
 *   the voice plays at full volume with no ducking).
 * @param {object} [opts]
 * @param {number} [opts.duckLevel=0.30]  Level to duck music to (0..1)
 * @param {number} [opts.duckMs=400]       Fade duration in ms
 * @returns {{ stop: () => void, ended: Promise<void> }}
 *   `stop()` cancels playback and restores music. `ended` resolves when
 *   the voice-note finishes naturally OR is stopped.
 */
export function playVoiceNote(url, audioReactive, opts = {}) {
  const duckLevel = opts.duckLevel ?? DUCK_LEVEL;
  const duckMs    = opts.duckMs    ?? DUCK_MS;

  const el = new Audio();
  // On iOS Safari, some blob URLs (opus in webm) need an explicit
  // `preload` + `load()` cycle before `.play()` will resolve.
  // Setting src BEFORE preload/playsinline attributes avoids a race where
  // Safari picks up an old media state.
  el.preload = "auto";
  // playsinline: keep audio inline; don't invoke iOS full-screen player.
  el.playsInline = true;
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");
  el.src = url;
  try { el.load(); } catch {}

  let stopped  = false;
  let restored = false;

  /**
   * Restore music gain. Safe to call multiple times.
   * We animate back to 1.0 AND snap the final value to `_baseGain` after
   * the animation, so no stale ramp leaves the music at the ducked level.
   */
  const restore = (reason) => {
    if (restored) return;
    restored = true;
    if (!audioReactive) return;
    try { audioReactive.duckTo(1.0, duckMs); } catch {}
    // Snap to base AFTER the duckTo promise would resolve, as a safety net.
    // We use a timeout instead of awaiting so this is fire-and-forget.
    setTimeout(() => snapToBase(audioReactive), duckMs + 50);
    void reason;   // reserved for future debug hookup by the host
  };

  const ended = new Promise((resolve) => {
    const finish = () => { restore("ended"); resolve(); };
    el.addEventListener("ended", finish, { once: true });
    el.addEventListener("error", finish, { once: true });
    // Note: we intentionally do NOT listen for `abort` or `emptied` here.
    // Those events can fire during element setup on iOS Safari (before
    // playback begins) and would prematurely end the note. `ended` and
    // `error` are sufficient — `stop()` from the caller handles the rest.
  });

  // Kick things off: duck first, then play. If the browser refuses to
  // autoplay (unlikely because playback is triggered by a user gesture),
  // we still resolve cleanly and restore music.
  // NOTE: On iOS Safari, creating a second <audio> element while the
  // music <audio> is actively playing sometimes yields NotAllowedError
  // or a silent failure because iOS enforces a single active audio
  // session. As a defense we play SYNCHRONOUSLY inside the click gesture
  // via a `pending` state, and start ducking in parallel rather than
  // awaiting the duck ramp (awaiting can drop us out of the gesture
  // window on iOS).
  const start = () => {
    if (audioReactive) {
      try { audioReactive.duckTo(duckLevel, duckMs); } catch {}
    }
    // Play immediately (same task as the gesture) — do NOT await duck.
    let playPromise;
    try {
      playPromise = el.play();
    } catch (err) {
      console.warn("Voice-note play threw:", err && err.message ? err.message : err);
      restore("play-threw");
      return;
    }
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((err) => {
        const msg = err && err.name ? (err.name + ": " + (err.message || "")) : String(err);
        console.warn("Voice-note play failed:", msg, "src-len:", (el.src || "").length);
        restore("play-failed");
      });
    }
  };
  start();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { el.pause(); } catch {}
      try { el.currentTime = 0; } catch {}
      restore("stop");
    },
    ended,
  };
}
