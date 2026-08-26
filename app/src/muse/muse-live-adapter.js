/**
 * Empathic Art — Muse live adapter
 *
 * The bridge between EEG band powers and the app's emotion contract. Register
 * an instance with `MuseSource.registerLiveAdapter()` and `connect("live")`
 * starts emitting real frames in place of the scripted journey.
 *
 * ── The mapping ───────────────────────────────────────────────────────────
 *
 * Three raw metrics come out of the band analyser, each with a defensible
 * basis in the EEG literature and each deliberately simple:
 *
 *   valence  ← frontal alpha asymmetry: ln(alpha_AF8) − ln(alpha_AF7).
 *              Alpha power is inversely related to cortical activation, and
 *              relatively greater LEFT-frontal activation is the long-standing
 *              correlate of approach/positive affect. Less left alpha than
 *              right therefore reads as positive valence.
 *
 *   arousal  ← ln(beta / (alpha + theta)). The classic engagement ratio:
 *              fast activity rising against slow activity means alert.
 *
 *   openness ← the alpha + theta share of relative power, the signature of
 *              relaxed, absorbed, eyes-soft attention.
 *
 * ── Why the calibration matters more than the mapping ─────────────────────
 *
 * Absolute EEG values differ enormously between people, and between sessions
 * with the same person, mostly for reasons that have nothing to do with mood
 * (skull thickness, hair, how damp the electrodes are). A fixed threshold
 * would read as "this user is permanently anxious" on one head and
 * "permanently flat" on the next. So every metric is z-scored against a
 * running EMA mean and variance of *that user, this session*, then squashed
 * through tanh into the app's [-1, 1] range. What reaches the canvas is the
 * person's movement relative to their own baseline, not an absolute claim
 * about their emotional state.
 *
 * For the same reason the first `CALIBRATION_MS` blends from the user's
 * self-reported seed toward the live signal rather than snapping to it: until
 * the baseline has seen some spread, the z-scores are noise.
 *
 * This is an expressive mapping for an artwork, not a clinical measure — the
 * honest framing is that the painting responds to your brain activity, not
 * that it knows how you feel.
 *
 * @author  Bob Dougherty
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { requestMuseDevice, isWebBluetoothAvailable, AF7, AF8, CHANNEL_NAMES } from "./muse-ble.js?v=1.6.4.0";
import { BandAnalyser } from "./muse-bands.js?v=1.6.4.0";

const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Frame cadence, matched to the simulated source (~30 Hz). */
const FRAME_MS = 33;

/** Time constant for the running baseline, in seconds. */
const BASELINE_TAU = 90;

/** Blend-in window before the live signal is trusted on its own. */
const CALIBRATION_MS = 20000;

/**
 * Smoothing applied to the emitted frame. EEG band power is jittery window to
 * window; the canvas is a slow fluid. At 30 Hz this is roughly a 1 s time
 * constant, which stacks with the analyser's own ~1.5 s band smoothing for a
 * signal that answers in about two seconds — responsive enough to feel caused
 * by you, slow enough not to twitch.
 */
const FRAME_SMOOTH = 0.035;

/**
 * Standard deviations of the user's own baseline that map to a fully
 * committed axis. At 2.0, a two-sigma excursion reads ~0.76 of the way out,
 * so ordinary variation uses the middle of the circumplex and only a real
 * change in state reaches the edges.
 */
const Z_SCALE = 2.0;

/**
 * A single metric tracked against its own running mean and spread.
 * Welford-ish EMA: cheap, no history buffer, adapts as the session drifts.
 *
 * `minSpread` is load-bearing, not a guard against divide-by-zero. Dividing
 * by the observed standard deviation is what makes the mapping personal, but
 * it also means a very steady user gets an ever-shrinking denominator —
 * their tiniest fluctuation would swing the canvas corner to corner, and the
 * first seconds of any session (before the variance estimate has seen any
 * spread) would saturate for the same reason. The floor says: below this much
 * movement, treat it as stillness rather than amplifying it.
 */
class Baseline {
  constructor(minSpread, tauSeconds = BASELINE_TAU) {
    this._minSpread = minSpread;
    this._tau = tauSeconds;
    this._mean = null;
    this._var = 0;
    this._n = 0;
  }

  /**
   * Fold in a sample and return its z-score.
   * @param {number} x
   * @param {number} dt — seconds since the previous update
   */
  update(x, dt) {
    if (!Number.isFinite(x)) return 0;
    if (this._mean === null) { this._mean = x; this._var = 0; this._n = 1; return 0; }
    const k = 1 - Math.exp(-dt / this._tau);
    const d = x - this._mean;
    this._mean += k * d;
    this._var = (1 - k) * (this._var + k * d * d);
    this._n++;
    return d / Math.max(Math.sqrt(this._var), this._minSpread);
  }

  get samples() { return this._n; }
}

// Spread floors, in the units of each metric. The two log-ratio metrics share
// a floor of 0.15 natural-log units (~16%); openness works on a 0–1 power
// share, where a few percent is already a visible shift.
const MIN_SPREAD_LOG = 0.15;
const MIN_SPREAD_SHARE = 0.04;

