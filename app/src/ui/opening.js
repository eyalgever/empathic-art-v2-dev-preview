/**
 * Empathic Art v2 — Opening Sequence
 * ──────────────────────────────────────────────────────────────────
 * A quiet, animated reading that carries the viewer from the real
 * world into the artwork. Not a splash screen, not a loader — a
 * threshold ritual. Words fade in one at a time, older words fade
 * out, punctuated by stanza breaks and body cues, closing with a
 * Ready · 3 · 2 · 1 into the artwork.
 *
 * Non-invasive: mounts a new .ea-screen ahead of the existing
 * "before" screen, hides the header while running, and hands off
 * cleanly to the shipped flow. First-run only per session; a small
 * sessionStorage flag lets returning users skip straight to the
 * countdown.
 *
 * @author  Eyal Gever
 */

// Bumped from :seenFull to :seenFull:v2 on 2026-08-26 to force every
// existing session back through the full opening (the old key would
// have short-circuited to "ready 3 2 1" after a bugfix to the skip
// path; simpler to just invalidate it once).
const KEY_SEEN_FULL = "ea:v2:opening:seenFull:v2";

// Sequence content. Each stanza is an array of lines; each line is a
// string of words. Words are the animation unit for the poetic stanzas.
// Bracketed body cues animate as whole lines instead.
const SEQ = [
  // 1) Name
  { kind: "poem", hold: 900, gap: 1400, lines: [
    "Empathic Art",
    "an artwork that senses you",
    "and feels you feeling it",
  ]},

  // separator
  { kind: "rest", ms: 1600 },

  // 2) Question — the Age of Thinking Machines frame
  { kind: "poem", hold: 1000, gap: 1600, lines: [
    "In the age of thinking machines,",
    "one question remains:",
    "",
    "what does it mean to be human?",
  ]},

  { kind: "rest", ms: 1800 },

  // 3) Threshold
  { kind: "poem", hold: 900, gap: 1400, lines: [
    "This artwork asks for",
    "your presence.",
    "",
    "Give yourself time",
    "to arrive.",
    "",
    "Your nervous system",
    "will meet the artwork",
    "when it is ready.",
  ]},

  { kind: "rest", ms: 1600 },

  // 4) Wealth — citation register, quoted line, no attribution in-app
  { kind: "poem", hold: 1100, gap: 1500, lines: [
    "An unhurried sense of time",
    "is itself a form of wealth.",
  ]},

  { kind: "rest", ms: 1800 },

  // 5) Creation
  { kind: "poem", hold: 900, gap: 1500, lines: [
    "The artwork listens to you.",
    "Your presence is what creates it.",
  ]},

  { kind: "rest", ms: 2000 },

  // 6) Body cues — bracketed, whole-line cadence, slower
  { kind: "cues", hold: 2200, gap: 700, lines: [
    "[Put the world down]",
    "[Find a quiet place]",
    "[Take a deep breath]",
    "[Exhale]",
    "[Drop your shoulders]",
    "[Let go of words]",
    "[Give yourself to the music]",
    "[Give yourself to the art]",
  ]},

  { kind: "rest", ms: 1200 },

  // 7) Ready + countdown
  { kind: "ready" },
];

// Short (return-visit) sequence — just Ready · 3 · 2 · 1.
const SEQ_SHORT = [{ kind: "ready" }];

let _root = null;
let _stage = null;
let _skipHint = null;
let _running = false;
let _skipped = false;
let _onDone = null;

// ─── DOM building ────────────────────────────────────────────────────
function _mount() {
  if (_root) return;

  _root = document.createElement("section");
  _root.className = "ea-opening";
  _root.id = "ea-opening";
  _root.setAttribute("role", "presentation");
  _root.innerHTML = `
    <div class="ea-opening__stage" id="ea-opening-stage" aria-live="polite"></div>
    <div class="ea-opening__skip" id="ea-opening-skip" aria-hidden="true">tap anywhere to continue</div>
  `;

  // Insert as the very first child of ea-app so it sits above everything.
  const app = document.getElementById("ea-app") || document.body;
  app.insertBefore(_root, app.firstChild);

  _stage = _root.querySelector("#ea-opening-stage");
  _skipHint = _root.querySelector("#ea-opening-skip");

  // Tap anywhere skips to countdown (unless already in countdown).
  _root.addEventListener("click", _onSkipTap, { passive: true });
  _root.addEventListener("touchend", _onSkipTap, { passive: true });

  // Show the skip hint softly a few seconds in.
  setTimeout(() => { if (_running && !_skipped) _skipHint.classList.add("visible"); }, 6500);
}

function _unmount() {
  // Remove data-opening synchronously so the Before screen appears
  // immediately even if the leave animation is still playing on the
  // overlay itself. This is the safety line: if anything upstream
  // ever hangs, the user is not stuck on a black screen.
  document.body.removeAttribute("data-opening");
  if (!_root) return;
  _root.classList.add("ea-opening--leaving");
  const overlay = _root;
  _root = null; _stage = null; _skipHint = null;
  setTimeout(() => {
    if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }, 800);
}

function _onSkipTap() {
  if (!_running || _skipped) return;
  _skipped = true;
  // Fast-forward to the countdown: abort the outstanding poem timers
  // and resolve the pending _wait so the outer _run() promise chain
  // in startOpening() can continue into the short sequence.
  _abortCurrent();
  _clearStage();
  // The outer run loop will pick up SEQ_SHORT via _skipped flag; see
  // _run() below.
}

