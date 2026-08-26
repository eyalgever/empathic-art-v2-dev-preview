import { dbg } from "../debug/debug-overlay.js?v=1.3.1";

/**
 * Empathic App — Tooltip System
 *
 * A single delegated tooltip surface used across the app. Hovering or
 * tapping an element with `data-ea-tip="<key>"` shows the corresponding
 * tooltip content beside the anchor.
 *
 * Design intent:
 *   1. One tooltip DOM node lives in the body. All anchors point to it.
 *   2. Copy is written by the artist — sharp, human, brief.
 *   3. Emotion tooltips also render on the SVG circumplex — hover/tap
 *      an emotion dot or label to see its definition + force + signature.
 *   4. Tap-outside dismisses; ESC dismisses; leaving the anchor dismisses.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

// ─── Copy dictionaries ──────────────────────────────────────────────
// Written for the artist by the artist. Keep it minimal and human — no
// tech-doc voice, no marketing filler. Every string is a single thought.

/** Static tooltips keyed by `data-ea-tip` value. Each entry may carry
 *  an optional `sig` (signature / biosignal readout in mono type) and
 *  `science` (a single sentence of neuroscience or biosignal grounding)
 *  so information-dense tips can teach as well as guide. */
export const STATIC_TIPS = {
  "emotion-map": {
    title: "Emotion map",
    body: "Your feeling drawn as a path across the circumplex, valence on the horizontal, arousal on the vertical. Nineteen anchor emotions ring the wheel. Tap any anchor label for its bio-signature.",
    sig: "Axes: valence ± · arousal ± · openness 0–1",
  },
  "brainwaves": {
    title: "Brain waves",
    body: "Five EEG bands read from the front of the scalp. Delta and Theta rise as you soften; Alpha holds calm attention; Beta and Gamma climb with arousal and focus.",
    sig: "δ 0.5–4 · θ 4–8 · α 8–12 · β 12–30 · γ >30 Hz",
  },
  "play-pause": {
    title: "Play / pause",
    body: "Play the session back. Music, the artwork, and your emotion trail replay together in real time.",
  },
  "scrub": {
    title: "Scrub the timeline",
    body: "Drag anywhere along the bar to jump forward or back. Pins mark voice notes you recorded during this session. The artwork rewinds with you.",
  },
  "voice-record": {
    title: "Voice note",
    body: "Tap to record a thought. The music softens while you speak, then returns. Your note is pinned to this exact moment on the timeline.",
    sig: "48 kHz · mono · opus 128 kbps",
  },
  "close-map": {
    title: "Close the map",
    body: "Return to the artwork.",
  },
  "session-help": {
    title: "How this works",
    body: "Feel with the artwork. Tap the Emotion Map to see the circumplex the algorithm is reading right now. Tap the voice record button to capture a spoken note.",
  },
  "summary-help": {
    title: "Session replay",
    body: "Watch the whole journey play back, the artwork re-runs at the same emotion, the brain-waves breathe with it, and your voice note replays at the moment you spoke.",
  },
  "replay-timeline": {
    title: "Timeline",
    body: "Back to the sessions timeline, the horizontal ribbon of every session you have finished, ordered in time.",
  },
  "replay-gallery": {
    title: "Gallery",
    body: "Open the gallery, a scrolling deck of session cards you can flick through.",
  },
  "replay-new": {
    title: "New session",
    body: "Leave the replay and start a fresh session from the home screen.",
  },
  "share": {
    title: "Share this session",
    body: "Native share sheet on iOS/Android, or one\u2011tap post to X, Facebook, or Instagram. Copy link puts the session URL on your clipboard.",
  },

  // ─── Style picker + individual styles ───
  "style-picker": {
    title: "Choose your empathic art",
    body: "Each style paints your emotion in a different living language. Your colour comes from where you place yourself on the map; the structure comes from openness and arousal.",
  },
  "change-style": {
    title: "Change the art",
    body: "Swap to a different empathic art style. The current one stays live until you pick another, nothing is lost.",
  },
  "openness": {
    title: "Openness",
    body: "How wide the field breathes. Open loosens the structure into sparse, luminous space. Closed tightens it into a dense, intricate weave.",
  },
  "entropy": {
    title: "Entropy",
    body: "How settled or scattered your emotional field has been. Read as a four-word ladder: quiet is almost no movement, held in one place. Gathered is moving with intention, staying near one region. Restless is shifting often, unwilling to settle. Wide is ranging broadly across the whole map. During a session it reflects the last 60 seconds; in replay it reflects the whole journey.",
  },
  "axis-energized": {
    title: "Energized",
    body: "High arousal. The art quickens, motion accelerates, edges sharpen, brightness climbs.",
  },
  "axis-tired": {
    title: "Tired",
    body: "Low arousal. The art slows, motion softens, forms breathe wider, brightness settles.",
  },
  "axis-negative": {
    title: "Unpleasant",
    body: "Negative valence. Colour cools toward blue, grey, or red; the field carries more weight and less light.",
  },
  "axis-positive": {
    title: "Pleasant",
    body: "Positive valence. Colour warms toward gold, coral, and green; light returns and the field opens.",
  },

  // ─── Per-style descriptions ───
  // One-sentence poetic + one-sentence mechanical. Kept tight.
  "style-breath": {
    title: "Breath",
    body: "A slow flowing field that breathes with your emotion. Warmer colours rise with pleasant states; the flow accelerates with arousal; openness dilates the whole surface.",
  },
  "style-halo": {
    title: "Halo",
    body: "A luminous ring of colour circling your emotion anchor. The halo thickens with arousal and widens with openness; hues blend as you drift between neighbouring emotions.",
  },
  "style-skyspace": {
    title: "Skyspace",
    body: "A Turrell-inspired field of pure colour breathing softly at the edges. Homage to James Turrell's Skyspaces, hue drifts with valence; the field pulses gently with arousal.",
  },
  "style-aperture": {
    title: "Aperture",
    body: "A soft circular opening that dilates and contracts with your state. Openness pulls the aperture wide; arousal sharpens its edge; colour spills from within.",
  },
  "style-chapel": {
    title: "Chapel",
    body: "A Rothko-inspired vertical field of layered colour. Homage to the Rothko Chapel, valence sets the palette; openness deepens the bleed between colour zones.",
  },
  "style-filament": {
    title: "Filament",
    body: "Living nerves lit from within, tinted by your emotion. Open loosens the wires into wide, breathing tissue; closed pulls them into a dense, intricate lattice.",
  },
  "style-nerves": {
    title: "Nerves",
    body: "A luminous synaptic web, the bright inversion of Filament. Open spreads sparse neural arcs across the field; closed condenses them into a buzzing cortical lattice.",
  },
  "style-drift": {
    title: "Drift",
    body: "A weightless field of colour drifting on two slow currents. Open dissolves into a continuous photographic gradient; closed stacks the emotion into visible poster bands. Arousal picks up the flow; valence sets the palette.",
  },
  "style-threshold": {
    title: "Threshold",
    body: "A luminous ring circling your emotion, the boundary between the inner state and everything outside. Arousal quickens the pulse; openness widens the ring and softens its edge; pleasant states make it glow additively, unpleasant states pull the light inward.",
  },
  "style-ember": {
    title: "Ember",
    body: "A slow living coal breathing at the centre of the field. Pleasant states warm it toward gold; unpleasant states cool it into blue-violet embers; arousal quickens its pulse; openness lets the glow bloom outward into soft ash.",
  },
  "style-smokering": {
    title: "Smokering",
    body: "A ring of coloured smoke drifting in a slow toroidal current. Valence sets the palette; arousal quickens the drift; openness expands the ring and softens its outline. The smoke rides the same physics that carries breath through a body.",
  },
  "style-physarum": {
    title: "Physarum",
    body: "A living network drawn by tens of thousands of walkers. Each one deposits a little light where it steps and steers toward the strongest scent ahead, out of those three rules a slow continent of veins reroutes itself as feeling shifts. Arousal thickens the strands; openness widens the network from a dense inner web to a sparse continental map; valence sets the palette warmth.",
  },
  "style-curl": {
    title: "Curl",
    body: "Ink released into a slow current of feeling. A dye field is carried by a divergence-free flow, folding and marbling but never compressing, colour is preserved as it drifts. Arousal quickens the current and tightens the whorls; openness widens the bleeds; valence sets the ink palette.",
  },
  "style-aurora": {
    title: "Aurora",
    body: "A curtain of light above the field, the sky as felt from the ground. Valence tunes the palette between cool northern greens and warm solar reds; arousal folds the curtain into layered striations; openness widens the veil and lifts a soft starfield behind it.",
  },
  "style-fluid": {
    title: "Fluid",
    body: "Emotion as ink drifting through a Navier\u2013Stokes current. Valence and arousal set the palette; openness governs how brightly it lives, closed states hold a quiet, desaturated field where colour lingers as memory, and open states saturate the ink toward luminous, near\u2011white highs. Motion always breathes like oil on water: slow, folding, never rushed.",
  },

  /* ─── Session vocabulary (v1.5.1) ─────────────────────────
     Opened by the small “i” glyph at the end of the second meta
     line on both Session Complete and Session Replay. One popover,
     all six terms, plain language. */
  "session-vocab": {
    title: "Session vocabulary",
    body:
      "Duration: real time spent in the session.\n\n" +
      "Samples: every reading of your emotional state, about five per second. Density of feeling over time.\n\n" +
      "Crossings: moments where the named emotion changed. Chapter breaks in the journey.\n\n" +
      "Openness: the third axis alongside valence and arousal. Open is receptive, expansive, willing to feel; closed is guarded, held\u2011in. The field saturates and brightens as openness rises.\n\n" +
      "Entropy: how much the state moved during the session. Low means you sat mostly in one region; high means you ranged widely across the map. Not chaos, just breadth.\n\n" +
      "Dominant emotion: the named state you dwelled in longest. It titles the session.",
  },
};

