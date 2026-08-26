/**
 * Empathic Art v2 — Sensing (Human.js adapter)
 * ──────────────────────────────────────────────────────────────────
 * Reads the front camera through Human.js, extracts facial expressions
 * and pulse-rate estimates, and drives the circumplex puck via
 * updateCircumplexPreview(v, a, o). Non-invasive: manual drag stays
 * available, this module only takes over the puck while the Sense
 * chip is engaged.
 *
 * The Human.js model is loaded lazily on first activation so page load
 * is not blocked by ~2MB of TFJS weights. Camera stops the moment the
 * chip is turned off, on visibility change, or when leaving Before.
 *
 * Emotion → V/A mapping is not a table lookup. Human returns an array
 * of {emotion, score} pairs across ~7 basic categories; we project
 * each category to a fixed point on the circumplex and take a
 * score-weighted centroid. Categories and coordinates come from Russell's
 * circumplex placements, keeping the puck consistent with our own labels.
 *
 * Nothing leaves the device. No frames uploaded, no logs, no ids.
 *
 * @author  Eyal Gever
 */

import { updateCircumplexPreview } from "../ui/circumplex-preview.js";

// Category → circumplex coordinates. Valence [-1, 1], arousal [-1, 1].
// These are Russell-consistent anchors; the actual puck settles between
// them as a confidence-weighted centroid.
const EMO_ANCHORS = {
  neutral:  { v:  0.00, a:  0.00 },
  happy:    { v:  0.75, a:  0.55 },
  surprise: { v:  0.30, a:  0.85 },
  sad:      { v: -0.70, a: -0.40 },
  angry:    { v: -0.70, a:  0.75 },
  fear:     { v: -0.65, a:  0.80 },
  disgust:  { v: -0.60, a:  0.20 },
};

// Human config — face + emotion only. Everything else off to keep the
// model download small and the phone cool.
const HUMAN_CONFIG = {
  backend: "webgl",
  modelBasePath: "https://cdn.jsdelivr.net/npm/@vladmandic/human/models/",
  filter:   { enabled: true, equalization: false },
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 1, return: false },
    mesh:     { enabled: true },
    iris:     { enabled: false },
    description: { enabled: false },
    emotion:  { enabled: true, minConfidence: 0.15 },
  },
  body:    { enabled: false },
  hand:    { enabled: false },
  gesture: { enabled: false },
  object:  { enabled: false },
};

// Smoothing factor for V/A (0 = frozen, 1 = jittery). Empathic art wants
// slow — the puck should drift, not twitch.
const SMOOTH_ALPHA = 0.08;

let _human = null;         // Human instance, lazy-loaded
let _humanLoading = null;  // Promise while first-loading
let _video = null;         // HTMLVideoElement (offscreen)
let _stream = null;        // MediaStream
let _rafId = 0;
let _running = false;
let _lastV = 0, _lastA = 0;
let _openness = 0.5;       // preserved from slider
let _onFrame = null;       // subscriber for sensing-strip UI

/**
 * Public: turn sensing on. Returns a promise resolving to true if the
 * camera + model came up cleanly, false otherwise. The caller (chip
 * handler) decides how to reflect a failure in the UI.
 */
export async function startSensing({ onFrame } = {}) {
  if (_running) return true;
  _onFrame = typeof onFrame === "function" ? onFrame : null;

  try {
    await _ensureHuman();
    await _startCamera();
  } catch (err) {
    console.warn("[sensing] start failed", err);
    _stopCamera();
    return false;
  }

  document.body.setAttribute("data-sensing", "true");
  _running = true;
  _loop();
  return true;
}

/**
 * Public: turn sensing off. Camera released, RAF cancelled, puck stays
 * where it last settled (the manual drag handler will overwrite on next
 * touch).
 */
export function stopSensing() {
  if (!_running) return;
  _running = false;
  document.body.removeAttribute("data-sensing");
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = 0;
  _stopCamera();
  if (_onFrame) _onFrame({ active: false });
  _onFrame = null;
}

