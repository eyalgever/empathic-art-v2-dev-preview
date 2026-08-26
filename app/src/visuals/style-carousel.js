/**
 * Empathic App — Visual-Style Carousel (Before-screen picker)
 *
 * Horizontal-scrolling row of live-rendering preview tiles, one per
 * registered VisualStyle. The user's pick lands on
 * `store.state.visualStyle` and is honoured by the Session screen.
 *
 * Guardrails for on-device thermals (all mandatory, per the plan):
 *   - Lazy RAF: only tiles whose IntersectionObserver ratio ≥ 0.5 run
 *   - Hard cap of 3 concurrent live GL contexts (LRU eviction)
 *   - Preview canvas capped at 200 CSS px wide, devicePixelRatio = 1
 *   - Preview loop is a 6-second scripted arc: calm → arousal → return
 *   - Selected tile keeps rendering even off-screen (small cost,
 *     confirms the user's chosen style is alive)
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { StyleRegistry } from "./index.js?v=1.3.1";
import { emotionToColor } from "../palette/emotion-palette.js?v=1.3.1";

// One live context per registered style. With up to eight styles all
// sharing small preview canvases this stays inside iPhone GL context
// budgets (Safari's cap is ~16 WebGL contexts), and it avoids the
// eviction churn that made the "Current" tile fall stale when the
// user opened the picker.
const MAX_LIVE = 8;
const LOOP_MS = 6000;

function clamp01Local(x) { return Math.max(0, Math.min(1, x)); }

// Canonical poster for every registered style. Rendered under the
// live-preview canvas so evicted / not-yet-started tiles still
// communicate the style at a glance. Files live in
// docs/screenshots/style-NN-<id>.png and are shipped with the app.
const POSTER_MAP = {
  current:   "style-01-breath.png",
  halo:      "style-02-halo.png",
  skyspace:  "style-03-skyspace.png",
  aperture:  "style-04-aperture.png",
  chapel:    "style-05-chapel.png",
  filament:  "style-06-filament.png",
  nerves:    "style-07-nerves.png",
  drift:     "style-08-drift.png",
  threshold: "style-09-threshold.png",
  ember:     "style-10-ember.png",
  smokering: "style-11-smokering.png",
  physarum:  "style-12-physarum.png",
  curl:      "style-13-curl.png",
  aurora:    "style-14-aurora.png",
  fluid:     "style-15-fluid.png",
};

// Scripted 6-second preview arc: rest → gentle joy → contemplation → rest.
// Values stay inside the palette's covered v/a/o space.
function previewFrame(t01) {
  // Two easings interlocked. Very roughly: openness swells, arousal
  // rises then falls, valence gently oscillates around zero.
  const phase = t01 * Math.PI * 2;
  const v = 0.35 * Math.sin(phase);
  const a = 0.45 * Math.sin(phase * 1.3 + 0.6);
  const o = 0.55 + 0.25 * Math.sin(phase * 0.7);
  return { v, a, o };
}

/**
 * @typedef {Object} StylePreviewTile
 * @property {typeof import("./visual-style.js").StyleRegistry} Cls
 * @property {HTMLElement}       root
 * @property {HTMLCanvasElement} canvas
 * @property {any|null}          inst       — running style instance, or null
 * @property {number}            visibility — last observed IO ratio
 */