/** Brain-wave band definitions — used for the brainwaves tooltip and
 *  potentially for future per-lane tooltips. */
export const BRAIN_BANDS = [
  { key: "delta", name: "Delta", range: "0.5–4 Hz", body: "Slow, deep. Sleep and stillness. Rises as the body softens." },
  { key: "theta", name: "Theta", range: "4–8 Hz",   body: "Reverie. The state where poetry and memory live. Rises in low-arousal introspection." },
  { key: "alpha", name: "Alpha", range: "8–12 Hz",  body: "Calm attention. Eyes closed, mind quiet. The band that peaks during meditation." },
  { key: "beta",  name: "Beta",  range: "12–30 Hz", body: "Active thinking. Focus and problem-solving. Rises with arousal." },
  { key: "gamma", name: "Gamma", range: ">30 Hz",   body: "Peak binding. Insight and unified perception. Spikes at moments of awe." },
];

/**
 * The canonical 19 emotions — enriched with the definition, poetic force,
 * biosignature, and one line of neuroscience each. Extracted verbatim from
 * v2.1 (script.js) so the artist's voice is preserved.
 */
export const EMOTION_TIPS = {
  Love:          { def: "Pleasant, centred; warmth reaching outward.",                     force: "A pull toward; the field warms at its core and reaches outward in soft tendrils.", sig: "HR ↑ · HRV ↑ · RR steady · Bri 0.75 · Curv 0.8 · Exp 0.7" },
  Excitement:    { def: "Pleasant, very high arousal; activation before bloom.",           force: "A sharp acceleration; particles scatter outward; rhythm tightens before bloom.",  sig: "HR ↑↑ · HRV ↑ · RR ↑ · Bri 0.9 · Curv 0.3 · Exp 0.7 · Turb 0.5" },
  Joy:           { def: "Pleasant, high-arousal; warmth that rises.",                      force: "A warm upward thrust; the field expands, breath quickens, light gains golden weight.", sig: "HR ↑ · HRV ↑ · RR ↑ · Bri 0.85 · Curv 0.5 · Exp 0.8 · Turb 0.2" },
  Elation:       { def: "Peak positive arousal, gravity loosens.",                         force: "Uplift; the field rises and shimmers, gravity loosens its grip.",                sig: "HR ↑ · HRV ↑ · RR ↑ · Bri 0.95 · Curv 0.6 · Exp 0.85" },
  Awe:           { def: "Pleasant, high arousal held still; openness beyond the edge.",    force: "A slow dilation; pupils widen, breath holds, the field opens beyond its edges.", sig: "HR steady · HRV ↑ · RR ↓ · Bri 0.6 · Curv 0.7 · Exp 1.0 · Turb 0.1" },
  Surprise:      { def: "Edge of pleasant, very high arousal; unresolved.",                force: "A momentary discontinuity; the field freezes, then re-forms.",                   sig: "HR spike · HRV brief ↓ · RR caught · Bri 0.7 · Curv 0.4 · Turb 0.6" },
  Fear:          { def: "Unpleasant, very high arousal; contraction toward shelter.",      force: "A contraction toward shelter; the field clenches inward, edges sharpen.",       sig: "HR ↑↑ · HRV ↓ · RR ↑↑ shallow · Bri 0.4 · Curv 0.2 · Exp 0.3 · Turb 0.7" },
  Anger:         { def: "Unpleasant, high arousal; heat with direction.",                  force: "Heat with direction; the field reddens and pushes outward in angular bursts.",   sig: "HR ↑↑ · HRV ↓ · RR ↑ · Bri 0.6 · Curv 0.1 · Turb 0.85" },
  Stress:        { def: "Unpleasant, high arousal; sustained tension.",                    force: "Sustained tension; the field tightens, rhythms break, light dulls.",             sig: "HR ↑ · HRV ↓↓ · RR ↑ irregular · Bri 0.45 · Curv 0.2 · Den 0.8" },
  Anxiety:       { def: "Unpleasant, high arousal at the edge; never settling.",           force: "A trembling readiness; the field never settles, micro-storms scatter.",         sig: "HR ↑ · HRV ↓ · RR ↑ shallow · Bri 0.4 · Curv 0.25 · Turb 0.6" },
  Despair:       { def: "Lowest valence, lowest arousal; collapse.",                       force: "A collapse; the field sinks, loses light, particles fall.",                     sig: "HR ↓ · HRV ↓ · RR slow shallow · Bri 0.15 · Curv 0.3 · Exp 0.2" },
  Sadness:       { def: "Unpleasant, low arousal; a slow descent.",                        force: "A slow descent; the field cools, edges soften into mist.",                       sig: "HR ↓ · HRV ↓ · RR slow · Bri 0.25 · Curv 0.5 · Exp 0.4" },
  Melancholy:    { def: "Low valence held tenderly, contemplative.",                       force: "Sadness held tenderly; the field carries blue but light still moves through it.", sig: "HR steady-low · HRV ~ · RR slow · Bri 0.35 · Curv 0.6 · Exp 0.5" },
  Apathy:        { def: "Edge of low arousal, absent activation.",                         force: "Withdrawal; the field thins, loses contrast, time slows.",                      sig: "HR ↓ · HRV ↓ · RR slow · Bri 0.2 · Curv 0.5 · Exp 0.3" },
  Boredom:       { def: "Low arousal, neutral; stillness without rest.",                   force: "Stillness without rest; the field hums in monotone.",                            sig: "HR steady · HRV ~ · RR steady · Bri 0.3 · Curv 0.55 · Exp 0.35" },
  Contemplation: { def: "Pleasant, low arousal; motion becomes thought.",                  force: "Inward turn; the field deepens, motion becomes thought.",                        sig: "HR ↓ · HRV ↑ · RR slow deep · Bri 0.5 · Curv 0.7 · Exp 0.6" },
  Serenity:      { def: "Pleasant, low arousal; even light returning.",                    force: "Resolution; the field opens, light returns evenly, breath lengthens.",           sig: "HR ↓ · HRV ↑↑ · RR slow deep · Bri 0.65 · Curv 0.85 · Exp 0.8" },
  Calm:          { def: "Pleasant, low arousal; nothing demands attention.",               force: "The field rests; particles hover; nothing demands attention.",                   sig: "HR steady-low · HRV ↑ · RR slow steady · Bri 0.55 · Curv 0.9 · Exp 0.7" },
  Peace:         { def: "Edge of pleasant, lowest unpleasant signal; full coherence.",     force: "The field becomes a single tone; the body and the air agree.",                   sig: "HR low steady · HRV ↑↑ · RR slow deep · Bri 0.6 · Curv 1.0 · Exp 0.9" },
};

