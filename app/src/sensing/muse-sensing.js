/**
 * Empathic Art v2 — Sensing (Muse adapter)
 * ──────────────────────────────────────────────────────────────────
 * Thin bridge over v1's MuseLiveAdapter that presents the same public
 * surface as human-sensing.js. The sensing-strip UI can then drive
 * either source through the same start/stop/onFrame contract.
 *
 * Nothing new about EEG here — the mapping, the calibration, the
 * baseline drift are all handled inside MuseLiveAdapter (Bob Dougherty
 * / v1). We only bridge the frame format and manage the connection
 * lifecycle in a way that plays nicely with the Before screen.
 *
 * @author  Eyal Gever
 */

import { MuseLiveAdapter, isWebBluetoothAvailable }
  from "../muse/muse-live-adapter.js?v=1.6.4.0";
import { updateCircumplexPreview } from "../ui/circumplex-preview.js";

let _adapter = null;
let _connecting = false;
let _running = false;
let _onFrame = null;
let _openness = 0.5;    // v1 emits its own openness, but honor the slider
                        // override if the user is manually adjusting it.
let _slidingOpenness = false;

/** True if this browser can even attempt Web Bluetooth. */
export function isMuseAvailable() {
  try { return isWebBluetoothAvailable(); } catch { return false; }
}

export async function startMuseSensing({ onFrame, useSliderOpenness = false } = {}) {
  if (_running) return true;
  if (_connecting) return false;
  _onFrame = typeof onFrame === "function" ? onFrame : null;
  _slidingOpenness = !!useSliderOpenness;

  if (!isMuseAvailable()) return false;

  _connecting = true;
  try {
    if (!_adapter) _adapter = new MuseLiveAdapter();
    // connect() must run inside the user gesture — the chip click is
    // that gesture, and we're already inside it.
    if (!_adapter.isConnected) {
      await _adapter.connect();
    }
    _adapter.start((frame) => {
      const v = _clamp(frame.valence, -1, 1);
      const a = _clamp(frame.arousal, -1, 1);
      const o = _slidingOpenness ? _openness : _clamp(frame.openness, 0, 1);
      updateCircumplexPreview(v, a, o);
      document.body.setAttribute("data-sensing", "true");
      _running = true;
      if (_onFrame) _onFrame({
        active: true,
        v, a,
        top: { label: _emotionWordFromVA(v, a), score: 1 },
        confidence: 1,
      });
    });
    return true;
  } catch (err) {
    console.warn("[muse-sensing] connect failed", err);
    return false;
  } finally {
    _connecting = false;
  }
}

export function stopMuseSensing() {
  if (!_adapter) { _running = false; return; }
  try { _adapter.stop(); } catch { /* noop */ }
  document.body.removeAttribute("data-sensing");
  _running = false;
  if (_onFrame) _onFrame({ active: false });
  _onFrame = null;
}

export function isMuseSensingActive() { return _running; }
export function setMuseSensingOpenness(o) {
  _openness = _clamp(Number(o) || 0, 0, 1);
}

/**
 * Full teardown — disconnects the headband too. Used when the user
 * leaves the Before screen entirely.
 */
export async function disposeMuseSensing() {
  stopMuseSensing();
  if (_adapter) {
    try { await _adapter.disconnect(); } catch { /* noop */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * A very small V/A → word map for the sensing caption. This is UI copy
 * only; the puck colour still comes from the app's emotionToColor.
 */
function _emotionWordFromVA(v, a) {
  const posV = v >= 0.15, negV = v <= -0.15;
  const posA = a >= 0.15, negA = a <= -0.15;
  if (posV && posA)  return "engaged";
  if (posV && negA)  return "calm";
  if (negV && posA)  return "tense";
  if (negV && negA)  return "low";
  if (posV)          return "steady positive";
  if (negV)          return "steady low";
  if (posA)          return "alert";
  if (negA)          return "settled";
  return "centered";
}
