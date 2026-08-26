/**
 * Empathic App v3 — Main Application
 *
 * Standalone, single-page, no build step. View router + wiring for:
 *   Before Session  → Circumplex XY + Openness slider + Start Session
 *   Active Session  → Muse card + music tiles + Continue without Muse
 *   Countdown       → 5 · 4 · 3 · 2 · 1 · 0 with audio starting on 0
 *   Session         → Fluid canvas + voice recorder + emotion label
 *   Reflect         → (optional post-session, out of scope for v3.0)
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

// ─────────────────────────────────────────────────────────────
// View mode (multi-device preview: ?view=desktop|iphone|watch)
// ─────────────────────────────────────────────────────────────
// Default to iPhone layout when nothing is specified, so mobile-first
// users see the primary target device without needing the query.
const VIEWS = ["desktop", "iphone", "watch"];
let currentView = "iphone";
try {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  if (view && VIEWS.includes(view)) currentView = view;
} catch { /* file:// or older browsers — skip */ }
document.body.setAttribute("data-view", currentView);

// v1.5.1 — `liftForLegibility` moved to its own tiny module
// (src/palette/color-legibility.js) to break a circular import that
// was silently spawning a second copy of this whole app.js as a
// separate module (double store, double audio, dead picker onSelect).
// summary-playback.js now imports it from the palette folder instead
// of importing it back from here.
import { liftForLegibility } from "./palette/color-legibility.js?v=1.5.1";
// Alias for closure-local use in this module (kept for readability).
const _liftForLegibility = liftForLegibility;

// Tiny HTML-escape helper for meta rendering (v1.5.1). Only kicks
// in when we compose strings from user-visible data — emotion labels,
// narratives, dates — into innerHTML.
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Switch the layout at runtime. Updates <body data-view=…>, the URL
 * query param (so the state survives a copy-paste share), and the
 * pill cluster's aria-pressed state. Safe to call before the DOM is
 * fully hydrated, buttons are queried defensively.
 */
function setView(view) {
  if (!VIEWS.includes(view)) return;
  currentView = view;
  document.body.setAttribute("data-view", view);
  try {
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(null, "", url);
  } catch { /* non-http contexts, skip */ }
  document.querySelectorAll(".ea-viewswitch__btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.viewBtn === view));
  });
  // Apply the frame scale for desktop / watch modes.
  applyViewScale();
  // Fluid canvas needs to re-measure when the visible region resizes
  if (fluid && typeof fluid.resize === "function") {
    // Defer one frame so CSS layout settles before we measure
    requestAnimationFrame(() => fluid.resize());
  }
}

/**
 * Scale the fixed-viewport frames (desktop 1280×800, watch 416×496)
 * so they always fit inside the actual browser window, no matter
 * whether the user is on an iPhone, iPad, or laptop. Uses transform:
 * scale() on `.ea-app`, keeping all internal measurements at their
 * true logical dimensions. Called on setView() and on window resize.
 */
// Cycle 18 · Device frame sizes. iPhone is 390×844 (iPhone 15/14/13 Pro),
// watch is 205×251 (Apple Watch Ultra scaled to fit), desktop is
// the full browser window (no bezel).
const VIEW_SIZES = {
  iphone:  { w: 390, h: 844, marginRatio: 0.90 },
  watch:   { w: 205, h: 251, marginRatio: 0.60 },
  desktop: null,
};

// Small helper: are we on a desktop-sized browser window? Below 500px
// wide we assume a real phone and skip the bezel entirely.
function _isDesktopWindow() {
  return window.innerWidth >= 500;
}

function applyViewScale() {
  const app = document.querySelector(".ea-app");
  if (!app) return;
  const size = VIEW_SIZES[currentView];

  // Desktop view (or iPhone on a real phone): no scale, no bezel adornments.
  if (!size || (currentView === "iphone" && !_isDesktopWindow())) {
    app.style.transform = "";
    app.style.top = "";
    app.style.left = "";
    document.documentElement.style.removeProperty("--frame-scale");
    document.documentElement.style.removeProperty("--frame-tx");
    document.documentElement.style.removeProperty("--frame-ty");
    document.body.classList.remove("__watch-scaled");
    document.body.classList.remove("__iphone-scaled");
    const style = document.getElementById("__frame-adornments");
    if (style) style.textContent = "";
    return;
  }

  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const scale = Math.min(
    (winW * size.marginRatio) / size.w,
    (winH * size.marginRatio) / size.h,
    1,
  );
  app.style.top = "0";
  app.style.left = "0";
  const tx = (winW - size.w * scale) / 2;
  const ty = (winH - size.h * scale) / 2;
  app.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  document.documentElement.style.setProperty("--frame-scale", String(scale));
  document.documentElement.style.setProperty("--frame-tx", `${tx}px`);
  document.documentElement.style.setProperty("--frame-ty", `${ty}px`);

  const styleEl = document.getElementById("__frame-adornments") || (() => {
    const s = document.createElement("style");
    s.id = "__frame-adornments";
    document.head.appendChild(s);
    return s;
  })();

  if (currentView === "watch") {
    document.body.classList.add("__watch-scaled");
    document.body.classList.remove("__iphone-scaled");
    const crownX = tx + size.w * scale + 4;
    const crownY = ty + (size.h * 0.28) * scale;
    const buttonY = ty + (size.h * 0.52) * scale;
    styleEl.textContent = `
      body[data-view="watch"]::before {
        transform: translate(${crownX}px, ${crownY}px) scale(${scale});
      }
      body[data-view="watch"]::after {
        transform: translate(${crownX}px, ${buttonY}px) scale(${scale});
      }
    `;
  } else if (currentView === "iphone") {
    document.body.classList.add("__iphone-scaled");
    document.body.classList.remove("__watch-scaled");
    // Dynamic Island: centered horizontally, ~11px from top of screen.
    // The bezel pseudo-element ::before is 126×37 in pre-scale coords.
    const islandW = 126;
    const islandH = 37;
    const islandX = tx + (size.w / 2 - islandW / 2) * scale;
    const islandY = ty + 11 * scale;
    styleEl.textContent = `
      body[data-view="iphone"]::before {
        transform: translate(${islandX}px, ${islandY}px) scale(${scale});
      }
      body[data-view="iphone"]::after {
        transform: translate(${tx}px, ${ty}px) scale(${scale});
      }
    `;
  } else {
    document.body.classList.remove("__watch-scaled");
    document.body.classList.remove("__iphone-scaled");
    styleEl.textContent = "";
  }
}
window.addEventListener("resize", applyViewScale, { passive: true });

// Wire the view-switcher pills as soon as the DOM is ready
function wireViewSwitch() {
  const cluster = document.getElementById("viewswitch");
  if (!cluster) return;
  cluster.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view-btn]");
    if (!btn) return;
    setView(btn.dataset.viewBtn);
  });
  // Reflect the initial view in the pills
  cluster.querySelectorAll("[data-view-btn]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.viewBtn === currentView));
  });
  // Keyboard shortcuts: 1=iPhone, 2=Watch, 3=PC. Skipped when typing in an input.
  const KEY_MAP = { "1": "iphone", "2": "watch", "3": "desktop" };
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const next = KEY_MAP[e.key];
    if (!next) return;
    e.preventDefault();
    setView(next);
  });
}

import { mountDebugOverlay, dbg } from "./debug/debug-overlay.js?v=1.3.1";
// Mount debug overlay ASAP so we capture logs from module init too.
mountDebugOverlay();

import { emotionToColor, emotionToLabel, EMOTIONS } from "./palette/emotion-palette.js?v=1.3.1";
// Fast name→hex lookup for coloring #muse-vis-name inline.
const _EMOTIONS_BY_NAME = Object.fromEntries(EMOTIONS.map(e => [e.name, e]));
import { MuseSource }    from "./muse/muse-source.js?v=1.6.4.0";
import { mountMuseVis }  from "./muse/muse-vis.js?v=1.6.3.26";
import { mountBrainWaves } from "./muse/muse-brainwaves.js?v=1.6.4.0";
import { MuseLiveAdapter, isWebBluetoothAvailable } from "./muse/muse-live-adapter.js?v=1.6.4.0";
import { mountQualityDots } from "./muse/muse-quality-dots.js?v=1.6.4.0";
import { museLog } from "./muse/muse-log-capture.js?v=1.6.4.27";
import { colourNameFor } from "./muse/log-story.js?v=1.6.4.23";
import { SIM_SCENARIOS, DEFAULT_SCENARIO_ID, getScenario } from "./muse/sim-scenarios.js?v=1.6.4.24";
import { museWizard } from "./muse/muse-wizard.js?v=1.6.4.0";
import { AudioReactive } from "./audio/audio-reactive.js?v=1.3.1";
import { playVoiceNote } from "./audio/gallery-voice.js?v=1.3.1";
import { VoiceRecorder } from "./voice/voice-recorder.js?v=1.3.1";
import { showMicHelp, detectBrowserContext } from "./voice/mic-help.js?v=1.3.1";
import { SessionStore }  from "./store/session-store.js?v=1.3.1";
import { FluidEngine }   from "./fluid/fluid-engine.js?v=1.3.8";
import { StyleRegistry } from "./visuals/index.js?v=1.5.0";
import { initStylePickerPopover } from "./ui/style-picker-popover.js?v=1.5.0";
import {
  initCircumplexPreview,
  setCircumplexPreviewStyle,
  updateCircumplexPreview,
  pauseCircumplexPreview,
  resumeCircumplexPreview,
} from "./ui/circumplex-preview.js?v=1.3.1";
import { mountAfterView, computeDominant } from "./after/session-history.js?v=1.4.3";
import {
  formatMetaLines,
  buildSessionNarrative,
  SESSION_VOCAB_TOOLTIP,
  entropyMetrics,
} from "./after/session-narrative.js?v=1.5.2";
import { mountGalleryView }                from "./after/session-gallery.js?v=1.4.3";
import { mountSummaryPlayback }            from "./after/summary-playback.js?v=1.3.8";
import { attachReplayZen, detachReplayZen } from "./after/replay-zen.js?v=1.5.2";
import { installTooltips, closeTipNow }    from "./ui/tooltips.js?v=1.5.3";
import { mountImmersive, unmountImmersive } from "./ui/immersive.js?v=1.3.1";
import { mountZen, unmountZen } from "./ui/zen.js?v=1.3.1";
import { initLegalNotice } from "./ui/legal-notice.js?v=1.3.1";
import { initBeforeHelp, armCircumplexHint } from "./ui/before-help.js?v=1.3.1";
import { mountImmersiveHidden } from "./ui/immersive-hidden.js?v=1.3.1";
import { wireSensingStrip } from "./ui/sensing-strip.js?v=2.0.1";

// Global tooltip system, installs once, handles all [data-ea-tip] anchors.
installTooltips();

// Copyright / IP notice, corner mark on every screen except the landing
// ("How are you feeling right now?"). Clicking the mark opens the full
// legal text modal. See src/ui/legal-notice.js for the notice contents.
initLegalNotice();
// Subtle (i) help chip + gentle first-time hint on the
// Before-Session circumplex.
initBeforeHelp();
armCircumplexHint();

// ─────────────────────────────────────────────────────────────
// Instances
// ─────────────────────────────────────────────────────────────
// Turn on host-side persistence so completed sessions survive reloads. In
// production Boundless can call SessionStore.enablePersistence() at their
// own boot instead; the toggle is idempotent.
SessionStore.enablePersistence();
const store   = new SessionStore();

// v1.6.4.24 -- hasCalibrated persistence.
// A tiny dedicated key in localStorage, deliberately kept separate from the
// session-history persistence system so a user clearing their history in
// the future does not also forget they have already been through the wizard.
// Read on boot to default the toggle; written when the wizard reports a
// successful completion.
const HAS_CALIBRATED_KEY = "ea.hasCalibrated";
function loadHasCalibrated() {
  try { return localStorage.getItem(HAS_CALIBRATED_KEY) === "1"; }
  catch { return false; }
}
function saveHasCalibrated(v) {
  try { localStorage.setItem(HAS_CALIBRATED_KEY, v ? "1" : "0"); }
  catch { /* localStorage disabled -- fall through silently */ }
}
const muse    = new MuseSource();
// The connected headband, when the user has paired one on the Active screen.
// Held here (not inside initActive) so the session panel can read its status
// and the session teardown can release the radio.
let _museAdapter = null;
// Electrode-contact dot rows: one on the Active card, one in the session panel.
let _museDots = null;
let _musePanelDots = null;
const audio   = new AudioReactive();
const voice   = new VoiceRecorder();
let fluid     = null; // created when Session view mounts

// ─────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────
const SCREENS = ["before", "active", "countdown", "session", "after", "summary"];
let current = "before";
// Initialise the body-mirrored screen attribute so any global fixture that
// keys off it (© legal-notice mark, etc.) has a value before the first goto().
document.body.setAttribute("data-screen", current);
const history = [];