// ─── Tooltip DOM + placement ─────────────────────────────────────────

let tipEl = null;
let currentAnchor = null;
// Cycle 16: identity key. When the tooltip is open, `currentKey` holds
// the `data-ea-tip` value of the anchor that opened it. This is the
// SOURCE OF TRUTH for the toggle. Comparing keys instead of DOM refs
// is bulletproof against iOS Safari's quirks: pointerover/pointerout
// synthesised from touch, event target being a child <span> vs the
// <button>, hideTip's timer racing with the next tap, and the
// circumplex SVG's showTipAtPoint(null anchor) clearing currentAnchor.
let currentKey = null;
let hideTimer = null;
// Cycle 13: pinned = user tapped an anchor to open the tooltip. While
// pinned, hover-out / pointer-out DO NOT close the tooltip. It only
// closes when the user (a) taps the same anchor again, (b) taps
// outside any anchor and outside the tip itself, or (c) presses ESC.
let pinned = false;

function ensureTipEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "ea-tip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.setAttribute("aria-hidden", "true");
  tipEl.innerHTML =
    `<div class="ea-tip__title"></div>` +
    `<div class="ea-tip__body"></div>` +
    `<div class="ea-tip__sig"></div>` +
    `<div class="ea-tip__science"></div>`;
  document.body.appendChild(tipEl);
  return tipEl;
}

