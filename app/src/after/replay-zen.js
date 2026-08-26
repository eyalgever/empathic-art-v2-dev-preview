// ─────────────────────────────────────────────────────────────
// Replay Zen mode
//

import { museLog } from "../muse/muse-log-capture.js?v=1.6.4.27";

//
// After the user has been on the Session Replay screen for a few
// seconds without touching, we fade the chrome away so the art
// takes the whole frame. A gentle hint whispers "tap to reveal
// details" at the bottom.
//
// State machine:
//   AMBIENT: only the art (and the persistent emotion word) is
//     visible. A tiny hint text pulses at the very bottom.
//   INFO   : meta + narrative caption + top-bar chrome comes back.
//     A second hint appears: "tap for the emotion map". After 6s
//     of no interaction we drift back to AMBIENT.
//   MAP    : user has explicitly toggled the Emotion Map open. We
//     stay in this state as long as the map is visible.
//
// The state is written to <body> as data-replay-zen="ambient" |
// "info" | "map". CSS in styles/replay-zen.css does the actual
// fade work. This module only owns the state machine, the
// gestures, and the ambient hint text.
//
// Every ~25 seconds we do one gentle "narrative re-emergence" in
// which the narrative caption fades in for 5s then out again,
// even while in ambient. Think museum wall label catching your
// eye when you are ready to read it.
// ─────────────────────────────────────────────────────────────

const HINTS_AMBIENT = [
  "tap to reveal details",
  "tap for the vocabulary",
  "tap to see the emotion journey",
];
const HINT_INFO_MAP = "tap the Emotion Map panel above";
const AMBIENT_AFTER_MS = 5000;
const INFO_TIMEOUT_MS  = 6000;
const NARRATIVE_REEMERGE_MS = 25000;
const NARRATIVE_REEMERGE_HOLD_MS = 5000;

let _detach = null;

/** Public entry: turn Replay-Zen on. Returns a detach fn that
 *  restores the screen to its plain state and removes gestures. */
