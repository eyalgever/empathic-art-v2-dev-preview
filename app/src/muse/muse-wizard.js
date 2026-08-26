/**
 * Empathic Art -- Muse calibration wizard
 *
 * A fixed 6-block protocol that walks the user through a repeatable
 * sequence of test states while the Muse is streaming. Every session runs
 * the same six blocks in the same order for the same duration, so logs
 * from different sessions are directly comparable and the mapping can be
 * tuned against real data instead of remembered impressions.
 *
 * Protocol
 * ────────
 *
 *   #  State             Block   Instruction (shown on screen)
 *   1  neutral            45s   sit quietly, look ahead, no task, just be
 *   2  eyes closed        45s   close your eyes and relax
 *   3  eyes open          45s   open your eyes, look ahead, stay still
 *   4  deep breathing     45s   slow inhale through nose, slow exhale
 *   5  thinking hard      45s   count backwards from 100 by 7 (100, 93, 86...)
 *                               or think through any hard problem out loud
 *   6  positive memory    45s   recall a warm memory in detail, a person,
 *                               a place, a moment
 *
 * A 10s gap between blocks gives signals time to settle. Total wall-clock
 * run time: 6 * 45 + 5 * 10 = 320s (5 min 20 s).
 *
 * Aesthetic
 * ─────────
 *
 * The wizard renders as raw terminal-style text top-left, monospace, using
 * mix-blend-mode: difference so it auto-contrasts against whatever fluid
 * colour is behind it. No card, no border, no icons. It looks like
 * `tail -f` running over the art.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { museLog } from "./muse-log-capture.js?v=1.6.4.27";

/** One block spec: label, seconds, and the instruction shown on screen. */
const BLOCKS = [
  { key: "neutral",         seconds: 45, instruction: "sit quietly. look ahead. no task, just be." },
  { key: "eyes closed",     seconds: 45, instruction: "close your eyes and relax." },
  { key: "eyes open",       seconds: 45, instruction: "open your eyes. look ahead, stay still." },
  { key: "deep breathing",  seconds: 45, instruction: "slow inhale through nose, slow exhale through mouth." },
  { key: "thinking hard",   seconds: 45, instruction: "count backwards from 100 by 7 (100, 93, 86, 79...). or think through any hard problem out loud. actively concentrate." },
  { key: "positive memory", seconds: 45, instruction: "recall a warm memory in detail. a person, a place, a moment." },
];

/** Seconds of settling time between two blocks. */
const GAP_SECONDS = 10;

/** How many recent log lines the terminal overlay shows in the scrollback. */
const OVERLAY_TAIL_LINES = 6;

/** How often to redraw the overlay while the wizard is running (ms). */
const REDRAW_INTERVAL_MS = 500;

class MuseWizard {
  constructor() {
    this._container = null;
    this._headEl = null;
    this._instructionEl = null;
    this._barEl = null;
    this._logEl = null;
    this._btnEnd = null;

    this._running = false;
    this._blockIdx = -1;
    this._phase = "idle"; // "block" | "gap" | "done"
    this._phaseStart = 0;
    this._phaseDuration = 0;
    this._rafId = null;
    this._onDone = null;
  }

  /**
   * Start the wizard. Mounts the overlay if not already mounted and begins
   * block 1 immediately. Idempotent: a second call while running is a no-op.
   *
   * @param {object}   opts
   * @param {HTMLElement=} opts.host           Where to attach the overlay.
   * @param {function=}    opts.onDone         Called when the last block ends.
   */
  start({ host, onDone, silent = false } = {}) {
    if (this._running) return;
    this._running = true;
    this._onDone = onDone || null;
    this._silent = !!silent;

    this._mount(host || document.body);

    // Log the wizard's own start line so the paste always shows when it began.
    // Silent runs (visual-only previews) skip every museLog write so nothing
    // leaks into the replay overlay.
    if (!this._silent) museLog.note("wizard start");

    this._blockIdx = 0;
    this._enterPhase("block");
    this._tick(); // draw immediately
    this._loop();
  }

  /**
   * End the wizard early. Fires onDone with { completed: false }.
   */
  end() {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (!this._silent) museLog.note("wizard ended early");
    this._teardown({ completed: false });
  }

  /**
   * Whether the overlay is currently mounted. Used by the replay overlay to
   * avoid stacking two logs on top of each other.
   */
  get isMounted() { return !!this._container; }

  // ── phase machine ───────────────────────────────────────────────────────