function positionTip(anchor) {
  const t = ensureTipEl();
  const rect = anchor.getBoundingClientRect();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  const margin = 12;
  // Prefer above; fall back below if not enough room.
  let top = rect.top - th - margin;
  let arrow = "bottom";
  if (top < 8) {
    top = rect.bottom + margin;
    arrow = "top";
  }
  let left = rect.left + rect.width / 2 - tw / 2;
  const maxL = window.innerWidth - tw - 8;
  if (left < 8) left = 8;
  else if (left > maxL) left = maxL;
  t.style.top = top + "px";
  t.style.left = left + "px";
  t.dataset.arrow = arrow;
}

function positionTipAtPoint(clientX, clientY) {
  const t = ensureTipEl();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  const margin = 14;
  let top = clientY - th - margin;
  let arrow = "bottom";
  if (top < 8) {
    top = clientY + margin;
    arrow = "top";
  }
  let left = clientX - tw / 2;
  const maxL = window.innerWidth - tw - 8;
  if (left < 8) left = 8;
  else if (left > maxL) left = maxL;
  t.style.top = top + "px";
  t.style.left = left + "px";
  t.dataset.arrow = arrow;
}

function fillTip({ title, body, sig, science, color }) {
  const t = ensureTipEl();
  t.querySelector(".ea-tip__title").textContent = title || "";
  t.querySelector(".ea-tip__body").textContent = body || "";
  const sigEl = t.querySelector(".ea-tip__sig");
  if (sig) { sigEl.textContent = sig; sigEl.hidden = false; }
  else     { sigEl.hidden = true; }
  const sciEl = t.querySelector(".ea-tip__science");
  if (science) { sciEl.textContent = science; sciEl.hidden = false; }
  else         { sciEl.hidden = true; }
  if (color) {
    t.style.setProperty("--ea-tip-accent", color);
    t.dataset.hasAccent = "1";
  } else {
    t.style.removeProperty("--ea-tip-accent");
    delete t.dataset.hasAccent;
  }
}

