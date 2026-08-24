/**
 * color-legibility.js — shared color helper
 *
 * Extracted from src/app.js in v1.5.1 to break a circular import.
 * summary-playback.js needs `liftForLegibility` for the End-of-session
 * reveal, but importing it back from app.js (with a stale ?v= query)
 * used to spawn a second copy of app.js as a separate module — which
 * meant a second `SessionStore`, a second `AudioReactive`, and a
 * second picker onSelect closure that clobbered the visible one.
 * Living in its own tiny module removes that whole class of bug.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * Lift an emotion hex into a variant that always stays readable on
 * top of the live fluid surface. Preserves hue (so the label still
 * reads chromatically as the emotion) but clamps saturation and
 * lightness up so the label separates from the background.
 *
 * v1.5.0-alpha7 — introduced because Melancholy's canonical dusty
 * blue-purple sat right on top of the Melancholy fluid surface and
 * the label vanished. Also used by the summary-replay reveal.
 */
export function liftForLegibility(hex) {
  const s = String(hex || "").trim().replace(/^#/, "");
  const norm = s.length === 3
    ? s.split("").map((c) => c + c).join("")
    : s;
  if (norm.length !== 6) return hex;
  const r = parseInt(norm.slice(0, 2), 16) / 255;
  const g = parseInt(norm.slice(2, 4), 16) / 255;
  const b = parseInt(norm.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0;
  const l0 = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  const l = Math.max(l0, 0.82);
  const s2 = Math.max(sat, 0.65);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2;
  const p = 2 * l - q;
  const r2 = hue2rgb(p, q, h + 1 / 3);
  const g2 = hue2rgb(p, q, h);
  const b2 = hue2rgb(p, q, h - 1 / 3);
  const to2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + to2(r2) + to2(g2) + to2(b2);
}
