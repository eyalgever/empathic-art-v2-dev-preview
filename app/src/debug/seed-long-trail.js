/**
 * Empathic App — Debug Preset: Long Trail
 *
 * Generates a long synthetic sample trail for screenshots and demos, so a
 * rich, fully-colored circumplex path is visible immediately without
 * waiting out a real session. Enabled via ?debug=1&preset=long-trail
 * (see src/debug/debug-overlay.js).
 *
 * The trail traverses twelve anchor emotions in sequence:
 *   Fear -> Anger -> Awe -> Elation -> Joy -> Excitement -> Love ->
 *   Peace -> Serenity -> Sadness -> Melancholy -> Apathy
 *
 * Each leg eases smoothly from one anchor's (v, a) coordinates to the
 * next, with small organic jitter added so the path doesn't look like a
 * mechanical straight-line interpolation.
 *
 * Sample shape matches src/store/session-store.js's documented
 * `samples:[{t,v,a,o,label,hex}]` history entry, and mirrors the frame
 * fields produced by src/muse/muse-source.js during a live session.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS } from "../palette/emotion-palette.js?v=1.3.1";

const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const PATH_NAMES = [
  "Fear",
  "Anger",
  "Awe",
  "Elation",
  "Joy",
  "Excitement",
  "Love",
  "Peace",
  "Serenity",
  "Sadness",
  "Melancholy",
  "Apathy",
];

const TOTAL_SAMPLES = 5000;

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

function anchorFor(name) {
  const e = EMOTIONS.find((x) => x.name === name);
  if (!e) throw new Error(`seed-long-trail: unknown emotion "${name}"`);
  return e;
}

/**
 * Build ~5000 synthetic samples that walk the circumplex through the
 * twelve-emotion path above, evenly spaced in time.
 *
 * @param {number} [totalMs=600000] Total synthetic duration the trail
 *   should span (default 10 minutes), used only to space out `t` values.
 * @returns {Array<{t:number, v:number, a:number, o:number, label:string, hex:string}>}
 */
export function buildLongTrail(totalMs = 10 * 60 * 1000) {
  const anchors = PATH_NAMES.map(anchorFor);
  const legCount = anchors.length - 1;
  const samplesPerLeg = Math.floor(TOTAL_SAMPLES / legCount);
  const samples = [];

  let sampleIndex = 0;
  for (let leg = 0; leg < legCount; leg++) {
    const A = anchors[leg];
    const B = anchors[leg + 1];
    for (let i = 0; i < samplesPerLeg; i++) {
      const tLeg = i / samplesPerLeg;
      const e = easeInOutSine(tLeg);

      // Small organic jitter so the path isn't a perfectly straight arc.
      const jitter = 0.02;
      const nv = jitter * Math.sin(sampleIndex * 0.31 + 1.1);
      const na = jitter * Math.cos(sampleIndex * 0.27 + 0.6);

      const v = CLAMP(A.v + (B.v - A.v) * e + nv, -1, 1);
      const a = CLAMP(A.a + (B.a - A.a) * e + na, -1, 1);
      const o = CLAMP(0.5 + 0.2 * Math.sin(sampleIndex * 0.05), 0, 1);

      // Label/hex reflect the anchor we're departing from for the first
      // half of the leg, and the anchor we're arriving at for the second
      // half — this keeps word-reveal transitions roughly mid-leg, similar
      // to the nearest-anchor snapping used during a live session.
      const nearer = tLeg < 0.5 ? A : B;

      samples.push({
        t: Math.round((sampleIndex / TOTAL_SAMPLES) * totalMs),
        v,
        a,
        o,
        label: nearer.name,
        hex: nearer.hex,
      });
      sampleIndex++;
    }
  }

  return samples;
}

/**
 * Seed the long-trail preset into the running app.
 *
 * TODO: wire into SessionStore.commitSession({ samples, crossings,
 * dominantEmotion }) — see src/store/session-store.js for the sample
 * shape. SessionStore currently exposes no public method for injecting
 * samples into an in-progress session; commitSession() only accepts a
 * finished session's full sample array. Until that hook exists, this
 * function only builds and returns the synthetic array so callers
 * (or a future debug-overlay wiring) can pass it into commitSession()
 * directly, e.g.:
 *
 *   const samples = buildLongTrail();
 *   sessionStore.commitSession({
 *     samples,
 *     crossings: [],
 *     dominantEmotion: { name: samples[samples.length - 1].label,
 *                        hex: samples[samples.length - 1].hex },
 *   });
 *
 * @returns {Array<{t:number, v:number, a:number, o:number, label:string, hex:string}>}
 */
export function seedLongTrail() {
  const samples = buildLongTrail();
  try {
    // eslint-disable-next-line no-console
    console.info(`[debug] seed-long-trail: generated ${samples.length} samples across ${PATH_NAMES.join(" -> ")}`);
  } catch {}
  return samples;
}