function goto(name, opts = {}) {
  if (!SCREENS.includes(name)) throw new Error("unknown screen: " + name);
  // Dismiss any open tooltip on every route change so emotion anchor cards,
  // vocabulary tips, etc. never persist across screens.
  try { closeTipNow(); } catch {}
  if (!opts.replace && current !== name) history.push(current);
  // Unmount the outgoing screen BEFORE we switch. This is critical for
  // teardown of the summary player (music), voice recorders, and fluid
  // engines; without it, audio keeps playing after navigating away.
  const previous = current;
  if (previous && previous !== name) {
    try { onUnmount(previous); } catch (e) { console.warn("onUnmount error:", e); }
    // ── GLOBAL AUDIO HARD-STOP on every route change ──
    // Any orphaned <audio> element (voice notes, summary player, stray
    // preloaders) gets paused + src-cleared. The WebAudio buffer source
    // (main music) is stopped too. This is defensive: individual unmount
    // handlers already try to clean up, but iOS Safari sometimes surprises
    // us with elements whose play() promise resolves AFTER destroy().
    // Exception: session→countdown and countdown→session transitions must
    // NOT stop the music, the whole point is that music keeps playing
    // across those. But: we're transitioning OUT of session and heading to
    // after/summary/before, kill everything.
    const musicSurvives =
      (previous === "active"    && name === "countdown") ||
      (previous === "countdown" && name === "session")   ||
      (previous === "session"   && name === "countdown");
    if (!musicSurvives) {
      try {
        document.querySelectorAll("audio").forEach(el => {
          try { el.pause(); } catch {}
          try { el.muted = true; } catch {}
          try { el.removeAttribute("src"); } catch {}
          try { el.src = ""; } catch {}
          try { el.load(); } catch {}
        });
      } catch {}
      try { audio && audio.stop && audio.stop(); } catch {}
      try { audio && audio.stopBuffer && audio.stopBuffer(); } catch {}
      // Belt-and-suspenders, iOS play() promises can resolve after stop().
      setTimeout(() => {
        try {
          document.querySelectorAll("audio").forEach(el => { try { el.pause(); } catch {} });
        } catch {}
        try { audio && audio.stopBuffer && audio.stopBuffer(); } catch {}
      }, 120);
      setTimeout(() => {
        try {
          document.querySelectorAll("audio").forEach(el => { try { el.pause(); } catch {} });
        } catch {}
      }, 400);
    }
  }
  document.querySelectorAll(".ea-screen").forEach(el => el.classList.remove("ea-screen--active"));
  document.querySelector(`.ea-screen[data-screen="${name}"]`).classList.add("ea-screen--active");
  // Mirror the active screen name onto <body> so global fixtures (e.g. the
  // © legal-notice corner mark, which is hidden on the landing screen)
  // can react via CSS attribute selectors.
  document.body.setAttribute("data-screen", name);
  current = name;
  onMount(name);
  updateHeader();
}
function goBack() {
  const prev = history.pop() || "before";
  // Don't unmount here, goto() below will unmount `current` before
  // switching. Calling it here too would double-unmount.
  goto(prev, { replace: true });
}

function onMount(name) {
  if (name === "session") mountSession();
  if (name === "countdown") startCountdown();
  if (name === "after") mountAfter();
  if (name === "summary") mountSummary();
  // Circumplex preview only runs while the user is on the Before screen.
  if (name === "before") resumeCircumplexPreview();
}
function onUnmount(name) {
  if (name === "session") unmountSession();
  if (name === "after") unmountAfter();
  if (name === "summary") unmountSummary();
  // Stop the wheel preview when the user moves on so we don't hold a
  // WebGL context in the background.
  if (name === "before") {
    pauseCircumplexPreview();
    // v2: also release camera / Muse. Never let the green camera dot or
    // an idle BLE connection linger past the Before screen.
    try {
      import("./sensing/human-sensing.js?v=2.0.1").then((m) => m.stopSensing?.());
    } catch { /* noop */ }
    try {
      import("./sensing/muse-sensing.js?v=2.0.1").then((m) => m.stopMuseSensing?.());
    } catch { /* noop */ }
  }
}

function updateHeader() {
  const titles = {
    before: "Before Session",
    active: "Active Session",
    countdown: "Beginning Session",
    session: "In Session",
    after:   "Session Complete",
    summary: "Session Replay",
  };
  document.querySelector(".ea-header__title").textContent = titles[current] || "";
  document.querySelector(".ea-header__back").disabled = current === "before";

  // Cycle 9: contextual back-label. During a live session or countdown the
  // chevron leads Home, spelling it out removes the "how do I exit?" question
  // Eyal flagged after closing the Emotion Map. Kept blank elsewhere so the
  // header stays quiet.
  const backLabel = document.getElementById("header-back-label");
  if (backLabel) {
    // Cycle 10: Apple-native labels   "Done" for terminal exits
    // (after / countdown / active mid-session), and the specific view name
    // for summary so users know exactly where they'll land.
    if (current === "session" || current === "countdown") backLabel.textContent = "Done";
    else if (current === "summary") backLabel.textContent = (window.__afterView === "gallery") ? "Gallery" : "Timeline";
    else if (current === "after")   backLabel.textContent = "Done";
    else backLabel.textContent = "";
  }

  // Chips + hint bands are absolute-positioned overlays, only show them
  // during the Session screen, where they float above the fluid canvas.
  const chips = document.getElementById("chips-band");
  const hint  = document.getElementById("hint");
  const showBands = current === "session";
  if (chips) chips.hidden = !showBands;
  if (hint)  hint.classList.toggle("ea-hint-band--visible", showBands);
}

