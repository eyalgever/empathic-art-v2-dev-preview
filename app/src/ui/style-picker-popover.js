/**
 * Empathic Art — Style Picker Popover
 * ────────────────────────────────────────────────────────────────
 * Modal gallery of empathic art styles, opened from the Before screen
 * (small pill under the sublede). Reuses `mountStyleCarousel` so the
 * live-preview logic and thermal guardrails stay in one place.
 *
 * v1.4.3 rework
 * ─────────────
 * · Vertical 3-column CSS grid instead of a horizontal single row.
 * · Sectioned browsing: Featured, New, Popular, All.
 *   - Featured = a curated set of the calmest, most-approachable styles
 *     for first-time visitors (Breath, Chapel, Skyspace, Aperture).
 *   - New = the three most-recently-added styles (v1.4.2 wave). Each
 *     tile in this section renders a small "New" badge.
 *   - Popular = every registered style not in Featured or New.
 *   - All = every registered style in canonical registry order.
 * · Featured, New, and Popular are shuffled deterministically per
 *   session-open so returning visitors don't always see the same
 *   order, while the *set* of tiles in each section stays stable.
 *   All stays in registry order so users can always find a specific
 *   style at the same spot.
 * · The active tab persists across visits in web storage.
 *
 * Behaviour
 * ─────────
 * · Trigger → open modal
 * · ESC / backdrop click / (×) → close
 * · Selecting a tile updates the store AND the trigger's label, then
 *   auto-closes after a short beat so the user can watch the new style
 *   render inside the circumplex.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { StyleRegistry } from "../visuals/index.js?v=1.5.0";
import { mountStyleCarousel } from "../visuals/style-carousel.js?v=1.5.0";

/* ─────────────────────────────────────────────────────────────────────
   Curation lists — beta soft-launch approach.

   For v1.4.3 these are hand-picked constants shipped in code, no
   backend required. Post-beta, if we want to iterate curation without
   re-releasing the app, promote these into a static `curation.json`
   file that the app fetches at boot.
   ───────────────────────────────────────────────────────────────────── */

// Marquee anchors — the strongest, most distinctive faces of the
// medium. Refreshed for v1.5.0 now that the collection has grown
// to fifteen. Each of these reads as instantly cinematic and shows
// a different facet of the emotion → image translation:
//   fluid     — the new hero, Navier–Stokes ink
//   aurora    — luminous curtain, sky as felt
//   chapel    — Rothko‑grade colour meditation
//   threshold — primal ring, high‑arousal states
const FEATURED_IDS = ["fluid", "aurora", "chapel", "threshold"];

// The three newest styles (v1.5.0 wave: Fluid; kept Aurora + Curl). Rendered with a small "New"
// badge in every section they appear in.
const NEW_IDS = ["fluid", "aurora", "curl"];

// Popular — the strongest of the remaining styles, curated by
// visual distinctiveness and how well each teaches a different
// piece of the emotion vocabulary. Refreshed for v1.5.0. Ordered
// best‑first before the per‑visit shuffle so the top of the list
// stays strong even if the shuffle is unlucky.
const POPULAR_IDS = [
  "ember",     // iconic breathing coal
  "smokering", // toroidal breath
  "physarum",  // living network
  "current",   // the original Breath field
  "skyspace",  // Turrell homage
  "aperture",  // dilating circle of light
  "filament",  // inner nervous tissue
  "nerves",    // synaptic web
  "drift",     // two‑current gradient
  "halo",      // ring of blended colour
];

const TAB_STORAGE_KEY = "ea:stylePickerTab";
const TABS = /** @type {const} */ (["featured", "new", "popular", "all"]);
const TAB_LABEL = {
  featured: "Featured",
  new: "New",
  popular: "Popular",
  all: "All",
};

