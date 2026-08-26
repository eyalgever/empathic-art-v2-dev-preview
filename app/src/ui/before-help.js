/**
 * Before Session help overlay
 * ────────────────────────────────────────────────────────────────
 * A single elegant explainer panel opened by the subtle (i) chip
 * anchored to the "How are you feeling right now?" title. Covers
 * both the circumplex quadrants AND the Openness slider in one
 * place so first-time users understand what the map is asking for
 * without breaking the pristine landing.
 *
 * Behaviour
 * ─────────
 * · Chip → open modal
 * · ESC / backdrop click / (×) → close
 * · Focus is trapped inside while open; returns to chip on close
 * · Fully accessible: role="dialog", aria-modal, focusable close
 * · Never rendered on Watch until the chip is pressed — no extra
 *   chrome on the tiny face
 * ────────────────────────────────────────────────────────────────
 */

const PANEL_HTML = `
  <div class="ea-help-panel" role="dialog" aria-modal="true"
       aria-labelledby="ea-help-panel-title">
    <button type="button" class="ea-help-panel__close"
            aria-label="Close">
      <span aria-hidden="true">×</span>
    </button>

    <h2 class="ea-help-panel__title" id="ea-help-panel-title">
      How to use this map
    </h2>
    <p class="ea-help-panel__intro">
      Two simple readings. Place the dot on the wheel to describe how
      you feel right now, then choose how open you are to the
      experience.
    </p>

    <section class="ea-help-panel__section">
      <p class="ea-help-panel__label">The emotion wheel</p>
      <div class="ea-help-panel__row">
        <div class="ea-help-panel__item">
          <b>Energized</b>   <span>alert, awake, activated</span>
        </div>
        <div class="ea-help-panel__item">
          <b>Tired</b>   <span>calm, quiet, low arousal</span>
        </div>
        <div class="ea-help-panel__item">
          <b>Negative</b>   <span>unpleasant, difficult, tense</span>
        </div>
        <div class="ea-help-panel__item">
          <b>Positive</b>   <span>pleasant, warm, at ease</span>
        </div>
      </div>
      <p class="ea-help-panel__note">
        Drag the dot anywhere on the wheel. No answer is wrong.
      </p>
    </section>

    <section class="ea-help-panel__section">
      <p class="ea-help-panel__label">Openness</p>
      <div class="ea-help-panel__row">
        <div class="ea-help-panel__item">
          <b>Closed</b>  
          <span>guarded, holding back, keeping to yourself</span>
        </div>
        <div class="ea-help-panel__item">
          <b>Open</b>  
          <span>receptive, curious, willing to feel what arrives</span>
        </div>
      </div>
      <p class="ea-help-panel__note">
        The slider tunes how the painting listens back to you.
      </p>
    </section>
  </div>
`;

export function initBeforeHelp() {
  const chip = document.getElementById("before-help-chip");
  if (!chip) return;

  // Build backdrop lazily to keep initial DOM small.
  let backdrop = null;
  let lastFocus = null;

  const ensureDOM = () => {
    if (backdrop) return backdrop;
    backdrop = document.createElement("div");
    backdrop.className = "ea-help-panel-backdrop";
    backdrop.setAttribute("data-open", "false");
    backdrop.innerHTML = PANEL_HTML;
    document.body.appendChild(backdrop);

    // Wire close paths
    const panel = backdrop.querySelector(".ea-help-panel");
    const closeBtn = backdrop.querySelector(".ea-help-panel__close");
    closeBtn?.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    // Basic focus trap: cycle Tab within panel.
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
    return backdrop;
  };

  const open = () => {
    lastFocus = document.activeElement;
    const bd = ensureDOM();
    bd.setAttribute("data-open", "true");
    chip.setAttribute("aria-expanded", "true");
    // Focus the close button so ESC & Enter are wired immediately.
    requestAnimationFrame(() => {
      bd.querySelector(".ea-help-panel__close")?.focus();
    });
  };

  const close = () => {
    if (!backdrop) return;
    backdrop.setAttribute("data-open", "false");
    chip.setAttribute("aria-expanded", "false");
    try { lastFocus?.focus?.(); } catch { /* noop */ }
  };

  chip.addEventListener("click", (e) => {
    e.preventDefault();
    if (chip.getAttribute("aria-expanded") === "true") close();
    else open();
  });

  // Expose for keyboard shortcuts if ever wanted.
  window.__eaBeforeHelp = { open, close };
}

/**
 * Fade out the circumplex first-time hint on the very first touch/drag.
 * We use a one-shot listener so the DOM stays clean afterwards.
 */
export function armCircumplexHint() {
  const wheel = document.getElementById("circumplex");
  const hint  = document.getElementById("circumplex-hint");
  if (!wheel || !hint) return;
  const dismiss = () => {
    wheel.classList.add("ea-circumplex--touched");
    wheel.removeEventListener("pointerdown", dismiss);
    wheel.removeEventListener("touchstart", dismiss);
    wheel.removeEventListener("keydown", dismiss);
  };
  wheel.addEventListener("pointerdown", dismiss, { once: true });
  wheel.addEventListener("touchstart", dismiss, { once: true, passive: true });
  wheel.addEventListener("keydown", dismiss, { once: true });
}