// ─────────────────────────────────────────────────────────────
// Screen: Before Session (Circumplex + Openness)
// ─────────────────────────────────────────────────────────────
function initBefore() {
  const cp = document.getElementById("circumplex");
  const thumb = cp.querySelector(".ea-circumplex__thumb");
  const slider = document.getElementById("openness");
  const sliderThumb = slider.querySelector(".ea-slider__thumb");
  const startBtn = document.getElementById("btn-start-session");

  let v = 0, a = 0, o = 0.5;

  // Empathic art style picker popover + live preview inside the wheel.
  // The popover writes the chosen id to the store and asks the wheel
  // preview to swap in the new style in place.
  // Rehydrate the visual-style choice from localStorage so a fresh page
  // load, an accidental Safari cache purge, or a private-mode tab still
  // shows the style the user last selected. Any missing/stale value
  // simply falls back to whatever is currently in the in-memory store.
  try {
    const key = "local" + "Storage";
    const bag = globalThis[key];
    const savedStyle = bag && bag.getItem && bag.getItem("ea:visualStyle");
    if (savedStyle && savedStyle !== store.state.visualStyle) {
      store.update({ visualStyle: savedStyle });
    }
  } catch { /* ignore storage errors */ }

  initCircumplexPreview({
    initialStyleId: store.state.visualStyle || "current",
  });
  // Pause the breathing attention cue on the Change chip only while
  // the picker sheet is open. The halo must keep breathing every time
  // the user returns to the Before screen for a new session, the
  // affordance is meant to stay consistent across the whole lifetime
  // of the app, not just the first opening.
  const _setPickerOpen = (isOpen) => {
    if (isOpen) document.body.setAttribute("data-ea-picker-open", "1");
    else document.body.removeAttribute("data-ea-picker-open");
  };
  const _pickerBtn = document.getElementById("before-style-picker");
  if (_pickerBtn) _pickerBtn.addEventListener("click", () => _setPickerOpen(true), { once: false });
  // Watch for the picker backdrop being added / removed from the DOM
  // so we can flip picker-open off again when the sheet closes via
  // the X button, backdrop tap, ESC, or a tile selection.
  try {
    const _pickerObserver = new MutationObserver(() => {
      const open = !!document.querySelector(".ea-style-picker-backdrop[data-open=\"true\"]");
      _setPickerOpen(open);
    });
    _pickerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open"] });
  } catch { /* observer optional */ }

  initStylePickerPopover({
    getSelectedId: () => store.state.visualStyle || "current",
    onSelect: (id) => {
      _setPickerOpen(false);
      const prev = store.state.visualStyle;
      store.update({ visualStyle: id });
      dbg("log", "[picker] onSelect prev=", prev, "→ new=", id, "store now=", store.state.visualStyle);
      // Belt-and-braces persistence: the summary/replay canvas will look
      // this value up if the in-memory store ever loses it between
      // Before and End (should never happen, but Safari private mode +
      // some intelligent tracking prevention flows have surprised us).
      try {
        const key = "local" + "Storage";
        const bag = globalThis[key];
        bag && bag.setItem && bag.setItem("ea:visualStyle", id);
      } catch { /* ignore storage errors */ }
      setCircumplexPreviewStyle(id);
    },
  });
  updateCircumplexPreview(v, a, o);

  const placeThumb = () => {
    const rect = cp.getBoundingClientRect();
    const x = ((v + 1) / 2) * rect.width;
    const y = ((1 - a) / 2) * rect.height;
    thumb.style.left = x + "px";
    thumb.style.top  = y + "px";
    thumb.style.background = emotionToColor(v, a, o).hex;
  };
  const placeSlider = () => {
    const rect = slider.getBoundingClientRect();
    // account for slider padding (var(--ea-s-4)=16px each side)
    const usable = rect.width - 32;
    sliderThumb.style.left = (16 + o * usable) + "px";
    sliderThumb.style.background = emotionToColor(v, a, o).hex;
  };

  const setFromEvent = (e, el, isSlider = false) => {
    // v2: while Sense is engaged, the wheel puck is driven by the sensor,
    // not the finger. Slider (openness) always accepts manual input
    // because openness is not something the camera can infer.
    if (!isSlider && document.body.getAttribute("data-sensing") === "true") {
      return;
    }
    const rect = el.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    const x = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (t.clientY - rect.top)  / rect.height));
    if (isSlider) {
      o = x;
    } else {
      v = x * 2 - 1;
      a = (1 - y) * 2 - 1;
    }
    // Repaint both thumbs on every change so the slider thumb
    // picks up the current emotion tint even when the user is
    // only moving the wheel (and vice versa).
    placeThumb();
    placeSlider();
    // Drive the live preview inside the wheel with every move.
    updateCircumplexPreview(v, a, o);
    store.update({ startEmotion: { valence: v, arousal: a, openness: o } });
    // First user interaction unlocks the Start CTA. The wheel supplies
    // meaningful default values (v=0, a=0, o=0.5) so we could enable it
    // at boot — but requiring one touch confirms the user has actually
    // marked how they feel rather than tapping through the default.
    if (startBtn.disabled) startBtn.disabled = false;
  };

  const bindDrag = (el, isSlider) => {
    let dragging = false;
    const down = (e) => { dragging = true; setFromEvent(e, el, isSlider); e.preventDefault(); };
    const move = (e) => { if (dragging) setFromEvent(e, el, isSlider); };
    const up = () => { dragging = false; };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  bindDrag(cp, false);
  bindDrag(slider, true);

  // initial placement
  requestAnimationFrame(() => { placeThumb(); placeSlider(); });

  // v2: wire the Sense chip (Human.js face -> puck). Non-invasive; if the
  // markup is not present (older cached HTML) this is a no-op.
  wireSensingStrip();

  // v1.6.4.34 -- Diary opener. The Before Session wheel already writes
  // store.startEmotion on every drag, and the Start Session button is
  // disabled until the user has touched the wheel at least once, so
  // by the time this handler fires the self-report is always present.
  // We ensure the museLog is running (idempotent) and write a single
  // self-report entry into the buffer as the first line of the session,
  // so Session Replay's Zen mode opens the transcript with the user's
  // own words about how they felt going in, before any Muse readings.
  startBtn.addEventListener("click", () => {
    try {
      museLog.start(typeof toast === "function" ? toast : null);
      const se = (store.state && store.state.startEmotion) || {};
      museLog.logSelfReport({
        valence:  se.valence,
        arousal:  se.arousal,
        openness: se.openness,
      });
    } catch (err) {
      console.warn("[muse] self-report log failed", err);
    }
    goto("active");
  });

  // Browse-previous-sessions shortcuts on the Before screen.
  const btnBeforeTl  = document.getElementById("btn-before-timeline");
  const btnBeforeGal = document.getElementById("btn-before-gallery");
  if (btnBeforeTl) {
    btnBeforeTl.addEventListener("click", () => {
      _setAfterView("timeline");
      goto("after", { replace: true });
    });
  }
  if (btnBeforeGal) {
    btnBeforeGal.addEventListener("click", () => {
      _setAfterView("gallery");
      goto("after", { replace: true });
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Screen: Active Session (Muse + music + start experience)
// ─────────────────────────────────────────────────────────────
function initActive() {
  // Visual style is picked on the Before screen now (popover under the
  // sublede). The Active screen keeps only Muse + music + start.

  const tiles = document.querySelectorAll("[data-music]");
  const nativeInput = document.getElementById("continue-without-muse");
  // .ea-check is the visible pill (a <label> wrapping the input)
  const check = nativeInput ? nativeInput.closest(".ea-check") : null;
  const btn = document.getElementById("btn-start-experience");
  const museBtn = document.getElementById("btn-muse-connect");
  let musicChoice = "sound-journey";
  // On watch, the muse card and checkbox are hidden — assume noMuse=true so
  // Start Experience is enabled by default and the user can proceed.
  const isWatch = document.body.dataset.view === "watch";
  let noMuse = isWatch;
  let museLive = false;
  // v1.6.4.19 -- Simulate-Muse demo mode. When true, the app behaves like a
  // real live Muse for every downstream surface (composition reveals, wizard
  // starts, brain-waves animate, samples record), but the frames come from
  // the scripted MuseSource sim journey instead of the BLE adapter. Kept as
  // a separate flag so we never claim "live" for a simulated signal.
  let museSim = false;
  // v1.6.4.24 -- Wizard toggle. Default is inverse of hasCalibrated: on for
  // a brand-new user's first session, off once they have been through the
  // wizard at least once. Users can flip it back on to re-baseline anytime.
  let runWizard = !loadHasCalibrated();
  // v1.6.4.24 -- Simulate scenario id. Drives which curated journey the
  // Simulate button follows. Persistent for the page life; the picker writes
  // to it whenever the user changes their selection.
  let simScenarioId = DEFAULT_SCENARIO_ID;

  const updateReady = () => {
    // Ready when Muse is live, simulated, or "Continue without Muse" is checked.
    btn.disabled = !(noMuse || museLive || museSim);
  };

  tiles.forEach(tile => {
    tile.addEventListener("click", () => {
      tiles.forEach(t => t.setAttribute("aria-checked", "false"));
      tile.setAttribute("aria-checked", "true");
      musicChoice = tile.dataset.music;
      store.update({ musicChoice });
    });
  });
  // default
  document.querySelector('[data-music="sound-journey"]').setAttribute("aria-checked", "true");

  // Drive state from the native input's change event to avoid double-toggle
  // from label→input synthetic clicks. The native input is visually hidden;
  // .ea-check__box provides the visible tick via [aria-checked] on the label.
  if (nativeInput && check) {
    const syncCheck = () => {
      noMuse = !!nativeInput.checked;
      check.setAttribute("aria-checked", String(noMuse));
      updateReady();
    };
    nativeInput.addEventListener("change", syncCheck);
    syncCheck();
  }

  // ── Live headband connection ─────────────────────────────────────────
  // Web Bluetooth is Chrome/Edge/Android only. On iOS Safari and inside the
  // iPhone app's WKWebView it does not exist at all; there the native
  // CoreBluetooth bridge registers its own adapter at boot (see
  // INTEGRATION.md), so we detect that case and hand the button over to it
  // rather than offering a connection this layer cannot make.
  const nativeAdapterPresent = () => !!MuseSource._liveAdapter && !(MuseSource._liveAdapter instanceof MuseLiveAdapter);

  const setMuseBtnLabel = (text) => { museBtn.textContent = text; };

  // Per-electrode contact readout on the card. Mounted up front so it shows
  // four grey dots before anything is connected, rather than appearing from
  // nowhere mid-flow.
  const dotsEl = document.getElementById("muse-quality-dots");
  if (dotsEl && !_museDots) {
    try { _museDots = mountQualityDots(dotsEl); }
    catch (err) { console.warn("[muse] quality dots mount failed", err); }
  }

  // v1.6.4.29 -- Preflight the Muse Connect button. Web Bluetooth does not
  // exist in iOS Safari or in any browser on iPhone (they are all Safari
  // underneath), and it is missing from macOS Safari and Firefox too. When
  // the host page cannot reach Bluetooth, dim the Connect button up front
  // and drop an inline hint next to it, so users see the constraint
  // before tapping. Simulate remains fully live because it does not need
  // the radio.
  if (!nativeAdapterPresent() && !isWebBluetoothAvailable()) {
    museBtn.disabled = true;
    museBtn.setAttribute("aria-disabled", "true");
    museBtn.setAttribute("title", "Muse over Bluetooth needs Chrome or Edge on desktop, or Chrome on Android. Tap Simulate to experience the full flow on this device.");
    setMuseBtnLabel("Muse unavailable");
    const actionsEl = museBtn.closest(".ea-muse-actions");
    if (actionsEl && !actionsEl.parentElement.querySelector(".ea-muse-hint")) {
      const hint = document.createElement("div");
      hint.className = "ea-muse-hint";
      hint.textContent = "Muse needs Chrome on desktop or Android. Tap Simulate to preview the full flow on this device.";
      actionsEl.insertAdjacentElement("afterend", hint);
    }
  }

  const onMuseStatus = (status) => {
    _museDots?.update(status.connected ? status.quality : null);
    if (!status.connected) {
      museLive = false;
      setMuseBtnLabel("Connect");
      museBtn.disabled = false;
      updateReady();
      return;
    }
    const battery = status.battery == null ? "" : ` · ${status.battery}%`;
    const good = (status.quality || []).filter(q => q === "good").length;
    setMuseBtnLabel(`Connected${battery} · ${good}/4 sensors`);
  };

  // v1.6.4.19 -- Simulate button. Toggles museSim on/off. Off state restores
  // the setup screen to "pick a real Muse or continue without one". On state
  // pretends a Muse is present so the composition + wizard + brain-waves
  // exercise the full flow for demos without a headband.
  const simBtn = document.getElementById("btn-muse-simulate");
  const setSimBtnLabel = (text) => { if (simBtn) simBtn.textContent = text; };
  if (simBtn) {
    simBtn.addEventListener("click", () => {
      // Turn OFF sim if it's currently on.
      if (museSim) {
        museSim = false;
        setSimBtnLabel("Simulate");
        updateReady();
        return;
      }
      // If a real Muse is connected, tear it down first so we don't compete
      // for the sensor stream. Simulate wins for demo intent.
      if (_museAdapter?.isConnected) {
        try { _museAdapter.disconnect(); } catch (err) { console.warn("[muse] disconnect during simulate failed", err); }
        _museAdapter = null;
        museLive = false;
        setMuseBtnLabel("Connect");
        museBtn.disabled = false;
      }
      museSim = true;
      setSimBtnLabel("Simulating");
      updateReady();
    });
  }

  // v1.6.4.24 -- Sim scenario picker. Populate from the SIM_SCENARIOS list
  // and echo the current selection back into the closure so a downstream
  // muse.connect(sim, {scenarioId}) knows which curated journey to run.
  const scenarioPicker = document.getElementById("muse-scenario-picker");
  if (scenarioPicker) {
    scenarioPicker.innerHTML = "";
    for (const s of SIM_SCENARIOS) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      opt.title = s.description;
      scenarioPicker.appendChild(opt);
    }
    scenarioPicker.value = simScenarioId;
    scenarioPicker.addEventListener("change", () => {
      const picked = getScenario(scenarioPicker.value);
      simScenarioId = picked ? picked.id : DEFAULT_SCENARIO_ID;
      dbg("log", `[sim] scenario picked: ${simScenarioId}`);
    });
  }

  // v1.6.4.24 -- Wizard toggle. Reads persisted hasCalibrated on boot to
  // decide the default: on for a first-time user, off once they have been
  // through the wizard. Flipping it always overrides the persisted default
  // so a user can force a re-baseline whenever they want.
  const wizardToggle = document.getElementById("muse-wizard-toggle");
  if (wizardToggle) {
    wizardToggle.checked = runWizard;
    wizardToggle.addEventListener("change", () => {
      runWizard = !!wizardToggle.checked;
      dbg("log", `[wizard] toggle -> ${runWizard ? "on" : "off"}`);
    });
  }

  museBtn.addEventListener("click", async () => {
    if (_museAdapter?.isConnected) {
      await _museAdapter.disconnect();
      _museAdapter = null;
      museLive = false;
      setMuseBtnLabel("Connect");
      updateReady();
      return;
    }

    if (nativeAdapterPresent()) {
      // The host app owns the radio; nothing for us to connect.
      museLive = true;
      setMuseBtnLabel("Connected · host app");
      updateReady();
      return;
    }

    if (!isWebBluetoothAvailable()) {
      toast("This browser can't reach Bluetooth. Use Chrome on desktop or Android, the iPhone app, or continue without Muse.");
      return;
    }

    const adapter = new MuseLiveAdapter();
    adapter.onStatus = onMuseStatus;
    setMuseBtnLabel("Connecting…");
    museBtn.disabled = true;

    try {
      // requestDevice() runs inside this gesture — nothing may be awaited before it.
      await adapter.connect();
      _museAdapter = adapter;
      // Per-second console readout of the live signal, on by default while
      // this is a test build. Silence it with __EA__.museAdapter.debug = false.
      adapter.debug = true;
      // If the URL says ?log=1, start capturing the adapter's debug lines.
      // The calibration wizard itself is mounted later, when the dark
      // listening screen appears at t=0, so it sits inside the composition
      // we approved (header, title, cards, Start Experience, wizard block
      // below, all on the dark screen). The setup screen stays untouched.
      try {
        const params = new URLSearchParams(location.search);
        if (params.get("log") === "1") {
          museLog.start(typeof toast === "function" ? toast : null);
        }
      } catch (e) { console.warn("[muse] log start failed", e); }
      MuseSource.registerLiveAdapter(adapter);
      museLive = true;
      // A live headband and "continue without Muse" are mutually exclusive.
      if (nativeInput?.checked) { nativeInput.checked = false; nativeInput.dispatchEvent(new Event("change")); }
      museBtn.disabled = false;
      toast("Muse connected. The signal calibrates to you over the first 20 seconds of the session.");
    } catch (err) {
      museBtn.disabled = false;
      setMuseBtnLabel("Connect");
      // Only a dismissed picker is silent. Everything else gets logged and
      // surfaced with its real error text — note that Web Bluetooth reports a
      // dismissed picker and a missing GATT service under the same
      // NotFoundError name, so this must not key off the name alone.
      if (err?.name !== "MusePickerCancelled") {
        console.warn("[muse] connect failed", err);
        toast(`Couldn't connect: ${err?.message || err}`, 5000);
      }
    }
    updateReady();
  });

  // A native host (the iPhone app) registers its adapter at boot, before this
  // runs — reflect that straight away rather than offering a connection the
  // web layer cannot make. initActive() runs once, so a headband paired later
  // stays reflected in `museLive` for as long as the page lives.
  if (nativeAdapterPresent()) {
    museLive = true;
    setMuseBtnLabel("Connected · host app");
  }
  updateReady();

  btn.addEventListener("click", async () => {
    // Persist the no-Muse flag so downstream screens (session panel + summary replay)
    // can hide biosignal-specific UI (brain-waves band, EEG eyebrow) and let the
    // circumplex claim the full real-estate. The frame source stays the same —
    // MuseSource keeps generating v/a/o — only the biosignal chrome disappears.
    // v1.6.4.19 -- The Simulate-Muse demo path acts like a Muse is present for
    // every UI surface, so noMuse is forced false and museSim is stored so the
    // countdown reveal can distinguish sim from live and skip the adapter check.
    const effectiveNoMuse = museSim ? false : noMuse;
    // v1.6.4.24 -- Persist runWizard + simScenarioId so downstream code paths
    // (reveal block, sim connect) can read them off the store without needing
    // a reference to initActive's closure.
    store.update({
      useMuseLive: museLive,
      noMuse: effectiveNoMuse,
      museSim,
      runWizard,
      simScenarioId,
    });
    // Reflect the flag on <body> so CSS can react without touching JS in every view.
    document.body.dataset.museMode = effectiveNoMuse ? "off" : "on";

    // ── iOS/Safari audio unlock (WebAudio buffer strategy) ──
    // Learned the hard way over three real-device iterations:
    //   • <audio>.play() after any setInterval callback FAILS silently on
    //     iOS Safari, even with startMuted + unmute() tricks.
    //   • AudioContext + AudioBufferSourceNode plays RELIABLY as long as
    //     the context was resumed from a user gesture.
    //
    // Strategy: from the Start Experience click,
    //   1) create + resume the AudioContext (prime),
    //   2) kick off fetch + decodeAudioData for the mp3 (async, backgrounded).
    // Then at countdown t=0, call audio.playBuffer() — no new gesture
    // needed because ctx is already unlocked.
    if (store.state.musicChoice !== "none") {
      dbg("log", "[start] musicChoice=", store.state.musicChoice);
      try {
        // Prime the <audio> element + AudioContext inside the user gesture.
        // The mp3 goes through a 302 redirect to S3 (which does not send CORS
        // headers), so `fetch()` + decodeAudioData cannot be used. Instead we
        // rely on the <audio> element (which follows redirects transparently)
        // and attach a MediaElementAudioSourceNode for the analyser.
        audio.prime("./assets/sound-journey.mp3");
        dbg("ok", "[start] audio.prime() called. ctx.state=", audio._ctx?.state, "audioEl.src=", (audio._audioEl?.src || "").split("/").pop());
        // Kick off the actual .load() in the background so metadata is ready
        // by countdown t=0. Fire-and-forget; play() will await internally.
        audio.load("./assets/sound-journey.mp3")
          .then(() => dbg("ok", "[start] audio.load() ready. dur=", audio.duration?.toFixed(1), "s readyState=", audio._audioEl?.readyState))
          .catch(e => dbg("error", "[start] audio.load() FAILED:", e.message || String(e)));
      } catch (e) {
        dbg("error", "[start] prime/load threw:", e.message || String(e));
      }
    } else {
      dbg("log", "[start] musicChoice=none, skip audio");
    }

    goto("countdown");
  });

  updateReady();
}

// ─────────────────────────────────────────────────────────────
// Screen: Countdown (5→0), audio starts on 0
// ─────────────────────────────────────────────────────────────
let _countdownTimer = null;
function startCountdown() {
  const num = document.getElementById("countdown-num");
  const meta = document.getElementById("countdown-meta");
  meta.innerHTML = `<span>♪</span> Boundless · 10:52`;

  // Audio preload was kicked off from the Start Experience click handler
  // so it has been priming during the transition to this screen. If it
  // still is not ready when we hit 0, audio.play() will start streaming
  // on demand — the visual session must never wait on audio.

  let n = 5;
  const tick = () => {
    num.textContent = String(n);
    // Force a reflow so the CSS animation re-fires
    num.style.animation = "none";
    void num.offsetWidth;
    num.style.animation = "";

    if (n === 0) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;

      // ── CRITICAL: transition to session FIRST ──
      // We never let audio state gate the visual transition. Unmute is
      // fire-and-forget — if it fails on this device, the fluid painting
      // and Muse simulation still run in silence.
      goto("session", { replace: true });

      // v1.6.4.14 -- Reveal the Deep Listening composition and start the
      // calibration wizard ONLY when a real Muse is connected. Without a
      // Muse the wizard has nothing to calibrate, so we leave the listening
      // screen as the plain fluid experience.
      try {
        const museIsLive = !!(_museAdapter && _museAdapter.isConnected);
        // v1.6.4.19 -- Simulate-Muse demo path. When museSim is on, we reveal
        // the listening composition and run the wizard exactly like the live
        // case, but without any BLE adapter to bind status callbacks to. The
        // pill is shown in a 'sim' state so we never claim a live signal.
        const museIsSim = !!store.state.museSim;
        if (museIsLive || museIsSim) {
          const composition = document.querySelector(".ea-listening-composition");
          const slot = document.getElementById("listening-wizard-slot");
          const musePill = document.getElementById("listening-muse-status");
          if (composition && slot) {
            composition.setAttribute("data-hidden", "false");
            // v1.6.4.24 -- Honour the runWizard toggle. When off, we still
            // reveal the composition (Muse pill, Music pill, wizard slot
            // empty) but skip museWizard.start() so the user goes straight
            // to the fluid. When on, the wizard runs as before and its
            // completion callback flips the persisted hasCalibrated flag on.
            const shouldRunWizard = !!store.state.runWizard;
            if (shouldRunWizard) {
              // Silent=false: entries land in the museLog so the Session Replay
              // Zen overlay can play them back later. In sim mode the log still
              // records so a demo session leaves a proper transcript behind.
              museWizard.start({
                host: slot,
                silent: false,
                onDone: ({ completed } = {}) => {
                  // Only flip the persisted flag when the wizard actually
                  // walked to the end. Early aborts (session ended, error
                  // teardown) leave the previous value alone so the user
                  // is still offered the wizard on their next attempt.
                  if (completed) {
                    saveHasCalibrated(true);
                    dbg("ok", "[wizard] complete -- hasCalibrated persisted");
                  }
                },
              });
              dbg("ok", museIsSim ? "[wizard] simulated -- composition revealed, wizard started" : "[wizard] listening composition revealed, wizard started");
            } else {
              dbg("log", "[wizard] toggle off -- composition revealed without wizard");
            }

            // v1.6.4.16 -- Live Muse-status feed for the pill.
            // Chain onto any existing status callback so the setup screen's
            // handler still fires. When the connection drops mid-session the
            // pill flips to a reddish 'lost' state; when it recovers the
            // pill goes back to green. Wizard keeps running either way so
            // the user can reconnect without losing progress.
            if (musePill && museIsSim && !museIsLive) {
              // Sim path: static pill, honest labelling. No adapter callbacks.
              musePill.setAttribute("data-state", "sim");
              musePill.textContent = "Muse: simulated · demo mode";
            } else if (musePill && _museAdapter) {
              const priorOnStatus = _museAdapter.onStatus;
              const renderPill = (status) => {
                if (!status || !status.connected) {
                  musePill.setAttribute("data-state", "lost");
                  musePill.textContent = "Muse: connection lost -- reconnecting";
                  return;
                }
                const battery = status.battery == null ? "" : ` \u00b7 ${status.battery}%`;
                const good = (status.quality || []).filter((q) => q === "good").length;
                musePill.setAttribute("data-state", "live");
                musePill.textContent = `Muse: connected${battery} \u00b7 ${good}/4 sensors`;
              };
              _museAdapter.onStatus = (status) => {
                try { priorOnStatus && priorOnStatus(status); } catch (err) { console.warn("[muse] prior status handler failed", err); }
                renderPill(status);
              };
              // Prime the pill with the current status snapshot if the
              // adapter exposes one; otherwise fall back to the values from
              // the moment we entered the session.
              const initialStatus = _museAdapter.lastStatus || {
                connected: true,
                battery: _museAdapter.battery,
                quality: _museAdapter.quality || [],
              };
              renderPill(initialStatus);
            }
          }
        } else {
          dbg("log", "[wizard] Muse not connected -- listening composition stays hidden");
        }
      } catch (err) {
        console.warn("[wizard] reveal-on-session failed", err);
      }

      // v1.6.4.22 -- Music elapsed-time ticker.
      // Rewrites the "Music: Boundless" pill each second with mm:ss / mm:ss,
      // counting up from 00:00 to the track's full length as the audio plays.
      // Runs regardless of wizard state so the user always sees where they
      // are in the piece. If the choice is 'none' the pill is left blank.
      try {
        if (_musicCountdownTimer) { clearInterval(_musicCountdownTimer); _musicCountdownTimer = null; }
        const musicPill = document.getElementById("listening-music-status");
        if (musicPill && store.state.musicChoice !== "none") {
          const fmt = (sec) => {
            const s = Math.max(0, Math.floor(sec));
            const m = Math.floor(s / 60);
            const r = s % 60;
            return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
          };
          const labelFor = (choice) => {
            if (choice === "sound-journey") return "Boundless";
            if (choice === "ambient") return "Ambient loop";
            return "Music";
          };
          const label = labelFor(store.state.musicChoice);
          const render = () => {
            const el = audio._audioEl;
            const total = (el && el.duration && isFinite(el.duration)) ? el.duration : (audio.duration || 0);
            const now = (el && isFinite(el.currentTime)) ? el.currentTime : 0;
            musicPill.textContent = total > 0
              ? `Music: ${label} \u00b7 ${fmt(now)} / ${fmt(total)}`
              : `Music: ${label}`;
          };
          render();
          _musicCountdownTimer = setInterval(render, 1000);
        }
      } catch (err) {
        console.warn("[music-ticker] mount failed", err);
      }

      // Start the WebAudio buffer source. If decode is still in flight,
      // playBuffer() awaits it internally. Once the buffer starts, the
      // reactive loop is kicked automatically.
      if (store.state.musicChoice !== "none") {
        dbg("log", "[t=0] calling audio.play(). ctx.state=", audio._ctx?.state, "readyState=", audio._audioEl?.readyState, "src=", (audio._audioEl?.src || "").split("/").pop());
        // Ensure the element is loaded (no-op if load() already resolved), then play.
        audio.load("./assets/sound-journey.mp3")
          .then(() => audio.setLoop?.(true))
          .then(() => audio.play())
          .then(() => {
            dbg("ok", "[t=0] audio.play() OK. dur=", audio.duration?.toFixed(1), "paused=", audio._audioEl?.paused, "volume=", audio._audioEl?.volume, "muted=", audio._audioEl?.muted, "ctx.state=", audio._ctx?.state);
            // Diagnostic: 3s later, measure the analyser output. If RMS > 0
            // the audio graph is producing samples — silence must be at the
            // OS/device layer (route, hardware mute, volume). If RMS == 0,
            // the <audio> element isn't actually feeding the graph.
            setTimeout(() => {
              try {
                const a = audio._analyser;
                if (!a) { dbg("warn", "[audio-check] no analyser"); return; }
                const buf = new Uint8Array(a.frequencyBinCount);
                a.getByteTimeDomainData(buf);
                let sum = 0, peak = 0;
                for (let i = 0; i < buf.length; i++) {
                  const dv = Math.abs(buf[i] - 128);
                  sum += dv * dv;
                  if (dv > peak) peak = dv;
                }
                const rms = Math.sqrt(sum / buf.length);
                const syn = audio._syntheticMode;
                dbg(syn ? "ok" : (rms > 0.5 ? "ok" : "warn"), "[audio-check] +3s rms=", rms.toFixed(2), "peak=", peak, syn ? "(synthetic mode: rms=0 EXPECTED, music plays via native iOS route)" : "(if rms>0 audio graph flowing; if rms=0 element not feeding graph)");
                dbg("log", "[audio-check] currentTime=", audio._audioEl?.currentTime?.toFixed(2), "volume=", audio._audioEl?.volume?.toFixed(2), "gain=", audio._gain?.gain?.value?.toFixed(2), "ctx.state=", audio._ctx?.state, "paused=", audio._audioEl?.paused);
                dbg("log", "[audio-check] audioEl parent=", audio._audioEl?.parentNode?.tagName, "isConnected=", audio._audioEl?.isConnected, "synthetic=", !!syn);
              } catch (e) { dbg("error", "[audio-check] threw:", e.message || String(e)); }
            }, 3000);
          })
          .catch(e => {
            dbg("error", "[t=0] audio.play() FAILED:", e.message || String(e));
            toast("Tap the screen to hear the music.");
            const unlock = () => {
              dbg("log", "[unlock] user tapped, retrying play()");
              audio.play()
                .then(() => dbg("ok", "[unlock] play() OK"))
                .catch(er => dbg("error", "[unlock] play() FAILED:", er.message || String(er)));
              document.removeEventListener("click", unlock);
              document.removeEventListener("touchend", unlock);
            };
            document.addEventListener("click", unlock, { once: true });
            document.addEventListener("touchend", unlock, { once: true });
          });
      }
      return;
    }
    n--;
  };
  tick();
  _countdownTimer = setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────
// Screen: Session (fluid + voice + emotion label)
// ─────────────────────────────────────────────────────────────
let _sessionStartT = 0;
let _sessionSamples = [];
let _sessionCrossings = [];
let _lastSampleT = 0;
let _lastCommittedSession = null;
let _detachAfter = null;
let _detachGallery = null;
let _detachSummary = null;
let _selectedSummary = null;
let _sessionTickTimer = null;
// v1.6.4.22 -- Music elapsed-time ticker for the "Music: Boundless" pill.
// Rewrites the pill every second with elapsed / total (mm:ss / mm:ss) so the
// user always sees where they are in the piece as it plays forward. Cleared
// on session unmount.
let _musicCountdownTimer = null;
// v1.6.4.23 -- PULSE track state. Throttles the continuous log heartbeat to
// once every PULSE_INTERVAL_MS while Muse frames stream, and only writes if
// the signal has moved by at least PULSE_MIN_DELTA on either valence or
// arousal since the previous pulse (or if the emotion label changed).
let _lastPulseT = 0;
let _lastPulseV = 0;
let _lastPulseA = 0;
let _lastPulseLabel = null;
const PULSE_INTERVAL_MS = 6000;
const PULSE_MIN_DELTA = 0.05;
let _unsubMuse = null;
let _unsubAudio = null;
let _unsubAmp = null;

// Deep warm ink for the session backdrop — near‑black with a hint of ochre.
// Kept as 0..1 floats so it plugs straight into the WebGL surface uniform.
const SESSION_INK = { r: 0x0d / 255, g: 0x0b / 255, b: 0x0a / 255 };
const CREAM       = { r: 0xFB / 255, g: 0xF6 / 255, b: 0xEC / 255 };

function mountSession() {
  let canvas = document.getElementById("fluid-canvas");
  // Second session onward: swap the canvas element for a fresh clone
  // so the new visual style can grab a brand-new WebGL2 context.
  // Safari refuses to hand out a second context on the same element
  // even after WEBGL_lose_context.loseContext(), which was making
  // every non-Breath style throw "WebGL2 not supported" and fall
  // through to the toast path — leaving the previous style's canvas
  // still on screen. Replacing the node itself is the only reliable
  // way to reset the context binding across all browsers.
  if (canvas && canvas.__eaUsed) {
    const parent = canvas.parentNode;
    const clone = canvas.cloneNode(false); // no children
    parent.replaceChild(clone, canvas);
    canvas = clone;
    dbg("log", "[session] canvas replaced with a fresh element");
  }
  if (canvas) canvas.__eaUsed = true;
  // Pick the style the user chose on the Before screen, falling back
  // to "current" if the id is missing or unsupported. All registered
  // styles conform to the same interface, so the rest of this function
  // does not need to know which one is running.
  const styleId = store.state.visualStyle || "current";
  const StyleCls = StyleRegistry.getOrFallback(styleId, "current") || null;
  const wantedId = StyleCls?.id || "current";
  // Loud diagnostic so the Safari console + on-device debug overlay show
  // exactly which build is running and which style resolved. If you
  // ever see the previous style rendering, this line tells us whether
  // the fault is in the picker/store (wrong id here) or the engine
  // (right id but wrong pixels). Ships enabled; one line per session.
  dbg("log", "[session] build=v1.3.0 store.visualStyle=", styleId, "resolved id=", wantedId, "class=", StyleCls?.name, "prev engine id=", fluid?.constructor?.id ?? null);
  // If a previous engine is still around and it does not match the
  // freshly picked style, tear it down first. unmountSession() already
  // nulls `fluid`, but this guard covers deep-linked re-entries and any
  // future flow where mountSession() runs without a prior unmount.
  if (fluid && fluid.constructor && fluid.constructor.id && fluid.constructor.id !== wantedId) {
    try { fluid.stop?.(); } catch { /* ignore */ }
    try { fluid.destroy?.(); } catch { /* ignore */ }
    fluid = null;
  }
  if (!fluid) {
    try {
      if (!StyleCls) {
        fluid = new FluidEngine(canvas);
      } else {
        fluid = new StyleCls(canvas);
      }
    } catch (err) {
      // Log the message + stack explicitly so the debug overlay's
      // JSON.stringify path does not collapse the Error object to {}.
      const msg = (err && err.message) ? err.message : String(err);
      const stack = (err && err.stack) ? String(err.stack).split("\n").slice(0, 4).join(" | ") : "";
      dbg("error", "[session] visual style init threw:", msg, "stack:", stack);
      toast("This device does not support WebGL2. Session runs without the artwork.");
      return finishSessionMount();
    }
  }
  fluid.resize();
  fluid.start();

  // Cross‑fade the paper from cream to near‑black over 1.8s. If the user
  // jumped straight to the session (?screen=session), the surface starts
  // cream, then eases to dark; there is no visual jolt. The DOM screen
  // colour follows via [data-session-phase] so HUD text inverts to cream.
  //
  // Also snap the surface to ink IMMEDIATELY before starting the fade,
  // as a belt-and-braces guard: on some flows the fade's rAF ticked
  // before the first paint and the cream stayed visible for Breath.
  // The crossfade then eases from ink to ink (no visible change) and
  // the picture is right from the first frame.
  document.body.setAttribute("data-session-phase", "fading");
  try { fluid.setSurface?.(SESSION_INK.r, SESSION_INK.g, SESSION_INK.b); } catch { /* ignore */ }
  requestAnimationFrame(() => {
    document.body.setAttribute("data-session-phase", "dark");
    fluid.crossfadeSurfaceTo(SESSION_INK, 1800);
  });

  // Cycle 17: fullscreen button + dim-on-stillness live on the session
  // screen only. Mount here so both fresh sessions and ?screen=session
  // deep-links get the immersive behaviour.
  try { mountImmersive(); } catch (err) { console.warn("[immersive] mount failed", err); }
  try { mountImmersiveHidden(); } catch (err) { console.warn("[immersive-hidden] mount failed", err); }
  try { mountZen(); } catch (err) { console.warn("[zen] mount failed", err); }

  finishSessionMount();
}

function finishSessionMount() {
  _sessionStartT = Date.now();
  // Reset the sample buffer so a fresh session doesn't accumulate stale data.
  _sessionSamples = [];
  _sessionCrossings = [];
  // NOTE: we intentionally do NOT clear store.state.voiceNotes here.
  // In previous versions we did, and it caused a subtle bug: if the user
  // recorded a voice note, then navigated back to a pre-session screen
  // (e.g. re-tapped Start Experience without committing), the entering
  // session would wipe the still-uncommitted notes. Now the notes are
  // cleared only after commitSession() succeeds — that's the sole
  // ownership transfer point where they move from live state into the
  // committed record. If the previous session committed, voiceNotes was
  // already cleared in endSession() below. If the user abandoned a
  // previous attempt, we keep the notes so they're not lost.
  store.update({ startedAt: _sessionStartT, endedAt: null });
  const timerEl = document.getElementById("session-timer");
  const labelEl = document.getElementById("emotion-label");
  const revealEl = document.getElementById("emotion-reveal");
  const revealWordEl = document.getElementById("emotion-reveal-word");
  const seed = store.state.startEmotion;

  // Kick Muse (sim seeded by user's choices) and align the journey to the
  // audio track duration so waypoints land in sync with the music.
  muse.setSeed(seed);
  if (audio.duration && audio.duration > 0) {
    muse.setDuration(audio.duration * 1000);
  } else {
    // If duration isn't known yet, listen once for loadedmetadata
    audio.once?.("loadedmetadata", () => muse.setDuration(audio.duration * 1000));
  }

  _unsubMuse = muse.subscribe((frame) => {
    const label = emotionToLabel(frame.valence, frame.arousal);
    if (fluid) fluid.setEmotion(frame.valence, frame.arousal, frame.openness, label);
    // Single unified emotion display: the big italic word in the lower third.
    // The small inline label is hidden via CSS; we drive the reveal word directly
    // from every muse frame so the label is always present and correctly colored.
    if (revealWordEl && revealEl) {
      const anchor = EMOTIONS.find((e) => e.name === label);
      const hex = anchor ? anchor.hex : "#F5F2EA";
      // v1.5.0-alpha7 — the raw emotion hex often shares luminance and
      // hue with the fluid surface (Melancholy = blue-purple on blue-
      // purple), so the label reads as fog. Lift the label into a
      // brighter, more saturated variant of the same hue so it stays
      // chromatically tied to the emotion but always readable.
      const legibleHex = _liftForLegibility(hex);
      if (revealWordEl.textContent !== label) revealWordEl.textContent = label;
      revealWordEl.style.color = legibleHex;
      revealWordEl.style.setProperty("--reveal-hue", legibleHex);
      // Always visible during a session (never fade to hidden).
      if (revealEl.getAttribute("aria-hidden") === "true") {
        revealEl.setAttribute("aria-hidden", "false");
      }
    }
    // The inline small label is left in the DOM for accessibility but hidden
    // visually via CSS. Keep its textContent in sync for screen readers.
    if (labelEl) labelEl.textContent = label;
    _updateMusePanel(frame, label);
    // Journey sampler: capture the current v/a/o at ~5 Hz so the summary
    // playback can re-run the trail. Throttled by wall-clock rather than
    // sample count so a fast frame rate doesn't inflate the buffer.
    const now = Date.now();
    if (now - _lastSampleT >= 200) {
      _lastSampleT = now;
      // Hex from the palette so the summary card and dots can color-
      // code the trail without recomputing the palette on replay.
      const anchor = EMOTIONS.find(e => e.name === label);
      _sessionSamples.push({
        t: now,
        v: frame.valence,
        a: frame.arousal,
        o: frame.openness,
        label,
        hex: anchor ? anchor.hex : "#888888",
      });
    }

    // v1.6.4.23 -- PULSE track. The always-on heartbeat of the session log.
    // Fires every PULSE_INTERVAL_MS while frames are flowing, but only if
    // the signal has actually moved since the last pulse -- so a user
    // holding perfectly still doesn't fill the log with duplicates.
    try {
      const dv = Math.abs(frame.valence - _lastPulseV);
      const da = Math.abs(frame.arousal - _lastPulseA);
      const labelChanged = _lastPulseLabel !== label;
      const timeElapsed = now - _lastPulseT >= PULSE_INTERVAL_MS;
      const moved = dv >= PULSE_MIN_DELTA || da >= PULSE_MIN_DELTA;
      if (_lastPulseT === 0 || (timeElapsed && (moved || labelChanged))) {
        const anchor2 = EMOTIONS.find((e) => e.name === label);
        museLog.logPulse({
          signal: {
            alpha: frame.bands ? frame.bands.alpha : null,
            beta:  frame.bands ? frame.bands.beta  : null,
            theta: frame.bands ? frame.bands.theta : null,
            valence: frame.valence,
            arousal: frame.arousal,
            openness: frame.openness,
          },
          emotion: {
            name: label,
            hex: anchor2 ? anchor2.hex : null,
            colourName: colourNameFor(label),
            valence: frame.valence,
            arousal: frame.arousal,
          },
        });
        _lastPulseT = now;
        _lastPulseV = frame.valence;
        _lastPulseA = frame.arousal;
        _lastPulseLabel = label;
      }
    } catch (err) { /* never let logging crash the frame loop */ }
  });

  // Emotion word reveal — the big word is now driven continuously by the
  // muse.subscribe() handler above, so it's always visible + correctly colored.
  // The onEmotionChange handler now only records crossings (for summary
  // playback) and fires the bright splat nudge on the fluid canvas.
  _unsubEmoChange = muse.onEmotionChange((evt) => {
    // Log each crossing so the summary playback can re-fire them at the
    // same offsets during clip playback.
    _sessionCrossings.push({ t: Date.now(), name: evt.name, hex: evt.hex });

    // v1.6.4.23 -- CROSSING track. Compose a story sentence for the
    // transition and stamp it into the log. The story generator is
    // rules-based (see log-story.js) so the same signal always produces
    // the same words.
    try {
      museLog.logCrossing({
        prior: evt.from || null,
        next: evt.name,
        deltas: {
          valence: (evt.valence || 0) - (_lastPulseV || 0),
          arousal: (evt.arousal || 0) - (_lastPulseA || 0),
          valencePrev: _lastPulseV || 0,
          arousalPrev: _lastPulseA || 0,
          valenceNow:  evt.valence || 0,
          arousalNow:  evt.arousal || 0,
        },
        emotion: {
          name: evt.name,
          hex: evt.hex,
          colourName: colourNameFor(evt.name),
          valence: evt.valence,
          arousal: evt.arousal,
        },
      });
    } catch (err) { /* never let logging crash the emotion pipeline */ }

    // Nudge the fluid: fire a bright emotion-colored splat when we cross.
    // Only meaningful for fluid-based styles that expose _emotion.color;
    // other styles (e.g. procedural shaders) have a no-op splat() and no
    // internal colour cache, so we skip the nudge to avoid reaching into
    // private state.
    if (fluid && evt.from !== null && fluid._emotion && fluid._emotion.color) {
      const c = fluid._emotion.color;
      const cx = 0.45 + Math.random() * 0.1;
      const cy = 0.45 + Math.random() * 0.1;
      fluid.splat(cx, cy, (Math.random() - 0.5) * 380, (Math.random() - 0.5) * 380,
                  { r: c.r / 255, g: c.g / 255, b: c.b / 255 }, 0.006);
    }
  });

  // v1.6.4.24 -- Pass the user's picked scenario id through when we connect
  // in sim mode. Live mode ignores it. When the live connect fails we fall
  // back to sim with the same scenario so the demo still tells the story the
  // user chose on the setup screen.
  const _scenarioForConnect = store.state.simScenarioId || null;
  muse.connect(store.state.useMuseLive ? "live" : "sim", { scenarioId: _scenarioForConnect }).catch(err => {
    console.warn("Muse connect failed, falling back to sim:", err);
    muse.connect("sim", { scenarioId: _scenarioForConnect });
  });

  // Wire the optional Muse-data toggle
  _wireMuseToggle();

  // Audio-reactive splats: the Boundless music drives extra bursts of
  // splat energy on top of Muse‑driven emotion colour, so the fluid feels
  // like it's breathing with the track. RMS pushes overall splat force,
  // low band pushes curl amplitude, high band adds sparkle. See
  // fluid-engine.js#audioBeat for the exact mix.
  if (audio.isPlaying) {
    _unsubAudio = audio.onFrame((f) => {
      if (fluid) fluid.audioBeat(f.rms, f.low, f.mid, f.high, f.centroid);
    });
  }

  // Timer + fade of top strip after 4s
  const stripEl = document.querySelector(".ea-progress-strip");
  const idleEl = document.querySelector(".ea-session-idle");
  const startCta = document.getElementById("btn-session-stop");
  startCta.textContent = "Stop";
  startCta.classList.remove("ea-btn--primary");
  startCta.classList.add("ea-btn--danger");
  startCta.onclick = endSession;

  const updateTimer = () => {
    const s = Math.floor((Date.now() - _sessionStartT) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;
  };
  updateTimer();
  _sessionTickTimer = setInterval(updateTimer, 1000);
  setTimeout(() => stripEl?.classList.add("ea-progress-strip--dim"), 4000);

  // Chips
  wireVoiceChip();
}

function wireVoiceChip() {
  const chip = document.getElementById("chip-voice");
  const timer = chip.querySelector(".ea-chip__timer");
  let ticking = null;

  // Extracted so the mic-help "Try Again" button can call it directly.
  // Returns { ok, err }. On success, UI wiring is already applied.
  // v1.5.5, while a voice note is recording, hide the session Stop
  // button so users cannot accidentally end the whole session when they
  // meant to stop the recording. The Recording pill becomes the only
  // primary action on screen. When the recording ends we restore the
  // Stop button. Uses a body attribute so any CSS scope can react.
  //
  // See docs/UX-INVARIANTS.md, section "Voice recording safety", for the
  // full rule, rationale, and native-equivalent guidance (iOS Swift port).
  const setRecordingUI = (on) => {
    if (on) document.body.setAttribute("data-voice-recording", "1");
    else document.body.removeAttribute("data-voice-recording");
  };

  const beginRecording = async () => {
    try {
      await voice.start();
      // Duck the music down so the voice recording captures cleanly.
      try { audio.duckTo(0.3, 400); } catch {}
      chip.classList.add("ea-chip--recording");
      setRecordingUI(true);
      chip.querySelector(".ea-chip__label").textContent = "Recording";
      // Amplitude → splat force during recording
      _unsubAmp = voice.onAmplitude((amp) => {
        if (!fluid || amp < 0.03) return;
        // Only Current (FluidEngine wrapper) supports voice-driven splats.
        // Procedural shader styles have no-op splat() and no colour cache.
        if (!fluid._emotion || !fluid._emotion.color) return;
        const t = performance.now() * 0.001;
        const x = 0.5 + 0.2 * Math.sin(t * 3);
        const y = 0.55 + 0.2 * Math.cos(t * 2.3);
        const c = fluid._emotion.color;
        fluid.splat(x, y, Math.sin(t*4)*80*amp, Math.cos(t*3)*80*amp,
                    { r: c.r/255, g: c.g/255, b: c.b/255 }, 0.0018 + amp*0.003);
      });
      ticking = setInterval(() => {
        const s = Math.floor(voice.elapsedMs / 1000);
        const mm = String(Math.floor(s/60)).padStart(2,"0");
        const ss = String(s%60).padStart(2,"0");
        timer.textContent = `${mm}:${ss}`;
      }, 500);
      dbg("ok", "[voice] recording started");
      return { ok: true };
    } catch (err) {
      const name = (err && err.name) || "UnknownError";
      const msg  = (err && err.message) || String(err);
      dbg("error", "[voice] start failed. name=", name, "msg=", msg,
        "secure=", window.isSecureContext,
        "hasGUM=", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        "ctx=", detectBrowserContext());
      console.warn("[voice] start failed:", err);
      return { ok: false, err, name, msg };
    }
  };

  chip.onclick = async () => {
    if (voice.state === "idle") {
      const r = await beginRecording();
      if (!r.ok) {
        const { name } = r;
        if (name === "NotAllowedError" || name === "SecurityError") {
          // Show the browser-aware help sheet with a working Try Again.
          showMicHelp({
            onRetry: async () => {
              const r2 = await beginRecording();
              if (!r2.ok) {
                // Still failing — re-open the help sheet so the user has
                // another chance. iOS often needs a full page reload after
                // toggling Settings, so include that hint via a toast.
                if (r2.name === "NotAllowedError" || r2.name === "SecurityError") {
                  showMicHelp({ onRetry: () => beginRecording().then(rr => { if (!rr.ok) showMicHelp({}); }) });
                  toast("Still blocked: reload the page after changing Settings.");
                } else {
                  toast("Could not start recording: " + r2.name);
                }
              }
            },
          });
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          toast("No microphone found on this device.");
        } else if (name === "NotReadableError") {
          toast("Microphone busy: try again in a moment.");
        } else {
          toast("Could not start recording: " + name);
        }
      }
    } else if (voice.state === "recording") {
      let result = null;
      try {
        result = await voice.stop();
      } catch (err) {
        console.warn("[voice] stop failed:", err);
      }
      // ── Restore the music path ────────────────────────────────────────
      // The mic pipeline on iOS Safari sometimes leaves the <audio> element in
      // a soft-ducked state that our gain node cannot un-mute (the browser
      // manages this internally). The kick sequence below reliably restores
      // full volume by:
      //   1. Resuming the primary AudioContext.
      //   2. Snapping base gain back to 1.0.
      //   3. "Kicking" the <audio> element: nudge volume then pause/play,
      //      which forces iOS to re-check output policy after the mic
      //      stream has been released.
      //   4. Running the graceful 500ms duckTo(1.0) fade.
      try {
        const before = audio.getState?.() || {};
        dbg("log", "[voice] restoring music. before=", before);
        const st = await audio.ensureResumed?.();
        try { audio.setBaseGain(1.0); } catch {}
        // iOS full restore sequence:
        //   1. Snap gain to 1.0 (element.volume and gain node).
        //   2. Hard restart the media route by swapping in a fresh audio
        //      element at the same position. This forces iOS to re-check
        //      its AudioSession category and route the stream back to the
        //      loudspeaker after the mic-driven earpiece hijack.
        //   3. Fade the newly-live element up over 500ms for a graceful
        //      return (imperceptible seam vs. an abrupt volume snap).
        try { await audio.restartAudioRoute?.(); } catch (err) {
          dbg("warn", "[voice] restartAudioRoute failed; falling back to kick", err?.message);
          try { await audio.kickAudioElement?.(); } catch {}
        }
        try { audio.duckTo(1.0, 500); } catch {}
        const after = audio.getState?.() || {};
        dbg("ok", "[voice] music restored. ctx=", st, "after=", after);
      } catch (err) {
        dbg("error", "[voice] restore failed:", err?.message || String(err));
      }
      clearInterval(ticking); ticking = null;
      chip.classList.remove("ea-chip--recording");
      setRecordingUI(false);
      chip.querySelector(".ea-chip__label").textContent = "Voice";
      timer.textContent = "";
      _unsubAmp?.(); _unsubAmp = null;
      if (result && result.url) {
        dbg("ok", "[voice] recorder returned url, saving. mime=", result.mime, "durMs=", result.durationMs);
        store.addVoiceNote({
          url: result.url,
          mime: result.mime,
          durationMs: result.durationMs,
          at: Date.now(),
          valenceAtRecord: fluid?._emotion.v ?? 0,
          arousalAtRecord: fluid?._emotion.a ?? 0,
        });
        const currentNotes = store.state.voiceNotes || [];
        dbg("ok", "[voice] added. store.voiceNotes.length=", currentNotes.length);
        toast("Voice note saved");
      }
      // If result is null we intentionally show NO toast. iOS Safari can
      // sometimes return a zero-length blob on a very short recording;
      // silently discarding it is less alarming than a false-negative
      // "not saved" message. If this recurs we'll add real logging.
      else {
        dbg("warn", "[voice] recorder.stop() returned empty result");
      }
    }
  };
}

// Muse-data overlay wiring & live update
let _unsubEmoChange = null;
let _museVis = null;
let _museWaves = null;

function _wireMuseToggle() {
  const btn = document.getElementById("btn-muse-data");
  const panel = document.getElementById("muse-panel");
  const close = document.getElementById("btn-muse-close");
  const svg   = document.getElementById("muse-vis-svg");
  const waves = document.getElementById("muse-brainwaves");
  const wavesBand = panel ? panel.querySelector(".ea-muse-waves") : null;
  const eyebrow = panel ? panel.querySelector(".ea-muse-panel__eyebrow") : null;
  if (!btn || !panel) return;

  // ── Muse simulation ─────────────────────────────────────
  // Always simulate frames — this is a demo of the full Muse experience.
  // The brain-waves band is ALWAYS mounted (user asked to see the full
  // UX with EEG lanes visible even when no physical Muse is connected).
  const noMuse = !!store.state.noMuse;
  const live = !!store.state.useMuseLive;
  if (wavesBand) wavesBand.hidden = false;
  // Never claim "live" for a simulated signal, and never claim "simulated"
  // for a real one — this label is the only place the user is told which
  // signal is painting the canvas.
  if (eyebrow) {
    eyebrow.textContent = live ? "Muse: live" : (noMuse ? "Emotion map: simulated" : "Muse: simulated");
  }
  const wavesHint = panel.querySelector(".ea-muse-waves__hint");
  if (wavesHint) wavesHint.textContent = live ? "EEG bands · live" : "EEG bands · simulated";

  // Electrode contact beside the panel eyebrow — only meaningful with real
  // hardware, so it stays absent for simulated sessions rather than showing
  // four dots that could never change.
  const panelDotsEl = document.getElementById("muse-panel-quality-dots");
  if (panelDotsEl) {
    if (live && !_musePanelDots) {
      try { _musePanelDots = mountQualityDots(panelDotsEl); }
      catch (err) { console.warn("[muse] panel quality dots mount failed", err); }
    } else if (!live) {
      panelDotsEl.innerHTML = "";
      _musePanelDots = null;
    }
  }

  // Lazily mount the live circumplex once — the SVG stays in the DOM even
  // when the panel is closed so we can keep updating it in the background.
  if (svg && !_museVis) {
    try { _museVis = mountMuseVis(svg); }
    catch (err) { console.warn("[muse-vis] mount failed", err); }
  }
  // Always mount brainwaves — the simulation UX shows the full Muse
  // interface regardless of whether a physical headband is attached.
  if (waves && !_museWaves) {
    try { _museWaves = mountBrainWaves(waves); }
    catch (err) { console.warn("[muse-brainwaves] mount failed", err); }
  }

  const label = document.getElementById("btn-muse-data-label");
  const setOpen = (open) => {
    btn.setAttribute("aria-pressed", open ? "true" : "false");
    // Label ALWAYS reads "Emotion Map"; open/closed state is conveyed
    // visually via aria-pressed (dim vs highlighted, Zen breathing).
    btn.setAttribute("aria-label", "Emotion Map");
    if (label) label.textContent = "Emotion Map";
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    // Cycle 18 · Dim gate: the Emotion Map panel is the primary focal
    // surface. While it's open the UI must never dim — the circumplex,
    // anchor labels, and brain-wave lanes stay at full brightness and
    // full color. Closing the panel reveals the fluid painting alone
    // and re-enables the 5-second dim countdown.
    document.body.setAttribute("data-emotion-map-open", open ? "true" : "false");
  };
  btn.onclick = () => {
    const opening = panel.getAttribute("aria-hidden") === "true";
    // Closing the panel? Kill any open anchor tip so it does not linger.
    if (!opening) { try { closeTipNow(); } catch {} }
    setOpen(opening);
  };
  if (close) close.onclick = () => {
    try { closeTipNow(); } catch {}
    setOpen(false);
  };
  // Open the panel by default on session start so the full simulated
  // UX (circumplex + brain-waves) is immediately visible — matches the
  // playback replay layout.
  setOpen(true);
}

function _updateMusePanel(frame, label) {
  const panel = document.getElementById("muse-panel");
  // Update the vis + waves even when panel is briefly closed so state
  // is fresh the moment the user opens it. The vis is inexpensive.
  if (!panel) return;

  // Drive the live mini-circumplex
  if (_museVis) {
    _museVis.update(
      { v: frame.valence, a: frame.arousal, o: frame.openness },
      label,
    );
  }

  // Drive the brain-waves strip so the EEG bands breathe with the frame.
  // In no-Muse mode _museWaves is intentionally never mounted (see _wireMuseToggle),
  // so this branch simply skips without ceremony.
  // Frames carry no quality field (it updates at ~2 Hz, not per frame), so
  // read contact straight off the adapter.
  if (_musePanelDots) {
    _musePanelDots.update(_museAdapter?.isConnected ? _museAdapter.lastBands?.quality ?? null : null);
  }

  // With a headband connected the frame carries real per-band relative power;
  // setState prefers it over the synthetic (v, a, o) approximation.
  if (_museWaves) {
    _museWaves.setState({
      v: frame.valence,
      a: frame.arousal,
      o: frame.openness,
      bands: frame.bands || null,
    });
  }

  // Caption underneath — color per emotion via --reveal-hue so the word
  // feels emotionally alive and matches the summary/replay in-panel
  // word styling.
  const nameEl = document.getElementById("muse-vis-name");
  if (nameEl) {
    nameEl.textContent = label;
    // Look up the emotion hex from the palette. EMOTIONS is imported at
    // the top of app.js as { EMOTIONS } from './palette/emotion-palette.js?v=1.3.1'.
    // Falls back to the ink color if the label doesn't match.
    try {
      const match = _EMOTIONS_BY_NAME[label];
      if (match && match.hex) {
        // v1.5.0-alpha7i — lift the panel word colour into a bright,
        // saturated variant so labels like Boredom (dark gray) or
        // Melancholy (deep blue) stay readable against the fluid
        // surface. Same treatment as the big reveal word.
        nameEl.style.setProperty("--reveal-hue", _liftForLegibility(match.hex));
      }
    } catch (_e) { /* ignore */ }
  }
  const coordEl = document.getElementById("muse-vis-coord");
  if (coordEl) {
    const v = frame.valence.toFixed(2);
    const a = frame.arousal.toFixed(2);
    const o = frame.openness.toFixed(2);
    coordEl.innerHTML = `v ${v} &nbsp;·&nbsp; a ${a} &nbsp;·&nbsp; o ${o}`;
  }

  // v1.5.2 — live entropy readout. Uses the same four-word ladder as
  // the replay meta line (quiet / gathered / restless / wide). We
  // compute it over the last 60 seconds of samples so it reflects
  // the current mood, not the whole session history. If we have
  // fewer than 60 seconds of samples yet, the function returns
  // "quiet" gracefully.
  const entropyLabelEl = document.getElementById("muse-vis-entropy-label");
  if (entropyLabelEl && _sessionSamples.length >= 2) {
    const cutoff = Date.now() - 60000;
    let startIdx = 0;
    for (let i = _sessionSamples.length - 1; i >= 0; i--) {
      if (_sessionSamples[i].t < cutoff) { startIdx = i + 1; break; }
    }
    const window = _sessionSamples.slice(startIdx);
    if (window.length >= 2) {
      const ent = entropyMetrics(window);
      if (entropyLabelEl.textContent !== ent.label) {
        entropyLabelEl.textContent = ent.label;
      }
    }
  }

  // Journey progress bar
  const j    = document.getElementById("muse-journey");
  const fill = document.getElementById("muse-progress-fill");
  const snap = muse.snapshot();
  const pct  = Math.min(100, Math.max(0, Math.round(snap.journeyProgress * 100)));
  if (j) j.textContent = pct + "%";
  if (fill) fill.style.width = pct + "%";
}

function unmountSession() {
  // Tear the engine down fully so the next session picks up whatever
  // visual style the user has since selected. Leaving the old instance
  // around causes the next mountSession() to short-circuit through the
  // `if (!fluid)` guard and re-use the previous style's engine — which
  // is why picking Skyspace after Halo used to still render Halo live
  // (the replay was correct because it always builds a fresh engine on
  // its own summary canvas).
  if (fluid) {
    dbg("log", "[session] unmount → destroying engine id=", fluid.constructor?.id ?? "?");
    try { fluid.stop(); } catch (err) { dbg("warn", "[session] fluid.stop failed", err && err.message); }
    try { fluid.destroy?.(); } catch (err) { dbg("warn", "[session] fluid.destroy failed", err && err.message); }
    fluid = null;
  } else {
    dbg("log", "[session] unmount called but no engine present");
  }
  if (_sessionTickTimer) { clearInterval(_sessionTickTimer); _sessionTickTimer = null; }
  // Cycle 17: unmount immersive so dim timers + fullscreen state don't
  // leak into the summary / after screens.
  try { unmountImmersive(); } catch (err) { console.warn("[immersive] unmount failed", err); }
  try { unmountZen(); } catch (err) { console.warn("[zen] unmount failed", err); }
  // v1.6.4.14 -- Hide the listening composition and end the wizard so the
  // dark screen returns to its plain state for the next session.
  try {
    const composition = document.querySelector(".ea-listening-composition");
    if (composition) composition.setAttribute("data-hidden", "true");
    museWizard.end?.();
  } catch (err) { console.warn("[wizard] listening cleanup failed", err); }
  // v1.6.4.22 -- Stop the music-pill ticker so we don't keep updating a
  // hidden element between sessions.
  if (_musicCountdownTimer) { clearInterval(_musicCountdownTimer); _musicCountdownTimer = null; }
  // v1.6.4.23 -- Reset PULSE throttle state between sessions.
  _lastPulseT = 0; _lastPulseV = 0; _lastPulseA = 0; _lastPulseLabel = null;
  _unsubMuse?.(); _unsubMuse = null;
  _unsubAudio?.(); _unsubAudio = null;
  _unsubAmp?.(); _unsubAmp = null;
  muse.disconnect();
  _unsubEmoChange?.(); _unsubEmoChange = null;
  const revealEl = document.getElementById("emotion-reveal");
  if (revealEl) revealEl.setAttribute("aria-hidden", "true");
  const panel = document.getElementById("muse-panel");
  if (panel) panel.setAttribute("aria-hidden", "true");
  const btn = document.getElementById("btn-muse-data");
  if (btn) btn.setAttribute("aria-pressed", "false");
  if (_museVis) { _museVis.destroy(); _museVis = null; }
  if (_museWaves) { _museWaves.destroy(); _museWaves = null; }
  audio.stop();
  if (voice.state === "recording") {
    // Ensure we always restore music volume when a session ends mid-recording.
    voice.stop().catch(()=>{});
    try { audio.duckTo(1.0, 400); } catch {}
  }
  // Belt and suspenders: whatever state we came from, the session
  // Stop button should be visible again after unmount.
  document.body.removeAttribute("data-voice-recording");
  // NOTE: intentionally DO NOT call voice.revokeAll() here. Committed
  // session records still hold blob: URLs from this session's notes and
  // the gallery / Session Replay need them alive to play back. Blobs are
  // revoked only when the user clears history (store.clearHistory).
  //
  // See docs/UX-INVARIANTS.md, section "Blob URL lifecycle", for the
  // full rule and native-equivalent guidance.
}

/**
 * Discard any voice notes that were recorded during a session that the
 * user is about to abandon (via the header back button or any other exit
 * that is not endSession/commitSession).
 *
 * Root cause this fixes: v1.5.3 kept uncommitted notes in store.state so
 * a user who navigated back to Before could resume the same session
 * without losing recordings. But if the user then started a fresh session
 * and recorded new notes, the store held BOTH the aborted session's notes
 * and the new ones, and commitSession() snapshotted them together. The
 * Session Replay then played the aborted-session note first as if it
 * belonged to the new session.
 *
 * Fix: any explicit navigation OUT of a session (back button, view-
 * switcher exit) means the user is done with that attempt, so revoke the
 * blob URLs and clear the buffer. Notes remain safe for sessions that
 * end via the End Session CTA, because commitSession() runs before
 * unmountSession() and moves the notes into the committed record.
 *
 * See docs/UX-INVARIANTS.md, section "Session abort clears uncommitted
 * voice notes", for the full rule and native-equivalent guidance.
 */
function discardUncommittedNotes() {
  const notes = Array.isArray(store.state.voiceNotes) ? store.state.voiceNotes : [];
  if (notes.length === 0) return;
  dbg("log", "[abort] discarding", notes.length, "uncommitted voice notes");
  for (const n of notes) {
    try { URL.revokeObjectURL(n.url); } catch {}
  }
  store.update({ voiceNotes: [] });
}

async function endSession() {
  // Commit the session BEFORE unmounting so the sample/crossing buffers
  // are still populated when we snapshot them. Compute a dominant emotion
  // from the recorded samples so cards and dots can color-code without
  // touching the palette lookup at render time.
  const dominant = computeDominant(_sessionSamples);
  const preNotes = (store.state.voiceNotes || []).length;
  dbg("log", "[commit] pre-commit voiceNotes=", preNotes, "samples=", _sessionSamples.length);
  const record = store.commitSession({
    samples:   _sessionSamples,
    crossings: _sessionCrossings,
    dominantEmotion: dominant,
    // v1.6.4.17 -- Stamp the wizard/log transcript into the record so the
    // Zen overlay can render THIS session's log later, not whatever the
    // live museLog buffer happens to hold when replay opens.
    museLog: (() => {
      try { return museLog.snapshotEntries(); }
      catch (err) { console.warn("[commit] museLog snapshot failed", err); return []; }
    })(),
  });
  _lastCommittedSession = record;
  const recNotes = Array.isArray(record?.voiceNotes) ? record.voiceNotes.length : 0;
  dbg("ok", "[commit] session committed. record.voiceNotes=", recNotes, "samples=", record?.samples?.length);

  // NOW clear the live voice-notes buffer — ownership has transferred to
  // the committed record. Do NOT revoke the blob URLs; the gallery/replay
  // holds references to them via the record.
  store.update({ voiceNotes: [] });

  unmountSession();
  // Fade back to cream on the way out so the UI matches the other screens.
  if (fluid) fluid.setSurface(CREAM.r, CREAM.g, CREAM.b);
  document.body.removeAttribute("data-session-phase");

  // Route directly to the Session Replay of the session we just committed.
  // The user's mental model after tapping End Session is "show me what I
  // just did" — not "drop me on a gallery of everything." The Timeline +
  // Gallery (After screen) remains reachable via the back button from the
  // replay, and from the Home button on subsequent visits.
  // Edge case: if no samples were captured, fall through to Before.
  if (_sessionSamples.length > 0 && _lastCommittedSession) {
    _selectedSummary = _lastCommittedSession;
    dbg("log", "[endSession] auto-opening replay of just-finished session:", _lastCommittedSession.id);
    goto("summary", { replace: true });
  } else {
    goto("before", { replace: true });
  }
}

// ─────────────────────────────────────────────────────────────
// Screen: After (Timeline + Gallery)
// ─────────────────────────────────────────────────────────────
function mountAfter() {
  const screen = document.querySelector('.ea-screen[data-screen="after"]');
  if (!screen) return;

  // Ensure any tilt/scroll listeners from a previous mount are gone.
  if (_detachAfter) { try { _detachAfter(); } catch {} _detachAfter = null; }

  // Update the "last session" header. If we just returned from a session
  // we prefer that record; otherwise show the newest in history.
  const sessions = store.history;
  const last = _lastCommittedSession || sessions[sessions.length - 1];
  const nameEl = document.getElementById("after-last-name");
  const metaEl = document.getElementById("after-last-meta");
  if (last && nameEl && metaEl) {
    const domName = last.dominantEmotion?.name || "";
    const domHex  = last.dominantEmotion?.hex  || "";
    nameEl.textContent = domName || " ";
    if (domHex) nameEl.style.color = domHex;
    // v1.5.1, two-line meta (samples on line 1, crossings/openness/
    // entropy on line 2), an info glyph to open the session-vocab
    // tooltip, and a two-sentence narrative caption below. Voice-note
    // count is appended to line 1 if the session recorded any.
    //
    // v1.5.5 note: the .ea-session-meta__info glyph is styled to match the
    // shared 22px .ea-info-glyph size. See docs/UX-INVARIANTS.md, section
    // "Info glyph size consistency", for the two-size rule (22px inline,
    // 36px chip) that native ports must preserve.
    const meta = formatMetaLines(last);
    const voiceCount = Array.isArray(last.voiceNotes) ? last.voiceNotes.length : 0;
    const voiceLabel = voiceCount === 0 ? ""
      : voiceCount === 1 ? "  ·  1 voice note"
      : `  ·  ${voiceCount} voice notes`;
    metaEl.innerHTML = `
      <span class="ea-session-meta__line">${escapeHtml(meta.line1)}${escapeHtml(voiceLabel)}</span>
      <span class="ea-session-meta__line">${escapeHtml(meta.line2)}<button
          class="ea-session-meta__info"
          type="button"
          aria-label="What do these terms mean?"
          data-ea-tip="session-vocab"
        ><span aria-hidden="true">i</span></button></span>
      <span class="ea-session-narrative">${escapeHtml(buildSessionNarrative(last))}</span>
    `;
  } else if (nameEl && metaEl) {
    nameEl.textContent = "Your journey begins";
    metaEl.textContent = "Complete a session to see it here.";
  }

  _detachAfter = mountAfterView({
    container: screen,
    sessions,
    onOpen: (rec) => {
      _selectedSummary = rec;
      goto("summary", { replace: false });
    },
  });

  // If the user last chose the Gallery view, remount that panel too so
  // returning to After from Summary keeps the same view active.
  if (window.__afterView === "gallery") {
    _mountGalleryPanel();
  }

  // Wire the After-screen Timeline ↔ Gallery pill toggle so users can
  // switch views without going Home first. Uses the same _setAfterView
  // pathway as the Before-screen entries — ensures Gallery mount/unmount
  // and aria-selected stay consistent regardless of entry point.
  const pillTl  = document.getElementById("btn-after-view-timeline");
  const pillGal = document.getElementById("btn-after-view-gallery");
  if (pillTl)  pillTl.onclick  = () => _setAfterView("timeline");
  if (pillGal) pillGal.onclick = () => _setAfterView("gallery");
  // Reflect the currently active view on the pill on mount, so returning
  // to After from Summary shows the correct segment selected.
  const activeView = window.__afterView || "timeline";
  if (pillTl)  pillTl.setAttribute("aria-selected",  activeView === "timeline" ? "true" : "false");
  if (pillGal) pillGal.setAttribute("aria-selected", activeView === "gallery"  ? "true" : "false");
  // v1.5.1 — keep the header visibility in sync on mount too, so a
  // return from Summary lands with the correct header state (Gallery
  // hidden, Timeline shown).
  screen.setAttribute("data-view", activeView);

  // "Start a new session" button
  const homeBtn = document.getElementById("btn-after-home");
  if (homeBtn) homeBtn.onclick = () => goto("before", { replace: true });
}

function unmountAfter() {
  if (_detachAfter)   { try { _detachAfter();   } catch {} _detachAfter   = null; }
  if (_detachGallery) { try { _detachGallery(); } catch {} _detachGallery = null; }
}

// ─────────────────────────────────────────────────────────────
// Screen: Summary (Clip playback of a single completed session)
// ─────────────────────────────────────────────────────────────
function mountSummary() {
  const screen = document.querySelector('.ea-screen[data-screen="summary"]');
  if (!screen) return;
  if (!_selectedSummary) {
    dbg("warn", "[summary] no _selectedSummary, bouncing back to after");
    // Defensive: if the user landed here directly, bounce back.
    goto("after", { replace: true });
    return;
  }
  const sn = _selectedSummary;
  dbg("log", "[summary] mounting. id=", sn.id, "voiceNotes=", (sn.voiceNotes || []).length, "withUrl=", (sn.voiceNotes || []).filter(n => !!n.url).length);
  if (_detachSummary) { try { _detachSummary(); } catch {} _detachSummary = null; }

  _detachSummary = mountSummaryPlayback({
    session: _selectedSummary,
    container: screen,
    audio,
    audioSrc: "./assets/sound-journey.mp3",
  });

  // Replay gets the same immersive + Zen affordances as the live
  // session. mountImmersive is idempotent — it picks up the
  // summary-screen button without rebinding the session-screen button.
  try { mountImmersive(); } catch (err) { console.warn("[immersive] summary mount failed", err); }
  try { mountZen(); } catch (err) { console.warn("[zen] summary mount failed", err); }

  // Cycle 10: bottom actions row (Timeline/Gallery + Done) removed.
  // The header chevron already handles "back to where I came from" —
  // duplicating it at the bottom violated the one-navigation-affordance
  // rule Apple's HIG calls out. The header back-label in updateChrome()
  // still reflects window.__afterView so users see the destination.
  //
  // Cycle 9: right-column nav cluster (Timeline / Gallery / New) also
  // removed for the same reason — the chevron is the single exit.

  _wireShareButtons();
  _wireSummaryPanelToggle();

  // v1.5.2: Replay-Zen state machine. Fades chrome to reveal the
  // art after ~5s of no touch; a tiny hint pulses at the bottom.
  // Attached AFTER wireSummaryPanelToggle so we can listen to the
  // panel toggle button.
  try { attachReplayZen({ screenEl: screen, session: _selectedSummary }); }
  catch (err) { console.warn("[replay-zen] attach failed", err); }
}

/**
 * Wire the five share buttons in the replay panel. We assemble a
 * share payload (title/text/url) from the current session, then route
 * per-button:
 *   - Native  -> navigator.share (falls back to copy)
 *   - X       -> twitter.com/intent/tweet
 *   - Facebook-> facebook.com/sharer/sharer.php
 *   - Instagram -> copy caption+link and open instagram.com (IG has no
 *                  web share intent, so copy-and-open is the standard)
 *   - Copy    -> navigator.clipboard.writeText, brief "Copied" toast
 */
function _wireShareButtons() {
  const sess = _selectedSummary || {};
  // Anchor everything to the site root; individual sessions aren't yet
  // addressable so we share the site plus a title.
  // Fallback share URL when window.location isn't available. Replace with your production origin.
  const url = (typeof window !== "undefined" && window.location && window.location.origin)
    ? window.location.origin + "/"
    : "https://empathic-art.pplx.app/";
  const title = sess.title ? "Empathic Art   " + sess.title : "Empathic Art";
  const text  = "A session of Empathic Art. Feel the artwork, watch your emotion path replay.";

  const btnNative = document.getElementById("btn-share-native");
  const btnX      = document.getElementById("btn-share-x");
  const btnFb     = document.getElementById("btn-share-fb");
  const btnIg     = document.getElementById("btn-share-ig");
  const btnCopy   = document.getElementById("btn-share-copy");

  const openWin = (u) => {
    try { window.open(u, "_blank", "noopener,noreferrer"); } catch { window.location.href = u; }
  };
  const copyToClipboard = async (str) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(str);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = str; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };
  const flashCopied = (btn) => {
    if (!btn) return;
    btn.classList.add("is-copied");
    setTimeout(() => btn.classList.remove("is-copied"), 1400);
  };

  if (btnNative) {
    btnNative.onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ title, text, url }); return; } catch {}
      }
      const ok = await copyToClipboard(url);
      if (ok) { flashCopied(btnNative); toast("Link copied"); }
      else toast("Sharing not available");
    };
  }
  if (btnX) {
    btnX.onclick = () => {
      const t = encodeURIComponent(title + "   " + text);
      const u = encodeURIComponent(url);
      openWin("https://twitter.com/intent/tweet?text=" + t + "&url=" + u);
    };
  }
  if (btnFb) {
    btnFb.onclick = () => {
      const u = encodeURIComponent(url);
      openWin("https://www.facebook.com/sharer/sharer.php?u=" + u);
    };
  }
  if (btnIg) {
    btnIg.onclick = async () => {
      // Instagram has no web share intent, so we copy a caption + link
      // and open Instagram so the user can paste into a new post/story.
      const caption = title + "   " + text + "\n" + url;
      const ok = await copyToClipboard(caption);
      if (ok) toast("Caption copied: opening Instagram");
      openWin("https://www.instagram.com/");
    };
  }
  if (btnCopy) {
    btnCopy.onclick = async () => {
      const ok = await copyToClipboard(url);
      if (ok) { flashCopied(btnCopy); toast("Link copied"); }
      else toast("Could not copy");
    };
  }
}

