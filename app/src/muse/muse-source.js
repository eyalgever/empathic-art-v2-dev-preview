/**
 * Empathic App — Muse Source
 *
 * A unified interface that emits emotion frames { valence, arousal,
 * openness, timestamp } at ~30 Hz. Supports two modes:
 *
 *   'sim'  — a SCRIPTED emotional journey across the Russell circumplex,
 *            timed to the sound-journey track. From the user-selected
 *            seed we build a waypoint arc that visits several emotions
 *            (their names appear as reveals on screen). See _buildJourney().
 *
 *   'live' — a real headband. connect() throws if no adapter has been
 *            registered via MuseSource.registerLiveAdapter(); the shipped
 *            web adapter is MuseLiveAdapter in muse-live-adapter.js
 *            (Web Bluetooth), and the iPhone build registers its own
 *            CoreBluetooth-backed adapter instead. Both paths land here in
 *            the same shape, so everything downstream is unaware of which
 *            one is running.
 *
 * Frames are dispatched via a subscriber callback so the fluid engine
 * doesn't need to poll. In sim mode the source also emits
 * "emotionChange" events (via onEmotionChange) each time we cross into
 * a new anchor emotion — those events drive the on-screen word reveal.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS, nearestEmotions } from "../palette/emotion-palette.js?v=1.3.1";
import { getScenario } from "./sim-scenarios.js?v=1.6.4.24";

const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Named waypoint helper — resolves an emotion by name to its
// canonical (v, a) coordinates. Anything not in the lexicon falls
// back to a soft center.
function emotionCoords(name) {
  const e = EMOTIONS.find((x) => x.name === name);
  return e ? { v: e.v, a: e.a } : { v: 0.2, a: 0 };
}

// Ease functions used to shape the arc between waypoints.
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine  = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeInQuart    = (t) => t * t * t * t;
const easeOutQuart   = (t) => 1 - Math.pow(1 - t, 4);
const EASES = { easeInOutCubic, easeInOutSine, easeInQuart, easeOutQuart };

/**
 * Build a scripted journey through the circumplex, seeded from the
 * user's starting point on the Before-Session screen. The arc always
 * begins and ends near the seed, and passes through 6–8 anchor
 * emotions along the way. Total duration is the audio track duration
 * (or a default fallback).
 *
 * Journey shape (ten "movements"):
 *   1. Seed          — where the user marked themselves
 *   2. Contemplation — first inward turn
 *   3. Sadness       — descent
 *   4. Melancholy    — pause in the low-valence world
 *   5. Anger / Fear  — surge (chosen by seed sign of arousal)
 *   6. Stress        — release
 *   7. Awe           — first opening
 *   8. Joy / Elation — high point (chosen by seed sign of valence)
 *   9. Serenity      — glide down
 *  10. Peace         — resolution close to seed
 *
 * Each waypoint has: (v, a, o, hold_seconds, ease).
 *
 * @param {{valence:number, arousal:number, openness:number}} seed
 * @param {number} totalSeconds
 * @returns {Array<{v:number, a:number, o:number, at:number, ease:string}>}
 */
function _buildJourney(seed, totalSeconds, scenarioId) {
  const s = {
    v: CLAMP(seed.valence ?? 0, -1, 1),
    a: CLAMP(seed.arousal ?? 0, -1, 1),
    o: CLAMP(seed.openness ?? 0.5, 0, 1),
  };

  // v1.6.4.24 -- Named scenario support. When a scenario id is supplied
  // (from the Simulate scenario picker) we use its curated leg list instead
  // of the default seed-derived arc. This lets demos hit predictable beats
  // (Storm, Elation arc, Deep calm) instead of always walking the same
  // full-circuit path.
  const scenario = scenarioId ? getScenario(scenarioId) : null;
  let legs;
  if (scenario) {
    // Scenario legs are declared with the same shape the default arc uses.
    // SEED entries use the caller's seed for the origin waypoint; all other
    // entries pull their circumplex coords from the emotion palette.
    legs = scenario.legs.map((leg) => ({
      name: leg.name,
      w: leg.w,
      o: leg.name === "SEED" ? s.o : leg.o,
    }));
  } else {
    const surgeName = s.a >= 0 ? "Anger" : "Fear";
    const peakName  = s.v >= 0 ? "Joy"   : "Elation";

    // Sequence of waypoints. Each entry: [name-or-seed, weight, openness].
    // Weights sum to 1 and control what fraction of the track each leg
    // occupies -- most weight sits in the middle 'surge' and 'peak'
    // sections so the journey feels dramatic against the music.
    legs = [
      { name: "SEED",         w: 0.06, o: s.o                       },
      { name: "Contemplation",w: 0.10, o: Math.max(0.35, s.o - 0.10)},
      { name: "Sadness",      w: 0.10, o: 0.30                      },
      { name: "Melancholy",   w: 0.10, o: 0.28                      },
      { name: surgeName,      w: 0.12, o: 0.55                      },
      { name: "Stress",       w: 0.08, o: 0.50                      },
      { name: "Awe",          w: 0.10, o: 0.72                      },
      { name: peakName,       w: 0.14, o: 0.85                      },
      { name: "Serenity",     w: 0.10, o: 0.70                      },
      { name: "Peace",        w: 0.10, o: 0.65                      },
    ];
  }

  // Convert weights to cumulative time offsets.
  let t = 0;
  return legs.map((leg, i) => {
    const dur = leg.w * totalSeconds;
    const at = t;
    t += dur;
    const coords = leg.name === "SEED" ? { v: s.v, a: s.a } : emotionCoords(leg.name);
    return {
      v: coords.v,
      a: coords.a,
      o: leg.o,
      at,       // start-of-leg time in seconds
      ease: i % 2 === 0 ? "easeInOutSine" : "easeInOutCubic",
    };
  });
}

