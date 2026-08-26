/**
 * Empathic Art — Immersive-hidden overlay
 * ────────────────────────────────────────────────────────────────
 * When the user closes the emotion map during a live session, hide
 * every piece of UI chrome completely (not the dim-fade of ~15%
 * used by the stillness timer). Only two things remain on screen:
 *
 *   1. A floating emotion name at the top-center of the viewport.
 *   2. A tiny "Tap to show map" hint at the bottom, which fades in
 *      after 3s of continued map-closed state and fades out on any
 *      tap. Tapping anywhere on the field re-opens the emotion map.
 *
 * This is different from the stillness-dim system in immersive.js:
 *   · Dim  = 5s of no interaction → chrome fades to ~15% opacity.
 *   · Hide = user explicitly closes the map → chrome vanishes 100%.
 *
 * Wired to body[data-emotion-map-open]. When it flips to "false"
 * we enter the hidden state; when it flips back to "true" (either
 * via the tap or via any other opener) we exit.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { dbg } from "../debug/debug-overlay.js?v=1.3.1";

const HINT_DELAY_MS = 3000;

let _mounted = false;
let _observer = null;
let _nameEl = null;
let _hintEl = null;
let _hintTimer = null;
let _tapHandler = null;
let _sourceObserver = null;

// Read the current emotion label from #muse-vis-name (the source of
// truth for the label the user is seeing on the emotion map). We
// mirror it into our floating overlay so both agree.
function _currentLabel() {
  const src = document.getElementById("muse-vis-name");
  return (src && src.textContent) || "";
}
function _currentHue() {
  const src = document.getElementById("muse-vis-name");
  if (!src) return null;
  return src.style.getPropertyValue("--reveal-hue") || null;
}

function _syncLabel() {
  if (!_nameEl) return;
  _nameEl.textContent = _currentLabel();
  const hue = _currentHue();
  if (hue) _nameEl.style.color = hue;
  else     _nameEl.style.removeProperty("color");
}

function _ensureNodes() {
  if (!_nameEl) {
    _nameEl = document.createElement("div");
    _nameEl.className = "ea-immersive-emotion-name";
    _nameEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(_nameEl);
  }
  if (!_hintEl) {
    _hintEl = document.createElement("div");
    _hintEl.className = "ea-immersive-hint";
    _hintEl.setAttribute("role", "status");
    _hintEl.setAttribute("aria-live", "polite");
    _hintEl.innerHTML = `
      <span class="ea-immersive-hint__dot" aria-hidden="true"></span>
      <span class="ea-immersive-hint__text">Tap to show map</span>
    `;
    document.body.appendChild(_hintEl);
  }
}

function _startHintTimer() {
  _clearHintTimer();
  _hintTimer = setTimeout(() => {
    document.body.setAttribute("data-immersive-hint-visible", "1");
  }, HINT_DELAY_MS);
}
function _clearHintTimer() {
  if (_hintTimer) { clearTimeout(_hintTimer); _hintTimer = null; }
}

function _bindTapToShow() {
  if (_tapHandler) return;
  _tapHandler = (e) => {
    // Only respond if we're currently in immersive-hidden state.
    if (document.body.getAttribute("data-immersive-hidden") !== "1") return;
    // Never re-open on taps inside the (still-hidden but present)
    // emotion-map panel scrollable area — but that panel already has
    // pointer-events: none applied via the CSS, so this is a belt.
    // Fire the toggle: set data-emotion-map-open back to "true".
    // The setOpen() closure in app.js listens to a click on the
    // #btn-muse-data-toggle to flip state; simulate it by clicking.
    // The toggle button is #btn-muse-data. Because we hide it via
    // opacity:0 + pointer-events:none, .click() is blocked. Call
    // its onclick handler directly instead — it toggles the panel
    // and sets body[data-emotion-map-open="true"], which our own
    // observer then reacts to by calling _exitHidden().
    const openBtn = document.getElementById("btn-muse-data");
    if (openBtn && typeof openBtn.onclick === "function") {
      dbg("log", "[immersive-hidden] tap → reopen emotion map");
      try { openBtn.onclick(); } catch (err) { dbg("warn", "[immersive-hidden] onclick threw", err); }
      // Prevent the same tap from being handled elsewhere.
      e.stopPropagation();
      e.preventDefault();
    }
  };
  // Use capture so we intercept before other click handlers on the
  // (hidden) chrome even try to fire.
  window.addEventListener("click", _tapHandler, { capture: true });
  window.addEventListener("touchend", _tapHandler, { capture: true, passive: false });
}
function _unbindTapToShow() {
  if (!_tapHandler) return;
  window.removeEventListener("click",    _tapHandler, { capture: true });
  window.removeEventListener("touchend", _tapHandler, { capture: true });
  _tapHandler = null;
}

function _enterHidden() {
  _ensureNodes();
  _syncLabel();
  document.body.setAttribute("data-immersive-hidden", "1");
  _bindTapToShow();
  _startHintTimer();
  dbg("log", "[immersive-hidden] entered, chrome vanished, label floating");
}

function _exitHidden() {
  _clearHintTimer();
  _unbindTapToShow();
  document.body.removeAttribute("data-immersive-hidden");
  document.body.removeAttribute("data-immersive-hint-visible");
  dbg("log", "[immersive-hidden] exited, chrome restored");
}

/**
 * Watch the muse-vis-name node so the floating overlay always shows
 * the same label the user last saw in the map.
 */