// ─── Animation primitives ────────────────────────────────────────────
// Each waiter is a {id, resolve} pair. Aborting clears the timer AND
// resolves the promise immediately so the awaiting run loop can
// proceed instead of hanging on a promise that will never settle.
let _waiters = new Set();
function _wait(ms) {
  return new Promise((resolve) => {
    const waiter = { id: null, resolve };
    waiter.id = setTimeout(() => {
      _waiters.delete(waiter);
      resolve();
    }, ms);
    _waiters.add(waiter);
  });
}
function _abortCurrent() {
  for (const w of _waiters) {
    clearTimeout(w.id);
    try { w.resolve(); } catch { /* noop */ }
  }
  _waiters.clear();
}

function _clearStage() {
  if (_stage) _stage.innerHTML = "";
}

function _makeLine(cls) {
  const el = document.createElement("div");
  el.className = "ea-opening__line " + (cls || "");
  _stage.appendChild(el);
  return el;
}

// Fade a poem line in word-by-word, hold, then fade the whole line out.
async function _renderPoemLine(text, hold, gap) {
  if (!text.trim()) { await _wait(gap * 0.6); return; }
  const line = _makeLine("ea-opening__line--poem");
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = document.createElement("span");
    w.className = "ea-opening__word";
    w.textContent = words[i] + (i < words.length - 1 ? "\u00a0" : "");
    line.appendChild(w);
    // Force reflow before adding the visible class so transition runs.
    // eslint-disable-next-line no-unused-expressions
    w.offsetWidth;
    w.classList.add("visible");
    await _wait(320);
  }
  await _wait(hold);
  line.classList.add("leaving");
  await _wait(gap);
  if (line.parentElement) line.parentElement.removeChild(line);
}

async function _renderCueLine(text, hold, gap) {
  const line = _makeLine("ea-opening__line--cue");
  line.textContent = text;
  // eslint-disable-next-line no-unused-expressions
  line.offsetWidth;
  line.classList.add("visible");
  await _wait(hold);
  line.classList.add("leaving");
  await _wait(gap);
  if (line.parentElement) line.parentElement.removeChild(line);
}

async function _renderReady() {
  if (_skipHint) _skipHint.classList.remove("visible");
  // "Ready"
  const ready = _makeLine("ea-opening__line--ready");
  ready.textContent = "Ready";
  // eslint-disable-next-line no-unused-expressions
  ready.offsetWidth;
  ready.classList.add("visible");
  await _wait(1400);
  ready.classList.add("leaving");
  await _wait(700);
  if (ready.parentElement) ready.parentElement.removeChild(ready);

  // 3 · 2 · 1
  for (const n of ["3", "2", "1"]) {
    const num = _makeLine("ea-opening__line--num");
    num.textContent = n;
    // eslint-disable-next-line no-unused-expressions
    num.offsetWidth;
    num.classList.add("visible");
    await _wait(900);
    num.classList.add("leaving");
    await _wait(350);
    if (num.parentElement) num.parentElement.removeChild(num);
  }
}

async function _run(sequence) {
  for (const step of sequence) {
    if (_skipped) break;
    if (step.kind === "rest") { await _wait(step.ms); continue; }
    if (step.kind === "poem") {
      for (const line of step.lines) {
        if (_skipped) break;
        await _renderPoemLine(line, step.hold, step.gap);
      }
      continue;
    }
    if (step.kind === "cues") {
      for (const line of step.lines) {
        if (_skipped) break;
        await _renderCueLine(line, step.hold, step.gap);
      }
      continue;
    }
    if (step.kind === "ready") { await _renderReady(); continue; }
  }
  // If a skip happened mid-sequence, ALWAYS run the short countdown
  // before finishing. This is the single place that handles both the
  // "reached the end naturally" and "user tapped to skip" paths.
  if (_skipped) {
    for (const step of SEQ_SHORT) {
      if (step.kind === "ready") { await _renderReady(); }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────
export function startOpening({ onDone, forceFull = false } = {}) {
  _onDone = typeof onDone === "function" ? onDone : null;
  _mount();
  document.body.setAttribute("data-opening", "true");
  _running = true;
  _skipped = false;

  const seenFull = !forceFull && sessionStorage.getItem(KEY_SEEN_FULL) === "1";
  const seq = seenFull ? SEQ_SHORT : SEQ;

  // Safety net: no matter what the sequence does (hang, throw, abort
  // mid-flight), we ALWAYS unmount within a reasonable upper bound.
  // The full poem is ~65s; short is ~6s. Set the ceiling to 90s.
  const SAFETY_MS = seenFull ? 12000 : 90000;
  const finish = () => {
    if (!_running) return; // already finished
    _running = false;
    try { sessionStorage.setItem(KEY_SEEN_FULL, "1"); } catch { /* noop */ }
    _unmount();
    if (_onDone) _onDone();
    _onDone = null;
  };
  const safetyTimer = setTimeout(finish, SAFETY_MS);

  _run(seq).then(() => {
    clearTimeout(safetyTimer);
    finish();
  }).catch(() => {
    clearTimeout(safetyTimer);
    finish();
  });
}

export function isOpeningActive() { return _running; }
