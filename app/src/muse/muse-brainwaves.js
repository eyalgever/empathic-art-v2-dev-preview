/**
 * Empathic App v3 — Muse Brain Waves Visualiser
 *
 * Ported (in spirit) from the v2.2 Muse readout: five stacked EEG band lanes
 * showing simulated waveforms whose amplitude and character breathe with the
 * current emotional state.
 *
 * The five canonical Muse-style bands:
 *   Delta   0.5– 4 Hz   deep rest, unconsciousness
 *   Theta   4–  8 Hz    meditation, drowsy, dreamy
 *   Alpha   8– 13 Hz    calm, relaxed, eyes closed
 *   Beta    13–30 Hz    focused, alert, engaged
 *   Gamma   30–80 Hz    peak awareness, insight
 *
 * The lanes are drawn to a single <canvas>. On every animation frame we
 * push a new sample per band; the canvas scrolls right-to-left so the
 * newest values appear on the right edge.
 *
 * Amplitude drivers (updated externally via setState):
 *   • valence (v)   — positive valence emphasises Alpha, dampens Beta/Gamma
 *   • arousal (a)   — high arousal pumps Beta + Gamma, drops Delta/Theta
 *   • openness (o)  — raises Alpha (relaxed presence)
 *
 * We layer a small amount of pink noise so the traces feel like real EEG
 * rather than clean sines. This matches the v2.2 aesthetic exactly.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const BANDS = [
  { key: "delta", label: "Delta", hz: 2.5,  hex: "#3A4C76" }, // cool
  { key: "theta", label: "Theta", hz: 6.0,  hex: "#4E4E78" }, // violet
  { key: "alpha", label: "Alpha", hz: 10.5, hex: "#608A68" }, // calm green
  { key: "beta",  label: "Beta",  hz: 20.0, hex: "#E85A3C" }, // active red-orange
  { key: "gamma", label: "Gamma", hz: 45.0, hex: "#F4B23A" }, // joyful yellow
];

// Lane height reduced from 32 → 22 as part of the v3 UX pass: brain-waves should
// be a supporting readout, not competing with the circumplex for attention. With
// PADDING=6, five lanes total ≈ 122px; the eyebrow line adds ~20px so the band
// as a whole reads at ~1/3 the height of the circumplex on mobile.
const LANE_H     = 22;         // px per lane (was 32)
const LABEL_W    = 48;         // px reserved on the left for the band label
const PADDING    = 6;
const SAMPLES    = 180;        // horizontal resolution
const NOISE_MIX  = 0.28;       // amount of noise blended into each band
const SMOOTH     = 0.08;       // amp smoothing (0..1, higher = snappier)

/**
 * Mount the brain-waves visualiser onto a canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{
 *   setState: (frame: {v:number, a:number, o:number}) => void,
 *   destroy: () => void
 * }}
 */