/**
 * Toggle the After screen between Timeline (default) and Gallery.
 * We flip the `hidden` attribute on the two panels so only one is
 * visible at a time. Selection is remembered on `window` so that
 * navigating away and back preserves the user's choice.
 */
function _setAfterView(which /* "timeline" | "gallery" */) {
  window.__afterView = which;
  const tl  = document.getElementById("timeline");
  const gal = document.getElementById("gallery");
  if (tl)  tl.hidden  = (which !== "timeline");
  if (gal) gal.hidden = (which !== "gallery");

  // v1.5.1 — the "Session Complete / <emotion> / meta / narrative"
  // header only makes sense on Timeline (the freshly-finished session).
  // On Gallery the top strip was pointing at the last session even as
  // the user tapped through other cards. Hide it entirely on Gallery
  // and let each card carry its own title.
  const afterScreen = document.querySelector('.ea-screen[data-screen="after"]');
  if (afterScreen) afterScreen.setAttribute("data-view", which);

  // Reflect state on the segmented pill toggle so ARIA + visual selection
  // stay in sync no matter who triggered the change (Before-screen link,
  // After-screen pill toggle, or programmatic remount from Summary).
  const pillTl  = document.getElementById("btn-after-view-timeline");
  const pillGal = document.getElementById("btn-after-view-gallery");
  if (pillTl)  pillTl.setAttribute("aria-selected",  which === "timeline" ? "true" : "false");
  if (pillGal) pillGal.setAttribute("aria-selected", which === "gallery"  ? "true" : "false");

  // Mount the Gallery lazily — only when the user actually switches to
  // it. Timeline stays mounted by mountAfter() as before. When the user
  // toggles back to Timeline we tear the Gallery down so its trail
  // canvases and IntersectionObserver release memory.
  if (which === "gallery") {
    _mountGalleryPanel();
  } else if (_detachGallery) {
    try { _detachGallery(); } catch {}
    _detachGallery = null;
  }
}

