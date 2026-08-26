// ═══════════════════════════════════════════════════════════════════════
// Zen Mode
// ─────────────────────────────────────────────────────────────────────
// A stronger companion state to dim-on-stillness. Zen is EXPLICITLY
// entered by the user — never automatic — and hides everything except
// the fluid painting and the emotion word. On the PC view it also
// hides the device bezel so the painting fills the browser window
// edge-to-edge. Full-immersion viewing mode.
//
// Toggles:
//   - Chip button #btn-zen in the session chip cluster
//   - Keyboard shortcut Z (when not typing in an input)
//
// Exit affordances (all fire the same _exit path):
//   - Escape key
//   - Z key
//   - Top-right corner hotspot: 2 seconds of pointer presence in the
//     60×60 top-right region reveals a semi-transparent "Exit Zen"
//     pill for 3 seconds. Moving away cancels the reveal countdown.
//
// While Zen is active:
//   - body[data-zen="true"] drives all CSS hides
//   - Dim-on-stillness is suspended (see immersive.js gate)
//   - The Emotion Map plaque / Muse plaque / view switcher / debug
//     pill / header / chip band / stop button all fade out
//
// Cross-platform: pure attribute + CSS + pointer events. Works Chrome,
// Safari, Firefox, iOS Safari, future WKWebView.
// ═══════════════════════════════════════════════════════════════════════

const HOTSPOT_DWELL_MS = 2000;
const EXIT_PILL_VISIBLE_MS = 3000;
const HOTSPOT_SIZE_PX = 80;

let _btn = null;
let _hotspot = null;
let _exitPill = null;
let _dwellTimer = null;
let _hidePillTimer = null;
let _mounted = false;
let _boundHandlers = null;

function _isZen() {
  return document.body.getAttribute("data-zen") === "true";
}

function _enter() {
  document.body.setAttribute("data-zen", "true");
  if (_btn) {
    _btn.setAttribute("aria-pressed", "true");
    _btn.setAttribute("aria-label", "Exit Zen mode");
  }
}

function _exit() {
  document.body.removeAttribute("data-zen");
  if (_btn) {
    _btn.setAttribute("aria-pressed", "false");
    _btn.setAttribute("aria-label", "Enter Zen mode");
  }
  _hideExitPill();
}

function _toggle() {
  if (_isZen()) _exit(); else _enter();
}

function _showExitPill() {
  if (!_exitPill) return;
  _exitPill.setAttribute("aria-hidden", "false");
  if (_hidePillTimer) clearTimeout(_hidePillTimer);
  _hidePillTimer = setTimeout(_hideExitPill, EXIT_PILL_VISIBLE_MS);
}

function _hideExitPill() {
  if (!_exitPill) return;
  _exitPill.setAttribute("aria-hidden", "true");
  if (_hidePillTimer) { clearTimeout(_hidePillTimer); _hidePillTimer = null; }
}

function _onHotspotEnter() {
  if (!_isZen()) return;
  if (_dwellTimer) return;
  _dwellTimer = setTimeout(() => {
    _dwellTimer = null;
    if (_isZen()) _showExitPill();
  }, HOTSPOT_DWELL_MS);
}

function _onHotspotLeave() {
  if (_dwellTimer) { clearTimeout(_dwellTimer); _dwellTimer = null; }
}

function _onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

  if (e.key === "Escape" && _isZen()) {
    e.preventDefault();
    _exit();
    return;
  }
  if ((e.key === "z" || e.key === "Z") && !e.repeat) {
    e.preventDefault();
    _toggle();
  }
}

// ─── Public API ─────────────────────────────────────────────────────
export function mountZen() {
  if (_mounted) return;

  _btn = document.getElementById("btn-zen");
  if (_btn) {
    _btn.addEventListener("click", _toggle);
    _btn.setAttribute("aria-pressed", "false");
    _btn.setAttribute("aria-label", "Enter Zen mode");
  }

  // Invisible top-right hotspot for the exit affordance
  _hotspot = document.createElement("div");
  _hotspot.className = "ea-zen-hotspot";
  _hotspot.setAttribute("aria-hidden", "true");
  _hotspot.style.cssText =
    `position:fixed;top:0;right:0;width:${HOTSPOT_SIZE_PX}px;height:${HOTSPOT_SIZE_PX}px;` +
    "z-index:99998;pointer-events:none;";
  document.body.appendChild(_hotspot);

  // The Exit Zen pill — a small chip that fades in when the user
  // dwells in the hotspot. Positioned just under the hotspot.
  _exitPill = document.createElement("button");
  _exitPill.type = "button";
  _exitPill.className = "ea-zen-exit-pill";
  _exitPill.setAttribute("aria-hidden", "true");
  _exitPill.textContent = "Exit Zen";
  _exitPill.addEventListener("click", _exit);
  document.body.appendChild(_exitPill);

  // Zen only enables its hotspot pointer-events while active — done via CSS
  window.addEventListener("keydown", _onKey);

  // Track pointer presence in the hotspot region using window mousemove
  // (works even when the hotspot has pointer-events:none in non-Zen).
  const move = (e) => {
    if (!_isZen()) return;
    const inside = (e.clientX >= window.innerWidth - HOTSPOT_SIZE_PX) &&
                   (e.clientY <= HOTSPOT_SIZE_PX);
    if (inside) _onHotspotEnter(); else _onHotspotLeave();
  };
  window.addEventListener("pointermove", move, { passive: true });

  _boundHandlers = { move };
  _mounted = true;
}

export function unmountZen() {
  if (!_mounted) return;

  window.removeEventListener("keydown", _onKey);
  if (_boundHandlers) {
    window.removeEventListener("pointermove", _boundHandlers.move);
    _boundHandlers = null;
  }
  if (_btn) _btn.removeEventListener("click", _toggle);
  if (_hotspot && _hotspot.parentElement) _hotspot.parentElement.removeChild(_hotspot);
  if (_exitPill && _exitPill.parentElement) _exitPill.parentElement.removeChild(_exitPill);
  if (_dwellTimer) { clearTimeout(_dwellTimer); _dwellTimer = null; }
  if (_hidePillTimer) { clearTimeout(_hidePillTimer); _hidePillTimer = null; }

  document.body.removeAttribute("data-zen");
  _btn = null;
  _hotspot = null;
  _exitPill = null;
  _mounted = false;
}

export function isZenActive() {
  return _isZen();
}