/**
 * Live Muse adapter. Implements the `{ start, stop }` shape
 * `MuseSource.registerLiveAdapter()` expects, plus connection management the
 * UI can drive independently of session start.
 */
export class MuseLiveAdapter {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.batteryLevel = null;
    this.deviceName = null;

    /** Latest band snapshot, or null before the first analysis window. */
    this.lastBands = null;

    /** Optional UI callbacks. */
    this.onStatus = null;      // ({ connected, battery, quality, ready, deviceName })
    this.onBandsUpdate = null; // raw BandAnalyser payload

    this._analyser = new BandAnalyser({ onBands: (b) => this._handleBands(b) });
    this._frameCb = null;
    this._timer = null;
    this._t0 = 0;
    this._lastUpdate = 0;

    this._seed = { valence: 0, arousal: 0, openness: 0.5 };
    this._target = { ...this._seed };
    this._current = { ...this._seed };

    this._vBase = new Baseline(MIN_SPREAD_LOG);
    this._aBase = new Baseline(MIN_SPREAD_LOG);
    this._oBase = new Baseline(MIN_SPREAD_SHARE);

    this._debug = false;
    this._debugTimer = null;
  }

  /**
   * Log a live readout to the console once a second. Toggle at runtime with
   * `__EA__.museAdapter.debug = true`, or start the app with `?debug=1`.
   */
  get debug() { return this._debug; }

  set debug(on) {
    this._debug = !!on;
    clearInterval(this._debugTimer);
    this._debugTimer = null;
    if (this._debug && this.isConnected) {
      this._debugTimer = setInterval(() => this._logReadout(), 1000);
    }
  }

  /**
   * One line per second: the emitted frame, the band powers behind it, and
   * per-electrode contact. Contact is first on the list of things worth
   * seeing — most "the signal is dead" reports are a dry or lifted sensor,
   * and the band numbers are meaningless without knowing which electrodes
   * produced them.
   */
  _logReadout() {
    const b = this.lastBands;
    // Before the session starts nothing is driving _current, so show the live
    // mapped target instead — otherwise the readout looks frozen at the seed
    // while the headband is in fact streaming fine.
    const emitting = !!this._frameCb;
    const f = emitting ? this._current : this._target;
    const vao = `v ${f.valence >= 0 ? " " : ""}${f.valence.toFixed(2)}  ` +
                `a ${f.arousal >= 0 ? " " : ""}${f.arousal.toFixed(2)}  ` +
                `o ${f.openness.toFixed(2)}`;

    if (!b) { console.log(`[muse] ${vao} | waiting for first analysis window…`); return; }

    // Greek symbols rather than initials: "a" for alpha sitting next to "a"
    // for arousal in the same line is needlessly confusing.
    const SYM = { theta: "θ", alpha: "α", beta: "β", gamma: "γ", delta: "δ" };
    const bands = ["theta", "alpha", "beta", "gamma"]
      .map((k) => `${SYM[k]} ${b.bands[k].toFixed(2)}`).join("  ");
    const contact = b.quality
      .map((q, i) => `${CHANNEL_NAMES[i]} ${q === "good" ? "ok" : q === "marginal" ? "~" : "xx"}`)
      .join("  ");

    const notes = [];
    if (!b.ready) notes.push("warming up 1/f model");
    if (!emitting) notes.push("pre-session (showing live target, not a smoothed frame)");
    else if (performance.now() - this._t0 < CALIBRATION_MS) notes.push("blending seed → live");
    // Valence needs BOTH frontal electrodes; without them it is frozen, and
    // that is invisible in the number itself.
    if (!(b.weights[AF7] > 0 && b.weights[AF8] > 0)) notes.push("valence held (need AF7+AF8 contact)");
    const good = b.quality.filter((q) => q === "good").length;
    if (good < 2) notes.push(`only ${good}/4 electrodes good — reseat/re-wet`);

    console.log(
      `[muse] ${vao} | ${bands} | ${SYM.delta} ${b.bands.delta.toFixed(2)} | ${contact}` +
      `${this.batteryLevel == null ? "" : ` | ${this.batteryLevel}%`}` +
      `${notes.length ? `\n       ${notes.join(" · ")}` : ""}`,
    );
  }

  /**
   * Where to blend from during calibration — normally the user's own
   * placement on the Before-screen circumplex.
   */
  setSeed(seed) {
    if (!seed) return;
    this._seed = {
      valence:  CLAMP(seed.valence ?? 0, -1, 1),
      arousal:  CLAMP(seed.arousal ?? 0, -1, 1),
      openness: CLAMP(seed.openness ?? 0.5, 0, 1),
    };
    this._target = { ...this._seed };
    this._current = { ...this._seed };
  }

  /**
   * Show the device picker and connect. Must be called from a user gesture.
   * Streaming (and baseline calibration) begins immediately, before the
   * session does, so the signal is warm by the time the canvas needs it.
   */
  async connect() {
    this.client = await requestMuseDevice();
    this.client.onEEG = (ch, samples) => this._analyser.push(ch, samples);
    this.client.onBattery = (pct) => { this.batteryLevel = pct; this._emitStatus(); };
    this.client.onDisconnect = () => {
      this.isConnected = false;
      this.lastBands = null;
      this._analyser.reset();
      this._emitStatus();
    };

    await this.client.connect();
    this.isConnected = true;
    this.deviceName = this.client.deviceName;
    this._t0 = performance.now();
    // Re-run the setter so a debug flag set before connecting starts logging now.
    if (this._debug) this.debug = true;
    this._emitStatus();
  }

  /** Disconnect the headband and stop emitting. */
  async disconnect() {
    this.stop();
    clearInterval(this._debugTimer);
    this._debugTimer = null;
    if (this.client) {
      try { await this.client.disconnect(); } catch { /* already gone */ }
      this.client = null;
    }
    this.isConnected = false;
    this.lastBands = null;
    this._analyser.reset();
    this._emitStatus();
  }

  // ── MuseSource adapter contract ──────────────────────────────────────────

  /**
   * Begin emitting emotion frames.
   * @param {(frame:{valence:number,arousal:number,openness:number,timestamp:number,bands?:object}) => void} onFrame
   */
  start(onFrame) {
    if (!this.isConnected) {
      throw new Error("MuseLiveAdapter: connect() must succeed before start().");
    }
    this._frameCb = onFrame;
    this._t0 = performance.now();
    this._lastUpdate = performance.now();
    clearInterval(this._timer);
    this._timer = setInterval(() => this._emitFrame(), FRAME_MS);
  }

  /** Stop emitting frames. Leaves the headband connected. */
  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._frameCb = null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Fold a fresh band snapshot into the three metric baselines. */
  _handleBands(payload) {
    this.lastBands = payload;
    this.onBandsUpdate?.(payload);
    this._emitStatus();
    if (!payload.ready) return;

    const now = performance.now();
    const dt = Math.min(5, (now - this._lastUpdate) / 1000) || 0.5;
    this._lastUpdate = now;

    const { bands, perChannel, weights } = payload;

    // Valence — frontal alpha asymmetry. Only meaningful when both frontal
    // electrodes are contributing; otherwise hold the previous target.
    let vTarget = this._target.valence;
    if (weights[AF7] > 0 && weights[AF8] > 0) {
      const l = perChannel[AF7].alpha;
      const r = perChannel[AF8].alpha;
      if (l > 0 && r > 0) {
        const z = this._vBase.update(Math.log(r) - Math.log(l), dt);
        vTarget = Math.tanh(z / Z_SCALE);
      }
    }

    // Arousal — beta against the slow bands.
    const slow = bands.alpha + bands.theta;
    const aTarget = slow > 0
      ? Math.tanh(this._aBase.update(Math.log(bands.beta / slow + 1e-6), dt) / Z_SCALE)
      : this._target.arousal;

    // Openness — the slow-band share, recentred on the user's own baseline
    // so it uses the full 0–1 range instead of hugging whatever their
    // resting alpha happens to be.
    const oz = this._oBase.update(slow, dt);
    const oTarget = CLAMP(0.5 + 0.5 * Math.tanh(oz / Z_SCALE), 0, 1);

    this._target = {
      valence: CLAMP(vTarget, -1, 1),
      arousal: CLAMP(aTarget, -1, 1),
      openness: oTarget,
    };
  }

  /** Ease toward the target and hand a frame to MuseSource. */
  _emitFrame() {
    if (!this._frameCb) return;
    const now = performance.now();

    // Blend seed → live over the calibration window.
    const cal = CLAMP((now - this._t0) / CALIBRATION_MS, 0, 1);
    const blended = {
      valence:  this._seed.valence  + (this._target.valence  - this._seed.valence)  * cal,
      arousal:  this._seed.arousal  + (this._target.arousal  - this._seed.arousal)  * cal,
      openness: this._seed.openness + (this._target.openness - this._seed.openness) * cal,
    };

    this._current = {
      valence:  this._current.valence  + (blended.valence  - this._current.valence)  * FRAME_SMOOTH,
      arousal:  this._current.arousal  + (blended.arousal  - this._current.arousal)  * FRAME_SMOOTH,
      openness: this._current.openness + (blended.openness - this._current.openness) * FRAME_SMOOTH,
    };

    this._frameCb({
      valence:  CLAMP(this._current.valence, -1, 1),
      arousal:  CLAMP(this._current.arousal, -1, 1),
      openness: CLAMP(this._current.openness, 0, 1),
      timestamp: Date.now(),
      // Extra field, ignored by everything that does not want it. The
      // brain-wave lanes use it to draw real band powers instead of the
      // synthetic approximation.
      bands: this.lastBands ? this.lastBands.bands : null,
      calibrating: cal < 1,
    });
  }

  _emitStatus() {
    this.onStatus?.({
      connected: this.isConnected,
      battery: this.batteryLevel,
      quality: this._analyser.quality,
      ready: this._analyser.ready,
      deviceName: this.deviceName,
    });
  }
}

export { isWebBluetoothAvailable };
