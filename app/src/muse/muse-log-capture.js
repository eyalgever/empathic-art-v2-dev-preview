/**
 * Empathic Art -- Muse session log capture
 *
 * A quiet passenger on top of the live-adapter's debug readout. Records every
 * "[muse] ..." console line to an in-memory ring buffer. The calibration
 * wizard (see muse-wizard.js) writes block-boundary "STATE:" entries into the
 * same buffer, so the resulting log is a continuous stream of metric samples
 * bracketed by which of the six wizard blocks each sample belongs to.
 *
 * Downstream the buffer is exposed two ways:
 *
 *   1. copy() serialises the whole transcript to plain text for a chat paste.
 *   2. tail(n) returns the last n formatted lines, which the terminal-style
 *      overlay renders on top of the fluid visuals in both live and replay.
 *
 * Rules:
 *   1. Passive. Never interferes with the adapter or the normal emission loop.
 *      Bob's original console.log still fires; we shadow-copy from it.
 *   2. Bounded. Ring buffer of 6000 entries (about an hour at 1 Hz).
 *   3. Text-only. No fancy formatting. What lands in the buffer is what the
 *      overlay shows and what the paste contains.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { whatFor, storyFor, triggerFor, colourNameFor, fmtSigned, fmtUnsigned } from "./log-story.js?v=1.6.4.23";
import { EMOTIONS } from "../palette/emotion-palette.js?v=1.6.4.37";

const MAX_ENTRIES = 6000;
const CAPTURE_PREFIX = "[muse]";

// v1.6.4.37 -- Rich clipboard support. When the user hits copy log, we put
// two representations of the same log on the clipboard: a plain-text version
// (identical to what serialiseSnapshot has always produced, so Slack, WhatsApp,
// iOS Notes, and any other plain-text target behave exactly as before) and an
// inline-styled HTML version (so Google Docs, Notion, Word, Gmail, Apple Mail,
// and Substack render the same colors and weights the user sees on screen).
//
// Emotion colors come from the emotion palette so a future recolor tracks
// automatically. Band colors are a small palette local to this file: the log
// is where the band letters get visual weight, and the color climbs from cold
// deep-sleep purple through cool indigo and calm teal into warm alert amber
// and hot gamma coral, matching the mental model of frequency.
const BAND_COLOR = {
  delta: "#7A6C9E",
  theta: "#6C82C4",
  alpha: "#4E9C86",
  beta:  "#D89A3E",
  gamma: "#DE6E5A",
};

// Fast lookup for emotion-name -> hex. Built once at module load.
const EMOTION_HEX_BY_NAME = (() => {
  const map = new Map();
  for (const e of EMOTIONS) map.set(e.name, e.hex);
  return map;
})();

// Longest names first so "Alert Stress" wins over "Stress" in a substring pass.
const EMOTION_NAMES_LONGEST_FIRST = [...EMOTION_HEX_BY_NAME.keys()].sort(
  (a, b) => b.length - a.length
);

/** HTML-escape a string for safe embedding in the serialised HTML log. */
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap every occurrence of a known emotion name inside a pre-escaped string
 * with an inline-color span pulling from the emotion palette. Longest names
 * first so multi-word emotions do not get half-matched by shorter ones.
 */
function tintEmotions(escapedText) {
  let out = escapedText;
  for (const name of EMOTION_NAMES_LONGEST_FIRST) {
    const hex = EMOTION_HEX_BY_NAME.get(name);
    // Word-boundary match so "Anger" does not also stain "Angerless" or a URL.
    const re = new RegExp(`\\b${name}\\b`, "g");
    out = out.replace(
      re,
      `<span style="color:${hex};font-weight:600">${name}</span>`
    );
  }
  return out;
}

/**
 * Wrap each band-letter reference inside a pre-escaped string with an inline
 * color span. Matches both the whole-word form (delta, theta, alpha, beta,
 * gamma) and the short one-letter form used in PULSE lines (d, t, a, b, g
 * immediately followed by a space and a decimal), so both the primer table
 * and the running pulses stay in sync visually.
 */
function tintBands(escapedText) {
  let out = escapedText;
  for (const [name, hex] of Object.entries(BAND_COLOR)) {
    const reFull = new RegExp(`\\b${name}\\b`, "g");
    out = out.replace(reFull, `<span style="color:${hex}">${name}</span>`);
  }
  return out;
}

/**
 * Serialise one raw text log line into an HTML string. Applies coloring for
 * emotion names and band letters, and bolds recognised section headers.
 * Comment lines (leading `#`) get muted so the primer reads as annotation.
 */