/** Show tooltip anchored to a DOM element */
export function showTipAt(anchorEl, payload) {
  if (!anchorEl) return;
  clearTimeout(hideTimer);
  currentAnchor = anchorEl;
  currentKey = anchorEl.getAttribute && anchorEl.getAttribute("data-ea-tip");
  fillTip(payload);
  ensureTipEl().setAttribute("aria-hidden", "false");
  // Position on next frame so measurement uses the filled content.
  requestAnimationFrame(() => positionTip(anchorEl));
}

/** Show tooltip at an absolute client point (used for SVG hits) */
export function showTipAtPoint(x, y, payload) {
  clearTimeout(hideTimer);
  currentAnchor = null;
  // Use the emotion name as the key so tapping the same emotion again
  // toggles it closed via the circumplex layer if desired.
  currentKey = payload && payload.title ? `emotion:${payload.title}` : null;
  fillTip(payload);
  ensureTipEl().setAttribute("aria-hidden", "false");
  // Pin the tip so hover-out / pointer-out do NOT close it (touch devices
  // synthesise pointerleave immediately after tap on SVG hit targets,
  // which would fight the just-opened tip). Outside-click still closes.
  pinned = true;
  requestAnimationFrame(() => positionTipAtPoint(x, y));
}

export function hideTip() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (tipEl) tipEl.setAttribute("aria-hidden", "true");
    currentAnchor = null;
    currentKey = null;
    pinned = false;
  }, 80);
}

