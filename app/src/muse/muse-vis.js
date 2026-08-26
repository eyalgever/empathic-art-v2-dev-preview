/**
 * Empathic App v3 — Muse Visualiser
 *
 * A live mini-circumplex ported from the v2.2 "Physics of Feeling" instrument.
 * It renders the 19 canonical emotions around a circular field, draws the two
 * axes (valence, arousal), and animates a puck that walks the emotional
 * journey in real time. Openness controls the puck's outer halo.
 *
 * Design intent:
 *   • The wheel replaces the old data-row readout as the primary Muse UI.
 *   • Emotion labels are placed by their circumplex angle (angle-sorted).
 *   • The puck's fill is the current emotion hex — the panel breathes color.
 *   • A short trail hints at journey direction without cluttering the field.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS, emotionToColor, emotionToLabel } from "../palette/emotion-palette.js?v=1.3.1";
import { showEmotionTip, hideTip } from "../ui/tooltips.js?v=1.5.3";

// --- Layout constants (viewBox is 1000x1000) ---
const VB = 1000;
const CX = VB / 2;
const CY = VB / 2;
const R_OUTER = 400;   // outer ring radius, where emotion labels sit just outside
const R_INNER = 340;   // v1.6.3.20: was 380. Puck and trail live inside R_OUTER so
                       // the 11px trail stroke plus its glow never bleed past the
                       // circle edge (user report: trail starts far outside the ring).
const R_MID   = 240;   // mid ring, scaled with R_INNER
const R_CORE  = 110;   // core ring, scaled with R_INNER
const R_LABEL = 435;   // emotion-label center distance from wheel center
const R_AXIS  = 478;   // axis-label distance, clears both R_OUTER AND the emotion
                       // labels. Axis labels are 28px at v1.6.3.20; they still fit
                       // inside the 1000x1000 viewBox at this radius.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Mount the visualiser into an <svg> element. Returns a controller with an
 * `update(frame)` method the app can call from the muse frame loop.
 *
 * @param {SVGElement} svgEl
 * @returns {{ update: (frame: {v:number, a:number, o:number, journeyProgress?:number}, label?: string) => void, destroy: () => void }}
 */