function lineToHtml(line) {
  const esc = escHtml(line);
  // Muted comment lines. Everything up to and including the `#` stays as-is,
  // then we still colorise emotions and bands inside the comment so the
  // primer table shows the same swatches as the running log.
  if (/^\s*#/.test(line)) {
    const painted = tintBands(tintEmotions(esc));
    return `<span style="color:#8a8677">${painted}</span>`;
  }
  // Section headers: bolden the track label. Track appears after the two
  // whitespace columns of timestamp, so a simple leading-token replace does
  // not work; instead we match the known labels as words.
  let painted = esc
    .replace(/\b(BEFORE SESSION|PULSE|CROSSING|STATE|STORY|NOTE)\b/g, `<b>$1</b>`);
  painted = tintBands(tintEmotions(painted));
  return painted;
}


class MuseLogCapture {
  constructor() {
    this._entries = [];
    this._sessionStart = null;
    this._originalLog = null;
    this._boundHook = null;
    this._toastFn = null;
  }

  /**
   * Start capturing. Wraps console.log so any line beginning with the [muse]
   * prefix gets mirrored into the buffer. Idempotent.
   */
  start(toastFn) {
    if (this._originalLog) return;
    this._toastFn = toastFn || null;
    this._sessionStart = performance.now();
    this._originalLog = console.log.bind(console);

    const hook = (...args) => {
      // Always let the original log fire first so devtools output is unchanged.
      this._originalLog(...args);
      try {
        const first = args[0];
        if (typeof first !== "string") return;
        if (!first.startsWith(CAPTURE_PREFIX)) return;
        this._push("metric", first);
      } catch { /* never let capture crash the app */ }
    };
    this._boundHook = hook;
    console.log = hook;
  }

  /**
   * Stop mirroring. Restores the original console.log. Buffer is preserved.
   */
  stop() {
    if (!this._originalLog) return;
    console.log = this._originalLog;
    this._originalLog = null;
    this._boundHook = null;
  }

  /**
   * Record a wizard block transition. Writes a rich STATE entry into the log
   * with four layers: what (block purpose), signal (band powers + valence /
   * arousal), emotion (label + colour swatch), story (composed on crossings
   * only, empty here). Every metric line that follows can be attributed to
   * this block during analysis.
   *
   * Optional context lets a caller enrich the entry with signal data. If
   * absent the entry still renders, just without the signal / emotion lines.
   */
  markState(label, ctx) {
    const trimmed = String(label || "").trim();
    if (!trimmed) return;
    const entry = {
      state: trimmed,
      what: whatFor(trimmed),
      signal: ctx && ctx.signal ? { ...ctx.signal } : null,
      emotion: ctx && ctx.emotion ? { ...ctx.emotion } : null,
    };
    this._push("state", trimmed, entry);
  }

  /**
   * Record a PULSE entry -- the always-on heartbeat of the log. Fires at a
   * throttled cadence (typically every 6 seconds) while Muse frames are
   * flowing. Each pulse carries the current signal and emotion so the log
   * reads as a continuous transcript of the session, not just wizard blocks.
   */
  logPulse(ctx) {
    if (!ctx) return;
    const entry = {
      signal: ctx.signal ? { ...ctx.signal } : null,
      emotion: ctx.emotion ? { ...ctx.emotion } : null,
    };
    this._push("pulse", "", entry);
  }

  /**
   * Record a CROSSING entry -- fires whenever the dominant emotion label
   * changes. Composes a story sentence about the transition from prior to
   * next, and a compact trigger phrase for the line below it.
   */
  logCrossing(ctx) {
    if (!ctx || !ctx.next) return;
    const story = storyFor(ctx.prior || null, ctx.next, ctx.deltas || {});
    const trigger = triggerFor(ctx.prior || null, ctx.next, ctx.deltas || {});
    const entry = {
      prior: ctx.prior || null,
      next: ctx.next,
      story,
      trigger,
      signal: ctx.signal ? { ...ctx.signal } : null,
      emotion: ctx.emotion ? { ...ctx.emotion } : null,
    };
    this._push("crossing", `${ctx.prior || "—"} -> ${ctx.next}`, entry);
  }