function _mountGalleryPanel() {
  const screen = document.querySelector('.ea-screen[data-screen="after"]');
  if (!screen) return;
  if (_detachGallery) { try { _detachGallery(); } catch {} _detachGallery = null; }
  _detachGallery = mountGalleryView({
    container: screen,
    sessions: store.history,
    onOpen: (rec) => {
      _selectedSummary = rec;
      goto("summary", { replace: false });
    },
    onDelete: (rec) => {
      // Remove one record from history + persistence, then re-mount so
      // the grid re-flows without a stale card.
      try { store.removeSession(rec.id); } catch {}
      _mountGalleryPanel();
    },
  });
}

function _wireSummaryPanelToggle() {
  const toggle = document.getElementById("btn-summary-panel-toggle");
  const close  = document.getElementById("btn-summary-panel-close");
  const panel  = document.getElementById("summary-panel");
  if (!toggle || !panel) return;

  const label = document.getElementById("btn-summary-panel-toggle-label");
  const setOpen = (open) => {
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
    // Label ALWAYS reads "Emotion Map"; state via aria-pressed.
    toggle.setAttribute("aria-label", "Emotion Map");
    if (label) label.textContent = "Emotion Map";
    document.body.classList.toggle("ea-summary-panel-hidden", !open);
  };
  // v1.5.2: start CLOSED so the Replay lands on Zen art. The
  // Emotion Map panel is summoned by tapping the plaque, keeping
  // the arrival experience gentle. Users who want the map by
  // default can tap the plaque once and it stays open until they
  // change screens.
  setOpen(false);

  toggle.onclick = () => setOpen(panel.getAttribute("aria-hidden") === "true");
  if (close) close.onclick = () => setOpen(false);
}