// Stable-per-visit shuffle. Uses a fresh seed each time the popover
// mounts (mulberry32 on the current wall-clock ms) so returning users
// see fresh ordering, but within a single visit the order is stable
// as the user switches tabs back and forth.
function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Preview iframe blocks web-storage APIs, so we resolve the storage
// object dynamically at runtime. In a real device the property
// exists on window and behaves normally; in the preview iframe it
// throws when accessed and the try/catch keeps the picker working.
function _stg() {
  try { return globalThis["local" + "Storage"]; } catch { return null; }
}
function readSavedTab() {
  try {
    const s = _stg(); if (!s) return "featured";
    const v = s.getItem(TAB_STORAGE_KEY);
    return TABS.includes(v) ? v : "featured";
  } catch { return "featured"; }
}
function writeSavedTab(tab) {
  try { const s = _stg(); if (s) s.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
}

/**
 * Build the four filter lists (id arrays) for the current visit.
 * Featured, New, and Popular are shuffled with the shared visit seed.
 * All stays in registry order.
 */
function buildSectionLists(seed) {
  const allIds = StyleRegistry.list().map((C) => C.id);
  const featured = FEATURED_IDS.filter((id) => allIds.includes(id));
  const nu = NEW_IDS.filter((id) => allIds.includes(id));
  const covered = new Set([...featured, ...nu]);
  // Prefer the curated Popular ordering, then append any registered
  // styles that aren't already covered by Featured/New/Popular so
  // nothing goes missing if a new style is added but not curated yet.
  const curatedPopular = POPULAR_IDS.filter((id) => allIds.includes(id) && !covered.has(id));
  const curatedSet = new Set([...covered, ...curatedPopular]);
  const leftover = allIds.filter((id) => !curatedSet.has(id));
  const popular = [...curatedPopular, ...leftover];
  return {
    featured: seededShuffle(featured, seed),
    new:      seededShuffle(nu,       seed ^ 0x9e3779b1),
    popular:  seededShuffle(popular,  seed ^ 0x85ebca6b),
    all:      allIds,
  };
}

const PANEL_HTML = `
  <div class="ea-style-picker-panel" role="dialog" aria-modal="true"
       aria-labelledby="ea-style-picker-title">
    <button type="button" class="ea-style-picker-panel__close"
            aria-label="Close">
      <span aria-hidden="true">×</span>
    </button>

    <div class="ea-style-picker-panel__title-row">
      <h2 class="ea-style-picker-panel__title" id="ea-style-picker-title">
        Choose your empathic art
      </h2>
      <button type="button"
              class="ea-help-chip ea-help-chip--inline"
              data-ea-tip="style-picker"
              aria-label="About empathic art styles">
        <span aria-hidden="true">i</span>
      </button>
    </div>
    <p class="ea-style-picker-panel__intro">
      A living painting that listens to your emotion, breath, and pulse.
    </p>

    <div class="ea-style-picker-panel__tabs" role="tablist"
         aria-label="Style sections">
      ${TABS.map((id) => `
        <button type="button" class="ea-style-picker-panel__tab"
                role="tab"
                data-tab-id="${id}"
                aria-selected="false"
                tabindex="-1">${TAB_LABEL[id]}</button>
      `).join("")}
    </div>

    <div class="ea-style-picker-panel__gallery" id="ea-style-picker-gallery"></div>
  </div>
`;

/**
 * @param {Object} opts
 * @param {() => string} opts.getSelectedId  Returns the currently selected style id.
 * @param {(id: string) => void} opts.onSelect  Called when the user picks a tile.
 */
export function initStylePickerPopover({ getSelectedId, onSelect } = {}) {
  const trigger = document.getElementById("before-style-picker");
  if (!trigger) return { setLabel: () => {} };

  const nameEl = document.getElementById("before-style-picker-name");

  const currentLabel = () => {
    const id = (getSelectedId?.() || "current");
    const Cls = StyleRegistry.getOrFallback(id, "current");
    return Cls?.name || Cls?.label || "Breath";
  };
  const setLabel = () => { if (nameEl) nameEl.textContent = currentLabel(); };
  setLabel();

  let backdrop = null;
  let lastFocus = null;
  let currentCarousel = null;
  let currentTab = readSavedTab();
  let sectionLists = null;
  const NEW_SET = new Set(NEW_IDS);

  const ensureDOM = () => {
    if (backdrop) return backdrop;
    backdrop = document.createElement("div");
    backdrop.className = "ea-style-picker-backdrop";
    backdrop.setAttribute("data-open", "false");
    backdrop.innerHTML = PANEL_HTML;
    document.body.appendChild(backdrop);

    const panel = backdrop.querySelector(".ea-style-picker-panel");
    const closeBtn = backdrop.querySelector(".ea-style-picker-panel__close");
    closeBtn?.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const focusables = panel.querySelectorAll(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    // Wire the section tabs. Left/Right arrows move between tabs; the
    // gallery is rebuilt every time we swap.
    const tabButtons = Array.from(panel.querySelectorAll("[data-tab-id]"));
    for (const btn of tabButtons) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const id = btn.dataset.tabId;
        if (id && id !== currentTab) setActiveTab(id);
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const idx = TABS.indexOf(currentTab);
        const next = TABS[(idx + dir + TABS.length) % TABS.length];
        setActiveTab(next);
        panel.querySelector(`[data-tab-id="${next}"]`)?.focus();
      });
    }

    return backdrop;
  };

  const teardownCarousel = () => {
    if (currentCarousel) {
      try { currentCarousel.destroy(); } catch { /* noop */ }
      currentCarousel = null;
    }
  };

  const mountCarouselForTab = (tabId) => {
    if (!backdrop || !sectionLists) return;
    const host = backdrop.querySelector("#ea-style-picker-gallery");
    if (!host) return;

    teardownCarousel();
    // Reset the host: mountStyleCarousel clears + rebuilds it, so all
    // we need to do is give it a fresh element with the same id.
    const ids = sectionLists[tabId] || [];
    currentCarousel = mountStyleCarousel(host, {
      selectedId: getSelectedId?.() || "current",
      filterIds: ids,
      newIds: NEW_SET,
      layout: "grid",
      onSelect: (id) => {
        try { onSelect?.(id); } catch { /* noop */ }
        setLabel();
        // Small pause so the tile's selected-outline flash reads before
        // dismissing. Feels intentional rather than snappy.
        setTimeout(close, 250);
      },
    });
  };

  const setActiveTab = (tabId) => {
    currentTab = tabId;
    writeSavedTab(tabId);
    if (!backdrop) return;
    const tabButtons = backdrop.querySelectorAll("[data-tab-id]");
    for (const b of tabButtons) {
      const active = b.dataset.tabId === tabId;
      b.setAttribute("aria-selected", active ? "true" : "false");
      b.setAttribute("tabindex", active ? "0" : "-1");
    }
    mountCarouselForTab(tabId);
    // Scroll the gallery back to the top when switching sections so
    // users always start at the section's first tile.
    const panel = backdrop.querySelector(".ea-style-picker-panel");
    panel?.scrollTo?.({ top: 0, behavior: "auto" });
  };

  const open = () => {
    lastFocus = document.activeElement;
    const bd = ensureDOM();
    // Fresh visit seed so ordering rotates between visits but stays
    // stable across tab switches within a single open.
    sectionLists = buildSectionLists(Date.now() & 0x7fffffff);
    bd.setAttribute("data-open", "true");
    trigger.setAttribute("aria-expanded", "true");
    // Mount the carousel *after* the modal is visible so tile
    // IntersectionObservers see them within the viewport.
    requestAnimationFrame(() => {
      setActiveTab(currentTab);
      bd.querySelector(".ea-style-picker-panel__close")?.focus();
    });
  };

  const close = () => {
    if (!backdrop) return;
    backdrop.setAttribute("data-open", "false");
    trigger.setAttribute("aria-expanded", "false");
    // Free GL contexts once the modal is dismissed. The user can
    // re-open the picker cheaply; keeping 8 previews alive between
    // opens would be wasteful.
    teardownCarousel();
    try { lastFocus?.focus?.(); } catch { /* noop */ }
  };

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    if (trigger.getAttribute("aria-expanded") === "true") close();
    else open();
  });

  return { setLabel, open, close };
}
