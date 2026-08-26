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

const KEY_SEEN_FULL = "ea:v2:opening:seenFull";

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

  // 2) Threshold
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

  { kind: "rest", ms: 1800 },

  // 3) Creation
  { kind: "poem", hold: 900, gap: 1500, lines: [
    "The artwork listens to you.",
    "Your presence is what creates it.",
  ]},

  { kind: "rest", ms: 2000 },

  // 4) Body cues — bracketed, whole-line cadence, slower
  { kind: "cues", hold: 2200, gap: 700, lines: [
    "[Find a quiet place]",
    "[Take a deep breath]",
    "[Exhale]",
    "[Drop your shoulders]",
    "[Let go of words]",
    "[Give yourself to the music]",
    "[Give yourself to the art]",
  ]},

  { kind: "rest", ms: 1200 },

  // 5) Ready + countdown
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
  if (!_root) return;
  _root.classList.add("ea-opening--leaving");
  const done = () => {
    if (_root && _root.parentElement) _root.parentElement.removeChild(_root);
    _root = null; _stage = null; _skipHint = null;
    document.body.removeAttribute("data-opening");
  };
  setTimeout(done, 800);
}

function _onSkipTap() {
  if (!_running || _skipped) return;
  _skipped = true;
  // Fast-forward to the countdown by aborting the current run
  // and starting a fresh short sequence.
  _abortCurrent();
  _clearStage();
  _run(SEQ_SHORT).catch(() => {});
}

// ─── Animation primitives ────────────────────────────────────────────
let _timeouts = new Set();
function _wait(ms) {
  return new Promise((resolve) => {
    const id = setTimeout(() => { _timeouts.delete(id); resolve(); }, ms);
    _timeouts.add(id);
  });
}
function _abortCurrent() {
  for (const id of _timeouts) clearTimeout(id);
  _timeouts.clear();
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
    if (step.kind === "rest") { await _wait(step.ms); continue; }
    if (step.kind === "poem") {
      for (const line of step.lines) await _renderPoemLine(line, step.hold, step.gap);
      continue;
    }
    if (step.kind === "cues") {
      for (const line of step.lines) await _renderCueLine(line, step.hold, step.gap);
      continue;
    }
    if (step.kind === "ready") { await _renderReady(); continue; }
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

  _run(seq).then(() => {
    try { sessionStorage.setItem(KEY_SEEN_FULL, "1"); } catch { /* noop */ }
    _running = false;
    _unmount();
    if (_onDone) _onDone();
  }).catch(() => {
    _running = false;
    _unmount();
    if (_onDone) _onDone();
  });
}

export function isOpeningActive() { return _running; }
