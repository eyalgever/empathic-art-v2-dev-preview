// Face mesh + iris + gaze + head-pose + face-box overlay.
// Draws the MediaPipe 468-vertex mesh with TRI468 triangulation on top of
// the live self-view video. Visual language: hairline white edges, small
// vertex dots, drop shadow, camera-scan corner brackets on the face box,
// iris markers with pupil dots, gaze bearing arrow, head-pose 3D gizmo.
//
// This is the vitalsign.ai / image-2 / image-3 look on the web.
// (The ARKit 1,220-vertex real-depth mesh is iOS only.)

import { TRI468 } from './tri468.js';

const HAIR = 'rgba(255,255,255,0.42)';   // triangulation edges
const HAIR_BRIGHT = 'rgba(255,255,255,0.72)'; // silhouette / lips / eyes
const DOT = 'rgba(255,255,255,0.92)';     // vertex dots
const DOT_SHADOW = 'rgba(0,0,0,0.55)';    // dot drop shadow
const BRACKET = 'rgba(255,255,255,0.9)';  // camera-scan corner brackets
const IRIS = 'rgba(120,220,255,0.95)';    // iris outline
const IRIS_PUPIL = 'rgba(255,255,255,1)'; // pupil dot
const GAZE = 'rgba(120,220,255,0.85)';    // gaze arrow
const AXIS_X = 'rgba(255,80,80,0.9)';     // head-pose X (roll)
const AXIS_Y = 'rgba(120,220,120,0.9)';   // head-pose Y (pitch)
const AXIS_Z = 'rgba(120,180,255,0.9)';   // head-pose Z (yaw)

// Human's face.annotations groups (subset we outline in bright hairline).
const CONTOUR_GROUPS = [
  'silhouette',
  'lipsUpperOuter', 'lipsLowerOuter', 'lipsUpperInner', 'lipsLowerInner',
  'leftEyeUpper0', 'leftEyeLower0',
  'rightEyeUpper0', 'rightEyeLower0',
  'leftEyebrowUpper', 'rightEyebrowUpper',
];

// Iris annotation names in Human's face.annotations (5 pts per iris).
const IRIS_GROUPS = ['leftEyeIris', 'rightEyeIris'];

