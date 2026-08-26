/**
 * Empathic Art — EEG band-power analysis
 *
 * Turns raw per-electrode µV samples into per-channel and aggregate band
 * powers. The pipeline follows the one proven in the nouscope project:
 *
 *   1. Per channel, a Hann-windowed DFT over the most recent 1 s of samples
 *      (256 samples at 256 Hz → 1 Hz bin resolution).
 *   2. Per-channel signal quality from windowed RMS; up to two bad channels
 *      are dropped and the survivors are combined as a quality-weighted mean.
 *   3. An aperiodic (1/f) background model — log₁₀(P) = a + b·log₁₀(f),
 *      refit periodically and EMA-smoothed — divides each band by its
 *      expected background power.
 *   4. The result is renormalised to sum to 1 across the active bands.
 *
 * Step 3 is what makes the output usable as an emotion signal. Raw EEG power
 * falls off as 1/f, so without it delta and theta swamp everything and the
 * numbers mostly track electrode impedance rather than the person wearing the
 * headband. After the correction, a band's value says how far it stands above
 * *its own* expected background — which is what "strong alpha" actually means.
 *
 * Delta is computed and reported but excluded from the normalisation by
 * default: it is large, movement-prone, and would otherwise dominate.
 *
 * @author  Bob Dougherty
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EEG_FS } from "./muse-ble.js?v=1.6.4.0";

const N = 256;                 // analysis window (1 s at 256 Hz)
const HOP = 128;               // recompute every 128 new samples (~2 Hz, 50% overlap)
const MAX_BIN = 45;            // highest DFT bin we need (Hz, == bin index at 1 Hz/bin)

// Every band edge below is written in Hz, which is only the same thing as a
// bin index while the window holds exactly one second of samples. Fail loudly
// rather than silently mislabelling every band if that ever stops being true.
if (N !== EEG_FS) {
  throw new Error(`muse-bands: analysis window (${N}) must equal the sample rate (${EEG_FS}) for 1 Hz bins.`);
}

export const BAND_KEYS = ["delta", "theta", "alpha", "beta", "gamma"];

/** Inclusive DFT bin ranges (Hz) per band. */
const BAND_BINS = {
  delta: [1, 3],
  theta: [4, 7],
  alpha: [8, 12],
  beta:  [13, 29],
  gamma: [30, 45],
};

/** Representative centre frequency per band, for the 1/f model. */
const BAND_FREQ = { delta: 2, theta: 6, alpha: 10, beta: 20, gamma: 40 };

/** Bands that participate in the relative-power sum (delta deliberately absent). */
const ACTIVE_BANDS = ["theta", "alpha", "beta", "gamma"];

// Signal-quality RMS thresholds in µV, after mean removal.
const SQ_GOOD = 50;
const SQ_POOR = 100;
const SQ_FLAT = 0.5;           // below this the electrode is flat-lining, not quiet

// Aperiodic model refit cadence and smoothing.
const AP_REFIT_EVERY = 10;     // analysis windows (~5 s)
const AP_SMOOTH = 0.3;         // EMA on the fitted coefficients
const AP_MIN_REFITS = 3;       // warm-up: no output until the model has settled

// EMA on the emitted band powers — ~1.5 s settling at a 2 Hz update rate.
const BAND_SMOOTH = 0.35;

const QUALITY_SCORE = { good: 2, marginal: 1, poor: 0 };
const QUALITY_WEIGHT = { good: 1.0, marginal: 0.5, poor: 0.0 };

/** Ordinary-least-squares fit of y = a + b·x. */
function linReg(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return { a: sy / n, b: 0 };
  const b = (n * sxy - sx * sy) / denom;
  return { a: (sy - b * sx) / n, b };
}

/**
 * Streaming band-power analyser for a 4-channel Muse.
 *
 * Feed it packets with `push(channelIndex, samples)`; it calls `onBands` at
 * roughly 2 Hz with:
 *
 * ```js
 * {
 *   bands:      { delta, theta, alpha, beta, gamma },   // relative, active bands sum to 1
 *   perChannel: [{ delta, theta, alpha, beta, gamma }, …],  // raw µV², TP9/AF7/AF8/TP10
 *   quality:    ["good"|"marginal"|"poor", …],
 *   weights:    [number, …],       // normalised channel weights used for the aggregate
 *   ready:      boolean,           // false while the 1/f model warms up (~15 s)
 *   timestamp:  number,            // Date.now()
 * }
 * ```
 */