  /**
   * Record the user's own self-report before the session begins. This is
   * the diary opener -- the words on the Before Session screen ("How are
   * you feeling right now? Place yourself on the map. Move the dot, adjust
   * openness, begin.") mirrored back into the log using the exact vocabulary
   * the wheel uses: Energized / Tired for arousal, Positive / Negative for
   * valence, Open / Closed for openness. This entry is always the first one
   * a session's transcript contains, and it lets a reader (or a researcher
   * comparing the Muse's reading against felt experience) know where the
   * user said they were before anything was measured.
   *
   *   valence   in [-1, +1]     -1 = fully Negative, +1 = fully Positive
   *   arousal   in [-1, +1]     -1 = fully Tired,    +1 = fully Energized
   *   openness  in [ 0,  1]      0 = fully Closed,    1 = fully Open
   *
   * Any missing or non-finite value defaults to the wheel's neutral center.
   */
  logSelfReport(ctx) {
    const v = Number.isFinite(ctx && ctx.valence)  ? ctx.valence  : 0;
    const a = Number.isFinite(ctx && ctx.arousal)  ? ctx.arousal  : 0;
    const o = Number.isFinite(ctx && ctx.openness) ? ctx.openness : 0.5;
    // Threshold bands match the wheel's own three regions. 0.20 either side
    // of centre is the neutral zone -- anything past it commits to a word.
    const arousalWord =
      a >= 0.20 ? "Energized" : a <= -0.20 ? "Tired"    : "Balanced";
    const valenceWord =
      v >= 0.20 ? "Positive"  : v <= -0.20 ? "Negative" : "Neutral";
    const opennessWord =
      o >= 0.60 ? "Open"      : o <= 0.40 ? "Closed"   : "Balanced";
    const entry = {
      valence: v,
      arousal: a,
      openness: o,
      arousalWord,
      valenceWord,
      opennessWord,
    };
    this._push("self-report", "before we listened", entry);
  }

  /**
   * Record a short free-form annotation. Kept as an escape hatch for anything
   * the wizard blocks do not cover (electrode felt loose, headband slipped).
   */
  note(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    this._push("note", trimmed);
  }

  /** Discard everything captured so far. */
  clear() {
    this._entries.length = 0;
    this._sessionStart = performance.now();
  }

  /**
   * Return a plain snapshot of all captured entries so a session record
   * can stamp its own log at commit time. The array is a shallow copy so
   * later log activity does not mutate the stored record.
   */
  snapshotEntries() {
    return this._entries.map((e) => ({ ...e }));
  }

  /**
   * Format a supplied snapshot of entries (as produced by snapshotEntries)
   * back into the same terminal-style transcript the live log uses.
   * Header block is stamped with the snapshot's own timing rather than
   * the current session, so a replayed record reads honestly.
   */
  serialiseSnapshot(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const lines = [];
    const firstWall = list.length ? list[0].wall : Date.now();
    const spanMs = list.length ? (list[list.length - 1].rel || 0) : 0;
    // ── Legend header ───────────────────────────────────────────────────
    // Self-describing so a pasted log is decodable without opening the app.
    lines.push(`# Empathic Art -- Muse session log`);
    lines.push(`# Captured ${new Date(firstWall).toISOString()}`);
    lines.push(`# ${list.length} entries, session ${this._fmtElapsedMs(spanMs)}`);
    lines.push(`#`);
    lines.push(`# Three tracks interleaved:`);
    lines.push(`#   STATE      wizard block markers (only when the calibration wizard runs)`);
    lines.push(`#   PULSE      every ~6s while Muse is streaming, showing the current signal`);
    lines.push(`#   CROSSING   fired whenever your emotion label changes on the circumplex`);
    lines.push(`#`);
    lines.push(`# In plain language:`);
    lines.push(`#`);
    lines.push(`# Muse reads five kinds of brainwave activity from four sensors on your head.`);
    lines.push(`# Each wave means something different, and the artwork combines them into`);
    lines.push(`# three numbers you can watch move in real time, plus one number about the`);
    lines.push(`# whole session that only appears once you have finished.`);
    lines.push(`#`);
    lines.push(`#   delta (~2Hz)   deep sleep. Streamed but not used to drive the artwork.`);
    lines.push(`#   theta (~6Hz)   drifting, absorbed, on the edge of sleep or in flow.`);
    lines.push(`#   alpha (~10Hz)  calm and awake, eyes soft. Rises when you close your eyes.`);
    lines.push(`#   beta  (~20Hz)  alert, thinking, engaged with the outside world.`);
    lines.push(`#   gamma (~40Hz)  sharp focus. Small and noisy on a consumer sensor.`);
    lines.push(`#`);
    lines.push(`# The three moment-to-moment numbers, updated ten times a second:`);
    lines.push(`#`);
    lines.push(`#   Valence    how positive or negative you are leaning right now.`);
    lines.push(`#              Driven by alpha on the two forehead sensors (AF7 vs AF8).`);
    lines.push(`#              Positive moves the emotion word to the right side of the`);
    lines.push(`#              circumplex (Joy, Serenity); negative to the left (Sadness,`);
    lines.push(`#              Anger).`);
    lines.push(`#`);
    lines.push(`#   Arousal    how activated or calm you are.`);
    lines.push(`#              Driven by beta (fast) against alpha + theta (slow).`);
    lines.push(`#              High moves the emotion word upward on the circumplex --`);
    lines.push(`#              Elation, Anger. Low moves it downward -- Serenity, Melancholy.`);
    lines.push(`#`);
    lines.push(`#   Openness   how relaxed and receptive versus tight and guarded.`);
    lines.push(`#              Driven by alpha + theta together.`);
    lines.push(`#              Open makes the artwork lighter and softer; closed makes it`);
    lines.push(`#              darker and sharper. Openness does not change the word,`);
    lines.push(`#              only the atmosphere around it.`);
    lines.push(`#`);
    lines.push(`# The one whole-session number, computed after the session ends:`);
    lines.push(`#`);
    lines.push(`#   Entropy    how much your state moved across the whole session.`);
    lines.push(`#              Combines how many named emotions you visited with how`);
    lines.push(`#              much distance you covered on the circumplex, per minute.`);
    lines.push(`#              A four-word ladder describes the shape of the journey:`);
    lines.push(`#                quiet     you held almost perfectly still in one place`);
    lines.push(`#                gathered  you moved with intention, stayed near one region`);
    lines.push(`#                restless  you shifted often, unwilling to settle`);
    lines.push(`#                wide      you ranged broadly across the whole map`);
    lines.push(`#              Not chaos, just breadth. Entropy shows up in Session`);
    lines.push(`#              Replay's summary line and in the narrated recap.`);
    lines.push(`#`);
    lines.push(`# Every number is compared against your own resting baseline from the first`);
    lines.push(`# ~90 seconds, so what you see is your movement relative to yourself, not a`);
    lines.push(`# universal claim about how you feel.`);
    lines.push(`#`);
    lines.push(`# For readers who want the exact math:`);
    lines.push(`#`);
    lines.push(`# Channels: TP9, AF7, AF8, TP10 (Muse S dry electrodes)`);
    lines.push(`# Bands:    delta ~2Hz  theta ~6Hz  alpha ~10Hz  beta ~20Hz  gamma ~40Hz`);
    lines.push(`# Valence  <- ln(alpha_AF8) - ln(alpha_AF7)   frontal alpha asymmetry`);
    lines.push(`# Arousal  <- ln(beta / (alpha + theta))      engagement ratio`);
    lines.push(`# Openness <- (alpha + theta) / total         relaxed absorption`);
    lines.push(`# Personal z-scored against your own 90s baseline.`);
    lines.push(`# Valence and arousal are tanh'd to [-1, +1]; openness to [0, 1].`);
    lines.push("");
    for (const e of list) {
      lines.push(...this._serialiseEntry(e));
    }
    return lines.join("\n");
  }

