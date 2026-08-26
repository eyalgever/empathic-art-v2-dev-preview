/**
 * Empathic Art -- log-story
 *
 * Rules-based narrative composer for the enriched Muse session log.
 * Every entry the Session Replay Zen overlay renders is a small block with
 * four layers: what (block purpose), signal (band powers + valence/arousal),
 * emotion (label + colour swatch + colour name), and story (one or two
 * sentences of plain-English narrative on crossings).
 *
 * This module is deterministic. Given the same inputs it always produces
 * the same words. No external calls, no randomness, no LLM.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * Human-facing colour names for the emotion palette. Each name was chosen
 * to match what the hex actually renders as, not a poetic invention. When
 * we say "sage green" we mean the colour a sage leaf is; the reader can
 * decode the palette from the log without opening the app.
 *
 * Keyed by lowercased emotion name so the map is stable across casing.
 */
export const COLOUR_NAMES = {
  "love":          "terracotta rose",
  "excitement":    "ember orange",
  "joy":           "gold amber",
  "elation":       "citrine yellow",
  "awe":           "honey ochre",
  "surprise":      "mist blue-grey",
  "fear":          "oxblood red",
  "anger":         "ember red",
  "stress":        "rust umber",
  "anxiety":       "plum shadow",
  "despair":       "midnight indigo",
  "sadness":       "deep denim",
  "melancholy":    "slate violet",
  "apathy":        "ashen grey",
  "boredom":       "stone grey",
  "contemplation": "teal shadow",
  "serenity":      "sage green",
  "calm":          "soft moss",
  "peace":         "olive light",
};

/** Return the colour name for an emotion, or a graceful fallback. */
export function colourNameFor(emotionName) {
  const key = String(emotionName || "").toLowerCase().trim();
  return COLOUR_NAMES[key] || "unnamed hue";
}

/**
 * One-line plain-English explanation of what a wizard block is meant to
 * reveal in the EEG. Reused verbatim from the wizard's own copy so the
 * log's "what" layer matches what the user was asked to do.
 */
export const BLOCK_WHAT = {
  "neutral":         "baseline rest -- calibrates the user's own resting rhythm.",
  "eyes closed":     "alpha rises when eyes close and the visual cortex idles.",
  "eyes open":       "alpha drops when the eyes take in the room again.",
  "deep breathing":  "slow paced breathing lifts theta and lowers arousal.",
  "thinking hard":   "mental effort pumps beta and gamma against the calmer bands.",
  "positive memory": "recalling something loved raises left-frontal activation.",
  "gap":             "brief pause between blocks -- signal drifts back toward baseline.",
};

/** Look up the "what" layer for a state label. */
export function whatFor(state) {
  const key = String(state || "").toLowerCase().trim();
  return BLOCK_WHAT[key] || "";
}

/**
 * Compose the story sentence for a crossing from prior -> next emotion.
 * The story is assembled from three templated fragments -- a trigger
 * clause, a movement clause, and a colour clause -- then joined so the
 * whole sentence reads like a paragraph a curator would write about
 * the moment.
 *
 * signals is an object of deltas: { valence, arousal, openness, alpha,
 * beta, theta } where each number is the change since the last entry.
 * Any absent field is treated as zero.
 */
export function storyFor(priorEmotion, nextEmotion, signals) {
  const s = signals || {};
  const dv = s.valence || 0;
  const da = s.arousal || 0;
  const daL = s.alpha || 0;
  const dbe = s.beta || 0;
  const dth = s.theta || 0;

  // Trigger clause -- what moved in the signal.
  const triggerParts = [];
  if (Math.abs(daL) > 0.04) triggerParts.push(daL > 0 ? "Alpha rose" : "Alpha softened");
  if (Math.abs(dbe) > 0.04) triggerParts.push(dbe > 0 ? "beta lifted" : "beta calmed");
  if (Math.abs(dth) > 0.04) triggerParts.push(dth > 0 ? "theta deepened" : "theta thinned");
  if (triggerParts.length === 0) {
    // Fall back to the derived axis change if bands did not move meaningfully.
    if (Math.abs(dv) > Math.abs(da)) {
      triggerParts.push(dv > 0 ? "Valence turned positive" : "Valence dipped negative");
    } else {
      triggerParts.push(da > 0 ? "Arousal lifted" : "Arousal eased");
    }
  }
  const trigger = triggerParts.slice(0, 2).join(", ") + ".";

  // Movement clause -- where the dot went on the circumplex.
  const movement = priorEmotion && nextEmotion
    ? `The dot drifted out of ${priorEmotion} and settled into ${nextEmotion}.`
    : `The dot settled into ${nextEmotion || "a new state"}.`;

  // Colour clause -- how the artwork answered.
  const colour = nextEmotion
    ? `The artwork warmed toward ${colourNameFor(nextEmotion)}.`
    : "";

  return [trigger, movement, colour].filter(Boolean).join(" ");
}

/**
 * Compose the concise trigger phrase used on the CROSSING entry's trigger
 * line -- the tight "valence -0.08 -> +0.22 (crossed the calm threshold)"
 * form under the story sentence.
 */
export function triggerFor(priorEmotion, nextEmotion, signals) {
  const s = signals || {};
  const dv = s.valence || 0;
  const da = s.arousal || 0;
  const dominantAxis = Math.abs(dv) > Math.abs(da) ? "valence" : "arousal";
  const dominantDelta = dominantAxis === "valence" ? dv : da;
  const from = (dominantAxis === "valence" ? s.valencePrev : s.arousalPrev) || 0;
  const to   = (dominantAxis === "valence" ? s.valenceNow  : s.arousalNow)  || 0;
  const dir  = dominantDelta > 0 ? "rose" : "fell";
  const fromS = (from >= 0 ? "+" : "") + from.toFixed(2);
  const toS   = (to   >= 0 ? "+" : "") + to.toFixed(2);
  return `${dominantAxis} ${fromS} -> ${toS} (${dominantAxis} ${dir})`;
}

/** Round to two decimals with an explicit sign so numbers align in the log. */
export function fmtSigned(n) {
  const v = Number(n);
  if (!isFinite(v)) return "  0.00";
  const s = (v >= 0 ? "+" : "") + v.toFixed(2);
  return s.padStart(6, " ");
}

/** Round to two decimals unsigned, right-padded so columns align. */
export function fmtUnsigned(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return " 0.00";
  return v.toFixed(2).padStart(5, " ");
}
