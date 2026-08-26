/**
 * Empathic App — Summary Playback
 *
 * Replays a completed session against a fresh fluid canvas. During
 * playback:
 *
 *   1. The audio track scrubs from t=0.
 *   2. The recorded valence/arousal/openness samples drive the fluid
 *      engine's setEmotion() at the same cadence they were captured.
 *   3. Each recorded crossing (transition into a new anchor emotion)
 *      fires an on-screen word reveal AND a bright splat of that
 *      emotion's color onto the fluid — so the journey re-tells itself
 *      visually with words layered over the fluid.
 *   4. Voice notes fire at their recorded `at` timestamps, using
 *      playVoiceNote(). If a note's blob URL was lost across a page
 *      reload (persisted sessions) it's silently skipped.
 *   5. The mini-circumplex trail redraws from t=0 → t=now.
 *   6. Brain-wave lanes breathe with the current v/a/o like they did
 *      live.
 *
 * The playback is *time-scaled* to the session's real duration, so a
 * ten-minute recording replays in ten minutes. A play/pause + scrub
 * bar (in index.html) lets the user seek anywhere.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { FluidEngine }    from "../fluid/fluid-engine.js?v=1.3.8";
import { StyleRegistry }  from "../visuals/index.js?v=1.3.7";
import { mountMuseVis }   from "../muse/muse-vis.js?v=1.6.3.26";
import { mountBrainWaves } from "../muse/muse-brainwaves.js?v=1.6.4.0";
import { playVoiceNote }  from "../audio/gallery-voice.js?v=1.3.1";
import { formatMetaLines, buildSessionNarrative } from "./session-narrative.js?v=1.5.1";
import { emotionToLabel } from "../palette/emotion-palette.js?v=1.3.1";
// v1.5.1 — imported from its own tiny module rather than back from
// ../app.js. The old ../app.js?v=1.5.0 import created a second copy
// of the entire app module (different query string → fresh instance)
// which meant a second SessionStore, a second AudioReactive, and a
// picker onSelect closure that clobbered the visible one — the root
// cause of the "picked Aurora, session ran Fluid" and "no audio" bugs.
import { liftForLegibility } from "../palette/color-legibility.js?v=1.5.1";
import { dbg }            from "../debug/debug-overlay.js?v=1.3.1";

const SESSION_INK = { r: 0x0d / 255, g: 0x0b / 255, b: 0x0a / 255 };

/**
 * Mount the summary/playback screen for a single session record.
 * Returns a `destroy()` cleanup used when the screen unmounts.
 *
 * @param {Object} opts
 * @param {SessionRecord} opts.session
 * @param {HTMLElement} opts.container
 * @param {AudioReactive} opts.audio
 * @param {string} opts.audioSrc  path to the master session track
 */