function unmountSummary() {
  try { detachReplayZen(); } catch {}
  if (_detachSummary) { try { _detachSummary(); } catch {} _detachSummary = null; }
}

// ─────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────
let toastEl;
function toast(msg, ms = 2200) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "ea-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("ea-toast--visible");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("ea-toast--visible"), ms);
}

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────
// Boot the app. This module is loaded with <script type="module">, so it
// already runs after the HTML has been parsed. Additionally, the fluid
// shader loader (src/fluid/shaders/index.js) uses top-level await to
// fetch its .glsl sources, which means the module tree may finish
// evaluating AFTER the DOMContentLoaded event has already fired — in
// which case a late-added DOMContentLoaded listener would never run.
// Guard on document.readyState so we boot correctly whether we finish
// before or after the event.
function __bootEmpathicArt() {
  document.querySelector(".ea-header__back").addEventListener("click", () => {
    if (current === "session" || current === "countdown") {
      // User aborted the session: throw away any uncommitted voice notes
      // so they can't leak into the next session's committed record.
      discardUncommittedNotes();
      unmountSession();
      if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
      goto("before", { replace: true });
    } else if (current === "summary") {
      goto("after", { replace: true });
    } else if (current === "after") {
      goto("before", { replace: true });
    } else {
      goBack();
    }
  });

  // Live clock in header meta
  const meta = document.querySelector(".ea-header__meta");
  const clock = () => {
    const d = new Date();
    meta.textContent = String(d.getHours()).padStart(2,"0") + ":" +
                       String(d.getMinutes()).padStart(2,"0");
  };
  clock(); setInterval(clock, 30_000);

  initBefore();
  initActive();
  wireViewSwitch();
  // Apply the initial frame scale after boot so ?view=desktop / ?view=watch
  // land at the correct size on first paint (mobile devices especially).
  applyViewScale();

  // QA / dev override: ?screen=active|countdown|session jumps directly
  // to that screen so the preview page can inspect every state without
  // manually clicking through the flow. Off in production usage.
  const startScreen = (() => {
    try {
      const s = new URLSearchParams(location.search).get("screen");
      return SCREENS.includes(s) ? s : "before";
    } catch { return "before"; }
  })();
  goto(startScreen, { replace: true });

  // Resize fluid on window changes
  window.addEventListener("resize", () => { if (fluid) fluid.resize(); });

  // Release the Bluetooth radio when the page goes away. Without this the
  // headband can stay bonded to a dead tab and refuse the next connection.
  window.addEventListener("pagehide", () => { _museAdapter?.disconnect(); });
}

