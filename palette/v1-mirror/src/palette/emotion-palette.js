/**
 * Empathic App — Emotion Palette (v3, vibrant)
 *
 * Canonical 19-feeling lexicon extracted from the v2.1 archive
 * (lexicon.js@v20260628v2). Every anchor hex was signed off by
 * the artist and is preserved verbatim here.
 *
 * Model:
 *   valence  ∈ [-1, +1]   -1 = Negative     +1 = Positive
 *   arousal  ∈ [-1, +1]   -1 = Tired        +1 = Energized
 *   openness ∈ [ 0,  1]    0 = Closed        1 = Open
 *
 * Design intent:
 *   1. We NEVER blend toward cream — that killed vibrance in v2.
 *   2. We resolve the current (v,a) point to the NEAREST anchor emotion
 *      on the Russell circumplex, and use that emotion's SATURATED hex.
 *   3. Openness only nudges lightness ±10%, and only mildly.
 *   4. A weak two-emotion blend (nearest + second-nearest) is used so
 *      transitions feel continuous rather than snapping.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * The canonical 19-emotion lexicon. Order is source-order (angle-sorted).
 * @typedef {Object} Emotion
 * @property {string} name    - Display label
 * @property {string} hex     - Anchor color, artist-signed
 * @property {number} angle   - Circumplex angle, degrees. 0° = +valence axis, CCW.
 * @property {number} v       - Derived valence = cos(angle)
 * @property {number} a       - Derived arousal = sin(angle)
 * @property {"veils"|"verticals"|"quadrants"|"multiform"|"nightfall"} comp
 * @property {"hot"|"warm"|"cool"|"deep"|"dark"|"calm"} mood
 */