export function mountBrainWaves(canvas) {
  if (!canvas) throw new Error("mountBrainWaves: canvas is required");

  const ctx = canvas.getContext("2d");
  const state = {
    // Per-band amplitude (smoothed 0..1)
    amp: BANDS.map(() => 0.3),
    ampTarget: BANDS.map(() => 0.3),
    // Phase accumulators per band (for waveform synthesis)
    phase: BANDS.map(() => Math.random() * Math.PI * 2),
    // Sample ring buffers (one per band, newest last)
    buf: BANDS.map(() => new Float32Array(SAMPLES)),
    running: true,
    rafId: 0,
    lastT: performance.now(),
  };

  // --- Canvas sizing (respects DPR for crisp lines) ---
  function resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
    const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
    const cssH = BANDS.length * LANE_H + PADDING * 2;
    canvas.style.height = cssH + "px";
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // --- Public: set the current emotional frame ---
  //
  // With a real headband connected the frame carries `bands` — aperiodic-
  // normalised relative power per band from muse-bands.js — and those drive
  // the lane amplitudes directly. Without it we fall back to the synthetic
  // approximation derived from (v, a, o), which is what the simulated
  // session has always shown. The waveform inside each lane is drawn the
  // same way either way: it is a stylised trace at the band's centre
  // frequency, not a plot of the raw EEG.
  function setState(frame) {
    if (!frame) return;

    if (frame.bands) {
      for (let i = 0; i < BANDS.length; i++) {
        const rel = frame.bands[BANDS[i].key];
        if (Number.isFinite(rel)) {
          // The four active bands sum to 1, so a band sitting at its own 1/f
          // background reads about 0.25; the tanh puts that mid-lane and
          // compresses the top end. Delta is excluded from that sum and
          // routinely runs above 1 (drift and motion live down there), so a
          // linear scale would peg its lane permanently — the compression is
          // what keeps all five lanes readable on one axis.
          state.ampTarget[i] = clamp01(0.08 + Math.tanh(rel * 1.8) * 0.95);
        }
      }
      return;
    }

    const v = clamp11(frame.v ?? 0);
    const a = clamp11(frame.a ?? 0);
    const o = clamp01(frame.o ?? 0.5);
    // Map (v, a, o) → per-band target amplitudes in [0.08, 1]
    //   Delta:  soft floor, rises when arousal is very low
    //   Theta:  peaks near sadness/melancholy (low arousal + negative valence)
    //   Alpha:  calm dominant band; rises with positive valence + openness
    //   Beta:   engagement; rises with arousal, moreso with negative valence
    //   Gamma:  peak awareness; rises with high arousal + positive valence
    const negA = Math.max(0, -a);
    const posA = Math.max(0,  a);
    const negV = Math.max(0, -v);
    const posV = Math.max(0,  v);
    state.ampTarget[0] = clamp01(0.18 + negA * 0.55 + (1 - o) * 0.12); // Delta
    state.ampTarget[1] = clamp01(0.14 + negA * 0.35 + negV * 0.35);    // Theta
    state.ampTarget[2] = clamp01(0.22 + posV * 0.30 + o    * 0.42);    // Alpha
    state.ampTarget[3] = clamp01(0.15 + posA * 0.55 + negV * 0.25);    // Beta
    state.ampTarget[4] = clamp01(0.10 + posA * 0.50 + posV * 0.30);    // Gamma
  }

  // --- Animation loop ---
  function tick(now) {
    if (!state.running) return;
    const dt = Math.min(0.08, (now - state.lastT) / 1000);
    state.lastT = now;

    // Smooth amplitude toward target
    for (let i = 0; i < BANDS.length; i++) {
      state.amp[i] += (state.ampTarget[i] - state.amp[i]) * SMOOTH;
    }

    // Push a new sample per band (advance phase by band frequency)
    for (let i = 0; i < BANDS.length; i++) {
      state.phase[i] += BANDS[i].hz * dt * 2 * Math.PI * 0.16;
      // Base signal: two-harmonic sine gives a slightly organic wobble
      const s = Math.sin(state.phase[i]) * 0.75 + Math.sin(state.phase[i] * 2.13 + 0.7) * 0.25;
      // Pink-ish noise (uniform is fine at this scale)
      const n = (Math.random() * 2 - 1) * NOISE_MIX;
      const v = (s * (1 - NOISE_MIX) + n) * state.amp[i];
      const buf = state.buf[i];
      // scroll left, append new sample on the right
      buf.copyWithin(0, 1);
      buf[SAMPLES - 1] = v;
    }

    draw();
    state.rafId = requestAnimationFrame(tick);
  }

  // --- Rendering ---
  function draw() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    // Panel background is transparent — the parent card provides the surface.
    // Subtle grid: one horizontal line per lane centre.
    ctx.save();
    ctx.strokeStyle = "rgba(251,246,236,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i < BANDS.length; i++) {
      const y = PADDING + i * LANE_H + LANE_H / 2;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    // Draw each band
    for (let i = 0; i < BANDS.length; i++) {
      const band = BANDS[i];
      const laneY  = PADDING + i * LANE_H + LANE_H / 2;
      const laneAmp = (LANE_H / 2) * 0.85;

      // Band label
      ctx.save();
      ctx.fillStyle = "rgba(251,246,236,0.72)";
      ctx.font = "600 10px 'Inter Tight', 'Inter', sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(band.label.toUpperCase(), 0, laneY);

      // Band amplitude readout on the far right
      ctx.fillStyle = "rgba(251,246,236,0.44)";
      ctx.font = "400 9px 'JetBrains Mono', 'SF Mono', monospace";
      ctx.textAlign = "right";
      const pct = Math.round(state.amp[i] * 100);
      ctx.fillText(String(pct).padStart(2, "0"), W - 2, laneY);
      ctx.restore();

      // Waveform trace
      const buf = state.buf[i];
      const traceX0 = LABEL_W;
      const traceX1 = W - 22; // leave room for the amp readout
      const traceW  = traceX1 - traceX0;
      const step = traceW / (SAMPLES - 1);

      // Soft glow underlay
      ctx.save();
      ctx.strokeStyle = hexWithAlpha(band.hex, 0.28);
      ctx.lineWidth = 3.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let k = 0; k < SAMPLES; k++) {
        const x = traceX0 + k * step;
        const y = laneY - buf[k] * laneAmp;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Crisp core line
      ctx.strokeStyle = band.hex;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < SAMPLES; k++) {
        const x = traceX0 + k * step;
        const y = laneY - buf[k] * laneAmp;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function destroy() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
    ro.disconnect();
  }

  // Start the loop
  state.rafId = requestAnimationFrame(tick);

  return { setState, destroy };
}

// --- helpers ---
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp11(x) { return Math.max(-1, Math.min(1, x)); }
function hexWithAlpha(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
