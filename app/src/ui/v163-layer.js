// ═══════════════════════════════════════════════════════════════════
// v1.6.3 layer, additive only.
//
// Rules (from the v1.6.3 build spec):
//   1. This file, plus styles/v163.css, are the only new files. The
//      one edit to index.html is two lines: a <link> for the CSS and
//      a <script type="module"> for this file.
//   2. Never modify src/app.js, audio, fluid, muse, palette, voice
//      recorder, session store, or any existing visual style. All
//      new behaviour is coordinated from THIS file by writing body
//      data attributes and reading base DOM state. The only clicks
//      we synthesise are on existing base buttons.
//   3. No em-dashes, no en-dashes, anywhere in this file. Commas,
//      colons, or the double hyphen with spaces (" -- ") are the
//      only separators allowed.
//   4. All visibility control happens via body-level data attributes
//      the CSS gates on: data-v163-entropy, data-v163-recording,
//      data-v163-replay, data-v163-zen, data-v163-zen-text.
//      Nothing here reaches into base styles.
// ═══════════════════════════════════════════════════════════════════

// Import the exact same query-string as src/app.js:243 so the ES
// module system returns the SAME module instance. Different query
// strings resolve to different cache entries even though they
// point at the same file, which would give us a private copy of
// STATIC_TIPS that the base app never sees.
import { STATIC_TIPS } from "./tooltips.js?v=1.5.3";

// ─── One-time tooltip registration ─────────────────────────────────
if (!STATIC_TIPS["blackout-voice"]) {
  STATIC_TIPS["blackout-voice"] = {
    title: "Voice note",
    body:
      "A private moment with yourself. Say out loud how you are feeling " +
      "right now. Only you will hear this back, in your own session history.",
  };
}


const BODY = document.body;


// ═══════════════════════════════════════════════════════════════════
// Module 1, Entropy Mode
// ═══════════════════════════════════════════════════════════════════

let entropyLayer = null;
let voicePill = null;
let endSessionPill = null;
let voicePillInfoGlyph = null;
let topLeftInfoChip = null;

let museResetRafId = 0;

function buildEntropyLayer() {
  if (entropyLayer) return entropyLayer;

  const sessionScreen = document.querySelector(
    '.ea-screen[data-screen="session"]'
  );
  if (!sessionScreen) return null;

  entropyLayer = document.createElement("div");
  entropyLayer.className = "v163-entropy-layer";

  // v1.6.3.9: Floating info-i chip removed per user directive.
  // Recording screen has EXACTLY two buttons: Voice note + End Session.
  // The tooltip that used to live on the info-i (blackout-voice text)
  // now belongs to the Voice note pill itself via data-ea-tip. The
  // pill's inline info glyph is kept as a visual hint that the pill
  // reveals info.
  topLeftInfoChip = null;

  voicePill = document.createElement("button");
  voicePill.type = "button";
  voicePill.className = "v163-pill v163-voice-pill";
  voicePill.setAttribute("aria-label", "Voice note");
  voicePill.setAttribute("data-recording", "false");
  // Tooltip lives on the inline info glyph inside the pill, NOT on
  // the pill wrapper (the pill's click starts/stops recording).
  // Tapping the small i circle at the pill's left edge shows the
  // blackout-voice tooltip; tapping the pill body records.

  // Inline info glyph on the voice pill's left inner edge. Same
  // italic serif i, wrapped in a small circle so it visually reads
  // as part of the pill cluster (Turn 15 rule: not two floating
  // objects). Reuses .ea-chip__info-glyph type styling.
  voicePillInfoGlyph = document.createElement("span");
  voicePillInfoGlyph.className = "v163-voice-pill__info";
  voicePillInfoGlyph.setAttribute("role", "button");
  voicePillInfoGlyph.setAttribute("tabindex", "0");
  voicePillInfoGlyph.setAttribute("aria-label", "About the voice note");
  voicePillInfoGlyph.setAttribute("data-ea-tip", "blackout-voice");
  voicePillInfoGlyph.innerHTML = '<span class="ea-chip__info-glyph" aria-hidden="true">i</span>';

  const voicePillLabel = document.createElement("span");
  voicePillLabel.className = "v163-voice-pill__label";
  voicePillLabel.textContent = "Voice note";

  voicePill.appendChild(voicePillInfoGlyph);
  voicePill.appendChild(voicePillLabel);

  // v1.6.3.11: The i glyph must show the tooltip, NOT start recording.
  // Previously stopPropagation was used, but that also blocks the document
  // level tooltip listener that scans [data-ea-tip] anchors on click.
  // Fix: let the click bubble to document (so tooltip opens), but bail out
  // of the pill record handler when the target came from the i glyph.
  voicePill.addEventListener("click", (e) => {
    if (e.target && e.target.closest(".v163-voice-pill__info")) {
      // Info glyph tap: swallow the record intent, but let bubbling
      // continue up to the document tooltip listener.
      return;
    }
    const chip = document.getElementById("chip-voice");
    if (chip) chip.click();
  });

  endSessionPill = document.createElement("button");
  endSessionPill.type = "button";
  endSessionPill.className = "v163-pill v163-end-session";
  endSessionPill.textContent = "End Session";
  endSessionPill.addEventListener("click", () => {
    const stop = document.getElementById("btn-session-stop");
    if (stop) stop.click();
  });

  entropyLayer.appendChild(voicePill);
  entropyLayer.appendChild(endSessionPill);
  sessionScreen.appendChild(entropyLayer);

  return entropyLayer;
}