export function mountMuseVis(svgEl) {
  if (!svgEl) throw new Error("mountMuseVis: svgEl is required");
  // Clear any previous render (safe on remount)
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  // --- Defs: radial background gradient + soft glow filter ---
  const defs = createNS("defs");
  defs.innerHTML = `
    <radialGradient id="muse-vis-bg" cx="50%" cy="50%" r="55%">
      <stop offset="0%"  stop-color="rgba(255,255,255,0.08)"/>
      <stop offset="70%" stop-color="rgba(255,255,255,0.02)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <filter id="muse-vis-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- Punchier glow so the trail reads as an expressive brush stroke
         rather than a diagram line. stdDeviation bumped 3→5 for a
         softer, more dominant beam that matches the replay's presence. -->
    <filter id="muse-vis-trail-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="5" result="blur1"/>
      <feMerge>
        <feMergeNode in="blur1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  `;
  svgEl.appendChild(defs);

  // --- Background disc ---
  const bg = createNS("circle", {
    cx: CX, cy: CY, r: R_OUTER + 8,
    fill: "url(#muse-vis-bg)",
  });
  svgEl.appendChild(bg);

  // --- Structural rings ---
  for (const r of [R_OUTER, R_MID, R_CORE]) {
    svgEl.appendChild(createNS("circle", {
      cx: CX, cy: CY, r,
      fill: "none",
      stroke: r === R_OUTER ? "rgba(251,246,236,0.28)" : "rgba(251,246,236,0.10)",
      "stroke-width": r === R_OUTER ? 1.4 : 1,
    }));
  }

  // --- Axes ---
  const axisStroke = "rgba(251,246,236,0.16)";
  svgEl.appendChild(createNS("line", {
    x1: CX - R_INNER, y1: CY, x2: CX + R_INNER, y2: CY,
    stroke: axisStroke, "stroke-width": 1,
    "stroke-dasharray": "4 6",
  }));
  svgEl.appendChild(createNS("line", {
    x1: CX, y1: CY - R_INNER, x2: CX, y2: CY + R_INNER,
    stroke: axisStroke, "stroke-width": 1,
    "stroke-dasharray": "4 6",
  }));

  // --- Axis end-cap labels (tiny) ---
  const axisLabelAttrs = {
    "font-family": '"Inter Tight", "Inter", sans-serif',
    "font-size": 28,           // v1.6.3.20: was 22, upsized for the enlarged panel
    "font-weight": 500,
    "letter-spacing": "0.14em",
    fill: "rgba(251,246,236,0.72)",
    "text-transform": "uppercase",
  };
  // Axis labels sit BEYOND the emotion-label ring (R_AXIS > R_LABEL) so they never
  // collide with peripheral emotions (Love/Peace on the +v axis, Boredom on the
  // -a axis, etc.). This was the source of the "calm ↔ Boredom" overlap.
  // +Valence (right) — "pleasant"; -Valence (left) — "unpleasant"
  svgEl.appendChild(createNS("text", {
    x: CX + R_AXIS, y: CY + 8, "text-anchor": "middle", ...axisLabelAttrs,
  }, "pleasant"));
  svgEl.appendChild(createNS("text", {
    x: CX - R_AXIS, y: CY + 8, "text-anchor": "middle", ...axisLabelAttrs,
  }, "unpleasant"));
  // -Arousal in SVG y=down space → "activated" is at the TOP of the wheel.
  svgEl.appendChild(createNS("text", {
    x: CX, y: CY - R_AXIS + 8, "text-anchor": "middle", ...axisLabelAttrs,
  }, "activated"));
  svgEl.appendChild(createNS("text", {
    x: CX, y: CY + R_AXIS + 8, "text-anchor": "middle", ...axisLabelAttrs,
  }, "calm"));

  // --- Emotion terms placed by angle (labels + tiny anchor dot) ---
  // Store references so we can highlight the nearest one live.
  const emoNodes = new Map(); // name -> { text, dot, x, y }
  for (const emo of EMOTIONS) {
    // Circumplex angle: 0° = +valence axis, increasing CCW.
    // SVG y grows downward, so flip the y term.
    const rad = (emo.angle * Math.PI) / 180;
    const dotX = CX + Math.cos(rad) * R_OUTER;
    const dotY = CY - Math.sin(rad) * R_OUTER;
    const lblX = CX + Math.cos(rad) * R_LABEL;
    const lblY = CY - Math.sin(rad) * R_LABEL;

    // Anchor dot — emotion hex, larger + more opaque so the color/emotion pairing
    // reads at a glance. This is the visual anchor for the label sitting outside it.
    // A larger transparent hit target sits on top so hovering the dot works well
    // on touch and mouse — the visible dot stays small.
    const dot = createNS("circle", {
      cx: dotX, cy: dotY, r: 7,
      fill: emo.hex,
      opacity: 1,
    });
    dot.setAttribute("data-emo", emo.name);
    svgEl.appendChild(dot);

    // Invisible hit target — a bigger circle around each anchor makes hover/tap
    // reliable on mobile without visually enlarging the dot.
    const hit = createNS("circle", {
      cx: dotX, cy: dotY, r: 22,
      fill: "transparent",
      "pointer-events": "all",
    });
    hit.setAttribute("data-emo", emo.name);
    hit.setAttribute("data-emo-hex", emo.hex);
    hit.style.cursor = "help";
    svgEl.appendChild(hit);
    hit.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      showEmotionTip(emo.name, emo.hex, ev.clientX, ev.clientY);
    });
    hit.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      hideTip();
    });
    hit.addEventListener("click", (ev) => {
      // Stop the same click from bubbling to the document-level outside-click
      // handler, which would immediately close the tip we just opened.
      ev.stopPropagation();
      showEmotionTip(emo.name, emo.hex, ev.clientX, ev.clientY);
    });

    // Emotion label — Fraunces italic, coloured with the emotion hex tinted toward
    // cream (85% emotion, 15% cream) so the color–feeling link is unmistakable while
    // still remaining legible on the dark background.
    const labelFill = tintTowardCream(emo.hex, 0.15);
    const anchor = anchorForAngle(emo.angle);
    const text = createNS("text", {
      x: lblX, y: lblY + 8,
      "text-anchor": anchor,
      "font-family": '"Fraunces", "Cormorant Garamond", Georgia, serif',
      "font-size": 34,           // v1.6.3.20: was 26, 30% larger so the 19 emotion
      "font-weight": 500,        // names read easily at the enlarged panel size.
      "font-style": "italic",
      fill: labelFill,
      "letter-spacing": "0.01em",
      style: "transition: fill 260ms ease, font-weight 260ms ease; cursor: help;",
    }, emo.name);
    text.setAttribute("data-emo", emo.name);
    text.setAttribute("data-emo-hex", emo.hex);
    text.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      showEmotionTip(emo.name, emo.hex, ev.clientX, ev.clientY);
    });
    text.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType && ev.pointerType !== "mouse") return;
      hideTip();
    });
    text.addEventListener("click", (ev) => {
      ev.stopPropagation();
      showEmotionTip(emo.name, emo.hex, ev.clientX, ev.clientY);
    });
    svgEl.appendChild(text);

    emoNodes.set(emo.name, { text, dot, x: dotX, y: dotY, baseFill: labelFill, hex: emo.hex });
  }

  // --- Journey trail (persistent, per-segment colorized by emotion) ---
  // Cycle 17: identical rendering to session replay. Full session history
  // from t=0 to now — no rolling window, no time-based fade. The trail IS
  // the emotional journey; erasing older segments would betray the artist's
  // intent ("I want to see where it started and the evolution of my
  // emotions through the session"). The 12k segment cap is a memory-safety
  // net for pathological cases only; a normal 10-min session is well under.
  //
  // Design choices:
  //   • No mix-blend-mode: screen — iOS Safari rendered it inconsistently,
  //     making the trail look chunky vs. the smooth continuous curves
  //     visible in replay. Straight opacity blending is stable everywhere.
  //   • Full opacity, no filter — the color IS the signal; softening it
  //     with a glow filter obscured the beautiful color transitions.
  //   • stroke-linejoin: round + linecap: round — segments connect visually
  //     as one continuous curved path even though they're individual lines.
  const trailGroup = createNS("g", {
    "pointer-events": "none",
    // Apply the trail-glow filter to the whole group so the live-session
    // trail reads as expressive brushwork (dominant, painterly) instead
    // of a thin diagram line. Matches the replay's visual weight.
    filter: "url(#muse-vis-trail-glow)",
  });
  // Trail sits BEHIND the puck group so the puck reads on top. We append it
  // here BEFORE the puckHalo/puckGroup below so DOM order = paint order.
  svgEl.appendChild(trailGroup);
  let lastTrailPt = null; // { x, y }
  // Generous safety cap. A 30-min session at 30fps would be ~54k segments;
  // we cap at 12k which is ~6-7 minutes of dense motion or a full 30-min
  // session at the 5 Hz replay sample rate. Older segments only get
  // pruned in the pathological worst case, so the trail effectively
  // reads as "full session" for every real-world use.
  const MAX_TRAIL_SEG = 12000;
  const trailSegs = []; // rolling array of <line> nodes

  // ── The puck: "YOU" ───────────────────────────────────────
  // The puck represents the viewer's current emotional state on the wheel.
  // It carries three visual signals so it's unmistakable:
  //   1. Soft outer halo (openness bloom)
  //   2. Continuously animated pulse ring (heartbeat cue — this is alive, this is you)
  //   3. "YOU" caption in the current emotion color, tracking the puck
  const puckHalo = createNS("circle", {
    cx: CX, cy: CY, r: 28,
    fill: "#FBF6EC",
    opacity: 0.22,
    filter: "url(#muse-vis-glow)",
  });
  svgEl.appendChild(puckHalo);
  puckHalo.style.transition = "cx 320ms ease, cy 320ms ease, r 320ms ease, opacity 320ms ease, fill 320ms ease";

  // Pulse ring — animated via SMIL so it works consistently on iOS Safari.
  // The ring's stroke picks up the puck's current fill via `stroke="currentColor"`
  // on a wrapper <g> we retint each frame.
  const puckGroup = createNS("g", { color: "#FBF6EC" });
  puckGroup.style.transition = "color 320ms ease";
  svgEl.appendChild(puckGroup);

  const pulseRing = createNS("circle", {
    cx: CX, cy: CY, r: 18,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    opacity: 0.85,
  });
  pulseRing.style.transition = "cx 320ms ease, cy 320ms ease";
  // Two animate primitives that repeat forever — expand + fade.
  const animR = createNS("animate", {
    attributeName: "r", from: "14", to: "38", dur: "1.6s",
    begin: "0s", repeatCount: "indefinite", calcMode: "spline",
    keySplines: "0.16 0.84 0.44 1",
  });
  const animO = createNS("animate", {
    attributeName: "opacity", from: "0.85", to: "0", dur: "1.6s",
    begin: "0s", repeatCount: "indefinite", calcMode: "spline",
    keySplines: "0.16 0.84 0.44 1",
  });
  const animSW = createNS("animate", {
    attributeName: "stroke-width", from: "2.4", to: "0.6", dur: "1.6s",
    begin: "0s", repeatCount: "indefinite", calcMode: "spline",
    keySplines: "0.16 0.84 0.44 1",
  });
  pulseRing.appendChild(animR);
  pulseRing.appendChild(animO);
  pulseRing.appendChild(animSW);
  puckGroup.appendChild(pulseRing);

  const puck = createNS("circle", {
    cx: CX, cy: CY, r: 14,
    fill: "#FBF6EC",
    stroke: "#FBF6EC",
    "stroke-width": 2.5,
    style: "transition: cx 320ms ease, cy 320ms ease, fill 320ms ease, r 320ms ease, stroke 320ms ease;",
  });
  puckGroup.appendChild(puck);

  // "YOU" caption — small caps, sits just under the puck, colored with the emotion.
  // Font-size in SVG units (viewBox is 1000). Panel renders at ~280–380px wide, so
  // 48 SVG units resolves to ~13–18px on-screen — legible.
  // paint-order + stroke gives the caption a cream halo so it reads on any fluid
  // color behind the wheel (the panel background is a translucent overlay).
  const youLabel = createNS("text", {
    x: CX, y: CY + 44,
    "text-anchor": "middle",
    "font-family": '"Inter Tight", "Inter", sans-serif',
    "font-size": 48,
    "font-weight": 800,
    "letter-spacing": "0.18em",
    fill: "currentColor",
    stroke: "#0D0B0A",
    "stroke-width": 4,
    "paint-order": "stroke fill",
    "text-transform": "uppercase",
    style: "transition: x 320ms ease, y 320ms ease;",
  }, "YOU");
  puckGroup.appendChild(youLabel);

  // --- Highlighted emotion state, so we can revert the previous one cleanly ---
  let lastHighlight = null;

  /**
   * Update the wheel with a new muse frame.
   * @param {{v:number, a:number, o:number, journeyProgress?:number}} frame
   * @param {string} [label] - Explicit nearest-emotion label. If omitted we
   *                           compute it from (v,a) using the palette module.
   */
  function update(frame, label) {
    if (!frame) return;
    const v = clamp11(frame.v ?? 0);
    const a = clamp11(frame.a ?? 0);
    const o = clamp01(frame.o ?? 0.5);
    const name = label || pickLabelFromVA(v, a);
    const hex = emotionToColor(v, a, 1); // saturated, no cream drift
    const emo = EMOTIONS.find((e) => e.name === name) || null;
    const emoHex = emo ? emo.hex : hex;

    // Convert (v,a) → SVG coord. Clamp inside the outer ring.
    const px = CX + v * R_INNER;
    const py = CY - a * R_INNER;

    puck.setAttribute("cx", px);
    puck.setAttribute("cy", py);
    puck.setAttribute("fill", emoHex);
    puck.setAttribute("stroke", emoHex);
    puck.setAttribute("r", 13 + o * 6); // openness inflates the puck

    // Retint the puck group so pulseRing (stroke=currentColor) and YOU (fill=currentColor)
    // both track the emotion.
    puckGroup.setAttribute("color", emoHex);

    // Move the pulse ring with the puck. Its animated attributes (r, opacity, stroke-width)
    // are driven by SMIL and untouched here.
    pulseRing.setAttribute("cx", px);
    pulseRing.setAttribute("cy", py);

    // Position the YOU caption near the puck. Smart placement: put it on the
    // side of the puck AWAY from the nearest emotion label so YOU never sits
    // on top of a label like "Sadness" or "Serenity". The current emotion
    // label lies OUTSIDE the puck (at R_LABEL, ~430), so the puck-to-center
    // direction is the safest place — pointing INWARD toward CX,CY.
    const puckR = 13 + o * 6;
    const dxc = CX - px;
    const dyc = CY - py;
    const dist = Math.max(1, Math.hypot(dxc, dyc));
    const pad = puckR + 42;
    // Only offset inward when the puck is far enough from center that it
    // makes sense; near the middle just drop the label below.
    if (dist > 40) {
      const ux = dxc / dist;
      const uy = dyc / dist;
      youLabel.setAttribute("x", px + ux * pad);
      youLabel.setAttribute("y", py + uy * pad + 16); // +16 fudge for baseline
    } else {
      youLabel.setAttribute("x", px);
      youLabel.setAttribute("y", py + puckR + 42);
    }

    puckHalo.setAttribute("cx", px);
    puckHalo.setAttribute("cy", py);
    puckHalo.setAttribute("fill", emoHex);
    puckHalo.setAttribute("r", 26 + o * 22);
    puckHalo.setAttribute("opacity", 0.22 + o * 0.28);

    // ── Persistent journey trail ───────────────────────────────────────
    // Draw a line segment from the previous position to the current one,
    // colored with the CURRENT emotion hex. Over the course of a session
    // the trail becomes a colored path that shows exactly how the user's
    // feeling moved through the circumplex.
    if (lastTrailPt) {
      const dx = px - lastTrailPt.x;
      const dy = py - lastTrailPt.y;
      // Skip degenerate segments (sub-pixel jitter) to keep the DOM tidy.
      if (dx * dx + dy * dy > 0.8) {
        const seg = createNS("line", {
          x1: lastTrailPt.x.toFixed(1),
          y1: lastTrailPt.y.toFixed(1),
          x2: px.toFixed(1),
          y2: py.toFixed(1),
          stroke: emoHex,
          // Doubled stroke width (6→11) and moved the glow filter to the
          // parent group. The trail dominates as a painterly beam so the
          // live session matches the replay's visual quality.
          "stroke-width": 11,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 1,
        });
        trailGroup.appendChild(seg);
        trailSegs.push(seg);
        // Safety-only prune. See MAX_TRAIL_SEG comment above.
        while (trailSegs.length > MAX_TRAIL_SEG) {
          const dead = trailSegs.shift();
          if (dead && dead.parentNode) dead.parentNode.removeChild(dead);
        }
      }
    }
    lastTrailPt = { x: px, y: py };

    // Highlight the nearest emotion label. When restoring the previous highlight we
    // return the label to its per-emotion tinted baseline (85% emotion + 15% cream)
    // — not the old flat cream — so the color-emotion pairing stays legible even
    // for feelings that are not the current puck target.
    if (lastHighlight && lastHighlight !== name) {
      const prev = emoNodes.get(lastHighlight);
      if (prev) {
        prev.text.setAttribute("fill", prev.baseFill);
        prev.text.setAttribute("font-weight", "500");
        prev.dot.setAttribute("r", 7);
        prev.dot.setAttribute("opacity", 1);
      }
    }
    if (name) {
      const cur = emoNodes.get(name);
      if (cur) {
        // Selected label goes to pure emotion hex + bold weight, and the dot swells.
        cur.text.setAttribute("fill", cur.hex);
        cur.text.setAttribute("font-weight", "700");
        cur.dot.setAttribute("r", 11);
        cur.dot.setAttribute("opacity", 1);
      }
      lastHighlight = name;
    }
  }

  function destroy() {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  }

  // v1.6.3.20: reset the trail state. Called by summary-playback on seek
  // so the next segment doesn't span from the old lastTrailPt to the
  // scrubbed-to sample, drawing a stray line that leaves the ring.
  function resetTrail() {
    lastTrailPt = null;
    for (const seg of trailSegs) {
      if (seg && seg.parentNode) seg.parentNode.removeChild(seg);
    }
    trailSegs.length = 0;
  }

  return { update, destroy, resetTrail };
}

