/**
 * Empathic Art v2 — Sensing (Pulse / BLE Heart Rate Service)
 * ──────────────────────────────────────────────────────────────────
 * Pairs any Bluetooth device that advertises the standard Heart Rate
 * Service (0x180D) — chest straps (Polar H10, Wahoo Tickr), watches
 * that expose the GATT profile, and smart rings that speak the
 * standard (a small but growing set). No vendor SDK, no cloud API.
 *
 * We derive arousal from a simple two-scale HR indicator:
 *
 *   bpm       ↦ z-scored against a running EMA of this user, this
 *              session. Positive z → higher HR than their baseline →
 *              higher arousal. Squashed with tanh into [-1, 1].
 *   HRV proxy ↦ inverse of the RMSSD-like short-window variability of
 *              consecutive R-R intervals. Low HRV → sympathetic tone →
 *              higher arousal. Also z-scored, weighted 40%.
 *
 * Valence is NOT inferred from pulse alone — the mapping would be
 * dishonest. We hold the puck's valence at the last sensor-provided
 * value (from Human or Muse) if either has run, else at 0. The
 * emotion-word caption reports the state as "steady", "activated",
 * or "settled" rather than pretending we know positive vs negative.
 *
 * @author  Eyal Gever
 */

import { updateCircumplexPreview } from "../ui/circumplex-preview.js";

const HR_SERVICE = "heart_rate";                    // 0x180D
const HR_MEASUREMENT_CHAR = "heart_rate_measurement"; // 0x2A37
const BATTERY_SERVICE = "battery_service";           // 0x180F

// Time constants for the running baseline (seconds).
const BASELINE_TAU = 90;
const FRAME_MS = 250; // 4 Hz UI update; HR itself streams at ~1 Hz

let _device = null;
let _server = null;
let _hrChar = null;
let _running = false;
let _onFrame = null;
let _openness = 0.5;
let _lastValence = 0; // held from other sources, not inferred here
let _lastBpm = 0;
let _lastRR = [];    // ring buffer of recent R-R intervals (ms)

// EMA baselines
let _bpmMean = 0, _bpmVar = 1, _bpmSeen = false;
let _hrvMean = 0, _hrvVar = 1, _hrvSeen = false;

let _uiTimer = null;

export function isPulseAvailable() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

/**
 * Set the current valence (from Human or Muse) so this adapter can
 * hold that dimension rather than fabricating one. If no other source
 * has run, valence stays at 0.
 */
export function setPulseValence(v) {
  _lastValence = Math.max(-1, Math.min(1, Number(v) || 0));
}

export function setPulseOpenness(o) {
  _openness = Math.max(0, Math.min(1, Number(o) || 0));
}

export async function startPulseSensing({ onFrame } = {}) {
  if (_running) return true;
  if (!isPulseAvailable()) return false;
  _onFrame = typeof onFrame === "function" ? onFrame : null;

  try {
    _device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE] }],
      optionalServices: [BATTERY_SERVICE],
    });
    _device.addEventListener("gattserverdisconnected", _onDisconnect);
    _server = await _device.gatt.connect();
    const hr = await _server.getPrimaryService(HR_SERVICE);
    _hrChar = await hr.getCharacteristic(HR_MEASUREMENT_CHAR);
    await _hrChar.startNotifications();
    _hrChar.addEventListener("characteristicvaluechanged", _onMeasurement);
  } catch (err) {
    console.warn("[pulse-sensing] connect failed", err);
    _teardown();
    return false;
  }

  _running = true;
  document.body.setAttribute("data-sensing", "true");
  clearInterval(_uiTimer);
  _uiTimer = setInterval(_pushFrame, FRAME_MS);
  return true;
}

export function stopPulseSensing() {
  if (!_running && !_device) return;
  _teardown();
  if (_onFrame) _onFrame({ active: false });
  _onFrame = null;
}

export function isPulseSensingActive() { return _running; }

// ─── Internals ───────────────────────────────────────────────────────

function _teardown() {
  _running = false;
  document.body.removeAttribute("data-sensing");
  clearInterval(_uiTimer);
  _uiTimer = null;
  try { _hrChar?.stopNotifications?.(); } catch { /* noop */ }
  _hrChar?.removeEventListener?.("characteristicvaluechanged", _onMeasurement);
  _hrChar = null;
  try { _server?.disconnect?.(); } catch { /* noop */ }
  _server = null;
  _device?.removeEventListener?.("gattserverdisconnected", _onDisconnect);
  _device = null;
}