let voicePressedObserver = null;
let voicePressedBodyObserver = null;
function attachVoicePressedObserver() {
  const chip = document.getElementById("chip-voice");
  if (!chip) return;
  if (voicePressedObserver) voicePressedObserver.disconnect();
  if (voicePressedBodyObserver) voicePressedBodyObserver.disconnect();

  const baseLabel = chip.querySelector(".ea-chip__label");
  const sync = () => {
    const recording = chip.classList.contains("ea-chip--recording")
      || BODY.getAttribute("data-voice-recording") === "1";
    if (voicePill) {
      voicePill.setAttribute("data-recording", recording ? "true" : "false");
      // Mirror the base chip's label text so v163 pill stays in
      // lockstep with the base app during recording (base swaps to
      // Recording MM:SS with a live ticker).
      const myLabel = voicePill.querySelector(".v163-voice-pill__label");
      if (myLabel && baseLabel) {
        myLabel.textContent = recording
          ? (baseLabel.textContent || "Recording").trim()
          : "Voice note";
      }
    }
    BODY.setAttribute("data-v163-recording", recording ? "true" : "false");
  };
  voicePressedObserver = new MutationObserver(sync);
  voicePressedObserver.observe(chip, {
    attributes: true,
    attributeFilter: ["class", "aria-pressed"],
  });
  // Also observe the base label's text changes so the timer
  // ticks stay mirrored on v163's pill.
  if (baseLabel) {
    voicePressedObserver.observe(baseLabel, {
      characterData: true,
      subtree: true,
      childList: true,
    });
  }
  voicePressedBodyObserver = new MutationObserver(sync);
  voicePressedBodyObserver.observe(BODY, {
    attributes: true,
    attributeFilter: ["data-voice-recording"],
  });
  sync();
}

function closeMusePanelOnEntry() {
  cancelAnimationFrame(museResetRafId);
  museResetRafId = requestAnimationFrame(() => {
    const btn = document.getElementById("btn-muse-data");
    const panel = document.getElementById("muse-panel");
    if (!btn || !panel) return;
    if (panel.getAttribute("aria-hidden") === "false") {
      btn.click();
    }
  });
}

function enterEntropyMode() {
  buildEntropyLayer();
  attachVoicePressedObserver();
  BODY.setAttribute("data-v163-entropy", "on");
  closeMusePanelOnEntry();
}

function leaveEntropyMode() {
  BODY.removeAttribute("data-v163-entropy");
  BODY.removeAttribute("data-v163-recording");
  if (voicePressedObserver) {
    voicePressedObserver.disconnect();
    voicePressedObserver = null;
  }
  if (voicePressedBodyObserver) {
    voicePressedBodyObserver.disconnect();
    voicePressedBodyObserver = null;
  }
}


// ═══════════════════════════════════════════════════════════════════
// Module 2, Session Replay entry (map open state)
//
// On the replay/summary screen, the base app defaults the Emotion
// Map panel to CLOSED so the user lands on Zen art. Per v1.6.3
// spec Eyal wants the OPPOSITE on entry: map OPEN, art playing
// underneath. Users close the map to enter Zen mode (Module 3).
// ═══════════════════════════════════════════════════════════════════

let replayPanelObserver = null;
let replayMapOpenRafId = 0;

function forceReplayMapOpenOnEntry() {
  // The base _wireSummaryPanelToggle runs setOpen(false) inside
  // mountSummary(). We wait one frame so we run after it, then
  // click the toggle to flip open, exactly the same code path a
  // human tap would take.
  cancelAnimationFrame(replayMapOpenRafId);
  replayMapOpenRafId = requestAnimationFrame(() => {
    const toggle = document.getElementById("btn-summary-panel-toggle");
    const panel = document.getElementById("summary-panel");
    if (!toggle || !panel) return;
    if (panel.getAttribute("aria-hidden") === "true") {
      toggle.click();
    }
    syncReplayPanelState();
  });
}

function syncReplayPanelState() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  const open = panel.getAttribute("aria-hidden") === "false";
  BODY.setAttribute("data-v163-panel", open ? "open" : "closed");
  // When the panel is closed on the replay screen, enter Zen text
  // cycle; when open, exit.
  if (BODY.getAttribute("data-v163-replay") === "on") {
    if (open) {
      leaveZenTextMode();
    } else {
      enterZenTextMode();
    }
  }
}

function attachReplayPanelObserver() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  if (replayPanelObserver) replayPanelObserver.disconnect();
  replayPanelObserver = new MutationObserver(syncReplayPanelState);
  replayPanelObserver.observe(panel, {
    attributes: true,
    attributeFilter: ["aria-hidden"],
  });
  syncReplayPanelState();
}

function enterReplayMode() {
  BODY.setAttribute("data-v163-replay", "on");
  // Wait for mountSummary to finish wiring the panel toggle. Two
  // rAFs gives base app one full paint to run setOpen(false),
  // then our toggle click flips it open. Feels instant on the
  // user's side because the map opens under a still-black frame.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      forceReplayMapOpenOnEntry();
      attachReplayPanelObserver();
      injectPanelNewSessionButton();
      injectRevealChevron();
      attachPanelSwipeToClose();
      attachZenWordTracker();
      startContrastLoop();
    });
  });
}