export function drawMeshOverlay(ctx, face, videoW, videoH, canvasW, canvasH, opts) {
  const options = opts || {};
  const mirror = options.mirror !== false; // default true (front camera is mirrored)
  const showBox = options.showBox !== false;
  const showMesh = options.showMesh !== false;
  const showContours = options.showContours !== false;
  const showIris = options.showIris !== false;
  const showGaze = options.showGaze !== false;
  const showAxes = options.showAxes !== false;
  const showRoi = options.showRoi === true; // forehead PPG ROI, off by default now
  const labelEvery = options.labelEvery | 0; // 0 = no labels, N = label every Nth vertex

  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!face) return;

  const sx = canvasW / videoW;
  const sy = canvasH / videoH;
  // Project a source (video) coord into overlay canvas coords, mirroring X.
  const px = (x) => (mirror ? (videoW - x) : x) * sx;
  const py = (y) => y * sy;

  // 1. Face box with camera-scan corner brackets.
  if (showBox && face.box && face.box.length === 4) {
    const [bx, by, bw, bh] = face.box;
    const x0 = px(bx + (mirror ? bw : 0));
    const x1 = px(bx + (mirror ? 0 : bw));
    const y0 = py(by), y1 = py(by + bh);
    const L = Math.min(bw, bh) * sx * 0.12;
    ctx.save();
    ctx.strokeStyle = BRACKET;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // top-left
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    // top-right
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    // bottom-left
    ctx.moveTo(x0, y1 - L); ctx.lineTo(x0, y1); ctx.lineTo(x0 + L, y1);
    // bottom-right
    ctx.moveTo(x1 - L, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - L);
    ctx.stroke();
    ctx.restore();
  }

  const mesh = face.mesh;
  const ann = face.annotations || {};

  // 2. Optional forehead PPG ROI (dashed).
  if (showRoi && face.box) {
    const [bx, by, bw, bh] = face.box;
    const rxSrc = bx + bw * 0.20, rySrc = by + bh * 0.05;
    const rwSrc = bw * 0.60, rhSrc = bh * 0.22;
    const rx0 = px(rxSrc + (mirror ? rwSrc : 0));
    const rx1 = px(rxSrc + (mirror ? 0 : rwSrc));
    ctx.save();
    ctx.strokeStyle = 'rgba(232,90,60,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.min(rx0, rx1), py(rySrc), Math.abs(rx1 - rx0), rhSrc * sy);
    ctx.restore();
  }

  // 3. Triangulation edges (hairline).
  if (showMesh && mesh && mesh.length >= 468) {
    ctx.save();
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < TRI468.length; i += 3) {
      const a = mesh[TRI468[i]];
      const b = mesh[TRI468[i + 1]];
      const c = mesh[TRI468[i + 2]];
      if (!a || !b || !c) continue;
      const ax = px(a[0]), ay = py(a[1]);
      const bxp = px(b[0]), byp = py(b[1]);
      const cx = px(c[0]), cy = py(c[1]);
      ctx.moveTo(ax, ay); ctx.lineTo(bxp, byp);
      ctx.moveTo(bxp, byp); ctx.lineTo(cx, cy);
      ctx.moveTo(cx, cy); ctx.lineTo(ax, ay);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Bright contour polylines (silhouette, lips, eyes, brows).
  if (showContours && Object.keys(ann).length) {
    ctx.save();
    ctx.strokeStyle = HAIR_BRIGHT;
    ctx.lineWidth = 0.9;
    for (const groupName of CONTOUR_GROUPS) {
      const pts = ann[groupName];
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = px(p[0]), y = py(p[1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (groupName === 'silhouette' || groupName.startsWith('lips')) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Vertex dots. Drop-shadow first for legibility over skin.
  if (showMesh && mesh && mesh.length) {
    ctx.save();
    // Shadow pass
    ctx.fillStyle = DOT_SHADOW;
    for (let i = 0; i < 468; i++) {
      const p = mesh[i];
      if (!p) continue;
      const x = px(p[0]) + 0.5, y = py(p[1]) + 0.5;
      ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    // Dot pass
    ctx.fillStyle = DOT;
    for (let i = 0; i < 468; i++) {
      const p = mesh[i];
      if (!p) continue;
      const x = px(p[0]), y = py(p[1]);
      ctx.beginPath(); ctx.arc(x, y, 1.0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 6. Optional vertex-index labels every Nth landmark (developer mode).
  if (showMesh && mesh && labelEvery > 0) {
    ctx.save();
    ctx.font = '600 8px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 468; i += labelEvery) {
      const p = mesh[i];
      if (!p) continue;
      const x = px(p[0]) + 3, y = py(p[1]) - 3;
      ctx.strokeText(String(i), x, y);
      ctx.fillText(String(i), x, y);
    }
    ctx.restore();
  }

  // 7. Iris (5 points per eye: center + 4 around). Human puts these at
  //    face.annotations.leftEyeIris / rightEyeIris when iris is enabled.
  let leftIrisCenter = null, rightIrisCenter = null;
  if (showIris) {
    ctx.save();
    for (const g of IRIS_GROUPS) {
      const pts = ann[g];
      if (!pts || pts.length < 5) continue;
      // First point is iris center in Human's convention
      const center = pts[0];
      const cx = px(center[0]), cy = py(center[1]);
      if (g === 'leftEyeIris') leftIrisCenter = { x: cx, y: cy };
      else rightIrisCenter = { x: cx, y: cy };
      // Compute radius from center to outer points (avg)
      let r = 0, n = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = px(pts[i][0]) - cx;
        const dy = py(pts[i][1]) - cy;
        r += Math.hypot(dx, dy); n++;
      }
      r = n ? r / n : 5;
      ctx.strokeStyle = IRIS;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // Pupil dot
      ctx.fillStyle = IRIS_PUPIL;
      ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 8. Gaze arrow from between the eyes. face.rotation.gaze = { bearing,
  //    strength } when both iris + rotation are on. Bearing is in radians,
  //    strength is 0..1. Mirror-flip bearing when mirror is on.
  if (showGaze && face.rotation && face.rotation.gaze && leftIrisCenter && rightIrisCenter) {
    const g = face.rotation.gaze;
    const bearing = mirror ? (Math.PI - g.bearing) : g.bearing;
    const strength = Math.max(0, Math.min(1, g.strength || 0));
    const cx = (leftIrisCenter.x + rightIrisCenter.x) / 2;
    const cy = (leftIrisCenter.y + rightIrisCenter.y) / 2;
    const len = 32 + strength * 48;
    const ex = cx + Math.cos(bearing) * len;
    const ey = cy + Math.sin(bearing) * len;
    ctx.save();
    ctx.strokeStyle = GAZE;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    // arrowhead
    const ah = 6, aw = 3.5;
    const b1 = bearing + Math.PI * 0.85;
    const b2 = bearing - Math.PI * 0.85;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(b1) * ah, ey + Math.sin(b1) * ah);
    ctx.lineTo(ex + Math.cos(b2) * ah, ey + Math.sin(b2) * ah);
    ctx.closePath();
    ctx.fillStyle = GAZE;
    ctx.fill();
    ctx.restore();
  }

  // 9. Head-pose 3D axis gizmo, anchored at nose tip (mesh index 1).
  //    face.rotation.angle = { roll, pitch, yaw } in radians.
  if (showAxes && face.rotation && face.rotation.angle && mesh && mesh[1]) {
    const nose = mesh[1];
    const cx = px(nose[0]), cy = py(nose[1]);
    const { roll, pitch, yaw } = face.rotation.angle;
    const L = 42;
    // Convert to 2D projection. Simple orthographic:
    //   X axis (roll around forward): rotated by roll in-plane.
    //   Y axis (pitch): tilts up/down; project as y=-cos(pitch), z-component shows in size.
    //   Z axis (yaw): comes out of nose; project as x=-sin(yaw), y=some pitch influence.
    // Mirror flips roll and yaw signs to keep gizmo intuitive.
    const rr = mirror ? -roll : roll;
    const yy = mirror ? -yaw : yaw;
    const pp = pitch;
    // X (red): in-plane, rotated by roll
    const x_ex = cx + Math.cos(rr) * L;
    const x_ey = cy + Math.sin(rr) * L;
    // Y (green): vertical, tilted by pitch
    const y_ex = cx + Math.sin(rr) * L * -1;
    const y_ey = cy + Math.cos(rr) * L * -1 * Math.cos(pp);
    // Z (blue): outward, projected by yaw+pitch
    const z_ex = cx + Math.sin(yy) * L;
    const z_ey = cy - Math.sin(pp) * L;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = AXIS_X;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x_ex, x_ey); ctx.stroke();
    ctx.strokeStyle = AXIS_Y;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(y_ex, y_ey); ctx.stroke();
    ctx.strokeStyle = AXIS_Z;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(z_ex, z_ey); ctx.stroke();
    ctx.restore();
  }
}

// Draws a compact body skeleton (shoulders/neck/head) on a separate overlay.
// Used to render vitalsign.ai-style posture: shoulder tilt + neck tilt.
// keypoints: array of Human's body keypoints with { part, position: [x,y], score }.
export function drawBodySkeleton(ctx, keypoints, videoW, videoH, canvasW, canvasH, opts) {
  const options = opts || {};
  const mirror = options.mirror !== false;
  if (!keypoints || !keypoints.length) return;
  const byName = {};
  for (const kp of keypoints) byName[kp.part] = kp;
  const sx = canvasW / videoW, sy = canvasH / videoH;
  const px = (x) => (mirror ? (videoW - x) : x) * sx;
  const py = (y) => y * sy;
  const p = (name) => {
    const kp = byName[name];
    if (!kp || (kp.score != null && kp.score < 0.3)) return null;
    const pos = kp.position || kp;
    return { x: px(pos[0]), y: py(pos[1]) };
  };
  const chain = (names) => {
    let prev = null;
    ctx.beginPath();
    for (const n of names) {
      const pt = p(n);
      if (!pt) { prev = null; continue; }
      if (!prev) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
      prev = pt;
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.strokeStyle = 'rgba(120,220,120,0.85)';
  ctx.lineWidth = 2;
  // Shoulders line
  chain(['leftShoulder', 'rightShoulder']);
  // Ears to shoulders (neck)
  chain(['leftEar', 'leftShoulder']);
  chain(['rightEar', 'rightShoulder']);
  // Head triangle
  chain(['leftEar', 'nose', 'rightEar']);
  // Joint dots
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const n of ['leftShoulder', 'rightShoulder', 'leftEar', 'rightEar', 'nose']) {
    const pt = p(n);
    if (!pt) continue;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Computes shoulder-tilt and neck-tilt in degrees from body keypoints.
// Returns { shoulderTilt, neckTilt } (null if not enough data).
export function computePostureTilt(keypoints) {
  if (!keypoints || !keypoints.length) return { shoulderTilt: null, neckTilt: null };
  const byName = {};
  for (const kp of keypoints) byName[kp.part] = kp;
  const get = (n) => {
    const kp = byName[n];
    if (!kp || (kp.score != null && kp.score < 0.3)) return null;
    return kp.position || kp;
  };
  const lS = get('leftShoulder'), rS = get('rightShoulder');
  let shoulderTilt = null;
  if (lS && rS) {
    // Positive = right shoulder is higher (in image coords, higher = smaller y).
    // We report absolute degrees + sign.
    const dy = lS[1] - rS[1];
    const dx = rS[0] - lS[0];
    shoulderTilt = Math.atan2(dy, dx) * 180 / Math.PI;
  }
  const nose = get('nose');
  let neckTilt = null;
  if (lS && rS && nose) {
    const mid = { x: (lS[0] + rS[0]) / 2, y: (lS[1] + rS[1]) / 2 };
    const dx = nose[0] - mid.x;
    const dy = mid.y - nose[1]; // upward positive
    // Angle from vertical (0 = perfectly upright)
    neckTilt = Math.atan2(dx, dy) * 180 / Math.PI;
  }
  return { shoulderTilt, neckTilt };
}