export class MuseSource {
  static _liveAdapter = null;

  static registerLiveAdapter(adapter) {
    MuseSource._liveAdapter = adapter;
  }

  constructor() {
    this._mode = null;
    this._seed = { valence: 0, arousal: 0, openness: 0.5 };
    this._current = { ...this._seed };
    this._raf = null;
    this._lastEmit = 0;
    this._subscribers = new Set();
    this._emotionSubscribers = new Set();
    this._t0 = 0;
    this._journey = null;
    this._totalMs = 10 * 60 * 1000; // default 10:00, replaced by setDuration
    this._lastEmotionName = null;
    this._paused = false;
  }

  setSeed(seed) {
    this._seed = {
      valence:  CLAMP(seed.valence ?? 0, -1, 1),
      arousal:  CLAMP(seed.arousal ?? 0, -1, 1),
      openness: CLAMP(seed.openness ?? 0.5, 0, 1),
    };
    this._current = { ...this._seed };
  }

  /**
   * Set the total journey duration (must match the sound track). Called
   * once we know audio.duration. Rebuilds the journey immediately.
   * @param {number} ms
   */
  setDuration(ms) {
    this._totalMs = Math.max(60_000, ms | 0);
    if (this._seed) {
      // v1.6.4.24 -- Honour any scenario the caller selected via connect()
      // when we rebuild after learning the true track duration. If none is
      // set we fall back to the default seed-derived arc.
      this._journey = _buildJourney(this._seed, this._totalMs / 1000, this._scenarioId || null);
    }
  }

  /**
   * Subscribe to raw frames.
   * @param {(frame:{valence:number,arousal:number,openness:number,timestamp:number})=>void} cb
   */
  subscribe(cb) {
    this._subscribers.add(cb);
    return () => this._subscribers.delete(cb);
  }

  /**
   * Subscribe to significant emotion changes (word-reveal driver).
   * The callback is called with { name, hex, from, to, at } whenever the
   * nearest-anchor emotion changes.
   * @param {(evt:{name:string, hex:string, from:string, to:string, at:number})=>void} cb
   */
  onEmotionChange(cb) {
    this._emotionSubscribers.add(cb);
    return () => this._emotionSubscribers.delete(cb);
  }

  /**
   * The last waypoint the journey passed. Useful for the muse-data
   * overlay.
   * @returns {{v:number, a:number, o:number, name:string, journeyProgress:number}}
   */
  snapshot() {
    const { primary } = nearestEmotions(this._current.valence, this._current.arousal);
    return {
      v: this._current.valence,
      a: this._current.arousal,
      o: this._current.openness,
      name: primary.name,
      // In live mode there is no scripted journey, but elapsed-vs-track-length
      // is still the number the panel's progress bar wants.
      journeyProgress: (this._journey || this._mode === "live")
        ? (performance.now() - this._t0) / this._totalMs
        : 0,
    };
  }

