/**
 * Empathic Art — After view: Session Gallery
 * ────────────────────────────────────────────────────────────────
 * A grid of square thumbnails, one card per completed session.
 * Each card is a living miniature of the session:
 *
 *   · BACKGROUND: an animated replay of the recorded session, driven
 *     by the same visual-style engine that ran during the live take
 *     (Breath / Ember / Smokering / etc.). Rendered by a single shared
 *     off-screen engine that rotates through visible cards round-robin
 *     — one card animates at a time (~2s per turn) while the others
 *     retain their last painted frame. Keeps iPhone Safari well under
 *     the WebGL context ceiling and the battery quiet.
 *
 *   · FOREGROUND: the valence/arousal circumplex trail drawn as a
 *     translucent legend at ~50% opacity, so you can still read the
 *     shape of the emotional journey through the fluid painting.
 *
 *   · A small speaker chip in the top-left, present only when the
 *     session has a voice note. Tap plays the voice note in place;
 *     tap again to stop. Persisted sessions whose blob URLs did not
 *     survive a reload show the chip in a dimmed unavailable state.
 *
 *   · An (i) chip in the top-right that reveals a detail popover with
 *     recorded date + time, total duration, art style, top-3 emotions,
 *     an inline Voice note row (when present), and Open / Delete
 *     actions.
 *
 * The gallery complements the Timeline view: Timeline is the
 * chronological ribbon (oldest → newest), Gallery is the archive
 * (newest-first grid of portraits).
 *
 * Public API:
 *   mountGalleryView({ container, sessions, onOpen, onDelete }) → destroy()
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS }        from "../palette/emotion-palette.js?v=1.3.1";
import { computeDominant } from "./session-history.js?v=1.4.3";
import { StyleRegistry }   from "../visuals/index.js?v=1.3.7";
import { playVoiceNote }   from "../audio/gallery-voice.js?v=1.3.1";

// ─────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function fmtShortCapsDate(ms) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtLongDateTime(ms) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = MONTHS_SHORT[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min} · ${dd} ${mm} ${yyyy}`;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

function fmtVoiceDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function lexEntry(name) {
  return EMOTIONS.find(e => e.name === name) || null;
}

function styleLabel(id) {
  if (!id || id === "current") return "Breath";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function hasPlayableVoice(session) {
  const notes = Array.isArray(session?.voiceNotes) ? session.voiceNotes : [];
  return notes.some(n => n && n.url);
}

function hasAnyVoiceMeta(session) {
  const notes = Array.isArray(session?.voiceNotes) ? session.voiceNotes : [];
  return notes.length > 0;
}

/**
 * Top-N dwell emotions across a session's samples, sorted by dwell time
 * (sample count) descending. Falls back to the dominantEmotion if the
 * session has no per-sample labels.
 */