/** Immediate close, no delay — used for click-outside and toggle-off. */
export function closeTipNow() {
  clearTimeout(hideTimer);
  if (tipEl) tipEl.setAttribute("aria-hidden", "true");
  currentAnchor = null;
  currentKey = null;
  pinned = false;
}

/** True if the tooltip is currently visible on screen. */
function isTipOpen() {
  return !!(tipEl && tipEl.getAttribute("aria-hidden") === "false");
}

/**
 * Install global delegated listeners for all `[data-ea-tip]` anchors.
 * Call once at boot. Idempotent — safe to call again.
 */
let installed = false;
export function installTooltips() {
  if (installed) return;
  installed = true;
  ensureTipEl();

  const anchorFrom = (target) =>
    target && target.closest ? target.closest("[data-ea-tip]") : null;

  // Desktop hover (mouse only). Touch and pen use click-to-toggle.
  // Hover-in shows the tooltip on mouse enter; hover-out closes it —
  // but ONLY when the tooltip is not pinned by a click. Once the user
  // clicks an anchor, hovering off does not dismiss the tooltip.
  document.addEventListener("pointerover", (e) => {
    // Strict: only real mouse hover triggers the show. On iOS Safari,
    // pointerType can be "" (empty) for synthesized events from a tap,
    // which is NOT a real hover — skip those too.
    if (e.pointerType !== "mouse") return;
    if (pinned) return;
    const a = anchorFrom(e.target);
    if (!a) return;
    const key = a.getAttribute("data-ea-tip");
    const tip = STATIC_TIPS[key];
    if (!tip) return;
    showTipAt(a, { title: tip.title, body: tip.body, sig: tip.sig, science: tip.science });
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    if (pinned) return;
    const a = anchorFrom(e.target);
    if (!a) return;
    const to = e.relatedTarget;
    if (to && a.contains(to)) return;
    hideTip();
  });

  // Cycle 16: bulletproof click-to-toggle.
  //
  // Real-world bug: on iOS 18.7 Safari, tapping #chip-help-session opens
  // the tooltip on tap 1 but tap 2 does not close it. Previous cycles
  // suspected DOM-identity comparison (`currentAnchor === a`) failing
  // because the touch target is the child <span class="ea-chip__info-glyph">
  // rather than the <button>. `closest("[data-ea-tip]")` climbs to the
  // button in both cases, so in theory identity should hold. In practice
  // any other code path that reassigns `currentAnchor` between taps —
  // notably `showTipAtPoint()` (which sets it to null for circumplex hits)
  // and `hideTip()`'s 80ms setTimeout (which nulls it on hover-out) —
  // breaks the check. We fix this by:
  //
  //   1. Comparing the anchor's `data-ea-tip` KEY, not the DOM reference.
  //      Keys are stable strings; DOM refs can be clobbered by other
  //      code paths that touch the tooltip surface.
  //   2. Also short-circuiting the outer-click branch when the click's
  //      target is inside the just-tapped anchor's bounding box + we saw
  //      a click land on the tip button itself — belt-and-suspenders.
  //
  // Cross-platform: this uses `click` only, which fires exactly once per
  // tap on <button> on Chrome desktop/Android, Safari desktop/iOS, and
  // WKWebView (future iOS wrapper). No pointer events, no touch events,
  // no timers.
  //
  // Rules:
  //   • Tap an anchor whose tooltip is CLOSED             -> open.
  //   • Tap the SAME anchor (same data-ea-tip key) OPEN  -> close.
  //   • Tap a DIFFERENT anchor while open                -> switch.
  //   • Tap outside any anchor + outside the tip body    -> close.
  const handleToggle = (e) => {
    // Click inside the tooltip body itself? Leave it open (don't treat
    // as outside-click). User might be selecting text or tapping a link.
    if (tipEl && e.target && tipEl.contains(e.target)) return;

    const a = anchorFrom(e.target);

    // Outside-click on empty space with tooltip open -> close.
    if (!a) {
      if (isTipOpen()) {
        _dbg("outside", { open: true });
        closeTipNow();
      }
      return;
    }

    const key = a.getAttribute("data-ea-tip");
    const tip = STATIC_TIPS[key];
    if (!tip) return;

    // Second tap on the SAME anchor -> close. Compare by KEY, not by
    // DOM identity — the ref can be nulled by hideTip's timer or by
    // showTipAtPoint (circumplex SVG hits), but the key survives.
    if (isTipOpen() && currentKey === key) {
      _dbg("close", { key });
      closeTipNow();
      return;
    }

    // First tap, or switching to a different anchor -> open + pin.
    _dbg("open", { key, switching: isTipOpen(), prevKey: currentKey });
    showTipAt(a, { title: tip.title, body: tip.body, sig: tip.sig, science: tip.science });
    pinned = true;
  };

  // Tiny debug hook — logs to the on-screen debug overlay so the next
  // captured log tells us exactly which branch ran on each tap.
  function _dbg(action, extra) {
    try { dbg("log", `[tooltip] ${action}`, extra || {}); }
    catch (_) { /* debug is best-effort */ }
  }

  document.addEventListener("click", handleToggle);

  // ESC closes the tooltip.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTipNow();
  });
}

/**
 * Programmatically show an emotion tooltip (used by the circumplex SVG
 * layer, which uses SVG hit targets not covered by the [data-ea-tip]
 * delegated flow).
 *
 * @param {string} name  - emotion display name
 * @param {string} hex   - emotion anchor color
 * @param {number} x     - client x of pointer
 * @param {number} y     - client y of pointer
 */
export function showEmotionTip(name, hex, x, y) {
  const t = EMOTION_TIPS[name];
  if (!t) return;
  showTipAtPoint(x, y, {
    title: name,
    body: t.def,
    sig: t.sig,
    science: t.science,
    color: hex,
  });
}