export const EMOTIONS = [
  { name: "Love",          hex: "#C46E54", angle:  10, comp: "veils",     mood: "warm" },
  { name: "Excitement",    hex: "#DE8230", angle:  30, comp: "multiform", mood: "hot"  },
  { name: "Joy",           hex: "#F4B23A", angle:  50, comp: "veils",     mood: "hot"  },
  { name: "Elation",       hex: "#E6BA46", angle:  70, comp: "multiform", mood: "hot"  },
  { name: "Awe",           hex: "#C89848", angle:  80, comp: "quadrants", mood: "warm" },
  { name: "Surprise",      hex: "#8CA2B2", angle: 100, comp: "quadrants", mood: "cool" },
  { name: "Fear",          hex: "#802826", angle: 120, comp: "verticals", mood: "deep" },
  { name: "Anger",         hex: "#A82E28", angle: 140, comp: "verticals", mood: "deep" },
  { name: "Stress",        hex: "#963E2C", angle: 155, comp: "verticals", mood: "deep" },
  { name: "Anxiety",       hex: "#70384E", angle: 170, comp: "quadrants", mood: "deep" },
  { name: "Despair",       hex: "#2C2E4C", angle: 200, comp: "nightfall", mood: "dark" },
  { name: "Sadness",       hex: "#3A4C76", angle: 220, comp: "veils",     mood: "cool" },
  { name: "Melancholy",    hex: "#4E4E78", angle: 240, comp: "veils",     mood: "cool" },
  { name: "Apathy",        hex: "#585E6C", angle: 255, comp: "nightfall", mood: "dark" },
  { name: "Boredom",       hex: "#686664", angle: 270, comp: "nightfall", mood: "dark" },
  { name: "Contemplation", hex: "#3A6864", angle: 290, comp: "veils",     mood: "calm" },
  { name: "Serenity",      hex: "#608A68", angle: 310, comp: "multiform", mood: "calm" },
  { name: "Calm",          hex: "#6E9474", angle: 330, comp: "quadrants", mood: "calm" },
  { name: "Peace",         hex: "#849868", angle: 350, comp: "quadrants", mood: "calm" },
].map((e) => {
  const r = (e.angle * Math.PI) / 180;
  return { ...e, v: Math.cos(r), a: Math.sin(r), rgb: hexToRgb(e.hex) };
});

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  return "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0");
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clampNeg11(x) { return Math.max(-1, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(c1, c2, t) {
  return {
    r: Math.round(lerp(c1.r, c2.r, t)),
    g: Math.round(lerp(c1.g, c2.g, t)),
    b: Math.round(lerp(c1.b, c2.b, t)),
  };
}

/**
 * Return the two nearest emotions by angular distance on the circumplex.
 * Distance is normalized to point magnitude — inside the unit circle
 * we still snap to nearest ANGLE, but low-magnitude points blend more
 * toward "Contemplation" (a low-arousal, positive-calm center).
 *
 * @param {number} valence
 * @param {number} arousal
 * @returns {{primary: Emotion, secondary: Emotion, tPrimary: number, mag: number}}
 */
export function nearestEmotions(valence, arousal) {
  const v = clampNeg11(valence);
  const a = clampNeg11(arousal);
  const mag = Math.hypot(v, a);
  // Angle in degrees, 0 = +valence axis, counterclockwise
  const deg = ((Math.atan2(a, v) * 180) / Math.PI + 360) % 360;

  // Sort by angular distance to `deg`
  const withDist = EMOTIONS.map((e) => {
    const raw = Math.abs(e.angle - deg);
    const d = Math.min(raw, 360 - raw);
    return { e, d };
  }).sort((x, y) => x.d - y.d);

  const primary = withDist[0].e;
  const secondary = withDist[1].e;
  // How close we are to primary vs secondary (0 = fully primary, 1 = midpoint between the two)
  const total = withDist[0].d + withDist[1].d + 1e-4;
  const tPrimary = withDist[0].d / total;
  return { primary, secondary, tPrimary, mag };
}

/**
 * Compute the emotion color from PAD-lite inputs.
 * Never blends toward cream. Uses the nearest anchor's saturated hex,
 * slightly blended with the second-nearest for smooth transitions,
 * plus a mild openness lightness nudge.
 *
 * @param {number} valence
 * @param {number} arousal
 * @param {number} [openness=0.5]
 * @returns {{r:number,g:number,b:number, hex:string, rgba:string}}
 */
export function emotionToColor(valence, arousal, openness = 0.5) {
  const o = clamp01(openness);
  const { primary, secondary, tPrimary, mag } = nearestEmotions(valence, arousal);

  // Blend primary → secondary by tPrimary (kept small so primary dominates)
  const blended = lerpRgb(primary.rgb, secondary.rgb, tPrimary * 0.55);

  // Openness lifts (open) or deepens (closed) by up to ±14%
  // Open = brighter, more air; Closed = deeper, more shadow.
  const target = o > 0.5
    ? { r: 255, g: 255, b: 255 }
    : { r:  22, g:  18, b:  20 };
  const opBias = Math.abs(o - 0.5) * 0.28;
  let final = lerpRgb(blended, target, opBias);

  // Low-magnitude (near circumplex center) points still get the primary color
  // rather than being washed toward neutral — this is exactly what killed
  // vibrance before. We instead darken them slightly for a "quiet" feel.
  if (mag < 0.25) {
    const quiet = { r: Math.round(blended.r * 0.85), g: Math.round(blended.g * 0.85), b: Math.round(blended.b * 0.85) };
    final = lerpRgb(quiet, final, mag / 0.25);
  }

  const hex = rgbToHex(final.r, final.g, final.b);
  return { ...final, hex, rgba: `rgba(${final.r}, ${final.g}, ${final.b}, 1)` };
}

/**
 * Human-readable label — returns the nearest anchor emotion name.
 * @param {number} valence
 * @param {number} arousal
 * @returns {string}
 */
export function emotionToLabel(valence, arousal) {
  return nearestEmotions(valence, arousal).primary.name;
}

/* ------------------------------------------------------------------ */
/*  Harmonic palette                                                  */
/*                                                                    */
/*  Returns a five-stop chord derived from the primary emotion, its   */
/*  circumplex neighbour, and one analogous step further round the    */
/*  wheel. Styles pull whichever stops they need (back / whisper /    */
/*  mid / front / hot) so a single anchor reads as a Rothko-style     */
/*  colour zone — warm-cool micro-bleed inside one mood — instead     */
/*  of a monochrome tint.                                             */
/*                                                                    */
/*  Design:                                                           */
/*    mid      — the primary emotion at its full anchor saturation    */
/*    front    — primary hue lifted for the bright surface highlight  */
/*    hot      — primary hue tilted TOWARD the secondary emotion by   */
/*               the neighbour vector at high L (the whisper of the   */
/*               neighbour bleeding into the highlight, Rothko-style) */
/*    whisper  — the analogous emotion one wheel step further round,  */
/*               at reduced saturation and mid-L. Quiet third colour  */
/*               that keeps the field from reading monochrome.        */
/*    back     — primary hue at low L, saturated. Deep shadow stop.   */
/* ------------------------------------------------------------------ */

function _rgbToHsl01(r01, g01, b01) {
  const max = Math.max(r01, g01, b01);
  const min = Math.min(r01, g01, b01);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
    if      (max === r01) h = ((g01 - b01) / d + (g01 < b01 ? 6 : 0)) / 6;
    else if (max === g01) h = ((b01 - r01) / d + 2) / 6;
    else                   h = ((r01 - g01) / d + 4) / 6;
  }
  return { h, s, l };
}
function _hslToRgb01({ h, s, l }) {
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const c01 = (x) => Math.max(0, Math.min(1, x));
  return [c01(hue(h + 1 / 3)), c01(hue(h)), c01(hue(h - 1 / 3))];
}
function _hexToRgb01(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
function _hueDeltaTurns(fromDeg, toDeg) {
  // Shortest signed hue delta expressed in unit turns (−0.5..+0.5).
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  return d / 360;
}

/**
 * Harmonic palette — five colour stops for the current (v, a) point.
 *
 * All stops are returned as [r, g, b] arrays in 0..1 floats so they
 * can be uploaded directly to GL uniforms with gl.uniform3fv().
 *
 * @param {number} valence
 * @param {number} arousal
 * @param {{ saturationBoost?: number, front?: number, hot?: number,
 *           whisper?: number, back?: number,
 *           whisperShift?: number, hotShift?: number }} [opts]
 * @returns {{ mid:number[], front:number[], hot:number[], whisper:number[], back:number[],
 *             primary: Emotion, secondary: Emotion }}
 */
export function harmonicPalette(valence, arousal, opts = {}) {
  const near = nearestEmotions(valence, arousal);
  const primary = near.primary;
  const secondary = near.secondary;

  const {
    // Multiplier on the primary anchor saturation.
    saturationBoost = 1.0,
    // Lightness targets for each stop.
    front   = 0.66,
    hot     = 0.82,
    whisper = 0.52,
    back    = 0.22,
    // How far the hot stop tilts toward the secondary emotion (as a
    // fraction of the primary→secondary hue delta). 0 = pure primary
    // highlight, 1 = fully at secondary hue. Default is a whisper.
    hotShift = 0.55,
    // How far the whisper stop lies past the secondary (used to pull
    // in one analogous step further around the wheel).
    whisperShift = 1.7,
  } = opts;

  const primaryHsl = _rgbToHsl01(..._hexToRgb01(primary.hex));
  const baseSat = Math.min(1, Math.max(primaryHsl.s, 0.55) * saturationBoost);

  // Delta from primary to secondary in unit turns, shortest path.
  const dTurns = _hueDeltaTurns(primary.angle, secondary.angle);

  // mid — primary anchor at its full colour, mid-lightness
  const mid = _hslToRgb01({ h: primaryHsl.h, s: baseSat, l: primaryHsl.l });

  // front — primary hue lifted for the bright pass
  const frontStop = _hslToRgb01({
    h: primaryHsl.h,
    s: Math.max(0.5, baseSat * 0.9),
    l: front,
  });

  // hot — tilt toward secondary hue at high L (Rothko highlight bleed)
  const hotHue = (primaryHsl.h + dTurns * hotShift + 1) % 1;
  const hotStop = _hslToRgb01({
    h: hotHue,
    s: Math.max(0.45, baseSat * 0.8),
    l: hot,
  });

  // whisper — one analogous step past the secondary, quiet saturation
  const whisperHue = (primaryHsl.h + dTurns * whisperShift + 1) % 1;
  const whisperStop = _hslToRgb01({
    h: whisperHue,
    s: Math.max(0.35, baseSat * 0.55),
    l: whisper,
  });

  // back — primary hue, deep shadow
  const backStop = _hslToRgb01({
    h: primaryHsl.h,
    s: baseSat,
    l: back,
  });

  return {
    mid, front: frontStop, hot: hotStop, whisper: whisperStop, back: backStop,
    primary, secondary,
  };
}

/**
 * Full emotion record for the current (v,a) point. Useful when the
 * fluid engine or UI needs mood/comp metadata alongside the color.
 *
 * @param {number} valence
 * @param {number} arousal
 * @returns {Emotion}
 */
export function emotionAt(valence, arousal) {
  return nearestEmotions(valence, arousal).primary;
}
