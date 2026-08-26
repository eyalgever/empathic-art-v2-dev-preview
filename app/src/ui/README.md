# src/ui

Chrome, overlays, and ambient behaviors that sit on top of the fluid canvas: tooltips, Entropy Mode (fullscreen + dim-on-stillness), Zen Mode, the legal notice, first-run help, and the touch-to-open gate.

## Files

| File               | Exports                                                                  | Purpose                                              |
|--------------------|---------------------------------------------------------------------------|-------------------------------------------------------|
| `tooltips.js`      | `STATIC_TIPS`, `BRAIN_BANDS`, `EMOTION_TIPS`, `showTipAt`, `showTipAtPoint`, `hideTip`, `installTooltips`, `showEmotionTip` | Hover/tap tooltip system for UI chrome and the emotion circumplex |
| `immersive.js`     | `mountImmersive`, `unmountImmersive`                                     | Entropy Mode: fullscreen toggle + dim-on-stillness ambient chrome fade |
| `zen.js`           | `mountZen`, `unmountZen`, `isZenActive`                                  | Zen Mode, user-triggered full-chrome-hide viewing mode (Session Replay) |
| `legal-notice.js`  | `initLegalNotice`                                                        | Corner mark + modal with the Boundless partnership legal text |
| `before-help.js`   | `initBeforeHelp`, `armCircumplexHint`                                    | First-run help affordances on the "before" screen     |
| `touch-to-open.js` | `mountTouchToOpen`                                                       | Full-screen tap gate that satisfies mobile autoplay policy |
| `v163-layer.js`    | (module init, no exports)                                                 | The v1.6.3 additive overlay layer. Coordinates Entropy Mode chrome, Session Replay panel, Zen Mode transitions, and the adaptive-ink system that samples the fluid canvas and keeps titles, meta, narrative, timeline label, NEW SESSION label, whisper sentence, and the legal mark readable over any emotion. See [Adaptive ink over the fluid canvas](../palette/README.md#adaptive-ink-over-the-fluid-canvas) for the full mechanism. |

## tooltips.js

A single tooltip system shared by static UI labels, brainwave band names, and emotion-circumplex nodes.

**Data exports:**

- `STATIC_TIPS`, a lookup of tip text for fixed UI elements (buttons, toggles) keyed by element id or role.
- `BRAIN_BANDS`, ordered list of EEG band descriptors (name, frequency range, plain-language meaning) used to label brainwave readouts.
- `EMOTION_TIPS`, per-emotion tooltip copy, keyed by emotion name, shown when a circumplex node is hovered or tapped.

**Functions:**

```js
showTipAt(anchorEl, payload)
showTipAtPoint(x, y, payload)
hideTip()
installTooltips()
showEmotionTip(name, hex, x, y)
```

- `showTipAt(anchorEl, payload)`, positions and shows the tooltip relative to a DOM element, typically on hover/focus of a button or icon.
- `showTipAtPoint(x, y, payload)`, positions and shows the tooltip at raw viewport coordinates, used where there is no single anchor element (e.g. a canvas-drawn node).
- `hideTip()`, hides the tooltip immediately. Safe to call when no tooltip is showing.
- `installTooltips()`, wires hover/focus/tap listeners for every element that carries a tooltip data attribute and binds the `STATIC_TIPS`/`BRAIN_BANDS` copy. Called once at boot.
- `showEmotionTip(name, hex, x, y)`, convenience wrapper used by the circumplex visualizer to show an `EMOTION_TIPS` entry at a point, colored with the emotion's `hex`.

**Depends on:** `dbg` from [`src/debug/debug-overlay.js`](../debug/README.md) for diagnostic logging.

**Consumed by:**

- [`src/muse/muse-vis.js`](../muse/README.md) imports `showEmotionTip` and `hideTip` to drive circumplex node tooltips as the live trail is drawn.
- [`src/app.js`](../../ARCHITECTURE.md) calls `installTooltips()` once at boot.

## immersive.js (Entropy Mode)

Powers Entropy Mode: two independent behaviors, both scoped to the live session screen. A fullscreen toggle and an ambient dim-on-stillness fade. Both are implemented in this one file because they share button wiring and screen lifecycle.

**Fullscreen behavior:**

- On desktop Chrome and Safari, the Entropy Mode button calls the native Fullscreen API (`element.requestFullscreen()` / `document.exitFullscreen()`), so the browser itself hides its own chrome.
- On iOS Safari, the native API is not exposed for non-video elements, so the fallback sets `body[data-immersive="true"]`. CSS pins `.ea-app` to `inset: 0` and `height: 100dvh` under that attribute, visually approximating fullscreen without the real API.
- Multiple buttons can exist at once. The module tracks them in an internal `_btns` array so the live session screen and Session Replay screen buttons both stay in sync with the current fullscreen state via display-change events.
- When the Emotion Map card closes in Session Replay, the module remembers whether Entropy Mode was active before the card opened (`_wasImmersiveBeforeMapOpen`) and re-requests the native display mode, because iOS Safari silently drops fullscreen when a modal panel opens or the page scrolls.

**Dim-on-stillness behavior:**

- `DIM_DELAY_MS = 5000`. After five seconds with no pointer activity, `body[data-dim="true"]` is set, fading the UI chrome to roughly 15 percent opacity and showing a "Touch to interact" hint.
- Only `pointerdown`, `touchstart`, `mousedown`, `keydown`, and `click` reset the idle timer. Audio updates, Muse sample updates, and scroll events deliberately do not count as activity. The intent is to dim only when the user has stopped physically interacting, not when data is merely flowing.
- Waking is snappy: the chrome restores in 200ms, then the five-second idle timer restarts.
- Dimming is suspended entirely while the Emotion Map card is open in Session Replay, or while Zen Mode is active, so it never fights with either of those states.

**Public API:**

```js
mountImmersive()
unmountImmersive()
```

`mountImmersive()` wires the Entropy Mode button(s) and starts the idle timer for the current screen. `unmountImmersive()` tears down listeners and clears the idle timer when leaving the screen.

**Depends on:** none (self-contained, no internal imports).

**Consumed by:** [`src/app.js`](../../ARCHITECTURE.md) mounts and unmounts `immersive.js` per screen as the state machine transitions.

## zen.js (Zen Mode)

Zen Mode is a full-chrome-hide viewing mode that lives inside Session Replay. The header comment in the source is explicit: Zen is entered by the user, never automatically. In Session Replay, closing the Emotion Map card drops the screen into Zen Mode by default; tapping anywhere brings the title cluster back.

**Public API:**

```js
mountZen()
unmountZen()
isZenActive()
```

`mountZen()` wires the enter/exit affordances for the current screen. `unmountZen()` removes them. `isZenActive()` returns the current boolean state and is safe to call at any time, including from other modules.

**Entering Zen Mode:**

- In Session Replay, closing the Emotion Map card drops the screen into Zen Mode automatically.
- The source also looks for a chip button with id `#btn-zen` to toggle Zen on click, but this element is not present in the shipped `index.html`. In the current build the button-based entry point is inert.
- The keyboard shortcut is available: pressing `Z` (case-insensitive, ignores key-repeat) toggles Zen Mode on.

**Exiting Zen Mode:**

- Tapping anywhere in Session Replay's Zen Mode brings the title cluster back (TIMELINE, EMOTION MAP, NEW SESSION).
- `Escape` or `Z` exits immediately from the keyboard.
- Hovering or touching a hotspot in the top-right corner, `HOTSPOT_SIZE_PX = 80` (an 80×80px region), for `HOTSPOT_DWELL_MS = 2000` (two seconds) reveals an "Exit Zen" pill, visible for `EXIT_PILL_VISIBLE_MS = 3000` (three seconds), which can then be tapped to exit.

**Effects while active:**

- `body[data-zen="true"]` is set, which CSS uses to hide all UI chrome down to the fluid canvas.
- The dim-on-stillness behavior in `immersive.js` (Entropy Mode) is suspended while Zen Mode is active, so the two ambient states never overlap.

**Depends on:** none (self-contained, no internal imports).

**Consumed by:** [`src/app.js`](../../ARCHITECTURE.md) mounts and unmounts `zen.js` per screen. Session Replay drives Zen Mode automatically after the Emotion Map card closes. Integrators who want a visible Zen entry point outside Session Replay (for example, on the iPhone app or Apple Watch companion) should add one that calls the internal toggle logic, or (on desktop) rely on the `Z` key with a physical keyboard.

## legal-notice.js

Renders a small corner mark on every screen except "before", plus a modal that shows the full legal text when the mark is tapped.

**Public API:**

```js
initLegalNotice()
```

`initLegalNotice()` inserts the corner mark, wires its click handler to open the modal, and wires the modal's close affordances. Called once at boot.

The modal content is Boundless-partnership-specific legal language covering intellectual property protection, revocation rights, attribution requirements, confidentiality, and governing law under Israeli courts, with contact details for eyalgever@gmail.com. The exact text lives in the `LEGAL_HTML` constant inside the source file and is intentionally not reproduced here, integrators who need to adapt it for a different partner or jurisdiction should edit that constant directly and have it reviewed by counsel before any public release.

**Depends on:** none (self-contained, no internal imports).

**Consumed by:** [`src/app.js`](../../ARCHITECTURE.md) calls `initLegalNotice()` once at boot.

## before-help.js

First-run help affordances shown on the "before" screen, before a session starts.

**Public API:**

```js
initBeforeHelp()
armCircumplexHint()
```

- `initBeforeHelp()` wires the help affordances for the before screen (e.g. an intro tip explaining how the session works). Called once at boot.
- `armCircumplexHint()` arms a one-time hint that points at the emotion circumplex the first time it becomes visible, so a first-time user understands what the colored dots represent before starting a session.

**Depends on:** none (self-contained, no internal imports).

**Consumed by:** [`src/app.js`](../../ARCHITECTURE.md) calls both `initBeforeHelp()` and `armCircumplexHint()` once at boot.

## touch-to-open.js

A full-screen tap gate shown before anything else runs. Its purpose is to satisfy mobile browser autoplay policy, audio cannot start until a real user gesture has occurred, so this gate collects that gesture before the rest of the app initializes audio.

**Public API:**

```js
mountTouchToOpen()
```

`mountTouchToOpen()` renders the gate and waits for a tap. Guards against firing while Zen Mode is active, and ignores taps that land on an interactive control (matched via an internal `INTERACTIVE_SELECTOR`) so the gate does not swallow clicks meant for a real button underneath it.

The module also auto-mounts itself on `DOMContentLoaded` when loaded as a module script, so it does not need to be called manually in most setups.

**Depends on:** none (self-contained, no internal imports).

**Consumed by:** nothing inside `src/` imports this module directly, instead, [`index.html`](../../INTEGRATION.md) loads it as its own `<script type="module">` tag, alongside `app.js`:

```html
<script type="module" src="./src/ui/touch-to-open.js?v=1.0.0"></script>
<script type="module" src="./src/app.js?v=1.0.0"></script>
```

This is one of only two module scripts `index.html` loads directly; every other module in the app is pulled in transitively through `app.js` imports.