function topEmotions(session, n = 3) {
  const samples = session.samples || [];
  if (!samples.length) {
    const dom = session.dominantEmotion;
    return dom ? [{ name: dom.name, hex: dom.hex, share: 1 }] : [];
  }
  const counts = new Map();
  for (const s of samples) {
    if (!s || !s.label) continue;
    counts.set(s.label, (counts.get(s.label) || 0) + 1);
  }
  const total = samples.length;
  const ranked = [...counts.entries()]
    .map(([name, c]) => {
      const emo = lexEntry(name);
      return {
        name,
        hex: emo ? emo.hex : "#888888",
        share: c / total,
      };
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, n);
  return ranked;
}

// ─────────────────────────────────────────────────────────────
// Circumplex trail overlay
// The trail is drawn as a translucent legend on top of the replay
// so the shape of the emotional journey remains readable even when
// the underlying painting is busy.
// ─────────────────────────────────────────────────────────────

const TRAIL_OVERLAY_ALPHA = 0.50;

function paintTrailOverlay(canvas, session) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 160;
  const cssH = canvas.clientHeight || 160;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const cx = cssW / 2;
  const cy = cssH / 2;
  const r  = Math.min(cx, cy) - 6;

  // Cross-hairs + subtle disc, extremely quiet so the replay stays lead.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();

  const samples = (session.samples || []).filter(
    s => s && Number.isFinite(s.v) && Number.isFinite(s.a),
  );

  // Group + overlay: paint everything at TRAIL_OVERLAY_ALPHA so the legend
  // reads as a soft veil over the animated fluid.
  ctx.save();
  ctx.globalAlpha = TRAIL_OVERLAY_ALPHA;

  if (samples.length < 2) {
    const seed = session.seed || { valence: 0, arousal: 0 };
    const dom  = session.dominantEmotion || { hex: "#c9c9c9" };
    ctx.beginPath();
    ctx.arc(
      cx + (seed.valence || 0) * r,
      cy - (seed.arousal || 0) * r,
      6, 0, Math.PI * 2,
    );
    ctx.fillStyle = dom.hex;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.lineCap  = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4;

  // ── Bezier trail ─────────────────────────────────────────────────────
  // Straight segments made the trail look like an EKG. The emotional
  // path through a session is continuous, not stepped, so each segment
  // is drawn as a Catmull-Rom-derived cubic Bezier: the two control
  // handles are derived from the previous and next neighbors, producing
  // a smooth curve that still passes exactly through every sample.
  //
  // Segments are still colored by the starting sample's dominant
  // emotion so the color progression along the arc is preserved.
  // Tension 0.5 gives Apple-native "smooth without overshoot".
  //   (Cycle 11, Eyal Gever, 2026-07-13)
  const TENSION = 0.5;
  const px = (p) => cx + (p.v || 0) * r;
  const py = (p) => cy - (p.a || 0) * r;

  for (let i = 0; i < samples.length - 1; i++) {
    const p0 = samples[i - 1] || samples[i];
    const p1 = samples[i];
    const p2 = samples[i + 1];
    const p3 = samples[i + 2] || samples[i + 1];

    // Cubic Bezier control points from Catmull-Rom (uniform, tension).
    const c1x = px(p1) + (px(p2) - px(p0)) * TENSION / 3;
    const c1y = py(p1) + (py(p2) - py(p0)) * TENSION / 3;
    const c2x = px(p2) - (px(p3) - px(p1)) * TENSION / 3;
    const c2y = py(p2) - (py(p3) - py(p1)) * TENSION / 3;

    ctx.strokeStyle = p1.hex || "#c9c9c9";
    ctx.beginPath();
    ctx.moveTo(px(p1), py(p1));
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, px(p2), py(p2));
    ctx.stroke();
  }

  const first = samples[0];
  const last  = samples[samples.length - 1];
  ctx.strokeStyle = first.hex || "#c9c9c9";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx + first.v * r, cy - first.a * r, 3.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = last.hex || "#c9c9c9";
  ctx.beginPath();
  ctx.arc(cx + last.v * r, cy - last.a * r, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// Voice-note single-player guard
// Only one voice note plays at a time — starting another stops the
// prior one. Used by both the on-card speaker chip and the (i)
// popover row.
// ─────────────────────────────────────────────────────────────

let _voicePlayback = null;      // { handle, cardEl, sessionId }
const _voiceListeners = new Set();

function _notifyVoice(sessionId, playing) {
  for (const cb of _voiceListeners) {
    try { cb(sessionId, playing); } catch {}
  }
}

function stopVoicePlayback() {
  if (!_voicePlayback) return;
  const prev = _voicePlayback;
  _voicePlayback = null;
  try { prev.handle.stop(); } catch {}
  _notifyVoice(prev.sessionId, false);
}

function startVoicePlayback(session) {
  const url = (session.voiceNotes || []).find(n => n && n.url)?.url || null;
  if (!url) return false;
  // Always stop any prior voice first (single-player).
  stopVoicePlayback();
  const handle = playVoiceNote(url, /* audioReactive */ null);
  _voicePlayback = { handle, sessionId: session.id };
  _notifyVoice(session.id, true);
  handle.ended.then(() => {
    // Only clear if this playback is still the active one; a manual
    // stop earlier would already have cleared _voicePlayback.
    if (_voicePlayback && _voicePlayback.handle === handle) {
      const sid = _voicePlayback.sessionId;
      _voicePlayback = null;
      _notifyVoice(sid, false);
    }
  });
  return true;
}

function onVoiceStateChange(cb) {
  _voiceListeners.add(cb);
  return () => _voiceListeners.delete(cb);
}

// ─────────────────────────────────────────────────────────────
// Info popover (opens from the (i) chip on each card)
// ─────────────────────────────────────────────────────────────

let _openPopover = null;

function closeOpenPopover() {
  if (!_openPopover) return;
  const bd = _openPopover;
  _openPopover = null;
  bd.setAttribute("data-open", "false");
  setTimeout(() => { try { bd.remove(); } catch {} }, 180);
  document.removeEventListener("keydown", _onEscClose, true);
}
function _onEscClose(e) {
  if (e.key === "Escape") { e.preventDefault(); closeOpenPopover(); }
}

function openInfoPopover({ session, onOpen, onDelete }) {
  closeOpenPopover();

  const top = topEmotions(session, 3);
  const chipsHtml = top.length
    ? top.map(t => `
        <span class="ea-gallery-info__chip">
          <span class="ea-gallery-info__dot" style="background:${t.hex}"></span>
          ${t.name}
        </span>
      `).join("")
    : `<span class="ea-gallery-info__chip ea-gallery-info__chip--muted">
         No emotion data
       </span>`;

  // Voice-note row: shown only when the session recorded at least one
  // voice note. If the note's blob URL was lost across a reload, the
  // button is dimmed and its label communicates that state.
  const notes = Array.isArray(session.voiceNotes) ? session.voiceNotes : [];
  const playable = notes.find(n => n && n.url) || null;
  const voiceRowHtml = notes.length === 0 ? "" : `
    <div class="ea-gallery-info-panel__row ea-gallery-info-panel__row--voice">
      <dt>Voice note</dt>
      <dd class="ea-gallery-info__voice">
        <button type="button"
                class="ea-gallery-info__voice-btn${playable ? "" : " ea-gallery-info__voice-btn--muted"}"
                data-action="voice-toggle"
                ${playable ? "" : "aria-disabled=\"true\""}>
          <span class="ea-gallery-info__voice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path class="ea-voice-play" d="M8 5v14l11-7z"/>
              <g class="ea-voice-stop" style="display:none">
                <rect x="6" y="6" width="4" height="12" rx="1"/>
                <rect x="14" y="6" width="4" height="12" rx="1"/>
              </g>
            </svg>
          </span>
          <span class="ea-gallery-info__voice-label">
            ${playable ? "Play" : "Recording no longer on this device"}
          </span>
          ${playable ? `<span class="ea-gallery-info__voice-time">${fmtVoiceDuration(playable.durationMs || 0)}</span>` : ""}
        </button>
      </dd>
    </div>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "ea-gallery-info-backdrop";
  backdrop.setAttribute("data-open", "false");
  backdrop.innerHTML = `
    <div class="ea-gallery-info-panel" role="dialog" aria-modal="true"
         aria-labelledby="ea-gallery-info-title">
      <button type="button" class="ea-gallery-info-panel__close"
              aria-label="Close">
        <span aria-hidden="true">×</span>
      </button>

      <h2 class="ea-gallery-info-panel__title" id="ea-gallery-info-title">
        Session details
      </h2>

      <dl class="ea-gallery-info-panel__list">
        <div class="ea-gallery-info-panel__row">
          <dt>Recorded</dt>
          <dd>${fmtLongDateTime(session.startedAt)}</dd>
        </div>
        <div class="ea-gallery-info-panel__row">
          <dt>Duration</dt>
          <dd>${fmtDuration(session.durationMs)}</dd>
        </div>
        <div class="ea-gallery-info-panel__row">
          <dt>Art style</dt>
          <dd>${styleLabel(session.visualStyle)}</dd>
        </div>
        <div class="ea-gallery-info-panel__row ea-gallery-info-panel__row--chips">
          <dt>Main emotions</dt>
          <dd class="ea-gallery-info__chips">${chipsHtml}</dd>
        </div>
        ${voiceRowHtml}
      </dl>

      <div class="ea-gallery-info-panel__actions">
        <button type="button" class="ea-btn ea-btn--ghost ea-btn--slim"
                data-action="delete">Delete</button>
        <button type="button" class="ea-btn ea-btn--primary ea-btn--slim"
                data-action="open">Open Session</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const closeBtn = backdrop.querySelector(".ea-gallery-info-panel__close");
  const openBtn  = backdrop.querySelector('[data-action="open"]');
  const delBtn   = backdrop.querySelector('[data-action="delete"]');
  const voiceBtn = backdrop.querySelector('[data-action="voice-toggle"]');

  closeBtn.addEventListener("click", closeOpenPopover);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeOpenPopover();
  });
  openBtn.addEventListener("click", () => {
    stopVoicePlayback();
    closeOpenPopover();
    try { onOpen?.(session); } catch {}
  });
  delBtn.addEventListener("click", () => {
    const confirmed = delBtn.dataset.armed === "true";
    if (!confirmed) {
      delBtn.dataset.armed = "true";
      delBtn.textContent = "Tap again to confirm";
      delBtn.classList.add("ea-gallery-info__delete--armed");
      setTimeout(() => {
        if (delBtn.dataset.armed === "true") {
          delBtn.dataset.armed = "false";
          delBtn.textContent = "Delete";
          delBtn.classList.remove("ea-gallery-info__delete--armed");
        }
      }, 3000);
      return;
    }
    stopVoicePlayback();
    closeOpenPopover();
    try { onDelete?.(session); } catch {}
  });

  // Voice-note row wiring.
  let voiceUnsub = null;
  if (voiceBtn && playable) {
    const setState = (playing) => {
      voiceBtn.setAttribute("data-playing", playing ? "true" : "false");
      const play = voiceBtn.querySelector(".ea-voice-play");
      const stop = voiceBtn.querySelector(".ea-voice-stop");
      const lbl  = voiceBtn.querySelector(".ea-gallery-info__voice-label");
      if (play) play.style.display = playing ? "none" : "";
      if (stop) stop.style.display = playing ? "" : "none";
      if (lbl)  lbl.textContent    = playing ? "Stop" : "Play";
    };
    voiceUnsub = onVoiceStateChange((sid, playing) => {
      setState(sid === session.id && playing);
    });
    voiceBtn.addEventListener("click", () => {
      const isSelf = _voicePlayback && _voicePlayback.sessionId === session.id;
      if (isSelf) stopVoicePlayback();
      else startVoicePlayback(session);
    });
    // Reflect initial state (in case another card is currently playing).
    setState(_voicePlayback && _voicePlayback.sessionId === session.id);
  }

  document.addEventListener("keydown", _onEscClose, true);

  // Fade-in on next frame so CSS transition catches.
  requestAnimationFrame(() => {
    backdrop.setAttribute("data-open", "true");
    closeBtn.focus();
  });

  // Cleanup when the popover unmounts.
  const removeObserver = new MutationObserver(() => {
    if (!document.body.contains(backdrop)) {
      if (voiceUnsub) { try { voiceUnsub(); } catch {} }
      removeObserver.disconnect();
    }
  });
  removeObserver.observe(document.body, { childList: true });

  _openPopover = backdrop;
}