function _watchLabelSource() {
  if (_sourceObserver) return;
  const src = document.getElementById("muse-vis-name");
  if (!src) return;
  _sourceObserver = new MutationObserver(() => {
    if (document.body.getAttribute("data-immersive-hidden") === "1") {
      _syncLabel();
    }
  });
  _sourceObserver.observe(src, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
}

/** Mount once at boot. Idempotent. */
export function mountImmersiveHidden() {
  if (_mounted) return;
  _mounted = true;

  // Watch body attribute changes.
  _observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.attributeName === "data-emotion-map-open") {
        const open = document.body.getAttribute("data-emotion-map-open") === "true";
        // Only apply during an active session — the Before screen
        // doesn't have a "map" to hide.
        const inSession = document.body.getAttribute("data-screen") === "session"
          || !!document.querySelector('.ea-screen[data-screen="session"].ea-screen--active');
        if (!inSession) {
          _exitHidden();
          continue;
        }
        if (open) _exitHidden();
        else      _enterHidden();
      }
      if (r.attributeName === "data-screen") {
        // Leaving the session screen always exits hidden mode.
        const inSession = document.body.getAttribute("data-screen") === "session"
          || !!document.querySelector('.ea-screen[data-screen="session"].ea-screen--active');
        if (!inSession) _exitHidden();
      }
    }
  });
  _observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-emotion-map-open", "data-screen"],
  });

  _watchLabelSource();
  // Re-watch on every setOpen(true) since the muse panel may be torn
  // down and rebuilt between sessions.
  const onScreenChange = () => {
    // Wait a beat for the muse panel DOM to (re)appear.
    setTimeout(() => {
      if (_sourceObserver) { _sourceObserver.disconnect(); _sourceObserver = null; }
      _watchLabelSource();
    }, 200);
  };
  // Screen changes come as class flips on .ea-screen; observe them.
  const screens = document.querySelectorAll(".ea-screen");
  for (const s of screens) {
    new MutationObserver(onScreenChange).observe(s, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

export function unmountImmersiveHidden() {
  if (!_mounted) return;
  _exitHidden();
  if (_observer) { _observer.disconnect(); _observer = null; }
  if (_sourceObserver) { _sourceObserver.disconnect(); _sourceObserver = null; }
  if (_nameEl && _nameEl.parentNode) _nameEl.parentNode.removeChild(_nameEl);
  if (_hintEl && _hintEl.parentNode) _hintEl.parentNode.removeChild(_hintEl);
  _nameEl = null;
  _hintEl = null;
  _mounted = false;
}