// v1.6.3.12: The Zen big italic serif word (#summary-title, upper-left)
// used to freeze on session.dominantEmotion.name for the whole replay.
// The base playback engine already updates #summary-panel-word-text in
// real time as the YOU cursor crosses anchor emotions and on every
// sample. Mirror that live text into #summary-title so the Zen word
// echoes the emotional trail in ALL phases (empty, fadein, visible,
// fadeout). Purely additive: we only READ from the base and WRITE to
// #summary-title. We never touch the base observers or handlers.
let zenWordObserver = null;
function attachZenWordTracker() {
  const src = document.getElementById("summary-panel-word-text");
  const dst = document.getElementById("summary-title");
  if (!src || !dst) return;
  if (zenWordObserver) { zenWordObserver.disconnect(); zenWordObserver = null; }
  const sync = () => {
    const t = (src.textContent || "").trim();
    if (!t) return;
    if (dst.textContent !== t) dst.textContent = t;
  };
  sync();
  zenWordObserver = new MutationObserver(sync);
  zenWordObserver.observe(src, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
function detachZenWordTracker() {
  if (zenWordObserver) { zenWordObserver.disconnect(); zenWordObserver = null; }
}

// ═══════════════════════════════════════════════════════════════════
// v1.6.3.13, Adaptive text contrast against the fluid canvas.
//
// The Zen replay puts light cream text over a living fluid. When the
// fluid glows bright (Contemplation, Serenity, Joy) the cream text
// dissolves into the light pool. When the fluid runs dark (Stress,
// Melancholy) the cream reads fine. Solution: sample a small region
// of the fluid canvas at 6 Hz, compute Rec.709 luminance, and flip a
// body-level CSS variable --v163-text-ink between cream and dark ink
// with a 250ms crossfade. Also update --v163-text-ink-shadow with the
// opposite tone as a 1px halo insurance for mixed backgrounds.
//
// Purely additive: reads the fluid canvas via drawImage into a tiny
// offscreen 2D canvas (works regardless of WebGL preserveDrawingBuffer,
// because drawImage grabs the front buffer). Never touches the base
// fluid engine, its context, or any base rendering path.
// ═══════════════════════════════════════════════════════════════════

// v1.6.3.15: per-element sampling. Instead of one global decision for
// the whole card, each text row samples the fluid region beneath its
// own bounding rect and picks its own ink. This solves the case where
// the fluid runs bright at the top and dark at the bottom (or vice
// versa) so the title and the narrative may want opposite inks.
//
// Also adds a hair-thin -webkit-text-stroke in the OPPOSITE pole as
// per-glyph insurance from the Anti-Interference literature: a 1 px
// dark rim around cream text (or cream rim around dark text) keeps
// letterform edges crisp against high-frequency background detail
// without producing a soft halo. This is a per-pixel edge effect, not
// a shadow.

let contrastRafId = 0;
let contrastLastTs = 0;
let contrastProbeCanvas = null;
let contrastProbeCtx = null;

const CONTRAST_PROBE_HZ       = 10;
const CONTRAST_PROBE_INTERVAL = 1000 / CONTRAST_PROBE_HZ;
const CONTRAST_PROBE_SIZE     = 16; // per-element region sampled at 16x16
// EMA smoothing factor per probe tick, 0..1. Higher = snappier,
// lower = smoother. 0.22 at 10 Hz yields a ~500ms glide time constant.
const CONTRAST_EMA_ALPHA      = 0.22;

// Ink candidates. Warm cream and near-black are the two poles; the
// picker chooses whichever gives higher WCAG contrast against the
// background.
const INK_LIGHT = { r: 251, g: 246, b: 236 }; // #FBF6EC warm cream
const INK_DARK  = { r: 10,  g:   8, b:   6 }; // #0A0806 near-black warm

// Per-element tracked slots. Each slot has a CSS variable suffix, a
// resolver that returns the DOM node to sample, and its own smoothed
// ink state. If the resolver returns null the slot is skipped.
const INK_SLOTS = [
  { key: "eyebrow",    resolve: () => document.querySelector(".ea-summary__eyebrow") },
  { key: "title",      resolve: () => document.getElementById("summary-title") },
  { key: "meta",       resolve: () => document.querySelector(".ea-summary__meta .ea-session-meta__line") },
  { key: "narrative",  resolve: () => document.querySelector(".ea-session-narrative") },
  { key: "timeline",   resolve: () => document.querySelector(".v163-zen-timeline-label") ||
                                        document.querySelector(".v163-zen-timeline") },
  { key: "newsession", resolve: () => document.querySelector(".v163-new-session-label") ||
                                        document.querySelector(".v163-new-session") },
  { key: "whisper",    resolve: () => document.querySelector(".v163-zen-sentence") },
  // v1.6.3.17: copyright + legal mark now adapts alongside the pills.
  // In Replay/Zen the base cream-on-black paint becomes a hazy blob;
  // this slot samples the fluid directly under the mark and drives
  // --v163-ink-legal, --v163-ink-legal-border, --v163-ink-legal-fill.
  { key: "legal",      resolve: () => document.getElementById("ea-legal-mark") },
];

// Smoothed ink RGB per slot. Initialized to warm cream.
const inkState = Object.create(null);
for (const slot of INK_SLOTS) {
  inkState[slot.key] = { r: 251, g: 246, b: 236 };
}

function ensureContrastProbeCanvas() {
  if (contrastProbeCanvas) return contrastProbeCanvas;
  contrastProbeCanvas = document.createElement("canvas");
  contrastProbeCanvas.width  = CONTRAST_PROBE_SIZE;
  contrastProbeCanvas.height = CONTRAST_PROBE_SIZE;
  contrastProbeCtx = contrastProbeCanvas.getContext("2d", { willReadFrequently: true });
  return contrastProbeCanvas;
}

// Compute the fluid-canvas source rect (in fluid pixel units) that
// sits directly behind a DOM node's client rect. Returns null if the
// node has no size, is offscreen, or the fluid canvas is missing.
function fluidRectBehindNode(node, fluid) {
  if (!node || !fluid || !fluid.width || !fluid.height) return null;
  const nr = node.getBoundingClientRect();
  if (nr.width <= 0 || nr.height <= 0) return null;
  const fr = fluid.getBoundingClientRect();
  if (fr.width <= 0 || fr.height <= 0) return null;

  // Map node rect from CSS pixels into fluid-canvas backing-store pixels.
  const sx = fluid.width  / fr.width;
  const sy = fluid.height / fr.height;
  let srcX = (nr.left - fr.left) * sx;
  let srcY = (nr.top  - fr.top)  * sy;
  let srcW = nr.width  * sx;
  let srcH = nr.height * sy;

  // Clamp to the fluid canvas so drawImage never reads out of bounds.
  if (srcX < 0)               { srcW += srcX; srcX = 0; }
  if (srcY < 0)               { srcH += srcY; srcY = 0; }
  if (srcX + srcW > fluid.width)  srcW = fluid.width  - srcX;
  if (srcY + srcH > fluid.height) srcH = fluid.height - srcY;
  if (srcW <= 1 || srcH <= 1) return null;

  return { srcX, srcY, srcW, srcH };
}

// Convert a 0..255 sRGB channel to linear light per sRGB spec.
function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

// Rec.709 relative luminance for a 0..255 sRGB triplet.
function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

// WCAG contrast ratio between two 0..1 relative luminances.
function wcagContrast(L1, L2) {
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// Sample the fluid canvas beneath a specific source rect and return
// the median RGB and 60th-percentile luminance across the region.
// The rect is expressed in the fluid canvas backing-store pixel
// space, so it maps directly to drawImage source coordinates.
function sampleFluidSubRect(fluid, srcX, srcY, srcW, srcH) {
  ensureContrastProbeCanvas();
  try {
    contrastProbeCtx.clearRect(0, 0, CONTRAST_PROBE_SIZE, CONTRAST_PROBE_SIZE);
    contrastProbeCtx.drawImage(
      fluid,
      srcX, srcY, srcW, srcH,
      0, 0, CONTRAST_PROBE_SIZE, CONTRAST_PROBE_SIZE
    );
  } catch (_err) {
    return null;
  }

  let data;
  try {
    data = contrastProbeCtx.getImageData(0, 0, CONTRAST_PROBE_SIZE, CONTRAST_PROBE_SIZE).data;
  } catch (_err) {
    return null;
  }

  const N = CONTRAST_PROBE_SIZE;
  const px = N * N;
  const rs = new Uint8Array(px);
  const gs = new Uint8Array(px);
  const bs = new Uint8Array(px);
  const lums = new Float32Array(px);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    rs[p]   = data[i];
    gs[p]   = data[i + 1];
    bs[p]   = data[i + 2];
    lums[p] = 0.2126 * data[i] / 255 + 0.7152 * data[i + 1] / 255 + 0.0722 * data[i + 2] / 255;
  }

  const rSort = Array.from(rs).sort((a, b) => a - b);
  const gSort = Array.from(gs).sort((a, b) => a - b);
  const bSort = Array.from(bs).sort((a, b) => a - b);
  const mid = Math.floor(rSort.length / 2);

  const lumSort = Array.from(lums).sort((a, b) => a - b);
  const p60 = lumSort[Math.floor(lumSort.length * 0.60)];

  return {
    r: rSort[mid],
    g: gSort[mid],
    b: bSort[mid],
    lum: p60,
  };
}

// Given a background RGB, choose the ink RGB that maximizes contrast.
// Cream vs near-black poles; pick whichever gives higher WCAG contrast.
// No hue tint. No halo. Just pure ink. Also returns the actual
// contrast score achieved so callers can decide whether the palette
// pick is confident (>= 4.5:1) or whether to fall back to
// mix-blend-mode difference for that specific row.
function pickInkColor(bg) {
  const bgLum   = relativeLuminance(bg.r, bg.g, bg.b);
  const lightLum = relativeLuminance(INK_LIGHT.r, INK_LIGHT.g, INK_LIGHT.b);
  const darkLum  = relativeLuminance(INK_DARK.r,  INK_DARK.g,  INK_DARK.b);
  const cLight = wcagContrast(bgLum, lightLum);
  const cDark  = wcagContrast(bgLum, darkLum);
  const useDark = cDark > cLight;
  const ink = useDark ? { ...INK_DARK } : { ...INK_LIGHT };
  const bestContrast = useDark ? cDark : cLight;
  return { ink, useDark, bestContrast };
}

// WCAG AA body-text threshold. Below this we activate the per-slot
// mix-blend-mode difference fallback so the row stays readable even
// on mid-grey seams the two-color palette cannot cover.
const INK_FALLBACK_THRESHOLD = 4.5;

function clampU8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// Emit CSS variables for one slot: fill ink (text color), stroke ink
// (opposite pole for hair-thin outline), border ink at reduced
// opacity (for pill borders), and pill-fill (very low alpha same-pole
// tint for pill backgrounds that must remain in-palette while still
// yielding to the fluid).
function applySlotColors(key, ink) {
  const style = BODY.style;
  const r = Math.round(ink.r);
  const g = Math.round(ink.g);
  const b = Math.round(ink.b);
  const inkCss = `rgb(${r}, ${g}, ${b})`;
  style.setProperty(`--v163-ink-${key}`,        inkCss);
  style.setProperty(`--v163-ink-${key}-border`, `rgba(${r}, ${g}, ${b}, 0.42)`);

  // Pill fill: same pole as the label ink so the pill reads as a
  // family of one color, but 10% alpha so the fluid still dominates.
  // Cream ink -> cream tint (brightens the pill slightly over dark);
  // dark ink -> dark tint (darkens the pill slightly over bright).
  // Either way, the pill separates from the fluid without ever
  // introducing a third hue.
  style.setProperty(`--v163-ink-${key}-fill`, `rgba(${r}, ${g}, ${b}, 0.10)`);

  // Stroke uses the opposite pole for glyph-edge anti-interference.
  // Choose based on which pole the current ink is closer to. Very
  // low alpha keeps the stroke perceptible only where it needs to be.
  const inkLum = relativeLuminance(r, g, b);
  const opp = inkLum > 0.5 ? INK_DARK : INK_LIGHT;
  style.setProperty(
    `--v163-ink-${key}-stroke`,
    `rgba(${opp.r}, ${opp.g}, ${opp.b}, 0.55)`
  );
}

// One tick: sample every slot's local fluid region, pick ink per
// slot, smooth via EMA, and emit CSS vars. Also emit a fallback
// --v163-text-ink from the title slot for any element that isn't
// individually tracked (defensive default).
function contrastTick(ts) {
  contrastRafId = requestAnimationFrame(contrastTick);
  if (ts - contrastLastTs < CONTRAST_PROBE_INTERVAL) return;
  contrastLastTs = ts;

  if (BODY.getAttribute("data-v163-replay") !== "on") return;

  const fluid = document.getElementById("summary-fluid-canvas");
  if (!fluid || !fluid.width || !fluid.height) return;

  const a = CONTRAST_EMA_ALPHA;

  // Track which slots need the mix-blend-mode difference fallback.
  // A slot enters fallback when the palette-preserving best contrast
  // is under 4.5:1 (WCAG AA body). Emitted as a space-separated list
  // on data-v163-ink-fallback so the CSS can gate per-slot rules.
  const fallbackKeys = [];

  // v1.6.3.19: body-copy slots (meta, narrative, whisper) inherit ink
  // from the title. Sampling each independently causes visible splits
  // where SESSION REPLAY + Love flip to dark ink on a warm bg but the
  // meta row a few pixels below stays cream and disappears. Binding
  // body copy to the title guarantees one consistent ink pole across
  // the whole panel.
  // v1.6.3.20: expand binding so EVERY text slot follows the title's ink
  // pole. Eyebrow, timeline label, new-session label, and legal mark all
  // sat as independent samplers and could disagree with the title on the
  // same palette. Only the title samples locally; all other text slots
  // inherit from it. Pills keep their own opposite-pole borders because
  // they are visual objects, not text.
  const BODY_COPY_BOUND = new Set([
    "eyebrow",
    "meta",
    "narrative",
    "timeline",
    "newsession",
    "whisper",
    "legal"
  ]);

  // First pass: sample every slot EXCEPT the bound body-copy slots.
  for (const slot of INK_SLOTS) {
    if (BODY_COPY_BOUND.has(slot.key)) continue;
    const node = slot.resolve();
    if (!node) continue;
    const rect = fluidRectBehindNode(node, fluid);
    if (!rect) continue;
    const bg = sampleFluidSubRect(fluid, rect.srcX, rect.srcY, rect.srcW, rect.srcH);
    if (!bg) continue;
    const { ink, bestContrast } = pickInkColor(bg);
    const s = inkState[slot.key];
    s.r = s.r * (1 - a) + ink.r * a;
    s.g = s.g * (1 - a) + ink.g * a;
    s.b = s.b * (1 - a) + ink.b * a;
    applySlotColors(slot.key, s);
    if (bestContrast < INK_FALLBACK_THRESHOLD) fallbackKeys.push(slot.key);
  }

  // Second pass: bind meta/narrative/whisper ink state to the title's
  // smoothed color so they never split. Ink stays consistent across
  // the whole panel even when local fluid luminance disagrees.
  const titleInk = inkState.title;
  for (const key of BODY_COPY_BOUND) {
    const s = inkState[key];
    s.r = titleInk.r;
    s.g = titleInk.g;
    s.b = titleInk.b;
    applySlotColors(key, s);
  }

  if (fallbackKeys.length) {
    BODY.setAttribute("data-v163-ink-fallback", fallbackKeys.join(" "));
  } else {
    BODY.removeAttribute("data-v163-ink-fallback");
  }

  // Fallback --v163-text-ink follows the title slot so any element
  // that isn't per-slot bound still adapts sensibly.
  const t = inkState.title;
  const tCss = `rgb(${Math.round(t.r)}, ${Math.round(t.g)}, ${Math.round(t.b)})`;
  BODY.style.setProperty("--v163-text-ink", tCss);
  BODY.style.setProperty("--v163-text-ink-shadow", "transparent");
  BODY.style.setProperty("--v163-pill-label-ink", tCss);
  BODY.style.setProperty(
    "--v163-pill-border-ink",
    `rgba(${Math.round(t.r)}, ${Math.round(t.g)}, ${Math.round(t.b)}, 0.42)`
  );
  const tLum = relativeLuminance(t.r, t.g, t.b);
  BODY.setAttribute("data-v163-ink", tLum > 0.5 ? "light" : "dark");
}

function startContrastLoop() {
  if (contrastRafId) return;
  // Reset every slot to warm cream so the first-frame render doesn't
  // flash a stale color from a previous session.
  for (const slot of INK_SLOTS) {
    inkState[slot.key] = { ...INK_LIGHT };
    applySlotColors(slot.key, inkState[slot.key]);
  }
  contrastRafId = requestAnimationFrame(contrastTick);
}

function stopContrastLoop() {
  if (contrastRafId) { cancelAnimationFrame(contrastRafId); contrastRafId = 0; }
  BODY.removeAttribute("data-v163-ink");
  BODY.removeAttribute("data-v163-ink-fallback");
  const style = BODY.style;
  style.removeProperty("--v163-text-ink");
  style.removeProperty("--v163-text-ink-shadow");
  style.removeProperty("--v163-pill-label-ink");
  style.removeProperty("--v163-pill-border-ink");
  for (const slot of INK_SLOTS) {
    style.removeProperty(`--v163-ink-${slot.key}`);
    style.removeProperty(`--v163-ink-${slot.key}-border`);
    style.removeProperty(`--v163-ink-${slot.key}-stroke`);
    style.removeProperty(`--v163-ink-${slot.key}-fill`);
  }
}

// Insert a persistent header row at the top of the Emotion Map
// panel with three controls: timeline-back on the left, info-i in
// the middle (opens the Session Replay tooltip -- replaces the
// removed floating upper-left chip), and +NEW SESSION on the right.
// Always visible without scrolling. Idempotent: safe to call more
// than once. The base X close button is separately styled to sit
// in the upper-right of the panel corner, right of this header.
function injectPanelNewSessionButton() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  if (panel.querySelector(".v163-panel-header")) return;

  const header = document.createElement("div");
  header.className = "v163-panel-header";

  // v1.6.3.9: Timeline back button removed from the panel header per
  // user directive. It was floating inside the panel and cluttering
  // the Emotion Map view. Users can close the panel with X to return
  // to the M3 zen surface, which has its own TIMELINE pill.

  // Info-i: styled identically to the base .ea-chip--help so it
  // renders the same italic serif glyph. Reuses the base tooltip
  // via data-ea-tip so the same "Session replay" copy shows.
  const infoBtn = document.createElement("button");
  infoBtn.type = "button";
  infoBtn.className = "v163-panel-header__info";
  infoBtn.setAttribute("aria-label", "About this replay");
  // v1.6.3.12: Reuses the base Emotion Map tooltip copy (STATIC_TIPS
  // key "emotion-map") because this button anchors the map and the
  // emotional trail. Not "summary-help" (that was replay-generic).
  infoBtn.setAttribute("data-ea-tip", "emotion-map");
  infoBtn.textContent = "i";

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "v163-panel-header__new-session";
  newBtn.setAttribute("aria-label", "Start a new session");
  newBtn.textContent = "+ New";
  newBtn.addEventListener("click", () => startNewSession());

  header.appendChild(infoBtn);
  header.appendChild(newBtn);

  // Insert as the FIRST child of the panel so it lays out before
  // the circumplex flow and sits inside the panel's absolute
  // .v163-panel-header positioning box.
  panel.insertBefore(header, panel.firstChild);
}

function gotoTimeline() {
  // Go back to the Session Gallery / Timeline. Uses the base app
  // router when available. Fallback: click the header back arrow
  // if it exists on the summary screen.
  try {
    if (window.__EA__ && typeof window.__EA__.goto === "function") {
      window.__EA__.goto("after");
      return;
    }
  } catch (_err) { /* fall through */ }
  const back = document.querySelector(".ea-header__back");
  if (back) { back.click(); return; }
  const link = document.querySelector('[data-nav="after"]');
  if (link) link.click();
}

function leaveReplayMode() {
  BODY.removeAttribute("data-v163-replay");
  BODY.removeAttribute("data-v163-panel");
  if (replayPanelObserver) {
    replayPanelObserver.disconnect();
    replayPanelObserver = null;
  }
  detachPanelSwipeToClose();
  removeRevealChevron();
  detachZenWordTracker();
  stopContrastLoop();
  leaveZenTextMode();
}

// ═══════════════════════════════════════════════════════════════════
// v1.6.3.21 -- Reveal-the-art affordances.
//
// The map panel is a floating card inset from all four edges. That
// alone is a huge signal that art lives behind it, but two extra
// affordances make it explicit:
//
//   1. A downward chevron in the bottom peek band, shown only until
//      the viewer has closed the panel once. Clicking it closes the
//      panel. Sets ea.chevronSeen=1 in localStorage so it never
//      returns.
//   2. A swipe-down gesture on the panel itself. Any pointer that
//      starts inside the panel body and moves 60px+ down closes the
//      panel, matching iOS bottom-sheet convention.
// ═══════════════════════════════════════════════════════════════════

const CHEVRON_SEEN_KEY = "ea.chevronSeen";
let chevronEl = null;
let swipeState = null;

function chevronAlreadySeen() {
  try { return localStorage.getItem(CHEVRON_SEEN_KEY) === "1"; }
  catch (_e) { return false; }
}
function markChevronSeen() {
  try { localStorage.setItem(CHEVRON_SEEN_KEY, "1"); }
  catch (_e) { /* ignore */ }
  BODY.setAttribute("data-v163-chevron-seen", "1");
}

function closePanelByChevron() {
  const close = document.getElementById("btn-summary-panel-close");
  if (close) close.click();
  else {
    const toggle = document.getElementById("btn-summary-panel-toggle");
    if (toggle) toggle.click();
  }
  markChevronSeen();
}

function injectRevealChevron() {
  if (chevronEl) return;
  if (chevronAlreadySeen()) {
    BODY.setAttribute("data-v163-chevron-seen", "1");
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "v163-reveal-chevron";
  btn.setAttribute("aria-label", "Close panel to reveal art");
  btn.innerHTML = '<span class="v163-reveal-chevron__glyph">\u2304</span>';
  btn.addEventListener("click", closePanelByChevron);
  document.body.appendChild(btn);
  chevronEl = btn;
}

function removeRevealChevron() {
  if (chevronEl && chevronEl.parentNode) {
    chevronEl.parentNode.removeChild(chevronEl);
  }
  chevronEl = null;
}

// Swipe-down handler. Attach to the panel; any pointer that starts
// inside the panel and moves 60px+ downward without lateral drift
// counts as a dismiss. We ignore drags that start on interactive
// controls so the timeline scrubber and buttons keep working.
function _onPanelPointerDown(e) {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  if (BODY.getAttribute("data-v163-panel") !== "open") return;
  const t = e.target;
  if (t && t.closest &&
      t.closest("button, a, input, [role=slider], .ea-summary__slider, " +
                ".ea-summary__voice-notes, .ea-summary__brainwaves")) {
    return;
  }
  swipeState = {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    active: true,
  };
}
function _onPanelPointerMove(e) {
  if (!swipeState || !swipeState.active) return;
  if (e.pointerId !== swipeState.id) return;
  const dy = e.clientY - swipeState.y0;
  const dx = Math.abs(e.clientX - swipeState.x0);
  if (dy > 60 && dx < 40) {
    swipeState.active = false;
    closePanelByChevron();
  }
}
function _onPanelPointerEnd(e) {
  if (!swipeState) return;
  if (e.pointerId !== swipeState.id) return;
  swipeState = null;
}

function attachPanelSwipeToClose() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  panel.addEventListener("pointerdown", _onPanelPointerDown, { passive: true });
  panel.addEventListener("pointermove", _onPanelPointerMove, { passive: true });
  panel.addEventListener("pointerup", _onPanelPointerEnd, { passive: true });
  panel.addEventListener("pointercancel", _onPanelPointerEnd, { passive: true });
}
function detachPanelSwipeToClose() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;
  panel.removeEventListener("pointerdown", _onPanelPointerDown);
  panel.removeEventListener("pointermove", _onPanelPointerMove);
  panel.removeEventListener("pointerup", _onPanelPointerEnd);
  panel.removeEventListener("pointercancel", _onPanelPointerEnd);
  swipeState = null;
}


