/**
 * Empathic App — Microphone Permission Help Sheet
 *
 * Shown when getUserMedia() throws NotAllowedError / SecurityError.
 *
 * Rationale:
 *   iOS gates microphone access at TWO layers, and each layer is
 *   per-browser:
 *
 *     Layer 1 — App-level (Settings → Privacy → Microphone)
 *       Safari has this by default. Chrome and other apps must be
 *       granted individually.
 *
 *     Layer 2 — Per-site prompt (inside each browser)
 *       Once tapped "Don't Allow", Safari/Chrome remember it and
 *       never re-prompt until you clear website data or explicitly
 *       flip a per-site toggle.
 *
 *   We can't grant these from JavaScript — Apple designed it that
 *   way for privacy. What we CAN do is give the user precise,
 *   browser-aware instructions and a one-tap deep-link to Settings.
 *
 * Public API:
 *   showMicHelp({ onRetry })   // opens the sheet
 *   hideMicHelp()              // programmatic close
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * Best-effort browser + host detection. Returns one of:
 *   "safari-ios"        — real iOS Safari (WebKit)
 *   "chrome-ios"        — Chrome for iOS (CriOS, WebKit under the hood)
 *   "firefox-ios"       — Firefox for iOS (FxiOS, WebKit under the hood)
 *   "edge-ios"          — Edge for iOS
 *   "in-app-browser-ios" — a WKWebView-based in-app browser on iOS
 *   "android-chrome"    — Chrome / Chromium on Android
 *   "android-firefox"   — Firefox on Android
 *   "desktop"           — non-iOS, non-Android desktop browser
 *   "unknown"
 */