export function mountStyleCarousel(container, {
  selectedId = "current",
  onSelect = () => {},
  /**
   * Optional ordered array of style ids to show; when provided, only
   * these tiles render (in the given order). Style ids not registered
   * are silently skipped. When omitted, every registered style renders
   * in registry order.
   */
  filterIds = null,
  /**
   * Optional set of style ids that should render a “New” badge in the
   * top-right of their tile. Used by the section tabs to flag the
   * three most-recently-added styles.
   */
  newIds = null,
  /**
   * Layout hint. “grid” = vertical 3-column CSS grid (v1.4.3 default,
   * used by the popover). “row” = the legacy horizontal scroller so
   * existing call-sites keep working if they mount inline.
   */
  layout = "grid",
} = {}) {
  container.innerHTML = "";
  container.classList.add("ea-style-carousel");
  container.classList.toggle("ea-style-carousel--grid", layout === "grid");
  container.classList.toggle("ea-style-carousel--row", layout === "row");
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", "Visual style");

  const track = document.createElement("div");
  track.className = "ea-style-carousel__track";
  container.appendChild(track);

  const allStyles = StyleRegistry.list();
  const byId = new Map(allStyles.map((C) => [C.id, C]));
  const styles = Array.isArray(filterIds)
    ? filterIds.map((id) => byId.get(id)).filter(Boolean)
    : allStyles;
  const newSet = newIds instanceof Set
    ? newIds
    : new Set(Array.isArray(newIds) ? newIds : []);
  const tiles = /** @type {StylePreviewTile[]} */ ([]);
  let selected = selectedId;

  for (const Cls of styles) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ea-style-tile";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", Cls.id === selected ? "true" : "false");
    btn.dataset.styleId = Cls.id;

    // Per-style tooltip key. Matches STATIC_TIPS in tooltips.js.
    const tipKey = `style-${Cls.id === "current" ? "breath" : Cls.id}`;
    const isNew = newSet.has(Cls.id);
    // Every registered style ships a canonical poster in
    // docs/screenshots/style-NN-<id>.png. The tile shows the poster
    // as a background layer; the live-preview canvas paints on top of
    // it. When a tile is evicted (LRU beyond MAX_LIVE) or hasn’t
    // started yet, the poster is what the user sees — no blank tile,
    // no lost-context artefact. The mapping is derived from the
    // canonical registry order at build time.
    const posterName = POSTER_MAP[Cls.id];
    const posterUrl = posterName
      ? `./docs/screenshots/${posterName}?v=1.5.0`
      : "";
    btn.innerHTML = `
      <span class="ea-style-tile__preview">
        ${posterUrl
          ? `<img class="ea-style-tile__poster" src="${posterUrl}"
                  alt="" aria-hidden="true" loading="lazy"
                  decoding="async" />`
          : ""}
        <canvas class="ea-style-tile__canvas" width="200" height="250" aria-hidden="true"></canvas>
      </span>
      <span class="ea-style-tile__meta">
        <span class="ea-style-tile__name">${Cls.name}</span>
        <span class="ea-style-tile__sub">${Cls.subtitle || ""}</span>
      </span>
      ${isNew ? `<span class="ea-style-tile__badge" aria-label="New style">New</span>` : ""}
      <span class="ea-style-tile__info"
            role="button"
            tabindex="0"
            data-ea-tip="${tipKey}"
            aria-label="About ${Cls.name}">
        <span aria-hidden="true">i</span>
      </span>
    `;
    track.appendChild(btn);

    const canvas = btn.querySelector("canvas");
    const tile = { Cls, root: btn, canvas, inst: null, visibility: 0 };
    tiles.push(tile);

    // Tile-select on click, but only when the click did NOT originate
    // from the info chip. The info chip needs its click to bubble up
    // to the document-level tooltip toggle handler (see tooltips.js
    // handleToggle), so we must NOT stopPropagation on it. Instead we
    // detect the chip target here and skip the selection side-effect.
    btn.addEventListener("click", (e) => {
      if (e.target && e.target.closest(".ea-style-tile__info")) return;
      selected = Cls.id;
      for (const t of tiles) t.root.setAttribute("aria-checked", t.Cls.id === selected ? "true" : "false");
      ensureRunning(tile);
      onSelect(selected);
    });
  }

  // ── LRU of live instances ─────────────────────────────────────────
  /** @type {StylePreviewTile[]} */
  const liveOrder = [];

  function ensureRunning(tile) {
    if (tile.inst) {
      // Promote to MRU
      const idx = liveOrder.indexOf(tile);
      if (idx > -1) liveOrder.splice(idx, 1);
      liveOrder.push(tile);
      return;
    }
    // Evict least-recently-used until we have room. Never evict the
    // currently selected tile.
    while (liveOrder.length >= MAX_LIVE) {
      const victim = liveOrder.findIndex((t) => t.Cls.id !== selected);
      if (victim === -1) break;
      const [v] = liveOrder.splice(victim, 1);
      stopTile(v);
    }
    try {
      const canvas = tile.canvas;
      // Cheap preview: DPR fixed at 1, keep the backing store small.
      canvas.width = 200;
      canvas.height = 250;
      // Pass a tighter dye dissipation for the Breath tile so splats
      // fade before they can saturate the small canvas to white.
      // Session engine keeps its default (0.4) for the full-screen
      // painting; only the picker preview needs faster fade.
      // Tile previews: keep Breath's tight dissipation for its small
      // canvas, and flag Fluid instances so they run in the carousel's
      // faster/lusher "seductive thumbnail" mode (see fluid-style.js
      // v1.5.0-alpha7 dual-mode time-scale).
      const instOpts =
        tile.Cls.id === "current" ? { densityDiss: 1.6 } :
        tile.Cls.id === "fluid"   ? { tilePreview: true } :
        {};
      const inst = new tile.Cls(canvas, instOpts);
      inst.resize();
      // Breath (fluid) and Fluid (Navier–Stokes) both read only
      // against the dark session ink — on cream, the coloured splats
      // vanish into the surface and the tile appears blank/white.
      // Other styles paint their own backgrounds and don't need
      // setSurface.
      if (tile.Cls.id === "current" || tile.Cls.id === "fluid") {
        inst.setSurface?.(0x1E / 255, 0x21 / 255, 0x25 / 255);
      } else {
        inst.setSurface?.(0xFB / 255, 0xF6 / 255, 0xEC / 255);
      }
      // Prime with a neutral-warm emotion so the first frame is
      // meaningful rather than seeded grey.
      inst.setEmotion?.(0.2, 0.15, 0.55, "");
      inst.start();
      tile.inst = inst;

      liveOrder.push(tile);
    } catch (err) {
      console.warn("[style-carousel] failed to start", tile.Cls.id, err);
    }
  }

  function stopTile(tile) {
    if (!tile.inst) return;
    try { tile.inst.destroy(); } catch { /* noop */ }
    tile.inst = null;
    // Chromium draws a “broken image” / lost-context sprite over any
    // <canvas> whose WebGL context has been torn down while the
    // element is still in the tree. Just resizing the backing buffer
    // doesn’t clear that state — we have to swap in a brand-new,
    // never-initialised canvas element. That way the poster underneath
    // shows through cleanly.
    try {
      const oldCanvas = tile.canvas;
      if (oldCanvas && oldCanvas.parentNode) {
        const fresh = document.createElement("canvas");
        fresh.className = oldCanvas.className;
        fresh.width = 1;
        fresh.height = 1;
        fresh.setAttribute("aria-hidden", "true");
        oldCanvas.parentNode.replaceChild(fresh, oldCanvas);
        tile.canvas = fresh;
      }
    } catch { /* noop */ }
  }

  // ── IntersectionObserver ─────────────────────────────────────────
  //
  // We have four styles and MAX_LIVE=4 — there is never a reason to
  // evict a live tile, so once a tile has become visible and started
  // rendering, we leave it running for the lifetime of the picker.
  // This prevents the intermittent "tile stops animating on scroll"
  // effect: the previous eviction path destroyed the GL context, and a
  // subsequent scroll-back had to re-init it before it could paint
  // again. With only 4 GL contexts and no live memory pressure on
  // modern iPhones, the always-on approach is simpler and steadier.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const tile = tiles.find((t) => t.root === e.target);
      if (!tile) continue;
      tile.visibility = e.intersectionRatio;
      // Start any tile that has become at least partially visible — no
      // hysteresis, no eviction. Once running, it stays running.
      if (e.intersectionRatio > 0) ensureRunning(tile);
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  for (const t of tiles) io.observe(t.root);

  // ── Preview loop tick — drive every live tile with the same arc ──
  //
  // Current style (fluid painting) is different from every other
  // registered style: it's a fluid engine that only shows motion when
  // splats are injected. In the live app, the wheel touches inject
  // splats; in the preview tile we have no touches. So the preview
  // needs synthetic splats to feel alive. Every ~700ms we drop a
  // splat into any running Current tile at a slowly-orbiting position
  // synced to the same 6s arc. This is what the user experiences as
  // a "loop" — the fluid dances by itself.
  const t0 = performance.now();
  let raf = 0;
  let lastSplatAt = 0;
  // Splat cadence for the Breath tile. Slower + smaller than the live
  // wheel touches so the fluid doesn't saturate to white in the small
  // preview canvas (250x200px — dye density accumulates fast at that
  // scale). One splat per ~1.2s dissipates naturally between drops.
  const SPLAT_INTERVAL_MS = 1200;
  // Per-style preview overrides. Each style gets a fixed anchor so
  // side-by-side tiles read as visibly distinct. Filament and Nerves
  // in particular must not look like the same painting.
  //   { v, a, o } snapshot — v = valence, a = arousal, o = openness.
  const PREVIEW_ANCHOR = {
    // Filament — warm amber Excitement/Joy anchor (angle ~40°),
    // tightly closed → dense hot-orange wire lattice, low openness.
    // v=+0.77, a=+0.64 lands squarely between Excitement (30°) and
    // Joy (50°), both #DE8230/#F4B23A hot amber.
    filament: { v: 0.77, a: 0.64, o: 0.10 },
    // Nerves  — cool teal Contemplation anchor (angle ~290°),
    // fully open → sparse cyan/mint synaptic web. v=+0.34, a=-0.94
    // hits Contemplation (#3A6864). Distinct warm/cool contrast
    // with Filament so the two tiles never read the same.
    nerves:   { v: 0.34, a: -0.94, o: 0.98 },
    // Drift   — olive Peace anchor (angle ~350°), half-open so the
    // poster bands are visible but not sharp. v=+0.62, a=-0.20 lands
    // on Peace (#849868), a warm-olive that pairs with the gold hot
    // stop for a distinctly landscape-lit reading. Distinct from
    // Filament's dense hot lattice and Nerves' cool mint web because
    // the field is continuous and earth-toned rather than luminous.
    drift:    { v: 0.62, a: -0.20, o: 0.55 },
    // Threshold — luminous Elation anchor (angle ~30°), moderately
    // closed so the ring reads thick and crystalline. v=+0.72,
    // a=+0.55 lands near Elation, giving a warm-gold ring with
    // bright peach highlights and a violet-adjacent whisper. The
    // ring composition is deliberately distinct from every other
    // tile — no other style is a single centered corona.
    threshold: { v: 0.72, a: 0.55, o: 0.40 },
    // Fluid is not given a single anchor — the tile loop cycles it
    // through a scripted emotion journey (love → serenity → elation
    // → melancholy → love) so the preview reads as "session as
    // memory": several colours held in the same fluid at once.
    // See the Fluid-specific block inside tick() below.
  };

  // Fluid preview cycle — five labelled emotions on a rolling loop.
  // Each label change fires an internal burst inside FluidStyle, so
  // the tile reads as an ever-changing multi-colour painting instead
  // of a static hue. Chosen to span the palette wheel: warm love,
  // cool serenity, hot elation, dark melancholy, back to love.
  // v1.5.0-alpha7i — gentle 2-stop cycle. The 96×120 tile canvas
  // averages many-colour palettes into muddy neutrals, so we cycle
  // only between two visually adjacent emotions to keep the loop
  // alive without producing a chromatic soup.
  //   • Love    — warm rose / coral   (v hi, a mid)
  //   • Elation — luminous gold        (v hi, a hi)
  const FLUID_TILE_CYCLE = [
    { v:  0.75, a:  0.20, o: 0.95, label: "love" },
    { v:  0.90, a:  0.80, o: 0.95, label: "elation" },
  ];
  const FLUID_STOP_MS = 6000;
  function tick() {
    const now = performance.now();
    const t01 = ((now - t0) % LOOP_MS) / LOOP_MS;
    const frame = previewFrame(t01);
    for (const t of tiles) {
      if (!t.inst) continue;
      if (t.Cls.id === "fluid") {
        // Cycle through the emotion journey. Feed the CURRENT stop's
        // label every frame — FluidStyle's setEmotion only triggers a
        // burst when the label CHANGES from the previous call, so the
        // repeat inside a stop is a cheap no-op for burst scheduling.
        const stopIdx = Math.floor(((now - t0) / FLUID_STOP_MS) % FLUID_TILE_CYCLE.length);
        const s = FLUID_TILE_CYCLE[stopIdx];
        // Gentle openness breathing so the surface never feels frozen.
        const oBreathe = 0.08 * Math.sin(t01 * Math.PI * 2);
        t.inst.setEmotion(s.v, s.a, clamp01Local(s.o + oBreathe), s.label);
        continue;
      }
      const anchor = PREVIEW_ANCHOR[t.Cls.id];
      if (anchor) {
        // Fixed anchor + gentle breathing on arousal so the tile still
        // feels alive without drifting into the neighbour's aesthetic.
        const breathe = 0.05 * Math.sin(t01 * Math.PI * 2);
        t.inst.setEmotion(anchor.v, anchor.a + breathe, anchor.o, "");
      } else {
        t.inst.setEmotion(frame.v, frame.a, frame.o, "");
      }
    }
    // Drop synthetic splats into any running "current" (Breath) tile.
    // Breath is a fluid engine; without touches, it needs synthetic
    // splats to feel alive. Every SPLAT_INTERVAL_MS we drop one at a
    // slowly-orbiting position, coloured through the palette so it
    // matches the emotion the tile is currently tinted to.
    if (now - lastSplatAt >= SPLAT_INTERVAL_MS) {
      lastSplatAt = now;
      for (const t of tiles) {
        if (!t.inst || t.Cls.id !== "current") continue;
        // Orbit around the tile centre. Breath is pinned to a warm
        // Joy-adjacent palette so the preview reads as a flame on
        // dark ink, matching the immersive session's look.
        const phase = (now - t0) * 0.001 * 0.9;
        const orbitR = 0.20 + 0.10 * Math.sin(phase * 0.7);
        const cx = 0.5 + orbitR * Math.cos(phase);
        const cy = 0.5 + orbitR * Math.sin(phase * 1.15 + 0.6);
        const dx = -Math.sin(phase) * 180;
        const dy =  Math.cos(phase * 1.15 + 0.6) * 180;
        // Route the splat colour through the real palette so it
        // matches the immersive session exactly. Valence + arousal
        // sit in Joy territory (warm amber) with openness sweeping
        // to give the fluid a subtle chromatic drift.
        const c = emotionToColor(0.55 + 0.15 * frame.v, 0.60 + 0.20 * frame.a, 0.55 + 0.20 * frame.o);
        const col = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
        try {
          // Tight splat radius — 0.010 (of canvas) keeps the dye from
          // filling the whole tile in a few seconds. Combined with
          // the 1.2s cadence and FluidEngine's own dissipation, the
          // tile settles into a continuous flame-like flow instead of
          // saturating to white.
          t.inst.splat?.(cx, cy, dx, dy, col, 0.010);
        } catch { /* engine may not be ready yet */ }
      }
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  // Kick the selected tile explicitly so it renders even if it starts
  // outside the viewport on some layouts.
  const sel = tiles.find((t) => t.Cls.id === selected);
  if (sel) ensureRunning(sel);

  return {
    /** Current selected style id. */
    get selected() { return selected; },
    /** Called by destroy() below. */
    /** Programmatic teardown — call on screen change. */
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      for (const t of tiles) stopTile(t);
      liveOrder.length = 0;
      container.classList.remove("ea-style-carousel");
      container.innerHTML = "";
    },
  };
}
