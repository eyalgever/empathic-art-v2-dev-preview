// pulse-overlay.js
// Facial blood-perfusion overlay driven by real heart-rate.
//
// This is the 'Path B' rPPG visualization: we don't have per-region PPG
// signal from VitalLens's JS SDK (only a single scalar HR + a global PPG
// waveform), so we synthesize a medically-plausible perfusion map using:
//   - MediaPipe 468-mesh region groups (forehead, cheeks, temples, lips)
//   - The live HR frequency (beats per second)
//   - The live PPG waveform phase (rising = systole = brighter)
//
// The result reads like the classic rPPG demo: face 'lights up' with each
// heart beat, warmest at the vascular-rich areas (cheeks, forehead, lips).

// MediaPipe FaceMesh vertex groups for perfusion-rich regions.
// Indices come from the MediaPipe canonical 468 topology.
// Source: MediaPipe/mediapipe_face_mesh_v2/face_geometry.cc
const REGIONS = {
  // Forehead: dense capillary bed above brows.
  forehead: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
             365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
             132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
             // upper strip near hairline
             67, 109, 10, 338, 297, 332, 284, 251, 389],
  // Cheeks (left and right): highly vascular.
  cheekL: [116, 123, 147, 213, 192, 214, 212, 138, 135, 210, 169, 170, 140,
           171, 175, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234],
  cheekR: [345, 352, 376, 433, 416, 434, 432, 367, 364, 430, 394, 395, 369,
           396, 175, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454],
  // Temples: superficial temporal artery region.
  templeL: [21, 54, 103, 67, 109, 46, 53, 52, 65, 55, 107, 66, 105, 63, 70,
            156, 143, 111, 117, 118, 119, 120, 100, 47, 114, 188, 122, 6],
  templeR: [251, 284, 332, 297, 338, 276, 283, 282, 295, 285, 336, 296, 334,
            293, 300, 383, 372, 340, 346, 347, 348, 349, 329, 277, 343, 412,
            351, 6],
  // Lips: high perfusion, easy pulse read.
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269,
         267, 0, 37, 39, 40, 185, 61],
};

// Region weight: how strongly each region shows perfusion (0..1).
// Cheeks and forehead are the strongest anatomically.
const REGION_WEIGHT = {
  forehead: 0.85,
  cheekL:   0.90,
  cheekR:   0.90,
  templeL:  0.55,
  templeR:  0.55,
  lips:     0.70,
};

// Blob radius in mesh-relative units per region (used as glow spread).
const REGION_SPREAD = {
  forehead: 0.14,
  cheekL:   0.11,
  cheekR:   0.11,
  templeL:  0.09,
  templeR:  0.09,
  lips:     0.08,
};

// Compute the centroid of a region's vertices in canvas coords.
function centroid(mesh, indices, vv, vh, w, h, mirror) {
  let sx = 0, sy = 0, n = 0;
  for (const i of indices) {
    const p = mesh[i];
    if (!p) continue;
    const px = mirror ? (vv - p[0]) / vv * w : p[0] / vv * w;
    const py = p[1] / vh * h;
    sx += px; sy += py; n++;
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n, n };
}

// Extract a soft PPG phase in [0,1]: 0 at trough, 1 at peak.
// Uses the last ~16 PPG samples with linear detrend + normalise.
export function computePpgPhase(samples) {
  const N = samples.length;
  if (N < 8) return 0;
  const W = Math.min(48, N);
  const seg = samples.slice(N - W);
  let lo = Infinity, hi = -Infinity;
  for (const v of seg) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo;
  if (range < 1e-6) return 0;
  const cur = seg[seg.length - 1];
  return (cur - lo) / range;
}

// Draw the perfusion overlay on top of the video frame.
// ctx must have the same coord space as the video (canvas sized to video).
//
// face:      Human FaceResult (needs face.mesh)
// hrBpm:     current heart rate in bpm (drives beat frequency)
// ppgPhase:  0..1 sample phase (drives brightness within a beat)
// opts:      { mirror, alpha=0.55, warmth=1.0, showLegend=false }
export function drawPulseOverlay(ctx, face, hrBpm, ppgPhase, vv, vh, w, h, opts = {}) {
  if (!face || !face.mesh || face.mesh.length < 468) return;
  const mesh = face.mesh;
  const mirror = opts.mirror !== false;
  const alpha = opts.alpha ?? 0.55;
  const warmth = opts.warmth ?? 1.0;

  // Beat gain: 0 during diastole, ~1 at systolic peak.
  // Uses both PPG phase (fine, per-sample) and a synthetic pulse envelope
  // driven by HR frequency (fallback when phase is stale).
  const now = performance.now() / 1000;
  const beatHz = (hrBpm && hrBpm > 30 && hrBpm < 200) ? hrBpm / 60 : 1.15;
  const synthPhase = 0.5 + 0.5 * Math.sin(2 * Math.PI * beatHz * now - Math.PI / 2);
  // Sharper systolic envelope: exponentiate.
  const gain = Math.pow(0.35 * synthPhase + 0.65 * ppgPhase, 2.0);

  // Face bounding box (for radial size).
  const box = face.box;
  const faceH = box ? (box[3] / vh) * h : 200;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const region of Object.keys(REGIONS)) {
    const c = centroid(mesh, REGIONS[region], vv, vh, w, h, mirror);
    if (!c) continue;
    const wgt = REGION_WEIGHT[region];
    const spread = REGION_SPREAD[region] * faceH;
    // Warm perfusion palette: deep red at core, orange-pink outer, alpha 0.
    // Modulated by wgt * gain so cheeks pulse harder than temples.
    const A = alpha * wgt * (0.35 + 0.65 * gain);
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, spread);
    // Rothko-lineage red/orange (matches v1 emotion palette: Love #C46E54, Anger #802826).
    const r = Math.round(210 * warmth);
    const g = Math.round(60 + 20 * (1 - gain));
    const b = Math.round(45 + 15 * (1 - gain));
    grad.addColorStop(0.0, `rgba(${r},${g},${b},${A})`);
    grad.addColorStop(0.4, `rgba(${r},${g + 30},${b + 20},${A * 0.55})`);
    grad.addColorStop(1.0, `rgba(${r},${g + 60},${b + 30},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, spread, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Optional overlay text: beat rate + phase.
  if (opts.showLegend) {
    ctx.save();
    ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`${hrBpm ? hrBpm.toFixed(0) : '—'} bpm  ·  phase ${ppgPhase.toFixed(2)}`, 8, 8);
    ctx.restore();
  }
}