// ═══════════════════════════════════════════════════════════════════
// Module 3, Zen text cycle
//
// While the replay is on Zen (map closed), the art plays and the
// music continues. On top of that we run a single sentence that
// fades in and out on a 12s cycle, sitting under the base app's
// changing emotion word. A "New Session" pill sits at the bottom
// of the screen at all times so the user can start over from Zen.
//
// Cycle:
//   0s .. 12s     empty (fluid + emotion word only)
//   12s .. 13.3s  fade-in (1.3s ease)
//   13.3s .. 25.3s visible
//   25.3s .. 26.6s fade-out
//   26.6s        loop back to empty
//
// Copy: "Tap anywhere." (single sentence, per v1.6.3 spec).
// ═══════════════════════════════════════════════════════════════════

// v1.6.3 timing: 14s empty, 1.2s fade-in, 14s text visible, 1.2s
// fade-out. Total cycle = 30.4s. Locked spec.
const ZEN_HIDDEN_MS = 14000;
const ZEN_FADE_MS = 1200;
const ZEN_VISIBLE_MS = 14000;

let zenLayer = null;
let zenSentence = null;
let zenNewSessionPill = null;
let zenCycleTimeoutId = 0;

function buildZenLayer() {
  if (zenLayer) return zenLayer;
  const summaryScreen = document.querySelector(
    '.ea-screen[data-screen="summary"]'
  );
  if (!summaryScreen) return null;

  zenLayer = document.createElement("div");
  zenLayer.className = "v163-zen-layer";

  zenSentence = document.createElement("div");
  zenSentence.className = "v163-zen-sentence";
  zenSentence.setAttribute("aria-hidden", "true");
  // Whisper pill: hint that tapping the fluid starts a new session.
  // Only visible during the empty phase of the Zen cycle. The arrow
  // ideogram nudges the eye up toward the fluid canvas.
  zenSentence.textContent = "Tap anywhere \u2191";

  zenNewSessionPill = document.createElement("button");
  zenNewSessionPill.type = "button";
  zenNewSessionPill.className = "v163-pill v163-new-session";
  zenNewSessionPill.textContent = "+ New Session";
  zenNewSessionPill.addEventListener("click", (e) => {
    e.stopPropagation();
    startNewSession();
  });

  // v1.6.3.11: Tap in Zen empty phase reveals the full text cluster.
  //
  // v1.6.4.30: Listen on the summary screen root, not on zenLayer
  // itself. On iPhone Safari the tap can land on an element sibling
  // to zenLayer (the caption band, an SVG label, the muted log box)
  // and the click never reaches zenLayer directly. Listening at the
  // screen root catches every bubble. The summaryScreen still lives
  // inside body[data-v163-replay=on] scope so we can safely gate on
  // that attribute.
  //
  // v1.6.4.33: Two-step tap. First tap in the empty phase reveals
  // the cluster (empty -> fadein). Second tap while the cluster is
  // on screen (fadein or visible) hides it early (-> fadeout -> empty).
  // Taps during fadeout are ignored so the transition finishes cleanly
  // rather than snapping into a new phase mid-fade. The copy-log
  // button, + New Session pill, TIMELINE pill and header controls
  // handle their own clicks via stopPropagation or the ignore list
  // below so they never toggle the cycle.
  const zenClickHandler = (e) => {
    if (BODY.getAttribute("data-v163-zen") !== "on") return;
    if (BODY.getAttribute("data-v163-panel") === "open") return;
    if (e.target.closest(".v163-new-session")) return;
    if (e.target.closest(".v163-zen-timeline")) return;
    if (e.target.closest(".ea-muse-terminal__copy--pinned")) return;
    if (e.target.closest(
      ".ea-summary__topbar, .ea-immersive-btn, #summary-panel, .ea-header"
    )) return;
    const phase = BODY.getAttribute("data-v163-zen-phase");
    if (phase === "empty") {
      revealZenTextEarly();
    } else if (phase === "fadein" || phase === "visible") {
      hideZenTextEarly();
    }
    // phase === "fadeout": ignore, transition already in progress.
  };
  summaryScreen.addEventListener("click", zenClickHandler);

  // Timeline back pill: in M3 zen phase there is no way to return
  // to the timeline once you close the panel. This pill sits in
  // the upper-left corner (mirroring the panel header layout) and
  // navigates back to the Timeline (After) view. Always visible in
  // Replay Mode, independent of the fade cycle.
  const zenTimelinePill = document.createElement("button");
  zenTimelinePill.type = "button";
  zenTimelinePill.className = "v163-pill v163-zen-timeline";
  zenTimelinePill.textContent = "Timeline";
  zenTimelinePill.setAttribute("aria-label", "Back to Timeline");
  zenTimelinePill.addEventListener("click", (e) => {
    e.stopPropagation();
    gotoTimeline();
  });

  zenLayer.appendChild(zenSentence);
  zenLayer.appendChild(zenNewSessionPill);
  // Timeline pill mounts INSIDE the .ea-summary__topbar so it
  // shares the same offset-parent (and therefore the same
  // horizontal baseline) as the Emotion Map anchor
  // #btn-summary-panel-toggle. This is what makes them line up
  // on the same y in real iPhone viewports where the safe-area
  // inset varies. Falls back to the zen layer if the topbar
  // is missing for any reason.
  const topbar = document.querySelector(".ea-summary__topbar");
  if (topbar) {
    topbar.appendChild(zenTimelinePill);
  } else {
    zenLayer.appendChild(zenTimelinePill);
  }
  summaryScreen.appendChild(zenLayer);

  return zenLayer;
}