export function attachReplayZen({ screenEl, session }) {
  if (_detach) { try { _detach(); } catch {} _detach = null; }
  if (!screenEl) return () => {};

  const body = document.body;
  const canvas = screenEl.querySelector("#summary-fluid-canvas");
  const panel  = document.getElementById("summary-panel");
  const mapToggle = document.getElementById("btn-summary-panel-toggle");

  // Build the two floating hint labels once. Kept inside the
  // summary screen so they live and die with it.
  let hintAmbient = screenEl.querySelector(".ea-replay-zen__hint--ambient");
  if (!hintAmbient) {
    hintAmbient = document.createElement("div");
    hintAmbient.className = "ea-replay-zen__hint ea-replay-zen__hint--ambient";
    hintAmbient.setAttribute("aria-hidden", "true");
    hintAmbient.textContent = HINTS_AMBIENT[0];
    screenEl.appendChild(hintAmbient);
  }
  let hintInfo = screenEl.querySelector(".ea-replay-zen__hint--info");
  if (!hintInfo) {
    hintInfo = document.createElement("div");
    hintInfo.className = "ea-replay-zen__hint ea-replay-zen__hint--info";
    hintInfo.setAttribute("aria-hidden", "true");
    hintInfo.textContent = HINT_INFO_MAP;
    screenEl.appendChild(hintInfo);
  }

  // Muse calibration log overlay.
  // v1.6.4.17 -- Two paths for surfacing the log:
  //   1. Preferred: the session record has its own stamped museLog snapshot
  //      (recorded at commitSession time). Render THAT, so each replay shows
  //      the log of the session being replayed, not whatever the live buffer
  //      currently holds.
  //   2. Fallback: ?log=1 in the URL and the live buffer has content. Kept
  //      for backward compatibility and manual preview cases.
  // We mount inside .ea-summary__head so the log flows in the DOM right after
  // the narrative caption. That achieves two things:
  //   * A natural, tight gap between the caption and the first log line
  //     (a single blank-line breath, not a big void).
  //   * The log inherits the same ambient/info reveal as the head, so it
  //     appears together with the caption on tap or timed reveal, and
  //     hides in ambient. No separate reveal wiring needed.
  let detachMuseLog = null;
  try {
    const head = screenEl.querySelector(".ea-summary__head") || screenEl;
    if (Array.isArray(session?.museLog) && session.museLog.length > 0) {
      detachMuseLog = museLog.mountReplayOverlayFromRecord(head, session);
    } else {
      const params = new URLSearchParams(location.search);
      if (params.get("log") === "1" && museLog.size > 0) {
        detachMuseLog = museLog.mountReplayOverlay(head);
      }
    }
  } catch (err) { console.warn("[replay-zen] log mount failed", err); }

  let state = "info"; // start with everything visible so the user
                     // has a moment to read the title + narrative
  let ambientTimer = null;
  let infoTimer = null;
  let narrativeTimer = null;
  let hintIndex = 0;
  let destroyed = false;

  const setState = (next) => {
    if (destroyed) return;
    state = next;
    body.setAttribute("data-replay-zen", next);
    // Rotate the ambient hint text every time we land back in
    // ambient, but only after the first ambient dwell so the
    // user reads a consistent first message.
    if (next === "ambient") {
      hintIndex = (hintIndex + 1) % HINTS_AMBIENT.length;
      hintAmbient.textContent = HINTS_AMBIENT[hintIndex];
    }
    // The header collapses/expands between ambient and info, which
    // changes the canvas size. The fluid engine (and any style
    // that extends it) needs a resize() call so its FBOs match the
    // new pixel dimensions; otherwise the art gets letterboxed.
    // Fire on the next frame so layout has already reflowed.
    requestAnimationFrame(() => {
      try { window.__EA__?.summaryFluid?.resize?.(); } catch {}
    });
  };

  const scheduleAmbient = (ms = AMBIENT_AFTER_MS) => {
    clearTimeout(ambientTimer);
    ambientTimer = setTimeout(() => {
      // Only drift to ambient from info states; if the map is
      // open we stay put.
      if (state === "info") setState("ambient");
    }, ms);
  };
  const scheduleInfoTimeout = (ms = INFO_TIMEOUT_MS) => {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => {
      if (state === "info") setState("ambient");
    }, ms);
  };

  // Kick off: give the user 5s of full chrome, then fade to
  // ambient. First entry only.
  setState("info");
  scheduleAmbient(AMBIENT_AFTER_MS);

  // ── Narrative re-emergence loop ────────────────────────────
  // Every 25s (from the last user interaction) we briefly fade
  // the narrative back in without leaving ambient. body carries
  // data-replay-zen-narrative="peek" for the CSS to hook.
  const startNarrativePeek = () => {
    clearTimeout(narrativeTimer);
    narrativeTimer = setTimeout(function loop() {
      if (destroyed) return;
      if (state === "ambient") {
        body.setAttribute("data-replay-zen-narrative", "peek");
        setTimeout(() => {
          body.removeAttribute("data-replay-zen-narrative");
        }, NARRATIVE_REEMERGE_HOLD_MS);
      }
      narrativeTimer = setTimeout(loop, NARRATIVE_REEMERGE_MS);
    }, NARRATIVE_REEMERGE_MS);
  };
  startNarrativePeek();

  // ── Gesture: tap the canvas / anywhere non-interactive ─────
  //
  // We do NOT install a document-wide tap handler. Instead we
  // put a full-screen invisible catcher LAYER behind the panel
  // chrome, so taps on scrub bars, buttons, and the panel keep
  // working normally. The catcher only picks up taps on the raw
  // canvas / body area.
  //
  // Simpler approach: listen for pointerdown on the summary
  // screen and check the target. If the target lives inside an
  // interactive element (button, panel, chip, scrub track) we
  // treat it as an "activity" reset only. Otherwise we advance
  // the zen state.
  const isInteractive = (el) => {
    if (!el) return false;
    return !!el.closest(
      "button, a, input, [role='slider'], .ea-summary__scrub, " +
      ".ea-muse-panel, .ea-summary__panel, .ea-header, .ea-toast, " +
      ".ea-tip, .ea-replay-zen__hint"
    );
  };

  const onPointer = (e) => {
    const target = e.target;
    // Any interaction with a control resets the ambient timer
    // but does NOT change the zen state — the user is doing
    // what they meant to do.
    if (isInteractive(target)) {
      clearTimeout(ambientTimer);
      clearTimeout(infoTimer);
      // If they just interacted, treat it as "info" state so the
      // chrome stays lit long enough to finish the interaction.
      if (state === "ambient") setState("info");
      scheduleAmbient(AMBIENT_AFTER_MS + 3000);
      return;
    }

    // Non-interactive tap → advance the zen state
    if (state === "ambient") {
      setState("info");
      scheduleInfoTimeout(INFO_TIMEOUT_MS);
    } else if (state === "info") {
      // A second tap while in info keeps info alive (user is
      // engaging) and pulses the map hint more strongly.
      hintInfo.classList.remove("ea-replay-zen__hint--pulse");
      // Force reflow so the animation restarts
      void hintInfo.offsetWidth;
      hintInfo.classList.add("ea-replay-zen__hint--pulse");
      scheduleInfoTimeout(INFO_TIMEOUT_MS);
    }
  };

  screenEl.addEventListener("pointerdown", onPointer);

  // When the user opens the Emotion Map plaque we jump to "map"
  // state so nothing auto-fades while they're reading the map.
  const onMapToggle = () => {
    // Give the panel a moment to update its aria-hidden
    setTimeout(() => {
      const isOpen = panel && panel.getAttribute("aria-hidden") === "false";
      if (isOpen) {
        clearTimeout(ambientTimer);
        clearTimeout(infoTimer);
        setState("map");
      } else {
        setState("info");
        scheduleAmbient(AMBIENT_AFTER_MS);
      }
    }, 40);
  };
  if (mapToggle) mapToggle.addEventListener("click", onMapToggle);

  // ── Cleanup ────────────────────────────────────────────────
  _detach = () => {
    destroyed = true;
    clearTimeout(ambientTimer);
    clearTimeout(infoTimer);
    clearTimeout(narrativeTimer);
    body.removeAttribute("data-replay-zen");
    body.removeAttribute("data-replay-zen-narrative");
    screenEl.removeEventListener("pointerdown", onPointer);
    if (mapToggle) mapToggle.removeEventListener("click", onMapToggle);
    try { hintAmbient.remove(); } catch {}
    try { hintInfo.remove(); } catch {}
    try { detachMuseLog && detachMuseLog(); } catch {}
    _detach = null;
  };
  return _detach;
}

export function detachReplayZen() {
  if (_detach) { try { _detach(); } catch {} _detach = null; }
}
