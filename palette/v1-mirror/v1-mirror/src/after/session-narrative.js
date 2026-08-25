/* ─────────────────────────────────────────────────────────────────────
   src/after/session-narrative.js — v1.5.1
   ─────────────────────────────────────────────────────────────────────

   Reads a completed session record and returns two things:

     1) a compact metrics summary — openness %, entropy bucket,
        crossings count, sample count, duration, dominant emotion,
        and a few derived signals used by the narrative,

     2) a two-sentence narrative caption written in second person,
        past tense, that reads the session back to the user like
        session credits.

   Everything is computed deterministically from the sample stream.
   No runtime LLM calls — this file is safe to run inside the
   published pplx.app sandbox.

   Public API
   ────────────
     computeSessionMetrics(session) → {
       samples, crossings, durationMs, durationLabel,
       meanOpenness01, opennessPercent, opennessLabel,
       entropyScore, entropyLabel, entropyDescriptor,
       dominant: { name, hex, dwellRatio },
       familyDrift,   // "adjacent" | "migratory" | "still"
       arcLabel,      // "opened toward the end" | "closed toward the end" | "held its shape" | ...
       standoutMoment // { kind, label, seconds }
     }

     buildSessionNarrative(session) → "You settled into Sadness for
       four and a half minutes, drifting through eighteen adjacent
       states — mostly Melancholy and Contemplation, with a brief
       lift toward Peace near the end. The field stayed mostly
       closed, and your movement across the map was quiet rather
       than restless."

   The narrative is templated with slots derived from the metrics.
   ───────────────────────────────────────────────────────────────────── */

/** Emotion family map — used to detect "adjacent" drift vs migratory.
 *  Grouped by valence/arousal quadrant with a couple of neighbours
 *  reaching across low-arousal transitions. Kept intentionally
 *  coarse — this is a narrative aid, not an ontology. */
const EMOTION_FAMILY = {
  // High-arousal negative
  Anger: "storm", Fear: "storm", Anxiety: "storm", Stress: "storm",
  Panic: "storm", Alarm: "storm", Frustration: "storm", Rage: "storm",
  // High-arousal positive
  Elation: "bright", Joy: "bright", Excitement: "bright", Surprise: "bright",
  Delight: "bright", Awe: "bright",
  // Low-arousal positive
  Love: "warm", Peace: "warm", Serenity: "warm", Calm: "warm",
  Contentment: "warm", Tenderness: "warm", Gratitude: "warm",
  // Low-arousal negative
  Sadness: "quiet", Melancholy: "quiet", Despair: "quiet", Grief: "quiet",
  Loneliness: "quiet", Boredom: "quiet", Apathy: "quiet",
  // Reflective / neutral
  Contemplation: "reflective", Nostalgia: "reflective", Wonder: "reflective",
  Curiosity: "reflective", Interest: "reflective", Longing: "reflective",
};

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function numberToWord(n) {
  if (!Number.isFinite(n)) return String(n);
  const k = Math.round(n);
  if (k >= 0 && k < NUMBER_WORDS.length) return NUMBER_WORDS[k];
  if (k > 20 && k < 100) {
    const tens = Math.floor(k / 10) * 10;
    const ones = k - tens;
    const TENS = { 20: "twenty", 30: "thirty", 40: "forty", 50: "fifty",
                   60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety" };
    return ones === 0 ? TENS[tens] : `${TENS[tens]}-${NUMBER_WORDS[ones]}`;
  }
  return String(k);
}

/** Format a duration into a spoken phrase — "four and a half minutes",
 *  "just over a minute", "eight minutes", etc. Approximate on purpose:
 *  the narrative is prose, not a stopwatch. */
function durationPhrase(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 45) return "under a minute";
  const min = totalSec / 60;
  const whole = Math.floor(min);
  const frac = min - whole;
  if (whole === 0) return "under a minute";
  if (whole === 1 && frac < 0.25) return "just over a minute";
  if (whole === 1 && frac >= 0.75) return "nearly two minutes";
  if (whole === 1) return "a minute and a half";
  if (frac < 0.15) return `${numberToWord(whole)} minutes`;
  if (frac < 0.4)  return `${numberToWord(whole)} and a bit minutes`;
  if (frac < 0.65) return `${numberToWord(whole)} and a half minutes`;
  if (frac < 0.85) return `nearly ${numberToWord(whole + 1)} minutes`;
  return `${numberToWord(whole + 1)} minutes`;
}