  /**
   * Emit one entry as multiple text lines -- the four-layer block. Returns
   * an array of lines so the caller can join them with newlines and control
   * spacing between entries. Every layer is optional; empty layers are
   * skipped so PULSE entries without a wizard 'what' still render cleanly.
   */
  _serialiseEntry(e) {
    const wall = new Date(e.wall).toISOString().slice(11, 19);
    const rel  = this._fmtElapsedMs(e.rel || 0);
    const lines = [];
    const d = e.data || {};
    if (e.kind === "note") {
      lines.push(`${wall}  t+${rel}  NOTE: ${e.text}`);
      lines.push("");
      return lines;
    }
    if (e.kind === "self-report") {
      // Diary opener. Mirrors the Before Session screen's own words
      // ("How are you feeling right now? Place yourself on the map..."),
      // then shows the user's chosen labels alongside the raw numbers
      // so a researcher reading the transcript later can line the
      // self-report up against the Muse readings that follow.
      const arW = String(d.arousalWord || "—").padEnd(9, " ");
      const vaW = String(d.valenceWord || "—").padEnd(9, " ");
      const opW = String(d.opennessWord || "—").padEnd(9, " ");
      const line = "".padEnd(52, "-");
      lines.push(line);
      lines.push(`${wall}  t+${rel}  BEFORE SESSION`);
      lines.push(`                    How are you feeling right now?`);
      lines.push(`                    Place yourself on the map. Move the dot, adjust openness, begin.`);
      lines.push(`                    you said:`);
      lines.push(`                      Arousal    ${arW} (${fmtSigned(d.arousal)})`);
      lines.push(`                      Valence    ${vaW} (${fmtSigned(d.valence)})`);
      lines.push(`                      Openness   ${opW} ( ${fmtUnsigned(d.openness)})`);
      lines.push(`                    this is the beginning of your emotional journey.`);
      lines.push(`                    the Muse takes over from here.`);
      lines.push(line);
      lines.push("");
      return lines;
    }
    if (e.kind === "metric") {
      // Legacy path -- Bob's original adapter mirror. Passed through untouched.
      lines.push(`${wall}  t+${rel}  ${e.text}`);
      return lines;
    }
    if (e.kind === "state") {
      lines.push("");
      lines.push(`${wall}  t+${rel}  STATE: ${e.text}`);
      if (d.what)    lines.push(`                    what:    ${d.what}`);
      if (d.signal)  lines.push(`                    signal:  ${this._fmtSignalLine(d.signal)}`);
      if (d.emotion) lines.push(`                    emotion: ${this._fmtEmotionLine(d.emotion)}`);
      lines.push("");
      return lines;
    }
    if (e.kind === "pulse") {
      lines.push(`${wall}  t+${rel}  PULSE`);
      if (d.signal)  lines.push(`                    signal:  ${this._fmtSignalLine(d.signal)}`);
      if (d.emotion) lines.push(`                    emotion: ${this._fmtEmotionLine(d.emotion)}`);
      lines.push("");
      return lines;
    }
    if (e.kind === "crossing") {
      lines.push("");
      lines.push(`${wall}  t+${rel}  CROSSING: ${e.text}`);
      if (d.story)   lines.push(`                    story:   ${d.story}`);
      if (d.trigger) lines.push(`                    trigger: ${d.trigger}`);
      if (d.emotion) lines.push(`                    emotion: ${this._fmtEmotionLine(d.emotion)}`);
      lines.push("");
      return lines;
    }
    // Unknown kind -- best-effort fallback.
    lines.push(`${wall}  t+${rel}  ${e.text || ""}`);
    return lines;
  }