export function mountSummaryPlayback({ session, container, audio, audioSrc }) {
  // ─── DOM refs ─────────────────────────────────────────────
  const canvas    = container.querySelector("#summary-fluid-canvas");
  const revealEl  = container.querySelector("#summary-reveal");
  const revealW   = container.querySelector("#summary-reveal-word");
  // In-panel emotion word, sits below the circumplex and above the
  // brain-waves. Matches the live-session rhythm the user already knows.
  const panelWordEl = container.querySelector("#summary-panel-word");
  const panelWordText = container.querySelector("#summary-panel-word-text");
  const titleEl   = container.querySelector("#summary-title");
  const metaEl    = container.querySelector("#summary-meta");
  const svg       = container.querySelector("#summary-vis-svg");
  const wavesC    = container.querySelector("#summary-brainwaves");
  const playBtn   = container.querySelector("#btn-summary-play");
  const track     = container.querySelector("#summary-track");
  const fill      = container.querySelector("#summary-track-fill");
  const handle    = container.querySelector("#summary-track-handle");
  const timeleft  = container.querySelector("#summary-timeleft");
  const clockEl   = container.querySelector("#summary-clock");
  const notesTrack = container.querySelector("#summary-notes-track");
  const voiceList = container.querySelector("#summary-voicelist");
  dbg("log", "[summary] mount. voiceList=", !!voiceList, "notesTrack=", !!notesTrack, "session.voiceNotes=", Array.isArray(session.voiceNotes) ? session.voiceNotes.length : "NA");

  // ─── Header + meta ────────────────────────────────────────
  titleEl.textContent = session.dominantEmotion?.name || "Untitled";
  // v1.5.1 — same two-line meta + narrative treatment as the Session
  // Complete header, so the replay screen carries identical vocabulary
  // and story treatment.
  const _meta = formatMetaLines(session);
  const _esc = (str) => String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  metaEl.innerHTML = `
    <span class="ea-session-meta__line">${_esc(_meta.line1)}</span>
    <span class="ea-session-meta__line">${_esc(_meta.line2)}<button
        class="ea-session-meta__info"
        type="button"
        aria-label="What do these terms mean?"
        data-ea-tip="session-vocab"
      ><span aria-hidden="true">i</span></button></span>
    <span class="ea-session-narrative">${_esc(buildSessionNarrative(session))}</span>
  `;

  // ─── Visual style (fresh per replay) ─────────────────────
  // Replays honour the visual style the user selected on the Before
  // screen for THIS session. Chapel, Halo, Skyspace, Aperture, or the
  // original Breath fluid. Resolution order:
  //   1. session.visualStyle stamped by commitSession()
  //   2. "ea:visualStyle" persisted to localStorage by the picker (belt
  //      and braces if the record was written before we started stamping)
  //   3. "current" (Breath) fallback
  // If the resolved class fails to construct (unlikely but possible on
  // devices with quirky WebGL2 support) we drop back to Breath so the
  // replay always renders something instead of a black canvas.
  // v1.5.1, the localStorage "ea:visualStyle" fallback was REMOVED.
  // It silently overrode the recorded style with the picker's *current*
  // selection, so replaying an older session showed the last-picked
  // style rather than the one that was actually recorded. Stamped
  // records now win unconditionally. Unstamped legacy records land on
  // Breath, never on "whatever the user last tapped in the picker".
  const recordedStyleId = session.visualStyle || "current";
  dbg("log", "[summary] visual style resolved to:", recordedStyleId, "(from record:", session.visualStyle, ")");

  let fluid = null;
  // v1.5.2: expose the replay fluid instance globally so external
  // modules (Replay-Zen) can call resize() when the header collapses.
  if (!window.__EA__) window.__EA__ = {};
  const _prevReplayFluid = window.__EA__.summaryFluid;
  try {
    const StyleCls = StyleRegistry.getOrFallback(recordedStyleId, "current");
    if (StyleCls) {
      dbg("log", "[summary] instantiating style class:", StyleCls.id, StyleCls.name);
      fluid = new StyleCls(canvas);
    } else {
      dbg("warn", "[summary] no style class resolved, falling back to FluidEngine");
      fluid = new FluidEngine(canvas);
    }
    fluid.resize();
    fluid.start();
    window.__EA__.summaryFluid = fluid;
    // Cross-fade to dark just like the live session does.
    requestAnimationFrame(() => fluid.crossfadeSurfaceTo(SESSION_INK, 900));
  } catch (err) {
    console.warn("[summary] visual style init failed, falling back to Breath:", err);
    try {
      fluid = new FluidEngine(canvas);
      fluid.resize();
      fluid.start();
      window.__EA__.summaryFluid = fluid;
      requestAnimationFrame(() => fluid.crossfadeSurfaceTo(SESSION_INK, 900));
    } catch (err2) {
      console.warn("[summary] Breath fallback also failed:", err2);
    }
  }

  // ─── Circumplex trail replay ─────────────────────────────
  // The replay UI is the canonical demo of the full simulated Muse
  // experience, brain-waves are ALWAYS mounted so users see the whole
  // interface (circumplex + EEG lanes) regardless of whether a physical
  // headband was connected during the session. The museMode data attr
  // still reflects the original mode so trail colouring stays honest.
  const noMuseReplay = !!session.noMuse;
  const wavesBand = container.querySelector(".ea-summary__waves");
  if (wavesBand) wavesBand.hidden = false;
  if (container.dataset) container.dataset.museMode = noMuseReplay ? "off" : "on";

  const museVis = mountMuseVis(svg);
  const waves   = mountBrainWaves(wavesC);

  // ─── Audio for replay ────────────────────────────────────
  // The playback uses a fresh audio element rather than the live-session
  // AudioReactive so the two never fight for the same source.
  const player = new Audio(audioSrc);
  player.preload = "auto";
  // Slightly ducked so voice notes overlay cleanly.
  player.volume = 0.85;

  // Sample & crossing cursors, advance by playback clock, not sample rate.
  const samples   = Array.isArray(session.samples) ? session.samples : [];
  const crossings = Array.isArray(session.crossings) ? session.crossings : [];
  const notes     = Array.isArray(session.voiceNotes) ? session.voiceNotes : [];
  const t0Session = session.startedAt || 0;
  let sampleIdx = 0;
  let crossIdx  = 0;
  let noteIdx   = 0;
  const totalMs = Math.max(1000, session.durationMs || 0);

  // Precompute crossing t-offsets in ms from session start
  const crossOffsets = crossings.map(c => Math.max(0, (c.t || 0) - t0Session));
  const noteOffsets  = notes.map(n => Math.max(0, (n.at || 0) - t0Session));

  // ─── Voice-note UI: dots on the scrub + clickable pills below ───
  // Track handle map so a pill can flip visual state while playing.
  const pillHandles = new Map(); // idx -> { handle, pillEl }
  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }
  function fmtDur(ms) {
    if (!ms || ms < 1000) return "≤ 1s";
    const s = Math.round(ms / 1000);
    return `${s}s`;
  }
  // Build markers on the track
  if (notesTrack) {
    notesTrack.innerHTML = "";
    for (let i = 0; i < notes.length; i++) {
      const off = noteOffsets[i];
      const pct = Math.max(0, Math.min(1, off / totalMs));
      const dot = document.createElement("span");
      dot.className = "ea-summary__note-dot";
      dot.style.left = (pct * 100).toFixed(2) + "%";
      notesTrack.appendChild(dot);
    }
  }
  // Build clickable pill list. Pills manually trigger playback, the user
  // no longer has to wait for the timeline to reach the recording moment.
  function stopAllPills() {
    for (const { handle, pillEl } of pillHandles.values()) {
      try { handle && handle.stop && handle.stop(); } catch {}
      pillEl.classList.remove("ea-summary__voice-pill--playing");
      pillEl.classList.remove("ea-summary__voice-pill--replay");
      const g = pillEl.querySelector(".ea-summary__voice-pill__glyph");
      if (g) g.textContent = "▶";
    }
    pillHandles.clear();
  }
  if (voiceList) {
    voiceList.innerHTML = "";
    if (!notes.length) {
      dbg("warn", "[summary] no voice notes in session record — rendering empty state");
      // Explicit empty state so the section stays discoverable. The card
      // stays on-screen with a muted "no notes" line rather than vanishing
      //, users kept asking "where are the voice notes?" when the section
      // was hidden entirely.
      const heading = document.createElement("div");
      heading.className = "ea-summary__voicelist-heading";
      heading.textContent = "Voice notes";
      voiceList.appendChild(heading);
      const empty = document.createElement("div");
      empty.className = "ea-summary__voicelist-empty";
      empty.textContent = "No voice notes were recorded during this session.";
      voiceList.appendChild(empty);
    } else {
      dbg("ok", "[summary] rendering", notes.length, "voice-note pills. url-count=", notes.filter(n => !!n.url).length);
      // Section header, makes the list obviously findable on-screen.
      const heading = document.createElement("div");
      heading.className = "ea-summary__voicelist-heading";
      heading.textContent = notes.length === 1
        ? "Your voice note"
        : `Your voice notes (${notes.length})`;
      voiceList.appendChild(heading);

      notes.forEach((n, i) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "ea-summary__voice-pill";
        pill.setAttribute("aria-label", `Play voice note ${i + 1} at ${fmtTime(noteOffsets[i])}, duration ${fmtDur(n.durationMs)}`);
        // Glyph is a real play triangle. When playing, CSS overlays a
        // pause visual via the --playing modifier class.
        pill.innerHTML =
          `<span class="ea-summary__voice-pill__glyph" aria-hidden="true">▶</span>` +
          `<span class="ea-summary__voice-pill__label">Voice note ${i + 1}</span>` +
          `<span class="ea-summary__voice-pill__dur">${fmtDur(n.durationMs)}</span>` +
          `<span class="ea-summary__voice-pill__time">@ ${fmtTime(noteOffsets[i])}</span>`;

        const glyph = pill.querySelector(".ea-summary__voice-pill__glyph");

        pill.addEventListener("click", () => {
          // Toggle: clicking a playing pill stops it.
          if (pillHandles.has(i)) {
            const { handle, pillEl } = pillHandles.get(i);
            try { handle && handle.stop && handle.stop(); } catch {}
            pillEl.classList.remove("ea-summary__voice-pill--playing");
            const g = pillEl.querySelector(".ea-summary__voice-pill__glyph");
            if (g) g.textContent = "▶";
            pillHandles.delete(i);
            return;
          }
          // Otherwise stop everything and start this one.
          stopAllPills();
          if (!n.url) return;   // blob URL lost across reload
          // Seek the main timeline to the exact moment this voice note
          // was recorded so the fluid + emotion trail replay the state
          // that was happening while the artist spoke. If totalMs is
          // zero we skip seeking (empty session guard).
          if (totalMs > 0) {
            const pct = Math.min(1, Math.max(0, noteOffsets[i] / totalMs));
            try { seekTo(pct); } catch {}
          }
          try {
            const h = playVoiceNote(n.url, audio, { duckLevel: 0.3, duckMs: 400 });
            if (h) {
              pill.classList.add("ea-summary__voice-pill--playing");
              if (glyph) glyph.textContent = "❙❙";
              pillHandles.set(i, { handle: h, pillEl: pill });
              if (h.ended && typeof h.ended.then === "function") {
                h.ended.then(() => {
                  pill.classList.remove("ea-summary__voice-pill--playing");
                  if (glyph) glyph.textContent = "↻";
                  // Enter "replay" affordance: swap label to "Tap to replay",
                  // pulse the pill briefly, and clear the handle so the next
                  // click starts fresh. After 4s revert to normal state.
                  pill.classList.add("ea-summary__voice-pill--replay");
                  const labelEl = pill.querySelector(".ea-summary__voice-pill__label");
                  const origLabel = labelEl ? labelEl.textContent : null;
                  if (labelEl) labelEl.textContent = "Tap to replay";
                  pillHandles.delete(i);
                  setTimeout(() => {
                    if (!pillHandles.has(i)) {
                      pill.classList.remove("ea-summary__voice-pill--replay");
                      if (glyph) glyph.textContent = "▶";
                      if (labelEl && origLabel !== null) labelEl.textContent = origLabel;
                    }
                  }, 4000);
                });
              }
            }
          } catch (e) { console.warn("[summary] pill play failed:", e); }
        });
        voiceList.appendChild(pill);
      });
    }
  }

  // ─── Reveal a word overlay + splat when crossing ─────────
  // Word is PERSISTENT during playback (see tick sample-advance loop).
  // fireCrossing() still refreshes the label/hue on anchor transitions and
  // fires a bright splat, but never schedules a hide.
  function fireCrossing(c) {
    if (!c) return;
    if (revealW && revealEl) {
      revealW.textContent = c.name;
      revealW.style.setProperty("--reveal-hue", liftForLegibility(c.hex));
      revealEl.setAttribute("aria-hidden", "false");
    }
    // Mirror to the in-panel word (elegant serif under the circumplex,
    // above brain-waves) so users see the current emotion in the same
    // location the live session showed it.
    if (panelWordEl && panelWordText) {
      panelWordText.textContent = c.name;
      panelWordEl.style.setProperty("--reveal-hue", liftForLegibility(c.hex));
      panelWordEl.setAttribute("aria-hidden", "false");
    }
    if (fluid && c.hex) {
      const rr = parseInt(c.hex.slice(1, 3), 16) / 255;
      const gg = parseInt(c.hex.slice(3, 5), 16) / 255;
      const bb = parseInt(c.hex.slice(5, 7), 16) / 255;
      const cx = 0.42 + Math.random() * 0.16;
      const cy = 0.42 + Math.random() * 0.16;
      fluid.splat(cx, cy,
        (Math.random() - 0.5) * 380,
        (Math.random() - 0.5) * 380,
        { r: rr, g: gg, b: bb },
        0.006);
    }
  }

  function firePeriodicSplat(v, a, o, hex) {
    // Every ~7 samples add a light splat so the fluid keeps moving even
    // when the puck lingers in a single quadrant for a long time.
    if (!fluid || !hex) return;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const x = 0.5 + v * 0.25;
    const y = 0.5 - a * 0.25;
    fluid.splat(x, y,
      (Math.random() - 0.5) * 220,
      (Math.random() - 0.5) * 220,
      { r, g, b },
      0.003);
  }

  // ─── Voice-note re-firing ────────────────────────────────
  // Track handles so destroy() can stop any voice-note that is still
  // playing when the user leaves the Summary screen, otherwise their
  // audio elements outlive the view and leak into the next session.
  const activeVoiceHandles = [];
  function firePendingVoiceNotes(elapsedMs) {
    while (noteIdx < notes.length && noteOffsets[noteIdx] <= elapsedMs) {
      const n = notes[noteIdx++];
      if (n && n.url) {
        try {
          // NOTE: playVoiceNote signature is (url, audioReactive, opts).
          // Passing the second arg lets it duck the music. If we pass
          // opts by mistake in the audioReactive slot, duckTo() throws
          // silently and the voice note NEVER plays.
          const h = playVoiceNote(n.url, audio, { duckLevel: 0.3, duckMs: 400 });
          if (h) activeVoiceHandles.push(h);
        } catch (e) { console.warn("[summary] voice-note play failed:", e); }
      }
    }
  }

  // ─── Main tick ────────────────────────────────────────────
  let rafId = 0;
  let paused = true;
  // The tick uses player.currentTime as the source of truth so pausing
  // the audio pauses everything else. If audio didn't load (missing
  // asset) OR the browser blocked autoplay, we fall back to a synthetic clock
  // so the visuals never freeze.
  let fallbackStartMs = 0;
  let fallbackAccMs = 0;
  let audioPlayable = false; // becomes true only after a successful play()
  const useFallback = () =>
    !audioPlayable || !player.duration || Number.isNaN(player.duration) || player.paused;

  function currentElapsedMs() {
    if (useFallback()) {
      if (paused) return fallbackAccMs;
      return fallbackAccMs + (performance.now() - fallbackStartMs);
    }
    // The audio track plays at real time (1:1). Session recordings can be
    // arbitrarily short so we use the audio's currentTime as raw elapsed
    // seconds, capped at the session duration.
    return Math.min(totalMs, player.currentTime * 1000);
  }

  function tick() {
    const t = currentElapsedMs();

    // Advance sample cursor. This loop only fires the DISCRETE per-sample
    // effects: bright bookkeeping splats every 8 samples, and the panel
    // word / museVis / EEG lane updates whose changes are label-driven.
    // The FLUID setEmotion has moved out of this loop, see the
    // per-frame interpolation block below.
    while (sampleIdx < samples.length &&
           samples[sampleIdx].t - t0Session <= t) {
      const s = samples[sampleIdx++];
      const label = s.label || emotionToLabel(s.v, s.a);
      museVis.update({ v: s.v, a: s.a, o: s.o }, label);
      // waves is null in no-Muse mode, the EEG lanes are hidden and we don't paint into them.
      if (waves) waves.setState({ v: s.v, a: s.a, o: s.o });
      if ((sampleIdx & 7) === 0) firePeriodicSplat(s.v, s.a, s.o, s.hex);

      // PERSISTENT emotion word during replay, museum-plaque feel.
      // Every sample keeps the word in sync with the puck; we do NOT
      // auto-clear. fireCrossing() still fires transient bright splats on
      // anchor transitions and can override the hue at that moment.
      if (revealW && revealEl && label) {
        revealW.textContent = label;
        if (s.hex) revealW.style.setProperty("--reveal-hue", liftForLegibility(s.hex));
        if (revealEl.getAttribute("aria-hidden") !== "false") {
          revealEl.setAttribute("aria-hidden", "false");
        }
      }
      // Mirror the persistent word into the in-panel slot.
      if (panelWordEl && panelWordText && label) {
        panelWordText.textContent = label;
        if (s.hex) panelWordEl.style.setProperty("--reveal-hue", liftForLegibility(s.hex));
        if (panelWordEl.getAttribute("aria-hidden") !== "false") {
          panelWordEl.setAttribute("aria-hidden", "false");
        }
      }
    }

    // Per-frame interpolation of v/a/o into the fluid.
    //
    // Sessions get recorded at whatever rate the muse source is emitting
    // (~10 Hz) but the RAF tick runs at 60fps. If we drop setEmotion into
    // the per-sample loop above, the fluid gets a hard step every 100ms
    // and the puff visibly jerks between anchor emotions. Even worse
    // during long lingers where consecutive samples are 500ms+ apart.
    //
    // The fix is to lerp v/a/o at RAF cadence between the sample AT or
    // BEFORE `t` and the sample AFTER `t`, using the fractional position
    // between their timestamps. Fluid engines already crossfade their own
    // internal palette on setEmotion, so feeding them a continuous stream
    // rather than steps produces the same silk-smooth motion the live
    // session has.
    if (fluid && samples.length) {
      const prevIdx = Math.max(0, sampleIdx - 1);
      const s0 = samples[prevIdx];
      const s1 = samples[Math.min(samples.length - 1, prevIdx + 1)];
      const t0 = s0.t - t0Session;
      const t1 = s1.t - t0Session;
      let f = 0;
      if (t1 > t0) {
        f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      }
      const vi = s0.v + (s1.v - s0.v) * f;
      const ai = s0.a + (s1.a - s0.a) * f;
      const oi = (s0.o == null || s1.o == null)
        ? (s0.o != null ? s0.o : (s1.o != null ? s1.o : 0.5))
        : s0.o + (s1.o - s0.o) * f;
      const iLabel = s0.label || emotionToLabel(s0.v, s0.a);
      try { fluid.setEmotion(vi, ai, oi, iLabel); } catch { /* fluid may be tearing down */ }
    }

    // Advance crossing cursor
    while (crossIdx < crossings.length && crossOffsets[crossIdx] <= t) {
      fireCrossing(crossings[crossIdx++]);
    }

    // Fire voice notes
    firePendingVoiceNotes(t);

    // Update scrub bar
    const pct = Math.max(0, Math.min(1, t / totalMs));
    if (fill) fill.style.width = (pct * 100).toFixed(2) + "%";
    if (handle) handle.style.left = (pct * 100).toFixed(2) + "%";
    if (track) track.setAttribute("aria-valuenow", Math.round(pct * 100));
    const remainMs = Math.max(0, totalMs - t);
    if (timeleft) {
      const s = Math.round(remainMs / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      timeleft.textContent = `-${mm}:${ss}`;
    }
    if (clockEl) {
      const s = Math.round(t / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      clockEl.textContent = `${mm}:${ss}`;
    }

    // End of clip?
    if (t >= totalMs && !paused) {
      _pauseAtEnd();
    }
    rafId = requestAnimationFrame(tick);
  }

  // ─── Play / pause / seek ──────────────────────────────────
  function _play() {
    // Snapshot the current elapsed *before* flipping paused so we don't lose
    // the fallback accumulator when transitioning play states.
    const priorElapsed = currentElapsedMs();
    paused = false;
    fallbackAccMs = priorElapsed;
    fallbackStartMs = performance.now();
    // Try to start the audio. If it succeeds, sync its currentTime to our
    // fallback elapsed so the tick clock doesn't jump backwards. If it fails
    // (autoplay block or missing asset), useFallback() stays true and the
    // synthetic clock keeps running.
    // Ensure audio starts from the fallback-clock position so the two clocks
    // stay in sync. Audio plays at 1:1 real time.
    if (player.duration && !Number.isNaN(player.duration)) {
      try {
        const target = priorElapsed / 1000;
        player.currentTime = Math.max(0, Math.min(player.duration - 0.001, target));
      } catch {}
    }
    const p = player.play();
    if (p && typeof p.then === "function") {
      p.then(() => { audioPlayable = true; })
       .catch(() => { audioPlayable = false; });
    }
    playBtn.textContent = "❚❚";
    playBtn.setAttribute("aria-label", "Pause");
  }
  function _pause() {
    // Capture the current elapsed *before* flipping paused so the fallback
    // clock resumes from the same place next time.
    fallbackAccMs = currentElapsedMs();
    paused = true;
    try { player.pause(); } catch {}
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Play");
    playBtn.removeAttribute("data-state");
  }
  // When playback reaches the end, swap the play glyph to a restart icon so the
  // user has a clear affordance to hear it again.
  function _pauseAtEnd() {
    fallbackAccMs = totalMs;
    paused = true;
    try { player.pause(); } catch {}
    playBtn.textContent = "↻";
    playBtn.setAttribute("aria-label", "Play again");
    playBtn.setAttribute("data-state", "ended");
  }
  function _restart() {
    // Reset every cursor + clock to zero and play from the top.
    sampleIdx = 0; crossIdx = 0; noteIdx = 0;
    fallbackAccMs = 0;
    fallbackStartMs = performance.now();
    try { if (player.duration && !Number.isNaN(player.duration)) player.currentTime = 0; } catch {}
    playBtn.removeAttribute("data-state");
    _play();
  }
  playBtn.addEventListener("click", () => {
    // Restart when we're sitting at the end.
    if (playBtn.getAttribute("data-state") === "ended") { _restart(); return; }
    paused ? _play() : _pause();
  });

  // Auto-start playback once the audio metadata is ready (or immediately
  // if we're using the fallback clock).
  const kickoff = () => {
    // Snap cursors back to zero on (re)mount
    sampleIdx = 0; crossIdx = 0; noteIdx = 0;
    fallbackStartMs = performance.now();
    fallbackAccMs = 0;
    _play();
  };
  if (useFallback()) {
    kickoff();
  } else {
    if (player.readyState >= 1) {
      kickoff();
    } else {
      player.addEventListener("loadedmetadata", kickoff, { once: true });
    }
  }

  // Drag-to-scrub on the track. Behaves like a proper slider:
  //   • pointerdown → seek + capture pointer
  //   • pointermove while dragging → seek to current x
  //   • pointerup / cancel → release + resume
  let dragging = false;
  let wasPlayingBeforeDrag = false;

  function seekTo(pct) {
    pct = Math.max(0, Math.min(1, pct));
    fallbackAccMs = pct * totalMs;
    fallbackStartMs = performance.now();
    if (player.duration && !Number.isNaN(player.duration)) {
      try { player.currentTime = Math.min(player.duration - 0.001, (pct * totalMs) / 1000); } catch {}
    }
    // Rewind cursors to the new position (playback fires forward from here).
    sampleIdx = 0; crossIdx = 0; noteIdx = 0;
    // v1.6.3.20: also reset the trail so the next segment doesn't span
    // from the old puck position to the scrubbed-to sample, drawing a
    // stray line that appears to leave the circle. Then replay the trail
    // up to backT so the visible history matches the audio position.
    try { museVis.resetTrail && museVis.resetTrail(); } catch {}
    const backT = pct * totalMs;
    // Redraw trail history up to backT before advancing sampleIdx.
    for (let i = 0; i < samples.length; i++) {
      const st = samples[i].t - t0Session;
      if (st > backT) break;
      museVis.update({ v: samples[i].v, a: samples[i].a, o: samples[i].o }, samples[i].label);
    }
    while (sampleIdx < samples.length && samples[sampleIdx].t - t0Session <= backT) sampleIdx++;
    while (crossIdx  < crossings.length && crossOffsets[crossIdx] <= backT) crossIdx++;
    while (noteIdx   < notes.length && noteOffsets[noteIdx] <= backT) noteIdx++;
    // Reflect immediately in the UI so scrub feels responsive even when paused.
    if (fill) fill.style.width = (pct * 100).toFixed(2) + "%";
    if (handle) handle.style.left = (pct * 100).toFixed(2) + "%";
    if (track) track.setAttribute("aria-valuenow", Math.round(pct * 100));
    // If we scrubbed OFF the end, clear the ended state so the user can play again.
    if (pct < 0.999 && playBtn.getAttribute("data-state") === "ended") {
      playBtn.textContent = paused ? "▶" : "❚❚";
      playBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
      playBtn.removeAttribute("data-state");
    }
  }

  function pctFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const x = ((e.touches?.[0] || e).clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, x));
  }

  // iOS Safari fights us for the touch stream on horizontal scrub inside
  // an absolute-positioned scroll container. To reliably capture the
  // drag we handle both pointer events (desktop + modern iOS) and touch
  // events (older iOS + belt-and-braces), and explicitly preventDefault
  // so the browser doesn't try to scroll the parent while we drag.
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    wasPlayingBeforeDrag = !paused;
    if (!paused) _pause();
    track.classList.add("ea-summary__track--dragging");
    try { track.setPointerCapture(e.pointerId); } catch {}
    try { e.preventDefault(); } catch {}
    seekTo(pctFromEvent(e));
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    try { e.preventDefault(); } catch {}
    seekTo(pctFromEvent(e));
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch {}
    track.classList.remove("ea-summary__track--dragging");
    if (wasPlayingBeforeDrag) _play();
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  // Touch fallback: some iOS Safari builds don't reliably deliver
  // pointermove during a fast horizontal drag when the underlying
  // ancestor has overflow:auto. Handling touchmove with passive:false
  // and preventDefault guarantees the browser hands us the whole gesture.
  track.addEventListener("touchstart", (e) => {
    if (dragging) return; // pointerdown already handled
    dragging = true;
    wasPlayingBeforeDrag = !paused;
    if (!paused) _pause();
    track.classList.add("ea-summary__track--dragging");
    try { e.preventDefault(); } catch {}
    seekTo(pctFromEvent(e));
  }, { passive: false });
  track.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    try { e.preventDefault(); } catch {}
    seekTo(pctFromEvent(e));
  }, { passive: false });
  track.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("ea-summary__track--dragging");
    if (wasPlayingBeforeDrag) _play();
  });
  track.addEventListener("touchcancel", () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("ea-summary__track--dragging");
    if (wasPlayingBeforeDrag) _play();
  });
  // Keyboard scrub for a11y, left/right by 5%, home/end for endpoints.
  track.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.05;
    const curPct = Math.max(0, Math.min(1, currentElapsedMs() / totalMs));
    if (e.key === "ArrowLeft")  { seekTo(curPct - step); e.preventDefault(); }
    if (e.key === "ArrowRight") { seekTo(curPct + step); e.preventDefault(); }
    if (e.key === "Home")       { seekTo(0);             e.preventDefault(); }
    if (e.key === "End")        { seekTo(1);             e.preventDefault(); }
  });

  rafId = requestAnimationFrame(tick);

  return function destroy() {
    // Mark paused first so any in-flight tick() bails.
    paused = true;
    cancelAnimationFrame(rafId);
    rafId = 0;

    // Stop the summary's music player and fully release its src so the
    // <audio> element does not keep buffering / playing after unmount.
    try { player.pause(); } catch {}
    try { player.muted = true; } catch {}
    try { player.currentTime = 0; } catch {}
    try { player.removeAttribute("src"); } catch {}
    try { player.src = ""; } catch {}
    try { player.load(); } catch {}

    // Belt-and-suspenders: on iOS Safari the play() promise can resolve
    // AFTER destroy() has run, which restarts audio a beat after the user
    // navigates away. Repeat the pause on the next microtask + a short
    // delay to catch any late-resolving play promise.
    Promise.resolve().then(() => { try { player.pause(); } catch {} });
    setTimeout(() => { try { player.pause(); } catch {} }, 100);
    setTimeout(() => { try { player.pause(); } catch {} }, 400);

    // Also stop ANY other audio element that may still be playing in the
    // page (defensive, shouldn't be needed but iOS Safari has surprised
    // us before with orphaned <audio> elements from voice notes or the
    // AudioReactive singleton).
    try {
      document.querySelectorAll("audio").forEach((el) => {
        try { el.pause(); } catch {}
      });
    } catch {}
    try { audio && audio.stop && audio.stop(); } catch {}

    // Stop every voice-note that is still playing (both timeline-fired and
    // pill-triggered).
    for (const h of activeVoiceHandles) {
      try { h && h.stop && h.stop(); } catch {}
    }
    activeVoiceHandles.length = 0;
    for (const { handle, pillEl } of pillHandles.values()) {
      try { handle && handle.stop && handle.stop(); } catch {}
      try { pillEl.classList.remove("ea-summary__voice-pill--playing"); } catch {}
    }
    pillHandles.clear();
    try { fluid && fluid.stop(); } catch {}
    try { museVis && museVis.destroy(); } catch {}
    try { waves && waves.destroy(); } catch {}
    if (revealEl) revealEl.setAttribute("aria-hidden", "true");
  };
}