export function detectBrowserContext() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad on iOS 13+
  const isAndroid = /android/.test(ua);

  if (isIOS) {
    if (/crios\//.test(ua)) return "chrome-ios";
    if (/fxios\//.test(ua)) return "firefox-ios";
    if (/edgios\//.test(ua)) return "edge-ios";
    // Real Safari on iOS has "Safari/" AND "Version/" AND does NOT
    // have any of the above browser identifiers. A WKWebView from a
    // non-Safari app is missing "Version/" or "Safari/".
    const hasSafariUA = /safari\//.test(ua);
    const hasVersion = /version\//.test(ua);
    if (hasSafariUA && hasVersion) return "safari-ios";
    return "in-app-browser-ios";
  }

  if (isAndroid) {
    if (/firefox\//.test(ua)) return "android-firefox";
    return "android-chrome";
  }
  return "desktop";
}

/**
 * Human-readable steps per browser/host. Ordered from fastest to slowest.
 * Each step is a short imperative — we render them as a numbered list.
 */
function stepsFor(ctx) {
  switch (ctx) {
    case "safari-ios":
      return {
        title: "Enable microphone in Safari",
        subtitle: "iOS blocked the mic for this site. Fix it in one of these ways:",
        primary: {
          label: "Open Site Settings",
          hint: "Tap the aA icon on the left of the address bar, then Website Settings → Microphone → Allow.",
        },
        steps: [
          "Reload the page. Safari will prompt again for microphone access.",
          "If no prompt appears, tap the aA icon in the address bar → Website Settings → Microphone → Allow.",
          "Or: iOS Settings → Apps → Safari → Advanced → Website Data → find this site → Delete → reload here.",
        ],
        deepLink: null, // Safari has no app-settings deep link for per-site mic
      };

    case "chrome-ios":
      return {
        title: "Enable microphone in Chrome",
        subtitle: "Chrome remembered a 'Don't Allow' choice for this site. Clear it in this exact order:",
        primary: {
          label: "Open iOS Settings",
          hint: "iOS Settings → Chrome → turn ON Microphone AND Speech Recognition.",
        },
        steps: [
          "iOS Settings → Chrome → turn ON both Microphone AND Speech Recognition (both must be green).",
          "Back in Chrome, tap the ••• menu (bottom-right) → History → Clear Browsing Data → tick 'Cookies, Site Data' → Clear Browsing Data.",
          "Force-close Chrome (swipe up on Chrome from the app switcher), then reopen it and load this page again.",
          "When Chrome finally prompts 'Allow Empathic Art to access the microphone?', tap Allow.",
        ],
        deepLink: "app-settings:",
        note: "Chrome iOS has no per-site mic toggle. Once you tap 'Don't Allow' it's stuck until site data is cleared. If the steps above don't work, open this page in Safari instead, it's the most reliable browser for microphone access on iPhone.",
      };

    case "firefox-ios":
    case "edge-ios":
      return {
        title: `Enable microphone in ${ctx === "firefox-ios" ? "Firefox" : "Edge"}`,
        subtitle: "iOS blocked the mic for this browser or site.",
        primary: {
          label: "Open iOS Settings",
          hint: `iOS Settings → ${ctx === "firefox-ios" ? "Firefox" : "Edge"} → Microphone → On.`,
        },
        steps: [
          `iOS Settings → ${ctx === "firefox-ios" ? "Firefox" : "Edge"} → Microphone → turn ON.`,
          "Reload the page, the browser will prompt again.",
          "If it still fails, best results come from opening this page in Safari.",
        ],
        deepLink: "app-settings:",
      };

    case "in-app-browser-ios":
      return {
        title: "Microphone blocked",
        subtitle: "You're viewing this inside another app's built-in browser, which is blocking the mic.",
        primary: {
          label: "Open in Safari",
          hint: "Tap the share icon in this in-app browser and choose Open in Safari.",
        },
        steps: [
          "Tap the share icon in the app's built-in browser → Open in Safari.",
          "In Safari, tap Allow when it asks for microphone access.",
          "For the smoothest voice-note experience, always open this site in Safari.",
        ],
        deepLink: null,
        note: "In-app browsers have stricter microphone rules than Safari. If you keep hitting this, open the site in Safari.",
      };

    case "android-chrome":
      return {
        title: "Enable microphone in Chrome",
        subtitle: "Chrome blocked the mic for this site.",
        primary: {
          label: "Open Site Settings",
          hint: "Chrome ••• menu → Settings → Site settings → Microphone.",
        },
        steps: [
          "Tap the lock icon left of the address bar → Permissions → Microphone → Allow.",
          "Or: Chrome ••• menu → Settings → Site settings → Microphone → find this site → Allow.",
          "Then reload the page.",
        ],
        deepLink: null,
      };

    case "android-firefox":
      return {
        title: "Enable microphone in Firefox",
        subtitle: "Firefox blocked the mic for this site.",
        primary: {
          label: "Open Site Settings",
          hint: "Firefox ••• menu → Settings → Site permissions → Microphone.",
        },
        steps: [
          "Tap the lock icon left of the address bar → Site permissions → Microphone → Allow.",
          "Or: ••• menu → Settings → Site permissions → Microphone.",
          "Reload the page.",
        ],
        deepLink: null,
      };

    default:
      return {
        title: "Enable microphone access",
        subtitle: "This browser is blocking the mic for this site.",
        primary: {
          label: "Open browser settings",
          hint: "Look for a mic icon in the address bar, or check site permissions.",
        },
        steps: [
          "Look for a microphone icon in the address bar and set it to Allow.",
          "Or open your browser's site settings and grant microphone access to this page.",
          "Reload the page and try again.",
        ],
        deepLink: null,
      };
  }
}

let overlayEl = null;

/**
 * @param {Object} [opts]
 * @param {() => Promise<void>|void} [opts.onRetry] — invoked when user
 *   taps "Try Again". Should call VoiceRecorder.start() again.
 */
export function showMicHelp(opts = {}) {
  hideMicHelp();
  const ctx = detectBrowserContext();
  const info = stepsFor(ctx);

  const root = document.createElement("div");
  root.className = "mic-help-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "mic-help-title");
  root.innerHTML = `
    <div class="mic-help-backdrop" data-close="1"></div>
    <div class="mic-help-sheet" role="document">
      <button class="mic-help-close" type="button" aria-label="Close" data-close="1">×</button>

      <div class="mic-help-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="3" width="6" height="12" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <path d="M12 18v3"/>
          <path d="M8 21h8"/>
          <line x1="4" y1="4" x2="20" y2="20" stroke-width="1.6"/>
        </svg>
      </div>

      <h2 id="mic-help-title" class="mic-help-title"></h2>
      <p class="mic-help-subtitle"></p>

      <ol class="mic-help-steps"></ol>

      <p class="mic-help-note" hidden></p>

      <div class="mic-help-actions">
        <button class="mic-help-primary" type="button"></button>
        <button class="mic-help-retry" type="button">Try Again</button>
      </div>

      <p class="mic-help-context">Detected: <span></span></p>
    </div>
  `;

  root.querySelector(".mic-help-title").textContent = info.title;
  root.querySelector(".mic-help-subtitle").textContent = info.subtitle;

  const ol = root.querySelector(".mic-help-steps");
  info.steps.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    ol.appendChild(li);
  });

  if (info.note) {
    const n = root.querySelector(".mic-help-note");
    n.textContent = info.note;
    n.hidden = false;
  }

  const primaryBtn = root.querySelector(".mic-help-primary");
  primaryBtn.textContent = info.primary.label;
  primaryBtn.title = info.primary.hint;

  const ctxLabel = {
    "safari-ios": "iOS Safari",
    "chrome-ios": "Chrome on iOS",
    "firefox-ios": "Firefox on iOS",
    "edge-ios": "Edge on iOS",
    "in-app-browser-ios": "In-app browser (iOS)",
    "android-chrome": "Chrome on Android",
    "android-firefox": "Firefox on Android",
    "desktop": "Desktop browser",
    "unknown": "Unknown browser",
  }[ctx] || ctx;
  root.querySelector(".mic-help-context span").textContent = ctxLabel;

  // Primary button behavior:
  //   If a deep-link exists, try it (only works from a user gesture in
  //   supporting browsers). Also always show the hint as a tooltip AND
  //   inline right below, so if the deep-link is a no-op the user still
  //   knows what to do.
  primaryBtn.addEventListener("click", () => {
    if (info.deepLink) {
      // app-settings: opens the current app's settings page in iOS.
      // In real Safari it opens Safari's settings. In Chrome iOS it
      // opens Chrome's settings. In in-app WebViews it usually falls
      // back to iOS Settings root. Any of these are a huge help.
      try {
        window.location.href = info.deepLink;
      } catch { /* ignore */ }
    } else {
      // No deep link — inline-alert the exact steps so the user is
      // never stuck on a button that does nothing.
      try { alert(info.primary.hint); } catch { /* ignore */ }
    }
  });

  const retryBtn = root.querySelector(".mic-help-retry");
  retryBtn.addEventListener("click", async () => {
    // Give the caller a chance to re-request the mic. If it works,
    // they'll call hideMicHelp() themselves; if it fails, we'll
    // stay open.
    hideMicHelp();
    try { await opts.onRetry?.(); } catch { /* onRetry handles its own errors */ }
  });

  // Backdrop / close button
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "1") {
      hideMicHelp();
    }
  });

  document.body.appendChild(root);
  overlayEl = root;

  // Focus the retry button for keyboard users
  setTimeout(() => { try { retryBtn.focus(); } catch {} }, 20);
}

export function hideMicHelp() {
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
}

/**
 * Quick, non-throwing check for a persisted mic permission. Returns:
 *   "granted" | "denied" | "prompt" | "unknown"
 *
 * Uses the Permissions API where available (Chrome, some iOS Safari
 * builds behind a flag). Falls back to "unknown" — callers should
 * treat that as "we don't know yet, just try getUserMedia and handle
 * the error".
 */
export async function queryMicPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    const p = await navigator.permissions.query({ name: "microphone" });
    return p.state || "unknown";
  } catch {
    return "unknown";
  }
}