  /** Compose the tight signal line for a serialised entry. */
  _fmtSignalLine(sig) {
    const parts = [];
    if (sig.alpha != null) parts.push(`alpha ${fmtUnsigned(sig.alpha)}`);
    if (sig.beta  != null) parts.push(`beta ${fmtUnsigned(sig.beta)}`);
    if (sig.theta != null) parts.push(`theta ${fmtUnsigned(sig.theta)}`);
    if (sig.valence != null) parts.push(`v ${fmtSigned(sig.valence)}`);
    if (sig.arousal != null) parts.push(`a ${fmtSigned(sig.arousal)}`);
    if (sig.openness != null) parts.push(`o ${fmtUnsigned(sig.openness)}`);
    return parts.join("   ");
  }

  /**
   * Render an array of entries into the Zen overlay <pre> as rich HTML.
   * Each entry is a <div class="ea-log-entry ea-log-entry--{kind}"> with
   * child spans for the timestamp, track label, and per-layer lines. Colour
   * swatches are inline <span class="ea-log-swatch"> elements filled with
   * the emotion hex, so the palette reads directly off the log.
   */
  _renderEntriesHtml(host, entries) {
    // Wipe any prior contents.
    while (host.firstChild) host.removeChild(host.firstChild);
    const firstWall = entries.length ? entries[0].wall : Date.now();
    const spanMs = entries.length ? (entries[entries.length - 1].rel || 0) : 0;
    const legend = document.createElement("div");
    legend.className = "ea-log-legend";
    legend.textContent = [
      `# Empathic Art -- Muse session log`,
      `# Captured ${new Date(firstWall).toISOString()}`,
      `# ${entries.length} entries, session ${this._fmtElapsedMs(spanMs)}`,
      `#`,
      `# STATE     wizard block markers`,
      `# PULSE     ~6s heartbeat while Muse streams`,
      `# CROSSING  fires when your emotion label changes`,
      `#`,
      `# In plain language:`,
      `#   alpha   calm and awake, eyes soft; rises when you close your eyes`,
      `#   beta    alert, thinking, engaged with the world`,
      `#   theta   drifting, absorbed, on the edge of sleep or in flow`,
      `#   delta   deep sleep; streamed but not used to drive the artwork`,
      `#   gamma   sharp focus; small and noisy on a consumer sensor`,
      `#`,
      `# The artwork turns those waves into three moment-to-moment numbers:`,
      `#   Valence    positive vs negative -- driven by frontal alpha`,
      `#              (Joy/Serenity on the right, Sadness/Anger on the left)`,
      `#   Arousal    activated vs calm -- driven by beta against alpha+theta`,
      `#              (Elation/Anger up top, Serenity/Melancholy at the bottom)`,
      `#   Openness   relaxed vs guarded -- driven by alpha+theta together`,
      `#              (open = lighter, softer color; closed = darker, sharper)`,
      `#`,
      `# And one whole-session number, once the session ends:`,
      `#   Entropy    how much you moved across the whole session --`,
      `#              quiet, gathered, restless, or wide.`,
      `#`,
      `# Compared against your own baseline from the first ~90 seconds,`,
      `# so this is your movement relative to yourself.`,
      `#`,
      `# Channels TP9 AF7 AF8 TP10 -- bands delta theta alpha beta gamma`,
      `# Valence  = ln(alpha_AF8) - ln(alpha_AF7)`,
      `# Arousal  = ln(beta / (alpha + theta))`,
      `# Openness = (alpha + theta) / total`,
    ].join("\n");
    host.appendChild(legend);

    for (const e of entries) {
      host.appendChild(this._renderEntryHtml(e));
    }
  }