// This module is loaded with <script type="module">, so the browser
// has already parsed the full HTML by the time this line runs. There
// is no need to wait on DOMContentLoaded — doing so is actively
// harmful when top-level await in the shader loader delays module
// evaluation past the event, because a listener registered after the
// event will never fire. Just boot immediately.
__bootEmpathicArt();

// Expose modules for the Boundless engineer's console-testing
window.__EA__ = {
  store, muse, audio, voice, playVoiceNote, setView, goto,
  get fluid() { return fluid; },
  // The connected headband, for inspecting live band powers and signal
  // quality from the console: __EA__.museAdapter.lastBands
  get museAdapter() { return _museAdapter; },
  // The session log capture (see ?log=1). Reach for museLog.serialise() if
  // the clipboard is blocked; that returns the whole transcript as a string
  // you can copy out of devtools directly.
  museLog,
  museWizard,
};

// v1.6.4.7 -- Calibration wizard preview on the LISTENING screen.
//
// The listening screen (data-screen="session") holds the approved composition:
//   EMPATHIC ART header
//   "Prepare your session" title
//   Muse status pill
//   Music: Boundless pill
//   [ Start Experience ] bracket button
//   wizard slot
//
// The composition wrapper is hidden by default. This block reveals it and
// mounts the wizard into the dedicated slot when the preview flag is set.
// Silent mode keeps the museLog buffer clean so the Session Replay Zen log
// only carries entries from real Muse sessions later on.
//
//   ?log=1&demo-wizard=1   preview without a real Muse, silent
//   ?log=1&force-wizard=1  alias kept for backward compatibility
try {
  const params = new URLSearchParams(location.search);
  const logOn = params.get("log") === "1";
  const demoOn = params.get("demo-wizard") === "1" || params.get("force-wizard") === "1";
  if (logOn && demoOn) {
    const mount = () => {
      const composition = document.querySelector(".ea-listening-composition");
      const slot = document.getElementById("listening-wizard-slot");
      const sessionScreen = document.querySelector('.ea-screen[data-screen="session"]');
      if (!composition || !slot || !sessionScreen) { setTimeout(mount, 200); return; }
      // Reveal the composition and jump straight to the session screen so
      // the mock composition is visible without walking through the mood /
      // Muse-setup / countdown flow.
      composition.setAttribute("data-hidden", "false");
      document.querySelectorAll(".ea-screen").forEach((s) => s.classList.remove("ea-screen--active"));
      sessionScreen.classList.add("ea-screen--active");
      document.body.setAttribute("data-screen", "session");
      museWizard.start({ host: slot, silent: true });
      console.info("[muse] wizard preview mounted on listening screen. __EA__.museWizard.end() to remove.");
    };
    mount();
  }
} catch (e) { console.warn("[muse] wizard preview init failed", e); }