export function isSensingActive() { return _running; }

/**
 * Public: sensing does not own openness. When the openness slider moves
 * the app tells us so we can include it in the update we push to the
 * circumplex preview.
 */
export function setSensingOpenness(o) {
  _openness = Math.max(0, Math.min(1, Number(o) || 0));
}

// ─── Internals ───────────────────────────────────────────────────────

async function _ensureHuman() {
  if (_human) return _human;
  if (_humanLoading) return _humanLoading;
  _humanLoading = (async () => {
    const mod = await import("https://cdn.jsdelivr.net/npm/@vladmandic/human@3/dist/human.esm.js");
    const Human = mod.default || mod.Human || mod;
    _human = new Human(HUMAN_CONFIG);
    await _human.load();
    await _human.warmup();
    return _human;
  })();
  return _humanLoading;
}

async function _startCamera() {
  if (_stream) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width:  { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
    },
  });
  _stream = stream;
  _video = document.createElement("video");
  _video.setAttribute("playsinline", "");
  _video.setAttribute("muted", "");
  _video.muted = true;
  _video.autoplay = true;
  _video.srcObject = stream;
  // Keep it in the DOM but visually gone; some browsers pause elements
  // that are display:none, breaking the frame loop.
  _video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;";
  document.body.appendChild(_video);
  await _video.play().catch(() => { /* Safari: play() rejects if the tab has never had a user gesture; the chip tap is that gesture */ });
}

function _stopCamera() {
  if (_stream) {
    for (const t of _stream.getTracks()) { try { t.stop(); } catch { /* noop */ } }
    _stream = null;
  }
  if (_video) {
    try { _video.pause(); } catch { /* noop */ }
    if (_video.parentElement) _video.parentElement.removeChild(_video);
    _video = null;
  }
}

async function _loop() {
  if (!_running || !_human || !_video) return;
  try {
    const result = await _human.detect(_video);
    const face = result?.face?.[0];
    if (face && Array.isArray(face.emotion) && face.emotion.length) {
      const { v, a, top } = _emotionsToVA(face.emotion);
      // Slow drift, not jitter.
      _lastV += (v - _lastV) * SMOOTH_ALPHA;
      _lastA += (a - _lastA) * SMOOTH_ALPHA;
      updateCircumplexPreview(_lastV, _lastA, _openness);
      if (_onFrame) _onFrame({
        active: true,
        v: _lastV, a: _lastA,
        top,                         // { label, score }
        confidence: face.score || 0, // detector confidence
      });
    } else if (_onFrame) {
      _onFrame({ active: true, v: _lastV, a: _lastA, top: null, confidence: 0 });
    }
  } catch (err) {
    console.warn("[sensing] detect error", err);
  }
  _rafId = requestAnimationFrame(_loop);
}

/**
 * Convert Human's emotion array to a valence/arousal centroid. Returns
 * v, a, and the single top-scoring emotion (for the "sensing you now: X"
 * caption). Scores are already softmaxed so we can weight directly.
 */
function _emotionsToVA(emotions) {
  let vSum = 0, aSum = 0, wSum = 0;
  let top = null;
  for (const e of emotions) {
    const anchor = EMO_ANCHORS[e.emotion];
    if (!anchor) continue;
    const w = e.score;
    vSum += anchor.v * w;
    aSum += anchor.a * w;
    wSum += w;
    if (!top || w > top.score) top = { label: e.emotion, score: w };
  }
  const v = wSum > 0 ? vSum / wSum : 0;
  const a = wSum > 0 ? aSum / wSum : 0;
  return { v: _clamp(v, -1, 1), a: _clamp(a, -1, 1), top };
}

function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// If the tab is backgrounded, release the camera. Some phones aggressively
// pause hidden video anyway; explicit stop avoids the "green dot stays on"
// surprise iOS users flag.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && _running) stopSensing();
});