// ─────────────────────────────────────────────────────────────
// Shared round-robin replay engine
// One off-screen visual-style instance per registered style-id
// (lazy-created). At any moment the coordinator has ONE "active"
// card; it drives the engine that matches that card's session
// style, and blits every frame into the card's replay canvas via
// drawImage. Cards not currently active retain their last painted
// frame — nothing looks broken.
// ─────────────────────────────────────────────────────────────

/**
 * How long each card gets in the spotlight before we hand the shared
 * engine off to the next visible card. 2.4s felt like a natural beat
 * during QA — long enough to read the painting, short enough not to
 * lull the eye when there are many sessions.
 */
const SPOTLIGHT_MS = 2400;

/**
 * Playback speed for the replay: samples were recorded in real time
 * (usually 6-12 minutes per session), so we compress that into the
 * spotlight window by advancing the emotion signal N samples per
 * frame based on the total sample count. See `_pumpEmotion()`.
 */

class GalleryReplayEngine {
  constructor() {
    // Off-screen host canvases keyed by style-id. Each visual style
    // owns its own WebGL context on its own canvas, but we only ever
    // create the styles the seeded sessions actually reference — so
    // 4-6 sessions across 2 styles yields exactly 2 GL contexts, well
    // within the iOS Safari ceiling.
    this._enginesById = new Map();  // id -> { canvas, engine, StyleCls }
    this._active = null;            // { card, session, engine, host, sampleIdx, startedAt, rafId }
    this._pending = [];             // queue of { card, session }
    this._destroyed = false;
    this._rotateTimer = null;
    this._blitRafId = 0;

    // Resolution of each engine's host canvas. Cards render at
    // roughly card-width × card-width CSS px on screen, and the
    // replay canvas is blitted with drawImage (auto down/upsample).
    // 320 is a nice compromise between quality and cost.
    this._hostSize = 320;
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._rotateTimer); this._rotateTimer = null;
    cancelAnimationFrame(this._blitRafId); this._blitRafId = 0;
    if (this._active && this._active.rafId) {
      cancelAnimationFrame(this._active.rafId);
    }
    this._active = null;
    for (const rec of this._enginesById.values()) {
      try { rec.engine.stop(); }    catch {}
      try { rec.engine.destroy(); } catch {}
    }
    this._enginesById.clear();
    this._pending = [];
  }

  /** Register a card the coordinator should include in the rotation. */
  enqueue(card, session) {
    if (this._destroyed) return;
    // Skip if this card is already active or already queued.
    if (this._active && this._active.card === card) return;
    if (this._pending.some(p => p.card === card)) return;
    this._pending.push({ card, session });
    if (!this._active) this._advance();
  }

  /** Remove a card from the rotation (e.g. it scrolled out or was deleted). */
  dequeue(card) {
    if (this._destroyed) return;
    this._pending = this._pending.filter(p => p.card !== card);
    if (this._active && this._active.card === card) {
      this._endActive();
      this._advance();
    }
  }

  // Lazily build (or reuse) the engine for a given style id.
  _getEngine(styleId) {
    if (this._enginesById.has(styleId)) return this._enginesById.get(styleId);

    const StyleCls = StyleRegistry.getOrFallback(styleId, "current");
    if (!StyleCls) return null;

    const canvas = document.createElement("canvas");
    canvas.width  = this._hostSize;
    canvas.height = this._hostSize;
    // Note: keep the canvas detached from the DOM so it never impacts
    // layout. WebGL still renders correctly to a detached canvas.
    let engine;
    try {
      engine = new StyleCls(canvas);
    } catch (err) {
      console.warn("Gallery engine init failed for style", styleId, err);
      return null;
    }
    // Quiet neutral surface so the replay reads as pure "painting on
    // black" inside the card. Individual styles may override this on
    // setEmotion() — that is fine, we do not fight them.
    try { engine.setSurface(0.055, 0.043, 0.038); } catch {}
    try { engine.start(); } catch {}

    const rec = { canvas, engine, StyleCls };
    this._enginesById.set(styleId, rec);
    return rec;
  }

  _endActive() {
    if (!this._active) return;
    if (this._active.rafId) cancelAnimationFrame(this._active.rafId);
    this._active = null;
    cancelAnimationFrame(this._blitRafId); this._blitRafId = 0;
    clearTimeout(this._rotateTimer); this._rotateTimer = null;
  }

  _advance() {
    if (this._destroyed) return;
    if (!this._pending.length) { this._active = null; return; }
    const next = this._pending.shift();
    // Push the just-ended active card back onto the tail so we round-robin
    // through every visible card rather than starving newer arrivals.
    const prev = this._active;
    this._endActive();
    if (prev && prev.card && document.body.contains(prev.card)) {
      // Only re-enqueue if the card is still in the DOM and still opted-in.
      if (!this._pending.some(p => p.card === prev.card)) {
        this._pending.push({ card: prev.card, session: prev.session });
      }
    }

    const styleId = next.session.visualStyle || "current";
    const engRec = this._getEngine(styleId);
    if (!engRec) {
      // Skip this session; try the next one.
      this._advance();
      return;
    }

    const replayCanvas = next.card.querySelector(".ea-gallery__card-replay");
    if (!replayCanvas || !document.body.contains(next.card)) {
      this._advance();
      return;
    }

    // Prepare the replay canvas at DPR-aware resolution.
    const dpr  = Math.min(2, window.devicePixelRatio || 1);
    const cssW = replayCanvas.clientWidth  || 160;
    const cssH = replayCanvas.clientHeight || 160;
    if (replayCanvas.width !== Math.round(cssW * dpr)) {
      replayCanvas.width  = Math.round(cssW * dpr);
      replayCanvas.height = Math.round(cssH * dpr);
    }

    // Mark this card as spotlighted for CSS purposes (subtle glow, etc.).
    next.card.setAttribute("data-spotlight", "true");

    this._active = {
      card:        next.card,
      session:     next.session,
      engine:      engRec.engine,
      host:        engRec.canvas,
      startedAt:   performance.now(),
      sampleIdx:   0,
      rafId:       0,
    };

    // Blit + emotion-pump loop. We keep this loop crash-safe so a
    // one-off engine error cannot brick the rotation.
    const loop = (now) => {
      if (this._destroyed || !this._active) return;
      const a = this._active;
      if (a.card !== next.card) return;

      try {
        this._pumpEmotion(a, now);
        const ctx = replayCanvas.getContext("2d");
        ctx.drawImage(a.host, 0, 0, replayCanvas.width, replayCanvas.height);
      } catch (err) {
        // Never let a bad frame stop the rotation.
        // eslint-disable-next-line no-console
        console.warn("gallery replay frame skipped:", err && err.message);
      }

      if (now - a.startedAt >= SPOTLIGHT_MS) {
        next.card.removeAttribute("data-spotlight");
        this._advance();
        return;
      }
      a.rafId = requestAnimationFrame(loop);
    };
    this._active.rafId = requestAnimationFrame(loop);
  }

  /**
   * Feed the engine a compressed replay of the session samples. We
   * map the spotlight window to the full sample list linearly, so a
   * short session and a long session both animate for SPOTLIGHT_MS.
   * If the session has no samples we drive the engine with the seed
   * emotion so the painting still evolves.
   */
  _pumpEmotion(active, now) {
    const engine = active.engine;
    if (!engine || typeof engine.setEmotion !== "function") return;
    const session = active.session;
    const samples = session.samples || [];
    const elapsed = now - active.startedAt;
    const t = Math.min(1, elapsed / SPOTLIGHT_MS);

    if (samples.length >= 2) {
      const idxF = t * (samples.length - 1);
      const idx  = Math.max(0, Math.min(samples.length - 1, Math.floor(idxF)));
      const frac = idxF - idx;
      const sA = samples[idx];
      const sB = samples[Math.min(samples.length - 1, idx + 1)];
      // Defensive: if a sample slot is missing, fall back to the seed.
      if (!sA || !sB) {
        const seed = session.seed || { valence: 0, arousal: 0, openness: 0.5 };
        const dom  = session.dominantEmotion || null;
        try {
          engine.setEmotion(
            seed.valence || 0,
            seed.arousal || 0,
            seed.openness ?? 0.5,
            dom ? dom.name : "",
          );
        } catch {}
        return;
      }
      const v = sA.v + (sB.v - sA.v) * frac;
      const ar = sA.a + (sB.a - sA.a) * frac;
      const o  = (sA.o ?? 0.5) + ((sB.o ?? 0.5) - (sA.o ?? 0.5)) * frac;
      try { engine.setEmotion(v, ar, o, sA.label || ""); } catch {}
    } else {
      const seed = session.seed || { valence: 0, arousal: 0, openness: 0.5 };
      const dom  = session.dominantEmotion || null;
      try {
        engine.setEmotion(
          seed.valence || 0,
          seed.arousal || 0,
          seed.openness ?? 0.5,
          dom ? dom.name : "",
        );
      } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Card factory
// Each card has THREE stacked canvases: replay (background), trail
// overlay (foreground, ~50% opacity). We paint the overlay once on
// mount; the replay canvas is driven by the shared engine when the
// card is spotlighted.
// ─────────────────────────────────────────────────────────────

function buildCard(session, { onOpen, onDelete }) {
  const dom = session.dominantEmotion
    || computeDominant(session.samples)
    || { name: "Session", hex: "#888888" };

  const card = document.createElement("article");
  card.className = "ea-gallery__card";
  card.setAttribute("data-session-id", session.id || "");
  card.setAttribute("role", "listitem");

  const hasVoiceMeta = hasAnyVoiceMeta(session);
  const voicePlayable = hasPlayableVoice(session);

  // Speaker chip — visible only when a voice note exists on this session.
  const voiceChipHtml = hasVoiceMeta ? `
    <button type="button"
            class="ea-gallery__card-voice${voicePlayable ? "" : " ea-gallery__card-voice--muted"}"
            aria-label="${voicePlayable ? "Play voice note" : "Voice note not available on this device"}"
            ${voicePlayable ? "" : "aria-disabled=\"true\""}>
      <span aria-hidden="true" class="ea-gallery__card-voice-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path class="ea-voice-play" d="M8 5v14l11-7z"/>
          <g class="ea-voice-stop" style="display:none">
            <rect x="6" y="6" width="4" height="12" rx="1"/>
            <rect x="14" y="6" width="4" height="12" rx="1"/>
          </g>
        </svg>
      </span>
    </button>
  ` : "";

  card.innerHTML = `
    <button type="button" class="ea-gallery__card-open"
            aria-label="Open ${dom.name} session from ${fmtShortCapsDate(session.startedAt)}">
      <span class="ea-gallery__card-date">${fmtShortCapsDate(session.startedAt)}</span>

      <span class="ea-gallery__card-canvas-wrap" aria-hidden="true">
        <canvas class="ea-gallery__card-replay"></canvas>
        <canvas class="ea-gallery__card-overlay"></canvas>
      </span>

      <span class="ea-gallery__card-name" style="color:${dom.hex}">
        ${dom.name}
      </span>
      <span class="ea-gallery__card-duration">${fmtDuration(session.durationMs)}</span>
    </button>

    ${voiceChipHtml}

    <button type="button" class="ea-gallery__card-info"
            aria-label="Session details">
      <span aria-hidden="true">i</span>
    </button>
  `;

  const openBtn  = card.querySelector(".ea-gallery__card-open");
  const infoBtn  = card.querySelector(".ea-gallery__card-info");
  const voiceBtn = card.querySelector(".ea-gallery__card-voice");

  openBtn.addEventListener("click", () => {
    stopVoicePlayback();
    try { onOpen?.(session); } catch {}
  });

  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openInfoPopover({ session, onOpen, onDelete });
  });

  if (voiceBtn && voicePlayable) {
    // Playing / stopped visual state — mirror the popover row's state
    // model so the two stay in sync no matter which surface triggers.
    const setState = (playing) => {
      voiceBtn.setAttribute("data-playing", playing ? "true" : "false");
      const play = voiceBtn.querySelector(".ea-voice-play");
      const stop = voiceBtn.querySelector(".ea-voice-stop");
      if (play) play.style.display = playing ? "none" : "";
      if (stop) stop.style.display = playing ? "" : "none";
      voiceBtn.setAttribute(
        "aria-label",
        playing ? "Stop voice note" : "Play voice note",
      );
    };
    const unsub = onVoiceStateChange((sid, playing) => {
      setState(sid === session.id && playing);
    });
    // Track the listener on the card so we can clean up on tear-down.
    card._eaVoiceUnsub = unsub;
    voiceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isSelf = _voicePlayback && _voicePlayback.sessionId === session.id;
      if (isSelf) stopVoicePlayback();
      else startVoicePlayback(session);
    });
  } else if (voiceBtn) {
    // Muted state: tap yields a small non-blocking toast-style hint by
    // toggling a visual pulse — no audio, no popup, quiet failure.
    voiceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      voiceBtn.animate(
        [{ transform: "scale(1)" }, { transform: "scale(0.95)" }, { transform: "scale(1)" }],
        { duration: 240, easing: "ease-out" },
      );
    });
  }

  const replayCanvas  = card.querySelector(".ea-gallery__card-replay");
  const overlayCanvas = card.querySelector(".ea-gallery__card-overlay");

  return { card, replayCanvas, overlayCanvas };
}

