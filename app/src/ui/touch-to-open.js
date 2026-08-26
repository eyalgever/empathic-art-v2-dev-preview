// ═══════════════════════════════════════════════════════════════════════
// Touch-to-open Emotion Map
// ─────────────────────────────────────────────────────────────────────
// When the user has closed the Emotion Map (Zen-ish immersive state
// where the fluid dominates), tapping the fluid canvas should bring the
// Emotion Map back — same as tapping the "Emotion Map" chip in the top
// toolbar. Previously the tap only fired the dim-wake handler in
// immersive.js (fading chrome back in) but left the panel closed, so
// the user had to precisely tap the small dimmed chip.
//
// Scope:
//   • Live session — #fluid-canvas + #btn-muse-data
//   • Replay      — #summary-fluid-canvas + summary panel toggle
//
// Guards:
//   • Never opens while Zen is active (`data-zen="true"`) — Zen is the
//     user's explicit request to hide chrome; touch should NOT auto-
//     expose it.
//   • Never opens if the target is inside an interactive control (the
//     panel itself, chips, buttons, footer) — those elements have
//     their own click handlers and should not spuriously toggle.
//   • Idempotent — safe to call multiple times.
// ═══════════════════════════════════════════════════════════════════════

function _isZenActive() {
  return document.body.getAttribute("data-zen") === "true";
}

function _isMapOpen() {
  return document.body.getAttribute("data-emotion-map-open") === "true";
}

// Elements whose taps must NOT reopen the map (they have their own click
// handlers). The check is a simple `closest()` walk from the tap target.
const INTERACTIVE_SELECTOR = [
  ".ea-muse-panel",           // the panel itself
  ".ea-chips-band",           // top chips row (Voice, Emotion Map, help)
  ".ea-cta--session",         // Stop button
  ".ea-header",               // top header bar
  ".ea-view-switcher",        // iPhone / Watch / PC switcher
  ".ea-immersive-btn",        // fullscreen button
  ".ea-summary-panel-toggle", // replay panel toggle
  "#btn-summary-panel-toggle",
  "button",                   // any button anywhere
  "a",                        // any link
  "input",                    // form controls
  "[role=\"button\"]",
].join(",");

function _openLiveMap() {
  const btn = document.getElementById("btn-muse-data");
  const panel = document.getElementById("muse-panel");
  if (!btn || !panel) return false;
  if (panel.getAttribute("aria-hidden") !== "true") return false;
  // The existing btn onclick handler is already wired to setOpen(true)
  // when the panel is closed. Fire it.
  btn.click();
  return true;
}

function _openReplayMap() {
  // In replay, the map is hidden via body.ea-summary-panel-hidden and
  // toggled by #btn-summary-panel-toggle.
  const toggle = document.getElementById("btn-summary-panel-toggle");
  if (!toggle) return false;
  if (!document.body.classList.contains("ea-summary-panel-hidden")) return false;
  toggle.click();
  return true;
}

function _onFluidTap(evt) {
  // Never override interactive control taps.
  if (evt.target && evt.target.closest && evt.target.closest(INTERACTIVE_SELECTOR)) {
    return;
  }
  // Never auto-open in explicit Zen mode.
  if (_isZenActive()) return;

  // Detect which canvas was tapped by walking up.
  const isLiveCanvas = !!(evt.target && evt.target.closest && evt.target.closest("#fluid-canvas"));
  const isSummaryCanvas = !!(evt.target && evt.target.closest && evt.target.closest("#summary-fluid-canvas"));

  if (isLiveCanvas) {
    if (!_isMapOpen()) _openLiveMap();
  } else if (isSummaryCanvas) {
    _openReplayMap();
  }
}

let _mounted = false;
export function mountTouchToOpen() {
  if (_mounted) return;
  _mounted = true;
  // Bind on window so we catch taps that reach the canvas even through
  // layered overlays. Use capture:false so panel/button handlers run
  // FIRST — we only act if the target didn't match an interactive
  // control.
  window.addEventListener("pointerdown", _onFluidTap, { passive: true });
  // touchstart as a Safari safety net (some old iOS versions delay
  // pointerdown).
  window.addEventListener("touchstart", _onFluidTap, { passive: true });
}

// Auto-mount on module load.
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTouchToOpen, { once: true });
  } else {
    mountTouchToOpen();
  }
}