/** Short duration label for the meta line — "04:36" style. */
export function formatDurationLabel(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Bucket a fraction into a coarse word. */
function opennessLabelFrom(p) {
  if (p < 25)  return "mostly closed";
  if (p < 45)  return "held-in";
  if (p < 55)  return "balanced";
  if (p < 75)  return "mostly open";
  return "wide open";
}

/** Entropy — how much the state moved. Combines two signals:
 *   1) fraction of unique named emotions relative to session length,
 *   2) mean per-step path length in (v,a) space.
 *  Bucketed into a four-word ladder: quiet, gathered, restless, wide. */
export function entropyMetrics(samples) {
  if (!samples || samples.length < 2) {
    return { score: 0, label: "quiet", descriptor: "held perfectly still" };
  }
  const uniqueNames = new Set();
  let pathSum = 0;
  let steps = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].label) uniqueNames.add(samples[i].label);
    if (i > 0) {
      const a = samples[i - 1], b = samples[i];
      const dv = (b.v - a.v);
      const da = (b.a - a.a);
      pathSum += Math.sqrt(dv * dv + da * da);
      steps++;
    }
  }
  const meanStep = steps ? pathSum / steps : 0;

  // Normalise: number of unique named states, scaled to session length
  // (a short session with 3 uniques is high entropy, a long session with
  // 3 uniques is low). Cap unique names at ~15 to avoid runaway scores.
  const durMin = Math.max(0.5, (samples[samples.length - 1].t - samples[0].t) / 60000);
  const uniqueDensity = Math.min(uniqueNames.size / (durMin * 3), 1);   // 0..1
  const motionDensity = Math.min(meanStep * 25, 1);                    // 0..1
  const score = 0.5 * uniqueDensity + 0.5 * motionDensity;             // 0..1

  // Four-word ladder: quiet, gathered, restless, wide. Ordered by how
  // much movement across the map the session showed.
  //   quiet     : almost no movement, held in one place
  //   gathered  : moved with intention, stayed near one region
  //   restless  : shifted often, unwilling to settle in one spot
  //   wide      : ranged broadly across the whole map
  let label, descriptor;
  if (score < 0.25)      { label = "quiet";    descriptor = "the field held almost perfectly still"; }
  else if (score < 0.50) { label = "gathered"; descriptor = "the movement stayed gathered around one region"; }
  else if (score < 0.75) { label = "restless"; descriptor = "the state shifted restlessly, unwilling to settle"; }
  else                   { label = "wide";     descriptor = "the journey ranged widely across the whole map"; }

  return { score, label, descriptor };
}

/** Compute all metrics needed by the meta line and the narrative. */
export function computeSessionMetrics(session) {
  const samples = Array.isArray(session?.samples) ? session.samples : [];
  const crossings = Array.isArray(session?.crossings) ? session.crossings : [];
  const durationMs = Number.isFinite(session?.durationMs)
    ? session.durationMs
    : (samples.length >= 2 ? (samples[samples.length - 1].t - samples[0].t) : 0);

  // ── openness ─────────────────────────────────────────────
  let meanO = 0;
  for (const s of samples) meanO += (typeof s.o === "number" ? s.o : 0);
  meanO = samples.length ? meanO / samples.length : 0;
  const meanOpenness01 = (meanO + 1) / 2;                 // -1..1 → 0..1
  const opennessPercent = Math.round(meanOpenness01 * 100);
  const opennessLabel = opennessLabelFrom(opennessPercent);

  // ── entropy ──────────────────────────────────────────────
  const ent = entropyMetrics(samples);

  // ── dominant + dwell ─────────────────────────────────────
  const dwell = new Map();
  for (const s of samples) {
    if (!s.label) continue;
    dwell.set(s.label, (dwell.get(s.label) || 0) + 1);
  }
  const sortedDwell = [...dwell.entries()].sort((a, b) => b[1] - a[1]);
  const totalSamp = samples.length || 1;
  const dominantName = session?.dominantEmotion?.name
    || (sortedDwell.length ? sortedDwell[0][0] : "");
  const dominantHex = session?.dominantEmotion?.hex || "";
  const dominantDwellRatio = sortedDwell.length
    ? (dwell.get(dominantName) || sortedDwell[0][1]) / totalSamp
    : 0;

  // Second and third most-dwelled (used for "mostly X and Y" phrase)
  const secondary = sortedDwell.slice(1, 3).map(([n]) => n).filter(n => n && n !== dominantName);

  // ── family drift ─────────────────────────────────────────
  // Are we mostly moving within a single family, or crossing families?
  const dominantFamily = EMOTION_FAMILY[dominantName] || null;
  let inFamily = 0, outFamily = 0;
  for (const [name, count] of dwell.entries()) {
    if (EMOTION_FAMILY[name] === dominantFamily) inFamily += count;
    else outFamily += count;
  }
  const familyDrift = crossings.length === 0
    ? "still"
    : (inFamily / (inFamily + outFamily || 1) > 0.65 ? "adjacent" : "migratory");

  // ── openness arc ─────────────────────────────────────────
  // Compare first-third mean openness to last-third mean openness.
  let arcLabel = "held its shape";
  if (samples.length >= 12) {
    const third = Math.floor(samples.length / 3);
    let a = 0, b = 0;
    for (let i = 0; i < third; i++) a += samples[i].o || 0;
    for (let i = samples.length - third; i < samples.length; i++) b += samples[i].o || 0;
    a /= third; b /= third;
    const diff = b - a;
    if (diff > 0.20) arcLabel = "opened toward the end";
    else if (diff < -0.20) arcLabel = "closed toward the end";
    else if (Math.abs(meanO) < 0.15) arcLabel = "hovered near the threshold of opening";
  }

  // ── standout moment ──────────────────────────────────────
  // Pick the single most-notable moment: the deepest openness peak
  // OR the longest continuous dwell in a single named state.
  let standoutMoment = null;
  if (samples.length >= 4) {
    // Deepest opening
    let peakIdx = 0, peakVal = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      if ((samples[i].o || 0) > peakVal) { peakVal = samples[i].o; peakIdx = i; }
    }
    const peakT = samples[peakIdx].t - samples[0].t;
    const peakSeconds = Math.round(peakT / 1000);
    if (peakVal >= 0.6) {
      standoutMoment = {
        kind: "opening",
        label: samples[peakIdx].label,
        seconds: peakSeconds,
      };
    } else if (dominantDwellRatio >= 0.6) {
      standoutMoment = {
        kind: "dwell",
        label: dominantName,
        seconds: Math.round((dominantDwellRatio * durationMs) / 1000),
      };
    }
  }

  return {
    samples: samples.length,
    crossings: crossings.length,
    durationMs,
    durationLabel: formatDurationLabel(durationMs),
    meanOpenness01,
    opennessPercent,
    opennessLabel,
    entropyScore: ent.score,
    entropyLabel: ent.label,
    entropyDescriptor: ent.descriptor,
    dominant: { name: dominantName, hex: dominantHex, dwellRatio: dominantDwellRatio },
    secondary,
    familyDrift,
    arcLabel,
    standoutMoment,
  };
}