// ─────────────────────────────────────────────────────────────
// Public: mount the gallery view
// ─────────────────────────────────────────────────────────────

/**
 * Mount the Gallery panel. Returns a `destroy()` function.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container   The After screen root element.
 * @param {Array}       opts.sessions    Session history (any order).
 * @param {Function}    opts.onOpen      (session) => void — open summary replay.
 * @param {Function}    [opts.onDelete]  (session) => void — remove a record.
 */
export function mountGalleryView({ container, sessions, onOpen, onDelete }) {
  const reel    = container.querySelector("#gallery-reel");
  const countEl = container.querySelector("#gallery-count");
  const emptyEl = container.querySelector("#gallery-empty");

  if (!reel) return () => {};

  // Fresh mount — clear anything from a previous open.
  reel.innerHTML = "";
  closeOpenPopover();
  stopVoicePlayback();

  if (!sessions || !sessions.length) {
    if (countEl) countEl.textContent = "0 sessions";
    if (emptyEl) emptyEl.hidden = false;
    return () => { closeOpenPopover(); stopVoicePlayback(); };
  }
  if (emptyEl) emptyEl.hidden = true;

  if (countEl) {
    countEl.textContent = sessions.length === 1
      ? "1 session"
      : `${sessions.length} sessions`;
  }

  // Newest → oldest (archive ordering).
  const ordered = [...sessions].sort(
    (a, b) => (b.startedAt || 0) - (a.startedAt || 0),
  );

  // Shared round-robin replay coordinator.
  const replay = new GalleryReplayEngine();

  // Intersection observer decides which cards are eligible for the
  // spotlight. Cards outside the viewport paint their trail overlay
  // once (so they look complete) but do not participate in the
  // rotation — that keeps the engine focused on what the user sees.
  const paintedTrails = new WeakSet();

  const io = ("IntersectionObserver" in window)
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const card = entry.target;
          const sid = card.getAttribute("data-session-id");
          const sess = ordered.find(s => s.id === sid);
          if (!sess) continue;

          if (entry.isIntersecting) {
            // Paint the trail overlay once — it never needs to move.
            const overlay = card.querySelector(".ea-gallery__card-overlay");
            if (overlay && !paintedTrails.has(card)) {
              paintTrailOverlay(overlay, sess);
              paintedTrails.add(card);
            }
            replay.enqueue(card, sess);
          } else {
            replay.dequeue(card);
          }
        }
      }, { root: null, rootMargin: "120px 0px", threshold: 0.05 })
    : null;

  for (const s of ordered) {
    const { card, overlayCanvas } = buildCard(s, { onOpen, onDelete });
    reel.appendChild(card);
    if (io) {
      io.observe(card);
    } else {
      // Fallback: paint overlay immediately and eagerly enqueue.
      requestAnimationFrame(() => {
        paintTrailOverlay(overlayCanvas, s);
        replay.enqueue(card, s);
      });
    }
  }

  return () => {
    if (io) io.disconnect();
    // Clean up any per-card voice-state listeners.
    for (const card of reel.querySelectorAll(".ea-gallery__card")) {
      if (typeof card._eaVoiceUnsub === "function") {
        try { card._eaVoiceUnsub(); } catch {}
      }
    }
    replay.destroy();
    closeOpenPopover();
    stopVoicePlayback();
    reel.innerHTML = "";
  };
}
