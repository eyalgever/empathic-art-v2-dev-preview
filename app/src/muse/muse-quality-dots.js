/**
 * Empathic Art — EEG signal-quality dots
 *
 * Four dots, one per electrode, in the same left-to-right order the rest of
 * the pipeline uses: TP9, AF7, AF8, TP10. Green is good contact, amber is
 * marginal, red is poor, and grey means no headband is connected.
 *
 * This exists because band powers and emotion values look equally confident
 * whether or not the sensors are touching skin. A headband resting off the
 * head still produces a plausible-looking `valence: -0.92` — it is just
 * measuring muscle activity and movement instead of brain activity. Without
 * a contact readout there is no way for anyone to tell those two situations
 * apart, so the dots sit next to the numbers they qualify.
 *
 * Mirrors the equivalent readout in the nouscope project.
 *
 * @author  Bob Dougherty
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { CHANNEL_NAMES } from "./muse-ble.js?v=1.6.4.0";

/**
 * Build the dot row inside `container`.
 *
 * @param {HTMLElement} container
 * @returns {{ update: (quality: string[]|null) => void, destroy: () => void }}
 */
export function mountQualityDots(container) {
  if (!container) throw new Error("mountQualityDots: container is required");

  container.innerHTML = "";
  container.classList.add("ea-eeg-dots");
  container.setAttribute("role", "img");

  const dots = CHANNEL_NAMES.map((name) => {
    const dot = document.createElement("span");
    dot.className = "ea-eeg-dot";
    dot.dataset.electrode = name;
    // Native tooltip: the dots are deliberately small and unlabelled, so the
    // electrode name has to be discoverable somehow.
    dot.title = name;
    container.appendChild(dot);
    return dot;
  });

  /**
   * @param {string[]|null} quality — per channel: "good" | "marginal" | "poor".
   *   Pass null when no headband is connected.
   */
  function update(quality) {
    for (let i = 0; i < dots.length; i++) {
      const q = quality?.[i] ?? "none";
      dots[i].className = `ea-eeg-dot ea-eeg-dot--${q}`;
    }
    const summary = quality
      ? `EEG contact: ${CHANNEL_NAMES.map((n, i) => `${n} ${quality[i]}`).join(", ")}`
      : "EEG contact: no headband connected";
    container.setAttribute("aria-label", summary);
  }

  function destroy() {
    container.innerHTML = "";
    container.classList.remove("ea-eeg-dots");
  }

  update(null);
  return { update, destroy };
}
