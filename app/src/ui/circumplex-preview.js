/**
 * Empathic Art — Circumplex Live Preview
 * ────────────────────────────────────────────────────────────────
 * Renders the currently-selected empathic art style INSIDE the
 * emotion wheel on the Before screen. As the user drags the emotion
 * dot or adjusts openness, the preview updates in real time so the
 * user sees their emotional map become a living painting before the
 * session even begins.
 *
 * Cheap on purpose:
 *   - single WebGL context, capped devicePixelRatio = 2
 *   - swaps style instance in place when the user picks a new style
 *   - stops rendering when the Before screen isn't visible
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

import { StyleRegistry } from "../visuals/index.js?v=1.3.7";

let _slot   = null;   // wrapper element that owns the swappable canvas
let _canvas = null;   // the *current* canvas element (replaced on style swap)
let _inst   = null;
let _currentId = null;
let _running = false;
let _lastEmotion = { v: 0, a: 0, o: 0.5 };

/**
 * Build a fresh <canvas> to host the next style. A single canvas can
 * only ever hold one WebGL context in its lifetime — reusing it across
 * different styles poisons GL state and causes shader compiles to fail
 * silently on some drivers. Replacing the canvas element gives every
 * style a clean context.
 */
function _rebuildCanvas() {
  if (!_slot) return null;
  const next = document.createElement("canvas");
  next.id = "circumplex-preview";
  // The field canvas spans the entire chamber (wheel + slider zone),
  // not just the wheel. See .ea-chamber__field in components.css.
  next.className = "ea-chamber__field";
  next.setAttribute("aria-hidden", "true");
  if (_canvas && _canvas.parentNode === _slot) {
    _slot.replaceChild(next, _canvas);
  } else {
    _slot.insertBefore(next, _slot.firstChild);
  }
  _canvas = next;
  _resizeCanvas();
  return next;
}

function _resizeCanvas() {
  if (!_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  _canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
  _canvas.height = Math.max(1, Math.floor(rect.height * dpr));
}

function _instantiate(id) {
  if (!_slot) return;

  // Tear down any previous instance first — swapping GL contexts
  // safely means we don't accumulate dead ones on the tile canvas.
  if (_inst) {
    try { _inst.stop?.(); } catch { /* noop */ }
    try { _inst.destroy?.(); } catch { /* noop */ }
    _inst = null;
  }

  // Fresh canvas → fresh WebGL context for the new style.
  _rebuildCanvas();

  const Cls = StyleRegistry.getOrFallback(id, "current");
  if (!Cls) return;
  _currentId = id;

  // Tag the wheel container so CSS can adapt UI chrome (labels,
  // axes, dot) per active style. Styles like Skyspace paint a dark
  // wall behind the wheel and need light UI on top.
  if (_slot) _slot.setAttribute("data-visual-style", id);

  try {
    _inst = new Cls(_canvas);

    // Preview surface is a dusty charcoal wall for every style,
    // so fluid/particle motion reads clearly and the preview
    // feels like a Turrell chamber. The ship (v1.0.3) full-screen
    // Current experience is unaffected — it constructs its own
    // engine outside this preview slot and keeps its cream floor.
    _inst.setSurface?.(0x1E / 255, 0x21 / 255, 0x25 / 255);
    _inst.setEmotion?.(_lastEmotion.v, _lastEmotion.a, _lastEmotion.o);
    _inst.resize?.();
    _inst.start?.();
    _running = true;
  } catch (err) {
    // If a style fails to construct (e.g. WebGL2 not available),
    // fall back to the safe default and leave the preview visible
    // but static-ish rather than blowing up the whole start screen.
    console.warn("[circumplex-preview] style init failed", id, err);
    _inst = null;
  }
}

/**
 * Wire the preview canvas.
 * @param {Object} opts
 * @param {string} opts.initialStyleId  Style id to render on first mount.
 */
export function initCircumplexPreview({ initialStyleId = "current" } = {}) {
  const seed = document.getElementById("circumplex-preview");
  if (!seed) return;
  _slot = seed.parentNode;
  _canvas = seed;

  const ro = new ResizeObserver(() => {
    _resizeCanvas();
    _inst?.resize?.();
  });
  ro.observe(_slot);

  _instantiate(initialStyleId);
}

/** Swap the running preview to a different style id. */
export function setCircumplexPreviewStyle(id) {
  if (id && id !== _currentId) _instantiate(id);
}

/**
 * Push a new emotion into the running preview. Called by the Before
 * screen every time the user drags the dot or moves the openness
 * slider.
 * @param {number} v  valence   in [-1, 1]
 * @param {number} a  arousal   in [-1, 1]
 * @param {number} o  openness  in [0, 1]
 */
export function updateCircumplexPreview(v, a, o) {
  _lastEmotion = { v, a, o };
  if (_inst?.setEmotion) _inst.setEmotion(v, a, o);
}

/** Stop the preview (e.g. when leaving the Before screen). */
export function pauseCircumplexPreview() {
  if (!_running) return;
  try { _inst?.stop?.(); } catch { /* noop */ }
  _running = false;
}

/** Resume the preview when returning to the Before screen. */
export function resumeCircumplexPreview() {
  if (_running || !_inst) return;
  try { _inst.start?.(); _running = true; } catch { /* noop */ }
}