  /**
   * @param {'sim'|'live'} mode
   * @param {{scenarioId?: string}} [opts]  Sim-only. When scenarioId is set the
   *   corresponding curated journey (see sim-scenarios.js) drives the arc,
   *   overriding the default seed-derived path.
   */
  async connect(mode = "sim", opts) {
    this._mode = mode;
    this._t0 = performance.now();
    this._paused = false;
    // Remember the scenario across pause / resume cycles.
    this._scenarioId = (opts && opts.scenarioId) || null;

    if (mode === "live") {
      if (!MuseSource._liveAdapter) {
        throw new Error("MuseSource: no live adapter registered. Falling back to sim recommended.");
      }
      // Hand the adapter the user's own circumplex placement if it can use
      // one -- the live signal is a deviation from a personal baseline, so it
      // needs somewhere to start from while that baseline calibrates.
      MuseSource._liveAdapter.setSeed?.(this._seed);
      await MuseSource._liveAdapter.start((frame) => this._ingestLive(frame));
      return;
    }

    // sim: RAF loop stepping through the scripted journey. Force a fresh
    // journey when a scenario id is supplied so switching scenarios between
    // sessions actually takes effect.
    if (!this._journey || this._scenarioId) {
      this._journey = _buildJourney(this._seed, this._totalMs / 1000, this._scenarioId);
    }

    const loop = (now) => {
      if (this._paused) {
        this._raf = requestAnimationFrame(loop);
        return;
      }
      const tSec = (now - this._t0) / 1000;

      // Find which leg we're in.
      const legs = this._journey;
      let iA = 0;
      for (let i = 0; i < legs.length; i++) {
        if (legs[i].at <= tSec) iA = i;
        else break;
      }
      const iB = Math.min(iA + 1, legs.length - 1);
      const A = legs[iA];
      const B = legs[iB];
      const legDur = Math.max(0.5, (iB === iA ? 30 : (B.at - A.at)));
      const tLeg = CLAMP((tSec - A.at) / legDur, 0, 1);
      const e = (EASES[A.ease] || easeInOutSine)(tLeg);

      // Sinusoidal micro-noise so the arc feels organic (very small).
      const jitter = 0.025;
      const nv = jitter * Math.sin(tSec * 0.31 + 1.1);
      const na = jitter * Math.cos(tSec * 0.27 + 0.6);
      const no = jitter * 0.5 * Math.sin(tSec * 0.19);

      this._current = {
        valence:  CLAMP(A.v + (B.v - A.v) * e + nv, -1, 1),
        arousal:  CLAMP(A.a + (B.a - A.a) * e + na, -1, 1),
        openness: CLAMP(A.o + (B.o - A.o) * e + no,  0, 1),
      };

      if (now - this._lastEmit >= 33) {
        this._lastEmit = now;
        this._emit({ ...this._current, timestamp: now });
        this._fireEmotionChange(tSec);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  pause() { this._paused = true;  }
  resume() { this._paused = false; }

  disconnect() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._mode === "live" && MuseSource._liveAdapter) {
      MuseSource._liveAdapter.stop();
    }
    this._mode = null;
    this._lastEmotionName = null;
  }

  /**
   * Live-mode counterpart to the sim loop's per-tick body. The adapter owns
   * the cadence and the smoothing; we own the app-facing side effects, so
   * live and simulated sessions produce identical downstream behaviour
   * (current-state snapshot, word reveals, trail, entropy readout).
   *
   * Extra fields the adapter attaches — `bands`, `calibrating` — ride along
   * untouched for subscribers that want them.
   *
   * @param {{valence:number, arousal:number, openness:number, timestamp:number}} frame
   */
  _ingestLive(frame) {
    if (this._paused) return;
    this._current = {
      valence:  CLAMP(frame.valence  ?? 0,   -1, 1),
      arousal:  CLAMP(frame.arousal  ?? 0,   -1, 1),
      openness: CLAMP(frame.openness ?? 0.5,  0, 1),
    };
    this._emit(frame);
    this._fireEmotionChange((performance.now() - this._t0) / 1000);
  }

  /**
   * Emit an emotion-change event when the nearest anchor changes. The first
   * fire always goes out (with from: null) so the label reveals on session
   * start rather than waiting for the first transition.
   * @param {number} tSec — seconds since connect()
   */
  _fireEmotionChange(tSec) {
    const { primary } = nearestEmotions(this._current.valence, this._current.arousal);
    if (primary.name === this._lastEmotionName) return;
    const from = this._lastEmotionName;
    this._lastEmotionName = primary.name;
    for (const cb of this._emotionSubscribers) {
      cb({ name: primary.name, hex: primary.hex, from, to: primary.name, at: tSec });
    }
  }

  _emit(frame) {
    for (const cb of this._subscribers) cb(frame);
  }
}