  /** Render one entry as a <div> block. */
  _renderEntryHtml(e) {
    const wall = new Date(e.wall).toISOString().slice(11, 19);
    const rel  = this._fmtElapsedMs(e.rel || 0);
    const kind = e.kind || "metric";
    const d = e.data || {};

    const block = document.createElement("div");
    block.className = `ea-log-entry ea-log-entry--${kind}`;

    const head = document.createElement("div");
    head.className = "ea-log-head";
    const time = document.createElement("span");
    time.className = "ea-log-time";
    time.textContent = `${wall}  t+${rel}`;
    head.appendChild(time);

    if (kind === "state") {
      const label = document.createElement("span");
      label.className = "ea-log-track ea-log-track--state";
      label.textContent = `STATE: ${e.text}`;
      head.appendChild(label);
    } else if (kind === "self-report") {
      const label = document.createElement("span");
      label.className = "ea-log-track ea-log-track--self-report";
      label.textContent = "BEFORE SESSION";
      head.appendChild(label);
    } else if (kind === "pulse") {
      const label = document.createElement("span");
      label.className = "ea-log-track ea-log-track--pulse";
      label.textContent = "PULSE";
      head.appendChild(label);
    } else if (kind === "crossing") {
      const label = document.createElement("span");
      label.className = "ea-log-track ea-log-track--crossing";
      label.textContent = `CROSSING: ${e.text}`;
      head.appendChild(label);
    } else if (kind === "note") {
      const label = document.createElement("span");
      label.className = "ea-log-track ea-log-track--note";
      label.textContent = `NOTE: ${e.text}`;
      head.appendChild(label);
    } else {
      const label = document.createElement("span");
      label.className = "ea-log-track";
      label.textContent = e.text || "";
      head.appendChild(label);
    }
    block.appendChild(head);

    // Layers.
    if (kind === "self-report") {
      // v1.6.4.34 -- Diary opener. Renders the exact Before Session
      // headline the user just tapped through, then their choice on
      // each axis, in the vocabulary the wheel uses.
      const q = document.createElement("div");
      q.className = "ea-log-layer ea-log-layer--self-report-question";
      q.textContent = "How are you feeling right now?";
      block.appendChild(q);

      const sub = document.createElement("div");
      sub.className = "ea-log-layer ea-log-layer--self-report-sub";
      sub.textContent = "Place yourself on the map. Move the dot, adjust openness, begin.";
      block.appendChild(sub);

      const you = document.createElement("div");
      you.className = "ea-log-layer ea-log-layer--self-report-lead";
      you.textContent = "you said:";
      block.appendChild(you);

      const axis = (axisLabel, word, numText) => {
        const row = document.createElement("div");
        row.className = "ea-log-layer ea-log-layer--self-report-axis";
        const a1 = document.createElement("span");
        a1.className = "ea-log-layer__label";
        a1.textContent = axisLabel;
        const a2 = document.createElement("span");
        a2.className = "ea-log-layer__value ea-log-layer__value--self-report-word";
        a2.textContent = word;
        const a3 = document.createElement("span");
        a3.className = "ea-log-layer__value ea-log-layer__value--self-report-num";
        a3.textContent = `(${numText})`;
        row.appendChild(a1); row.appendChild(a2); row.appendChild(a3);
        return row;
      };
      block.appendChild(axis("arousal",  d.arousalWord  || "—", fmtSigned(d.arousal)));
      block.appendChild(axis("valence",  d.valenceWord  || "—", fmtSigned(d.valence)));
      block.appendChild(axis("openness", d.opennessWord || "—", fmtUnsigned(d.openness)));

      const outro = document.createElement("div");
      outro.className = "ea-log-layer ea-log-layer--self-report-outro";
      outro.textContent = "this is the beginning of your emotional journey. the Muse takes over from here.";
      block.appendChild(outro);
      return block;
    }

    if (d.what) {
      block.appendChild(this._layerRow("what", d.what));
    }
    if (d.signal) {
      block.appendChild(this._layerRow("signal", this._fmtSignalLine(d.signal)));
    }
    if (d.emotion) {
      block.appendChild(this._emotionRow(d.emotion));
    }
    if (d.story) {
      block.appendChild(this._layerRow("story", d.story));
    }
    if (d.trigger) {
      block.appendChild(this._layerRow("trigger", d.trigger));
    }
    return block;
  }

