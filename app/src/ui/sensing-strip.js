/**
 * Empathic Art v2 — Sensing strip UI wiring
 * ──────────────────────────────────────────────────────────────────
 * Connects the Sense chip in the Before Session screen to the Human.js
 * sensing engine. Handles chip aria-pressed, strip open/close, bar
 * updates, waveform paint, and openness-slider mirroring.
 *
 * Non-invasive: the manual drag handler in app.js does not need to know
 * about us. When sensing is active, body[data-sensing="true"] is set;
 * app.js sees this and stops writing to the puck. (Handled inside app.js
 * with a small guard we add there — the alternative is capture-phase
 * listeners that eat the events, and I want the manual drag path to be
 * observable to devtools.)
 *
 * @author  Eyal Gever
 */

import {
  startSensing,
  stopSensing,
  isSensingActive,
  setSensingOpenness,
} from "../sensing/human-sensing.js";
import {
  startMuseSensing,
  stopMuseSensing,
  isMuseSensingActive,
  setMuseSensingOpenness,
  isMuseAvailable,
} from "../sensing/muse-sensing.js";
import {
  startPulseSensing,
  stopPulseSensing,
  isPulseSensingActive,
  setPulseOpenness,
  setPulseValence,
  isPulseAvailable,
} from "../sensing/pulse-sensing.js";

let _wired = false;
let _waveCtx = null;
let _waveInited = false;
let _waveBuf = [];
const WAVE_MAX = 96;

export function wireSensingStrip() {
  if (_wired) return;
  const chip      = document.getElementById("sense-chip-camera");
  const pulseChip = document.getElementById("sense-chip-ring");
  const museChip  = document.getElementById("sense-chip-muse");
  const strip     = document.getElementById("sensing-strip");
  const slider    = document.getElementById("openness");
  const waveEl    = document.getElementById("sensing-wave");
  if (!chip || !strip || !waveEl) return; // Before screen not mounted yet
  _wired = true;

  // Both BLE chips need Web Bluetooth. iOS Safari lacks it — the chips
  // stay disabled there. Bluefy, desktop Chrome, and BLE-capable browsers
  // enable them.
  if (museChip && isMuseAvailable()) {
    museChip.disabled = false;
    museChip.removeAttribute("aria-disabled");
    museChip.classList.remove("ea-sense-chip--disabled");
  }
  if (pulseChip && isPulseAvailable()) {
    pulseChip.disabled = false;
    pulseChip.removeAttribute("aria-disabled");
    pulseChip.classList.remove("ea-sense-chip--disabled");
  }
  // Wave canvas is sized lazily on first show — while strip is hidden,
  // getBoundingClientRect().width is 0 and the canvas would collapse.

  // Mirror the openness slider into both sensing engines so the puck's
  // openness stays in sync while a sensor drives V/A. (Muse can compute
  // its own openness from EEG, but if the user is actively dragging the
  // slider they win — this is honored in muse-sensing when the flag is
  // set. Human never computes openness.)
  if (slider) {
    const readOpenness = () => {
      const v = Number(slider.getAttribute("aria-valuenow") || "50");
      setSensingOpenness(v / 100);
      setMuseSensingOpenness(v / 100);
      setPulseOpenness(v / 100);
    };
    slider.addEventListener("pointerdown", () => setTimeout(readOpenness, 0));
    slider.addEventListener("pointermove", () => readOpenness());
    readOpenness();
  }

  const openStrip = () => {
    strip.hidden = false;
    if (!_waveInited) { _initWave(waveEl); _waveInited = true; }
  };
  const closeStrip = () => {
    strip.hidden = true;
    _resetWave();
  };

  // Only one source can drive the puck at a time. If a source is
  // already active and the user taps the other chip, stop the first.
  chip.addEventListener("click", async () => {
    if (isSensingActive()) {
      stopSensing();
      chip.setAttribute("aria-pressed", "false");
      chip.removeAttribute("data-error");
      closeStrip();
      return;
    }
    if (isMuseSensingActive()) {
      stopMuseSensing();
      museChip?.setAttribute("aria-pressed", "false");
    }
    chip.setAttribute("aria-pressed", "true");
    openStrip();
    _paintCaption("waking up");
    _paintBar("sensing-bar-v", 0);
    _paintBar("sensing-bar-a", 0);

    const ok = await startSensing({ onFrame: _onFrame });
    if (!ok) {
      chip.setAttribute("aria-pressed", "false");
      chip.setAttribute("data-error", "true");
      _paintCaption("camera permission needed");
      setTimeout(() => {
        if (!isSensingActive()) { closeStrip(); chip.removeAttribute("data-error"); }
      }, 2400);
    }
  });

  // Pulse chip — any BLE Heart Rate Service device (chest strap, watch,
  // ring that speaks 0x180D). Opens the OS device picker on tap.
  if (pulseChip) {
    pulseChip.addEventListener("click", async () => {
      if (isPulseSensingActive()) {
        stopPulseSensing();
        pulseChip.setAttribute("aria-pressed", "false");
        pulseChip.removeAttribute("data-error");
        closeStrip();
        return;
      }
      if (isSensingActive())     { stopSensing();     chip.setAttribute("aria-pressed", "false"); }
      if (isMuseSensingActive()) { stopMuseSensing(); museChip?.setAttribute("aria-pressed", "false"); }
      pulseChip.setAttribute("aria-pressed", "true");
      openStrip();
      _paintCaption("pairing pulse sensor");
      _paintBar("sensing-bar-v", 0);
      _paintBar("sensing-bar-a", 0);

      const ok = await startPulseSensing({ onFrame: _onFrame });
      if (!ok) {
        pulseChip.setAttribute("aria-pressed", "false");
        pulseChip.setAttribute("data-error", "true");
        _paintCaption("pairing cancelled");
        setTimeout(() => {
          if (!isPulseSensingActive()) { closeStrip(); pulseChip.removeAttribute("data-error"); }
        }, 2400);
      }
    });
  }

  // Muse chip — mirrors the camera chip's behavior. Uses Web Bluetooth
  // pairing (opens the OS device picker on tap; the click IS the gesture).
  if (museChip) {
    museChip.addEventListener("click", async () => {
      if (isMuseSensingActive()) {
        stopMuseSensing();
        museChip.setAttribute("aria-pressed", "false");
        museChip.removeAttribute("data-error");
        closeStrip();
        return;
      }
      if (isSensingActive()) {
        stopSensing();
        chip.setAttribute("aria-pressed", "false");
      }
      museChip.setAttribute("aria-pressed", "true");
      openStrip();
      _paintCaption("pairing headband");
      _paintBar("sensing-bar-v", 0);
      _paintBar("sensing-bar-a", 0);

      const ok = await startMuseSensing({ onFrame: _onFrame, useSliderOpenness: false });
      if (!ok) {
        museChip.setAttribute("aria-pressed", "false");
        museChip.setAttribute("data-error", "true");
        _paintCaption("pairing cancelled");
        setTimeout(() => {
          if (!isMuseSensingActive()) { closeStrip(); museChip.removeAttribute("data-error"); }
        }, 2400);
      }
    });
  }
}