/** Compose the meta line for the Session Complete + Session Replay
 *  headers. Returns two strings so the layer above can wrap them into
 *  two separate <span>s if it wants a two-line meta. */
export function formatMetaLines(session) {
  const m = computeSessionMetrics(session);
  const when = new Date(session.startedAt).toLocaleString();
  const line1 = `${when}  ·  ${m.durationLabel}  ·  ${m.samples} samples`;
  const openBit = `${m.opennessPercent}% open`;
  const domBit = m.dominant.name ? `  ·  ${m.dominant.name}` : "";
  const line2 = `${m.crossings} crossings  ·  ${openBit}  ·  ${m.entropyLabel} entropy${domBit}`;
  return { line1, line2, metrics: m };
}

/** Compose a two-sentence narrative caption from the metrics.
 *  The template picks slots based on the session's shape so no two
 *  sessions read identically. Sentences are kept short. */
export function buildSessionNarrative(session) {
  const m = computeSessionMetrics(session);
  const dur = durationPhrase(m.durationMs);
  const dom = m.dominant.name || "an unnamed state";
  const cx  = numberToWord(m.crossings);

  // ─── Sentence 1: the arc ───────────────────────────────────
  let s1;
  if (m.crossings === 0) {
    s1 = `You held ${dom} for ${dur}, without crossing into another state.`;
  } else if (m.familyDrift === "adjacent" && m.secondary.length) {
    const near = m.secondary.length >= 2
      ? `mostly ${m.secondary[0]} and ${m.secondary[1]}`
      : `mostly ${m.secondary[0]}`;
    s1 = `You settled into ${dom} for ${dur}, drifting through ${cx} adjacent states: ${near}.`;
  } else if (m.familyDrift === "migratory") {
    s1 = `You began in ${dom} and travelled through ${cx} distinct emotional territories across ${dur}.`;
  } else {
    s1 = `You spent ${dur} circling ${dom}, moving through ${cx} named states along the way.`;
  }

  // ─── Sentence 2: openness + entropy ──────────────────────
  const opennessBit =
      m.opennessPercent < 25 ? "The field stayed mostly closed"
    : m.opennessPercent < 45 ? "The field remained held-in"
    : m.opennessPercent < 55 ? "The field held near its threshold"
    : m.opennessPercent < 75 ? "The field opened out generously"
    : "The field ran wide open";

  let arcBit = "";
  if (m.arcLabel === "opened toward the end")   arcBit = ", loosening toward the end";
  else if (m.arcLabel === "closed toward the end") arcBit = ", drawing inward toward the end";
  else if (m.arcLabel === "hovered near the threshold of opening") arcBit = ", hovering near the edge of opening";

  // The descriptor already starts with "the …" — keep it. Prefix the
  // pronoun that reads naturally after the opennessBit + arcBit clause.
  const s2 = `${opennessBit}${arcBit}, and ${m.entropyDescriptor}.`;

  return `${s1} ${s2}`;
}

/** Build the tooltip vocabulary body. One popover, all six terms. */
export const SESSION_VOCAB_TOOLTIP = {
  title: "Session vocabulary",
  body: [
    "Duration is the real time spent in the session.",
    "Samples are every reading of your emotional state, about five per second. Density of feeling over time.",
    "Crossings are moments where the named emotion changed. Chapter breaks in the journey.",
    "Openness is the third axis alongside valence and arousal. Open is receptive, expansive, willing to feel; closed is guarded, held-in. The field saturates and brightens as openness rises.",
    "Entropy is how much the state moved during the session. Four bands: quiet (held in one place), gathered (moved near one region), restless (shifted often without settling), wide (ranged broadly across the map). Not chaos, just breadth.",
    "Dominant emotion is the named state you dwelled in longest. It titles the session.",
  ].join("\n"),
};