function _onDisconnect() {
  stopPulseSensing();
}

/**
 * Parse the standard 0x2A37 heart-rate measurement notification.
 * See https://www.bluetooth.com/specifications/specs/gatt-specification-supplement/
 * (Section 3.113 / 3.114). Byte 0 is flags:
 *   bit0 → HR value format (0 = uint8, 1 = uint16)
 *   bit4 → RR-interval present (1/1024s each, uint16 little-endian)
 */
function _onMeasurement(evt) {
  const dv = evt.target.value;
  if (!dv || dv.byteLength < 2) return;
  const flags = dv.getUint8(0);
  const is16 = (flags & 0x01) === 0x01;
  let idx = 1;
  const bpm = is16 ? dv.getUint16(idx, true) : dv.getUint8(idx);
  idx += is16 ? 2 : 1;

  // Skip Energy Expended if present.
  if (flags & 0x08) idx += 2;

  // R-R intervals, if present, arrive as uint16 count of 1/1024 s each.
  const rr = [];
  if (flags & 0x10) {
    while (idx + 1 < dv.byteLength) {
      const raw = dv.getUint16(idx, true);
      rr.push((raw / 1024) * 1000); // to ms
      idx += 2;
    }
  }

  _lastBpm = bpm;
  if (rr.length) {
    // Keep the last ~20 intervals for the HRV proxy (~20-30s of history
    // at rest). Guards against short bursts skewing the estimate.
    _lastRR = _lastRR.concat(rr).slice(-20);
  }

  _foldBaseline();
}

function _foldBaseline() {
  const now = performance.now() / 1000;
  const alpha = 1 - Math.exp(-((_lastBaselineT ? (now - _lastBaselineT) : 0.25)) / BASELINE_TAU);
  _lastBaselineT = now;

  // BPM baseline.
  if (!_bpmSeen) {
    _bpmMean = _lastBpm;
    _bpmVar = 25;
    _bpmSeen = true;
  } else {
    const d = _lastBpm - _bpmMean;
    _bpmMean += alpha * d;
    _bpmVar  += alpha * (d * d - _bpmVar);
  }

  // HRV proxy: RMSSD over the recent R-R window.
  if (_lastRR.length >= 3) {
    let sq = 0, n = 0;
    for (let i = 1; i < _lastRR.length; i++) {
      const d = _lastRR[i] - _lastRR[i - 1];
      sq += d * d; n++;
    }
    const rmssd = Math.sqrt(sq / Math.max(1, n));
    if (!_hrvSeen) {
      _hrvMean = rmssd; _hrvVar = 25; _hrvSeen = true;
    } else {
      const d = rmssd - _hrvMean;
      _hrvMean += alpha * d;
      _hrvVar  += alpha * (d * d - _hrvVar);
    }
  }
}
let _lastBaselineT = 0;

function _pushFrame() {
  const bpmZ = _bpmSeen ? (_lastBpm - _bpmMean) / Math.sqrt(Math.max(1, _bpmVar)) : 0;
  const hrvZ = _hrvSeen && _lastRR.length >= 3
    ? (_hrvMean - _rmssdNow()) / Math.sqrt(Math.max(1, _hrvVar)) // inverse
    : 0;

  // Arousal blend: 60% BPM z, 40% HRV z (inverse).
  const a = Math.tanh(0.7 * bpmZ + 0.5 * hrvZ);

  updateCircumplexPreview(_lastValence, a, _openness);

  if (_onFrame) _onFrame({
    active: true,
    v: _lastValence,
    a,
    top: { label: _wordFrom(a), score: 1 },
    bpm: _lastBpm,
    confidence: 1,
  });
}

function _rmssdNow() {
  let sq = 0, n = 0;
  for (let i = 1; i < _lastRR.length; i++) {
    const d = _lastRR[i] - _lastRR[i - 1];
    sq += d * d; n++;
  }
  return Math.sqrt(sq / Math.max(1, n));
}

function _wordFrom(a) {
  if (a >= 0.4) return "activated";
  if (a >= 0.15) return "engaged";
  if (a <= -0.4) return "settled";
  if (a <= -0.15) return "quiet";
  return "steady";
}