function _onFrame({ active, v, a, top }) {
  if (!active) {
    _paintCaption("\u2014");
    _paintBar("sensing-bar-v", 0);
    _paintBar("sensing-bar-a", 0);
    return;
  }
  _paintBar("sensing-bar-v", v || 0);
  _paintBar("sensing-bar-a", a || 0);
  _paintCaption(top ? top.label : "reading");
  _pushWave(a || 0);
  _drawWave();
  // Feed valence forward to the pulse adapter so if the user later
  // switches sources, the puck's valence stays with the last honest
  // reading rather than snapping back to 0.
  try { setPulseValence(v || 0); } catch { /* pulse adapter not loaded */ }
}

function _paintCaption(word) {
  const el = document.getElementById("sensing-word");
  if (el) el.textContent = word;
}

/**
 * A bipolar bar (-1..+1) that grows out from the center. Positive fills
 * to the right, negative to the left. Written as inline left/width so
 * we don't need a CSS var lookup per frame.
 */
function _paintBar(id, value) {
  const fill = document.getElementById(id);
  if (!fill) return;
  const clamped = Math.max(-1, Math.min(1, value));
  const half = Math.abs(clamped) * 50;
  if (clamped >= 0) {
    fill.style.left  = "50%";
    fill.style.width = half + "%";
  } else {
    fill.style.left  = (50 - half) + "%";
    fill.style.width = half + "%";
  }
}

function _initWave(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(200, Math.floor(rect.width  || 320));
  const h = 36;
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.height = h + "px";
  _waveCtx = canvas.getContext("2d");
  _waveCtx.scale(dpr, dpr);
  _resetWave();
}

function _resetWave() {
  _waveBuf = new Array(WAVE_MAX).fill(0);
  _drawWave();
}

function _pushWave(v) {
  _waveBuf.push(v);
  while (_waveBuf.length > WAVE_MAX) _waveBuf.shift();
}

function _drawWave() {
  if (!_waveCtx) return;
  const ctx = _waveCtx;
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  const h = ctx.canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(238, 236, 231, 0.85)";
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const mid = h / 2;
  const dx = w / (WAVE_MAX - 1);
  for (let i = 0; i < _waveBuf.length; i++) {
    const y = mid - _waveBuf[i] * (h / 2 - 3);
    if (i === 0) ctx.moveTo(0, y);
    else         ctx.lineTo(i * dx, y);
  }
  ctx.stroke();
}