  _layerRow(label, text) {
    const row = document.createElement("div");
    row.className = `ea-log-layer ea-log-layer--${label}`;
    const l = document.createElement("span");
    l.className = "ea-log-layer__label";
    l.textContent = label + ":";
    const v = document.createElement("span");
    v.className = "ea-log-layer__value";
    v.textContent = text;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  _emotionRow(emo) {
    const row = document.createElement("div");
    row.className = "ea-log-layer ea-log-layer--emotion";
    const l = document.createElement("span");
    l.className = "ea-log-layer__label";
    l.textContent = "emotion:";
    const swatch = document.createElement("span");
    swatch.className = "ea-log-swatch";
    if (emo.hex) swatch.style.background = emo.hex;
    swatch.setAttribute("aria-hidden", "true");
    const v = document.createElement("span");
    v.className = "ea-log-layer__value";
    const name = emo.name || "—";
    const cname = emo.colourName || colourNameFor(name);
    const hex = emo.hex ? String(emo.hex).toUpperCase() : "";
    const va = (emo.valence != null && emo.arousal != null)
      ? ` \u00b7 v ${fmtSigned(emo.valence)} \u00b7 a ${fmtSigned(emo.arousal)}`
      : "";
    v.textContent = `${name}${va}  [${cname} ${hex}]`;
    row.appendChild(l);
    row.appendChild(swatch);
    row.appendChild(v);
    return row;
  }

  /** Compose the emotion line for a serialised entry. Includes the colour name. */
  _fmtEmotionLine(emo) {
    if (!emo) return "";
    const name = emo.name || "—";
    const hex  = emo.hex ? String(emo.hex).toUpperCase() : "";
    const cname = emo.colourName || colourNameFor(name);
    const va = (emo.valence != null && emo.arousal != null)
      ? `   v ${fmtSigned(emo.valence)} \u00b7 a ${fmtSigned(emo.arousal)}`
      : "";
    return `${name}${va}   [${cname} ${hex}]`;
  }

  /**
   * Copy an arbitrary snapshot (typically the one stamped on a session
   * record) to the clipboard. Returns { ok, chars } or { ok: false, error }.
   */
  async copySnapshot(entries) {
    const text = this.serialiseSnapshot(entries);
    const html = this.serialiseSnapshotHtml(entries);
    return this._writeRichClipboard(text, html);
  }

  /**
   * Serialise the log to an inline-styled HTML string that mirrors the
   * on-screen colors. Wrapped in a <pre> so line breaks and column alignment
   * survive a paste into Google Docs, Notion, Word, Gmail, or Apple Mail.
   * Text-only paste targets will silently take the plain-text half of the
   * clipboard instead; this function is only for the HTML half.
   */
  serialiseSnapshotHtml(entries) {
    const text = this.serialiseSnapshot(entries);
    const painted = text.split("\n").map(lineToHtml).join("\n");
    // Dark background matches the on-screen terminal so a paste into a
    // light-background editor still reads with the same contrast. Uses a
    // web-safe monospace stack so the paste renders without needing a
    // custom font install on the receiving end.
    const style = [
      "font-family:'SF Mono',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace",
      "font-size:12px",
      "line-height:1.5",
      "color:#d9d5c8",
      "background:#0e1013",
      "padding:16px 20px",
      "border-radius:6px",
      "white-space:pre",
      "tab-size:2",
      "overflow-x:auto",
    ].join(";");
    return `<pre style="${style}">${painted}</pre>`;
  }

  /**
   * Write both text/plain and text/html to the clipboard, so rich paste
   * targets (Google Docs, Notion) get colors and plain targets (Slack,
   * WhatsApp) get the same text they always did. Falls back to writeText
   * on browsers without ClipboardItem support.
   */
  async _writeRichClipboard(text, html) {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html":  new Blob([html], { type: "text/html"  }),
        });
        await navigator.clipboard.write([item]);
        return { ok: true, chars: text.length };
      }
    } catch (err) {
      // Fall through to writeText; leave a debug crumb but do not throw.
      if (typeof console !== "undefined") {
        console.warn("[muse-log] rich clipboard failed, falling back:", err);
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, chars: text.length };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  /**
   * Mount a read-only, scrollable terminal-style overlay of the current
   * log to the given host (defaults to document.body). Used in Session
   * Replay so the user can review the calibration transcript alongside
   * the fluid playback. Returns an unmount() function.
   */
  mountReplayOverlay(host) {
    return this._mountOverlayInternal({
      host,
      text: this.serialise(),
      copyFn: () => this.copy(),
      entries: this._entries.slice(),
    });
  }

  /**
   * Mount the replay overlay against a stamped session record. Uses the
   * record's own log snapshot (record.museLog) so the transcript matches
   * the session being replayed, not whatever the live buffer holds now.
   */
  mountReplayOverlayFromRecord(host, record) {
    const entries = Array.isArray(record?.museLog) ? record.museLog : [];
    if (entries.length === 0) return null;
    return this._mountOverlayInternal({
      host,
      text: this.serialiseSnapshot(entries),
      copyFn: () => this.copySnapshot(entries),
      entries,
    });
  }

  _mountOverlayInternal({ host, text, copyFn, entries }) {
    const el = document.createElement("div");
    el.className = "ea-muse-terminal ea-muse-terminal--replay";
    el.setAttribute("aria-label", "Muse session replay log");
    const pre = document.createElement("pre");
    pre.className = "ea-muse-terminal__log ea-muse-terminal__log--replay";
    // v1.6.4.23 -- Rich HTML rendering when entries are supplied. The plain
    // `text` path is kept as a fallback for any legacy caller that only
    // has a string. Rich rendering uses child <div>s so we can inline the
    // emotion colour swatch and highlight track labels.
    if (Array.isArray(entries) && entries.length > 0) {
      this._renderEntriesHtml(pre, entries);
    } else {
      pre.textContent = text;
    }
    el.appendChild(pre);

    // v1.6.4.16 -- Copy log buttons. One sits directly after the log body
    // (right below the final 'wizard complete' line), the other pins to the
    // bottom edge of the Zen surface for easy reach when the log is long.
    const makeCopyBtn = (label, extraClass) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `ea-muse-terminal__copy${extraClass ? ` ${extraClass}` : ""}`;
      b.textContent = label;
      b.addEventListener("click", async () => {
        const original = b.textContent;
        b.disabled = true;
        const res = await copyFn();
        b.textContent = res.ok ? `copied ${res.chars} chars` : "copy failed";
        setTimeout(() => { b.textContent = original; b.disabled = false; }, 1600);
      });
      return b;
    };
    // v1.6.4.27 -- Only one copy-log button. The pinned bottom-right variant
    // stays glued to the corner while the log scrolls, so the user can
    // always reach it. The old inline sibling under the last log line was
    // redundant and made the surface look duplicated.
    //
    // v1.6.4.32 -- Mount the pinned button as a direct child of <body>,
    // NOT inside .ea-muse-terminal--replay. When the button lives inside
    // the terminal, the terminal's opacity transitions cascade down
    // through the child's own opacity, so no !important rule on the
    // button can beat the parent's opacity 0 during empty/fadeout. Lifting
    // the button to <body> gives it a clean position:fixed anchor against
    // the viewport with its own reveal envelope. It stays paired to the
    // terminal via its own zen-phase gate in CSS, so it comes in and out
    // with the log body without inheriting the log's fade.
    const pinnedBtn = makeCopyBtn("copy log", "ea-muse-terminal__copy--pinned");
    pinnedBtn.dataset.museCopyPinned = "1";

    (host || document.body).appendChild(el);
    document.body.appendChild(pinnedBtn);
    return () => {
      el.remove();
      pinnedBtn.remove();
    };
  }

  /** Number of entries currently in the buffer. */
  get size() { return this._entries.length; }

  /**
   * Return the last n entries formatted as one string per line, ready for
   * the terminal-style overlay to render. Metric lines are shown as-is;
   * state and note lines are prefixed so they stand out visually.
   */
  tail(n) {
    const count = Math.max(0, Math.min(n | 0, this._entries.length));
    const slice = this._entries.slice(this._entries.length - count);
    return slice.map((e) => this._formatEntry(e));
  }

  /**
   * Serialise the whole buffer to plain text. Format is a header block, then
   * one entry per line:
   *   <wall clock HH:MM:SS>  t+<MM:SS>  <payload>
   * Metric lines pass through untouched; state and note lines get labels.
   */
  serialise() {
    return this.serialiseSnapshot(this._entries);
  }

  /**
   * Copy the serialised log to the clipboard. Returns { ok, chars } or
   * { ok: false, error }.
   */
  async copy() {
    const text = this.serialise();
    const html = this.serialiseSnapshotHtml(this._entries);
    return this._writeRichClipboard(text, html);
  }

  // ── internals ───────────────────────────────────────────────────────────

  _push(kind, text, data) {
    if (this._sessionStart == null) this._sessionStart = performance.now();
    const rel = performance.now() - this._sessionStart;
    const rec = { kind, text, wall: Date.now(), rel };
    if (data && typeof data === "object") rec.data = data;
    this._entries.push(rec);
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.splice(0, this._entries.length - MAX_ENTRIES);
    }
  }

  _formatEntry(e) {
    const rel = this._fmtElapsedMs(e.rel);
    if (e.kind === "state") return `[${rel}] STATE  ${e.text}`;
    if (e.kind === "note")  return `[${rel}] NOTE   ${e.text}`;
    // Metric lines already carry the "[muse]" prefix from Bob's adapter; add
    // a session-relative timestamp in front so the overlay reads as a log.
    return `[${rel}] ${e.text}`;
  }

  _fmtElapsedMs(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
}

/** Singleton. One capture per page life. */
export const museLog = new MuseLogCapture();