  _enterPhase(phase) {
    this._phase = phase;
    this._phaseStart = performance.now();

    if (phase === "block") {
      const b = BLOCKS[this._blockIdx];
      this._phaseDuration = b.seconds * 1000;
      if (!this._silent) museLog.markState(b.key);
    } else if (phase === "gap") {
      this._phaseDuration = GAP_SECONDS * 1000;
      if (!this._silent) museLog.markState("gap");
    } else if (phase === "done") {
      this._phaseDuration = 0;
      if (!this._silent) museLog.note("wizard complete");
      this._running = false;
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
      this._tick(); // final render
      this._teardown({ completed: true });
    }
  }

  _advance() {
    if (this._phase === "block") {
      // After the last block, no gap, straight to done.
      if (this._blockIdx >= BLOCKS.length - 1) {
        this._enterPhase("done");
      } else {
        this._enterPhase("gap");
      }
    } else if (this._phase === "gap") {
      this._blockIdx += 1;
      this._enterPhase("block");
    }
  }

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => {
      const elapsed = performance.now() - this._phaseStart;
      if (elapsed >= this._phaseDuration) {
        this._advance();
      }
      this._tick();
      this._loop();
    });
  }

  // ── rendering ───────────────────────────────────────────────────────────

  _mount(host) {
    if (this._container) return;
    const wrap = document.createElement("div");
    wrap.className = "ea-muse-terminal";
    wrap.setAttribute("aria-label", "Muse calibration wizard");
    wrap.innerHTML = `
      <div class="ea-muse-terminal__head"></div>
      <div class="ea-muse-terminal__instruction"></div>
      <div class="ea-muse-terminal__bar"></div>
      <pre class="ea-muse-terminal__log"></pre>
      <button type="button" class="ea-muse-terminal__end">end wizard</button>
    `;
    host.appendChild(wrap);
    // Body-level flag so pages under the wizard (setup, session) can shift
    // their content down on small screens to leave a real breathing gap.
    document.body.classList.add("ea-muse-wizard-active");
    this._container = wrap;
    this._headEl        = wrap.querySelector(".ea-muse-terminal__head");
    this._instructionEl = wrap.querySelector(".ea-muse-terminal__instruction");
    this._barEl         = wrap.querySelector(".ea-muse-terminal__bar");
    this._logEl         = wrap.querySelector(".ea-muse-terminal__log");
    this._btnEnd        = wrap.querySelector(".ea-muse-terminal__end");
    this._btnEnd.addEventListener("click", () => this.end());

    // Redraw the log tail on a lower cadence than rAF so we do not thrash
    // string concatenation every frame.
    this._redrawTimer = setInterval(() => this._drawLog(), REDRAW_INTERVAL_MS);
  }

  _teardown() {
    clearInterval(this._redrawTimer);
    this._redrawTimer = null;
    if (this._container) {
      // A brief hold on the "complete" line so the user sees it before it
      // disappears, then remove.
      setTimeout(() => {
        this._container?.remove();
        this._container = null;
        document.body.classList.remove("ea-muse-wizard-active");
        this._headEl = null;
        this._instructionEl = null;
        this._barEl = null;
        this._logEl = null;
        this._btnEnd = null;
      }, 2500);
    }
    if (typeof this._onDone === "function") this._onDone();
    this._onDone = null;
  }

  _tick() {
    if (!this._container) return;

    if (this._phase === "block") {
      const b = BLOCKS[this._blockIdx];
      const elapsed = performance.now() - this._phaseStart;
      const remaining = Math.max(0, Math.ceil((this._phaseDuration - elapsed) / 1000));
      const progress = Math.min(1, elapsed / this._phaseDuration);
      const nBars = 20;
      const filled = Math.round(progress * nBars);
      const bar = "\u2593".repeat(filled) + "\u2591".repeat(nBars - filled);

      this._headEl.textContent =
        `block ${this._blockIdx + 1} of ${BLOCKS.length}  ${b.key}`;
      this._instructionEl.textContent = b.instruction;
      this._barEl.textContent = `${bar}  ${String(remaining).padStart(2, "0")}s`;
    } else if (this._phase === "gap") {
      const elapsed = performance.now() - this._phaseStart;
      const remaining = Math.max(0, Math.ceil((this._phaseDuration - elapsed) / 1000));
      const nextBlock = BLOCKS[this._blockIdx + 1];
      this._headEl.textContent = `gap ${remaining}s  next: ${nextBlock ? nextBlock.key : "done"}`;
      this._instructionEl.textContent = nextBlock ? `get ready: ${nextBlock.instruction}` : "";
      this._barEl.textContent = "";
    } else if (this._phase === "done") {
      this._headEl.textContent = "wizard complete";
      this._instructionEl.textContent = "log captured. copy it and paste to review.";
      this._barEl.textContent = "";
    }
  }

  _drawLog() {
    if (!this._logEl) return;
    const lines = museLog.tail(OVERLAY_TAIL_LINES);
    this._logEl.textContent = lines.join("\n");
  }
}

/** Singleton. */
export const museWizard = new MuseWizard();