export class BandAnalyser {
  constructor({ onBands } = {}) {
    this.onBands = onBands ?? null;

    this._buffers = [[], [], [], []];
    this._hop = 0;
    this._quality = ["poor", "poor", "poor", "poor"];
    this._apModel = { a: 0, b: -1.5 };
    this._apWindows = 0;
    this._apRefits = 0;
    this._smoothed = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };

    this._precompute();
  }

  /** Latest relative band powers (active bands sum to 1 once `ready`). */
  get bands() { return { ...this._smoothed }; }

  /** True once the aperiodic model has converged and output is meaningful. */
  get ready() { return this._apRefits >= AP_MIN_REFITS; }

  /** Per-channel signal quality, in TP9/AF7/AF8/TP10 order. */
  get quality() { return [...this._quality]; }

  /** Drop all accumulated state — call on reconnect. */
  reset() {
    this._buffers = [[], [], [], []];
    this._hop = 0;
    this._quality = ["poor", "poor", "poor", "poor"];
    this._apModel = { a: 0, b: -1.5 };
    this._apWindows = 0;
    this._apRefits = 0;
    this._smoothed = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
  }

  /**
   * Feed one packet of samples for one electrode.
   * @param {number} ch — channel index 0–3
   * @param {number[]} samples — µV
   */
  push(ch, samples) {
    if (ch < 0 || ch > 3) return;
    const buf = this._buffers[ch];
    for (const s of samples) buf.push(Number.isFinite(s) ? s : 0);
    while (buf.length > N) buf.shift();

    // Channel 0 paces the analysis; the four electrodes stream in lockstep.
    if (ch !== 0) return;
    this._hop += samples.length;
    if (this._hop < HOP) return;
    this._hop = 0;
    if (this._buffers.every((b) => b.length >= N)) this._analyse();
  }

  // ── internals ────────────────────────────────────────────────────────────

  _analyse() {
    this._updateQuality();

    const perChannel = this._buffers.map((buf) => this._channelBands(buf));
    const weights = this._channelWeights();
    const totalW = weights.reduce((a, b) => a + b, 0);

    const raw = {};
    for (const band of BAND_KEYS) {
      let sum = 0;
      for (let ch = 0; ch < 4; ch++) sum += perChannel[ch][band] * weights[ch];
      raw[band] = totalW > 0 ? sum / totalW : 0;
    }

    if (++this._apWindows >= AP_REFIT_EVERY) {
      this._apWindows = 0;
      this._refitAperiodic(raw);
    }

    const rel = this._normalise(raw);
    for (const band of BAND_KEYS) {
      this._smoothed[band] += BAND_SMOOTH * (rel[band] - this._smoothed[band]);
    }

    this.onBands?.({
      bands: { ...this._smoothed },
      perChannel,
      quality: [...this._quality],
      weights,
      ready: this.ready,
      timestamp: Date.now(),
    });
  }

  /** Hann-windowed DFT power summed into bands, for one channel. */
  _channelBands(buf) {
    const spectrum = new Float64Array(MAX_BIN + 1);
    for (let k = 1; k <= MAX_BIN; k++) {
      const { re, im } = this._twiddles[k];
      let r = 0, m = 0;
      for (let n = 0; n < N; n++) {
        const s = buf[n];
        r += re[n] * s;
        m += im[n] * s;
      }
      spectrum[k] = r * r + m * m;
    }

    const out = {};
    for (const band of BAND_KEYS) {
      const [lo, hi] = BAND_BINS[band];
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += spectrum[k];
      // Mean power per bin keeps wide bands (beta, gamma) comparable to narrow ones.
      out[band] = sum / (hi - lo + 1);
    }
    return out;
  }

  _updateQuality() {
    for (let ch = 0; ch < 4; ch++) {
      const buf = this._buffers[ch];
      if (buf.length < N) { this._quality[ch] = "poor"; continue; }
      let mean = 0;
      for (let i = 0; i < N; i++) mean += buf[i];
      mean /= N;
      let acc = 0;
      for (let i = 0; i < N; i++) acc += (buf[i] - mean) ** 2;
      const rms = Math.sqrt(acc / N);
      // A dead electrode reads as an implausibly clean trace, not a noisy one.
      if (rms < SQ_FLAT)      this._quality[ch] = "poor";
      else if (rms < SQ_GOOD) this._quality[ch] = "good";
      else if (rms < SQ_POOR) this._quality[ch] = "marginal";
      else                    this._quality[ch] = "poor";
    }
  }

  /**
   * Normalised per-channel weights.
   *
   * At most two channels are explicitly dropped, but a channel that survives
   * the drop can still end up weighted 0 for being poor — so a headband with
   * one clean electrode really does aggregate from that electrode alone
   * (weights `[0, 1, 0, 0]`). That is deliberate: one good channel beats an
   * average contaminated by three bad ones. The equal-weight fallback below
   * only engages when nothing is usable at all.
   */
  _channelWeights() {
    const candidates = [0, 1, 2, 3]
      .filter((ch) => QUALITY_SCORE[this._quality[ch]] === 0)
      .sort((a, b) => QUALITY_SCORE[this._quality[a]] - QUALITY_SCORE[this._quality[b]]);
    const dropped = new Set(candidates.slice(0, 2));

    const w = this._quality.map((q, ch) => (dropped.has(ch) ? 0 : QUALITY_WEIGHT[q]));
    const total = w.reduce((a, b) => a + b, 0);
    if (total > 0) return w.map((x) => x / total);

    const kept = [0, 1, 2, 3].filter((ch) => !dropped.has(ch));
    const eq = kept.length ? 1 / kept.length : 0;
    return [0, 1, 2, 3].map((ch) => (kept.includes(ch) ? eq : 0));
  }

  /** Refit log₁₀(P) = a + b·log₁₀(f) across the active band centre frequencies. */
  _refitAperiodic(raw) {
    const logF = ACTIVE_BANDS.map((b) => Math.log10(BAND_FREQ[b]));
    const logP = ACTIVE_BANDS.map((b) => (raw[b] > 0 ? Math.log10(raw[b]) : -10));
    const { a, b } = linReg(logF, logP);
    // The first fit replaces the placeholder outright; later fits ease in.
    const k = this._apRefits === 0 ? 1 : AP_SMOOTH;
    this._apModel.a = (1 - k) * this._apModel.a + k * a;
    this._apModel.b = (1 - k) * this._apModel.b + k * b;
    this._apRefits++;
  }

  /** Divide by the modelled 1/f background, then renormalise the active bands to sum 1. */
  _normalise(raw) {
    const out = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
    if (!this.ready) return out;

    const { a, b } = this._apModel;
    let total = 0;
    for (const band of ACTIVE_BANDS) {
      const expected = Math.pow(10, a + b * Math.log10(BAND_FREQ[band]));
      out[band] = raw[band] > 0 && expected > 0 ? raw[band] / expected : 0;
      total += out[band];
    }
    // Delta rides along for display but stays out of the sum.
    const deltaExpected = Math.pow(10, a + b * Math.log10(BAND_FREQ.delta));
    out.delta = raw.delta > 0 && deltaExpected > 0 ? raw.delta / deltaExpected : 0;

    if (total <= 0) {
      for (const band of ACTIVE_BANDS) out[band] = 1 / ACTIVE_BANDS.length;
      return out;
    }
    for (const band of ACTIVE_BANDS) out[band] /= total;
    // Keep delta on the same scale as its neighbours so the lanes read together.
    out.delta = Math.min(1, out.delta / (total || 1));
    return out;
  }

  _precompute() {
    const hann = new Float64Array(N);
    for (let n = 0; n < N; n++) hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));

    this._twiddles = new Array(MAX_BIN + 1);
    for (let k = 1; k <= MAX_BIN; k++) {
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let n = 0; n < N; n++) {
        // Bin k sits at exactly k Hz because N === EEG_FS.
        const angle = (2 * Math.PI * k * n) / N;
        re[n] = hann[n] * Math.cos(angle);
        im[n] = hann[n] * Math.sin(angle);
      }
      this._twiddles[k] = { re, im };
    }
  }
}

export { N as ANALYSIS_WINDOW, EEG_FS };