function startNewSession() {
  // "New Session" == send the user back to the Before screen.
  // Preferred path: use the base app's own router if it is
  // exposed on window.__EA__. Fallback: click the header back
  // chevron (.ea-header__back). Last resort: any element with
  // data-nav="before".
  try {
    if (window.__EA__ && typeof window.__EA__.goto === "function") {
      window.__EA__.goto("before");
      return;
    }
  } catch (_err) { /* fall through */ }
  const back = document.querySelector(".ea-header__back");
  if (back) {
    back.click();
    return;
  }
  // Fallback: a data-nav="before" button, if the base app exposes
  // one. If neither works, do nothing rather than break.
  const preBtn = document.querySelector('[data-nav="before"]');
  if (preBtn) preBtn.click();
}

// v1.6.3.11: Fast-forward from empty -> fadein when the user taps
// the zen surface. Clears the pending empty-timeout so the cycle
// resumes cleanly with a full 14s visible window afterward.
function revealZenTextEarly() {
  if (!zenSentence) return;
  clearTimeout(zenCycleTimeoutId);
  zenCycleTimeoutId = 0;
  runZenCyclePhase("fadein");
}

// v1.6.4.33: Fast-forward from fadein or visible -> fadeout when the
// user taps a second time. Clears the pending visible timeout so the
// cycle continues fadeout -> empty on its own from here. The 1.2s
// fadeout still runs so the cluster and log body ease out together
// instead of snapping. If a tap lands during fadeout the handler
// ignores it -- the transition is already carrying the cluster off
// screen and we do not want to interrupt it.
function hideZenTextEarly() {
  if (!zenSentence) return;
  clearTimeout(zenCycleTimeoutId);
  zenCycleTimeoutId = 0;
  runZenCyclePhase("fadeout");
}