// --- helpers ---

function createNS(name, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, v);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp11(x) { return Math.max(-1, Math.min(1, x)); }

// Blend a hex color toward cream (#FBF6EC) by `t` (0 = pure hex, 1 = pure cream).
// Used to keep peripheral emotion labels legible on the dark background while
// still preserving the color–emotion link.
function tintTowardCream(hex, t) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const cr = 0xFB, cg = 0xF6, cb = 0xEC;
  const mix = (a, c) => Math.round(a + (c - a) * t);
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  return `#${hex2(mix(r, cr))}${hex2(mix(g, cg))}${hex2(mix(b, cb))}`;
}

function anchorForAngle(angleDeg) {
  // Right half of the wheel: labels sit to the RIGHT of the dot → text-anchor: start
  // Left half: labels sit to the LEFT → text-anchor: end
  // Near the poles (top/bottom): center them
  const a = ((angleDeg % 360) + 360) % 360;
  if (a > 80 && a < 100) return "middle";   // ~ top
  if (a > 260 && a < 280) return "middle";  // ~ bottom
  if (a >= 90 && a <= 270) return "end";
  return "start";
}

function pickLabelFromVA(v, a) {
  // Nearest anchor by angular distance (matches emotion-palette logic).
  let best = null;
  let bestDist = Infinity;
  for (const e of EMOTIONS) {
    const dv = v - e.v;
    const da = a - e.a;
    const d = dv * dv + da * da;
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best ? best.name : null;
}
