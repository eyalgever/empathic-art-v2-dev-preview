/**
 * Empathic App — After view: horizontal ribbon timeline (v2.2 style)
 *
 * A single horizontal strip that maps each completed session to one
 * vertical colored line. Line hue = dominant emotion. Line height =
 * session-length (normalized). Sessions are ordered oldest-left,
 * newest-right along the strip.
 *
 * Interactions:
 *   - Wheel + Ctrl / Cmd  → anchored zoom (fit → 2× → 4× → 8×)
 *   - Two-finger pinch     → anchored zoom (touch)
 *   - Plain wheel + zoom>fit → horizontal pan
 *   - Click a colored line → open the Summary replay of that session
 *   - Hover a colored line → preview date + mood in the hint bar
 *
 * Adapted from Empathic Art v2.2 (`timeline_test.html`, lines 660–975).
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { EMOTIONS } from "../palette/emotion-palette.js?v=1.3.1";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ZOOM_LADDER = ["fit", 2, 4, 8];
const MIN_LINE_PX = 3;  // minimum visible line width at fit zoom
const MAX_LINE_PX = 18; // max at 8×
const RIBBON_GAP  = 2;  // px between lines

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function fmtShortDate(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

function lexEntry(name) {
  return EMOTIONS.find(e => e.name === name) || null;
}

/** Fallback dominant emotion computed from samples. */
export function computeDominant(samples) {
  if (!samples || !samples.length) return null;
  const counts = new Map();
  for (const s of samples) {
    counts.set(s.label, (counts.get(s.label) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [name, n] of counts) {
    if (n > bestN) { best = name; bestN = n; }
  }
  const emo = lexEntry(best);
  return emo ? { name: emo.name, hex: emo.hex } : null;
}

// ─────────────────────────────────────────────────────────────
// Public: mount the After view (ribbon timeline)
// ─────────────────────────────────────────────────────────────

/**
 * Mount the After view. Renders one colored line per session on a
 * horizontal ribbon. Returns a `destroy` function.
 */
export function mountAfterView({ container, sessions, onOpen }) {
  const ribbon  = container.querySelector("#tl-ribbon");
  const scrollEl = container.querySelector("#tl-scroll");
  const innerEl  = container.querySelector("#tl-inner");
  const axisEl   = container.querySelector("#tl-axis");
  const emptyEl  = container.querySelector("#tl-empty");
  const countEl  = container.querySelector("#timeline-count");
  const hoverEl  = container.querySelector("#tl-hover");
  const presetsEl = container.querySelector("#tl-presets");
  const zoomInBtn = container.querySelector("#tl-zoom-in");
  const zoomOutBtn = container.querySelector("#tl-zoom-out");

  if (!ribbon || !scrollEl) {
    // Defensive: HTML mismatch — nothing to render.
    return () => {};
  }
  ribbon.innerHTML = "";
  if (axisEl) axisEl.innerHTML = "";

  if (!sessions || !sessions.length) {
    if (emptyEl) emptyEl.hidden = false;
    if (countEl) countEl.textContent = "0 sessions";
    if (hoverEl) hoverEl.textContent = "Complete a session to see it here";
    return () => {};
  }
  if (emptyEl) emptyEl.hidden = true;
  if (countEl) {
    countEl.textContent = sessions.length === 1
      ? "1 session"
      : `${sessions.length} sessions`;
  }

  // Oldest → newest, left → right.
  const ordered = [...sessions].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  // Duration extents for line-height mapping.
  let maxDur = 0;
  for (const s of ordered) {
    if ((s.durationMs || 0) > maxDur) maxDur = s.durationMs || 0;
  }
  if (!maxDur) maxDur = 60_000;

  // Render one line per session.
  const lines = ordered.map((s, idx) => {
    const dom = s.dominantEmotion || computeDominant(s.samples) || { hex: "#888", name: "Session" };
    const durNorm = Math.min(1, (s.durationMs || 0) / maxDur);
    const heightPct = 30 + durNorm * 65; // 30% .. 95%

    const line = document.createElement("button");
    line.type = "button";
    line.className = "tl-line";
    line.setAttribute("role", "listitem");
    line.setAttribute("data-idx", String(idx));
    line.setAttribute(
      "aria-label",
      `Open ${dom.name} session from ${fmtShortDate(s.startedAt)}`
    );
    line.style.setProperty("--tl-color", dom.hex);
    line.style.setProperty("--tl-h", heightPct + "%");
    ribbon.appendChild(line);

    line.addEventListener("click", (ev) => {
      // ignore clicks that ended a drag-pan
      if (dragState && dragState.moved) return;
      ev.stopPropagation();
      onOpen(s);
    });
    line.addEventListener("mouseenter", () => setHover(idx));
    line.addEventListener("focus",     () => setHover(idx));

    return { line, session: s, dom };
  });

  ribbon.addEventListener("mouseleave", clearHover);

  function setHover(idx) {
    const k = lines[idx];
    if (!k || !hoverEl) return;
    const s = k.session;
    hoverEl.innerHTML =
      `<span class="tl-hover__date">${fmtShortDate(s.startedAt)} · ${fmtTime(s.startedAt)}</span>` +
      `<span class="tl-hover__sep">·</span>` +
      `<span class="tl-hover__mood" style="color:${k.dom.hex}">${k.dom.name}</span>` +
      `<span class="tl-hover__sep">·</span>` +
      `<span class="tl-hover__dur">${fmtDuration(s.durationMs)}</span>`;
  }
  function clearHover() {
    if (hoverEl) hoverEl.textContent = "Hover a line to preview · click to open the session";
  }
  clearHover();

  // ── Zoom + pan state ─────────────────────────────────────────
  let zoom = "fit"; // one of ZOOM_LADDER

  function fitLineWidth() {
    const scrollW = scrollEl.getBoundingClientRect().width;
    const n = lines.length;
    if (!n) return MIN_LINE_PX;
    // total width = n*(w+gap) - gap = scrollW  → w = (scrollW + gap)/n - gap
    const w = (scrollW + RIBBON_GAP) / n - RIBBON_GAP;
    return Math.max(MIN_LINE_PX, Math.min(MAX_LINE_PX, w));
  }
  function currentLineWidth() {
    if (zoom === "fit") return fitLineWidth();
    return Math.max(MIN_LINE_PX, Math.min(MAX_LINE_PX, fitLineWidth() * zoom));
  }
  function currentInnerWidth() {
    const lw = currentLineWidth();
    const n = lines.length;
    return Math.max(1, n * lw + Math.max(0, n - 1) * RIBBON_GAP);
  }

  function relayout() {
    const lw = currentLineWidth();
    ribbon.style.gap = RIBBON_GAP + "px";
    for (const k of lines) {
      k.line.style.width = lw + "px";
    }
    innerEl.style.width = currentInnerWidth() + "px";
    scrollEl.classList.toggle("tl-scroll--zoomed", zoom !== "fit");
    // Redraw month axis every layout so it matches new geometry.
    drawAxis();
  }

  function drawAxis() {
    if (!axisEl) return;
    axisEl.innerHTML = "";
    if (!lines.length) return;
    const first = ordered[0].startedAt;
    const last  = ordered[ordered.length - 1].startedAt;
    if (!first || !last || last <= first) return;

    // Emit a tick when the month changes between two adjacent sessions.
    const w = currentInnerWidth();
    let prevMonth = -1;
    const ticks = [];
    for (let i = 0; i < ordered.length; i++) {
      const d = new Date(ordered[i].startedAt);
      const m = d.getMonth();
      if (m !== prevMonth) {
        const lw = currentLineWidth();
        const x = i * (lw + RIBBON_GAP) + lw / 2;
        const pct = (x / w) * 100;
        const tick = document.createElement("span");
        tick.className = "tl-axis__tick";
        tick.style.left = pct + "%";
        tick.textContent =
          d.toLocaleString(undefined, { month: "short" }) +
          " " + String(d.getFullYear()).slice(-2);
        // Anchor edge ticks to the container so they don't get clipped.
        if (pct < 8) tick.setAttribute("data-edge", "start");
        else if (pct > 92) tick.setAttribute("data-edge", "end");
        axisEl.appendChild(tick);
        ticks.push({ tick, pct });
        prevMonth = m;
      }
    }
  }

  // ── Mouse drag-to-pan ────────────────────────────────────────
  let dragState = null;
  scrollEl.addEventListener("mousedown", (ev) => {
    if (zoom === "fit") return;
    // don't hijack clicks on the colored lines themselves
    if (ev.target.closest && ev.target.closest(".tl-line")) return;
    dragState = {
      startX: ev.clientX,
      startScroll: scrollEl.scrollLeft,
      moved: false,
    };
    scrollEl.classList.add("tl-scroll--dragging");
    ev.preventDefault();
  });
  const onMouseMove = (ev) => {
    if (!dragState) return;
    const dx = ev.clientX - dragState.startX;
    if (Math.abs(dx) > 3) dragState.moved = true;
    scrollEl.scrollLeft = dragState.startScroll - dx;
  };
  const onMouseUp = () => {
    if (dragState) scrollEl.classList.remove("tl-scroll--dragging");
    dragState = null;
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  // ── Wheel: cmd/ctrl = anchored zoom; else horizontal pan ────
  const onWheel = (ev) => {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      const dir = ev.deltaY > 0 ? -1 : 1;
      stepZoom(dir, ev);
    } else if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && zoom !== "fit") {
      scrollEl.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }
  };
  scrollEl.addEventListener("wheel", onWheel, { passive: false });

  // ── Touch: single-finger pan; two-finger pinch = anchored zoom
  let touchState = null;
  let pinchState = null;
  const onTouchStart = (ev) => {
    if (ev.touches.length === 2) {
      const [a, b] = ev.touches;
      pinchState = {
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startZoom: zoom === "fit" ? 1 : zoom,
        anchorX: (a.clientX + b.clientX) / 2,
        anchorY: (a.clientY + b.clientY) / 2,
      };
      touchState = null;
    } else if (ev.touches.length === 1 && zoom !== "fit") {
      touchState = {
        startX: ev.touches[0].clientX,
        startScroll: scrollEl.scrollLeft,
        moved: false,
      };
    }
  };
  const onTouchMove = (ev) => {
    if (pinchState && ev.touches.length === 2) {
      ev.preventDefault();
      const [a, b] = ev.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const factor = d / Math.max(1, pinchState.startDist);
      const target = Math.max(1, Math.min(8, pinchState.startZoom * factor));
      // Snap to ladder threshold; keep smooth by writing a raw number then normalizing on end
      setZoom(target === 1 ? "fit" : target, { clientX: pinchState.anchorX });
    } else if (touchState && ev.touches.length === 1) {
      const dx = ev.touches[0].clientX - touchState.startX;
      if (Math.abs(dx) > 3) touchState.moved = true;
      scrollEl.scrollLeft = touchState.startScroll - dx;
    }
  };
  const onTouchEnd = () => {
    if (pinchState) {
      // snap to nearest ladder rung
      const cur = zoom === "fit" ? 1 : zoom;
      let best = "fit", bestDiff = Infinity;
      for (const v of ZOOM_LADDER) {
        const num = v === "fit" ? 1 : v;
        const diff = Math.abs(num - cur);
        if (diff < bestDiff) { bestDiff = diff; best = v; }
      }
      setZoom(best);
      pinchState = null;
    }
    touchState = null;
  };
  scrollEl.addEventListener("touchstart", onTouchStart, { passive: true });
  scrollEl.addEventListener("touchmove", onTouchMove,   { passive: false });
  scrollEl.addEventListener("touchend",  onTouchEnd,    { passive: true });
  scrollEl.addEventListener("touchcancel", onTouchEnd,  { passive: true });

  // ── Zoom ladder + anchored zoom ──────────────────────────────
  function zoomIndex(z) {
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < ZOOM_LADDER.length; i++) {
      const v = ZOOM_LADDER[i];
      const num = (v === "fit") ? 1 : v;
      const cur = (z === "fit") ? 1 : z;
      const d = Math.abs(num - cur);
      if (d < bestDiff) { best = i; bestDiff = d; }
    }
    return best;
  }
  function stepZoom(dir, anchorEv) {
    const idx = zoomIndex(zoom);
    const next = Math.max(0, Math.min(ZOOM_LADDER.length - 1, idx + dir));
    setZoom(ZOOM_LADDER[next], anchorEv);
  }
  function setZoom(z, anchorEv) {
    const rect = scrollEl.getBoundingClientRect();
    const anchorX = anchorEv ? (anchorEv.clientX - rect.left) : (rect.width / 2);
    const innerRect = innerEl.getBoundingClientRect();
    const ratio = (scrollEl.scrollLeft + anchorX) / Math.max(1, innerRect.width);

    zoom = z;
    relayout();

    const newInnerW = innerEl.getBoundingClientRect().width;
    scrollEl.scrollLeft = Math.max(0, ratio * newInnerW - anchorX);
    syncPresetButtons();
  }
  function syncPresetButtons() {
    if (!presetsEl) return;
    presetsEl.querySelectorAll("button").forEach(b => {
      const v = b.getAttribute("data-zoom");
      const matches = (v === "fit" && zoom === "fit") || (parseFloat(v) === zoom);
      b.classList.toggle("active", matches);
    });
  }

  if (presetsEl) {
    presetsEl.querySelectorAll("button").forEach(b => {
      b.addEventListener("click", () => {
        const v = b.getAttribute("data-zoom");
        setZoom(v === "fit" ? "fit" : parseFloat(v));
      });
    });
  }
  if (zoomInBtn)  zoomInBtn.addEventListener("click", () => stepZoom(+1));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => stepZoom(-1));

  // ── Initial layout + resize ──────────────────────────────────
  relayout();
  syncPresetButtons();

  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(relayout, 120);
  };
  window.addEventListener("resize", onResize);

  // ── Cleanup ──────────────────────────────────────────────────
  return () => {
    clearTimeout(resizeT);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    scrollEl.removeEventListener("wheel", onWheel);
    scrollEl.removeEventListener("touchstart", onTouchStart);
    scrollEl.removeEventListener("touchmove", onTouchMove);
    scrollEl.removeEventListener("touchend", onTouchEnd);
    scrollEl.removeEventListener("touchcancel", onTouchEnd);
    ribbon.innerHTML = "";
    if (axisEl) axisEl.innerHTML = "";
  };
}