function stopZenCycle() {
  clearTimeout(zenCycleTimeoutId);
  zenCycleTimeoutId = 0;
  if (zenSentence) {
    zenSentence.setAttribute("data-visible", "false");
    zenSentence.setAttribute("aria-hidden", "true");
  }
  BODY.removeAttribute("data-v163-zen-phase");
}

// runZenCyclePhase drives the whole M3 cluster via one body-level
// data attribute: data-v163-zen-phase.
//
//   "empty"    -> only .ea-summary__title (emotion word) visible,
//                 top-right anchor = icon only (State B),
//                 whisper "Tap anywhere." pill visible.
//   "fadein"   -> 1.2s crossfade: kicker + meta + narrative + New
//                 Session pill fade in; anchor label unfurls left
//                 (State C).
//   "visible"  -> full cluster steady for 14s.
//   "fadeout"  -> 1.2s reverse crossfade back to empty.
//
// The word .ea-summary__title never moves, never resizes, never
// fades. It is the anchor the cluster orbits around.
function setZenPhase(phase) {
  BODY.setAttribute("data-v163-zen-phase", phase);
}

function runZenCyclePhase(phase) {
  if (!zenSentence) return;
  setZenPhase(phase);
  // phase: "empty" | "fadein" | "visible" | "fadeout"
  switch (phase) {
    case "empty":
      zenSentence.setAttribute("data-visible", "true");
      zenSentence.setAttribute("aria-hidden", "false");
      zenCycleTimeoutId = setTimeout(
        () => runZenCyclePhase("fadein"),
        ZEN_HIDDEN_MS
      );
      break;
    case "fadein":
      // Whisper hides as the cluster starts to appear.
      zenSentence.setAttribute("data-visible", "false");
      zenSentence.setAttribute("aria-hidden", "true");
      zenCycleTimeoutId = setTimeout(
        () => runZenCyclePhase("visible"),
        ZEN_FADE_MS
      );
      break;
    case "visible":
      zenCycleTimeoutId = setTimeout(
        () => runZenCyclePhase("fadeout"),
        ZEN_VISIBLE_MS
      );
      break;
    case "fadeout":
      zenCycleTimeoutId = setTimeout(
        () => runZenCyclePhase("empty"),
        ZEN_FADE_MS
      );
      break;
  }
}

function enterZenTextMode() {
  buildZenLayer();
  BODY.setAttribute("data-v163-zen", "on");
  stopZenCycle();
  // Start the cycle in the empty phase so the art gets a clean
  // 14 seconds before the cluster fades in.
  runZenCyclePhase("empty");
}

function leaveZenTextMode() {
  BODY.removeAttribute("data-v163-zen");
  BODY.removeAttribute("data-v163-zen-phase");
  stopZenCycle();
}


// ═══════════════════════════════════════════════════════════════════
// Screen router
// ═══════════════════════════════════════════════════════════════════

function handleScreenChange(screen) {
  if (screen === "session") {
    enterEntropyMode();
    leaveReplayMode();
  } else if (screen === "summary") {
    leaveEntropyMode();
    enterReplayMode();
  } else {
    leaveEntropyMode();
    leaveReplayMode();
  }
}

function boot() {
  handleScreenChange(BODY.getAttribute("data-screen"));

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "data-screen") {
        handleScreenChange(BODY.getAttribute("data-screen"));
      }
    }
  });
  observer.observe(BODY, {
    attributes: true,
    attributeFilter: ["data-screen"],
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(boot);
  });
} else {
  requestAnimationFrame(boot);
}
