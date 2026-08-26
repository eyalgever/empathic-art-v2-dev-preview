/**
 * Empathic App — On-Device Debug Overlay
 *
 * Debug overlay. Off by default. Enable by appending ?debug=1 to the URL.
 *
 * When enabled, includes:
 *   - A persistent floating "DEBUG" pill button at the bottom of the screen
 *   - A full-screen log viewer with big COPY and SHARE buttons
 *   - Ring-buffer capture of dbg(), console.log/warn/error, unhandled errors,
 *     and unhandled promise rejections
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const MAX_LINES = 400;

let mounted = false;
let pillEl = null;
let sheetEl = null;
let logEl = null;
let statusEl = null;
const buffer = []; // { stamp, level, text }

function fmt(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function nowStamp() {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  const ms = String(t.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function colorFor(level) {
  return (
    level === "error" ? "#ff6b6b" :
    level === "warn"  ? "#ffcc66" :
    level === "ok"    ? "#6ee7a1" :
                        "#cbd5e0"
  );
}

function appendRow(entry) {
  if (!logEl) return;
  const row = document.createElement("div");
  row.style.cssText =
    "font: 12px/1.4 ui-monospace, SF Mono, Menlo, monospace;" +
    "color: " + colorFor(entry.level) + ";" +
    "padding: 3px 10px;" +
    "white-space: pre-wrap;" +
    "word-break: break-word;" +
    "border-top: 1px solid rgba(255,255,255,0.05);";
  row.textContent = `${entry.stamp}  ${entry.text}`;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function updatePillCount() {
  if (!pillEl) return;
  const errors = buffer.filter(e => e.level === "error").length;
  const warns  = buffer.filter(e => e.level === "warn").length;
  const label = pillEl.querySelector("[data-label]");
  if (label) {
    label.textContent =
      errors ? `DEBUG · ${buffer.length} · err ${errors}` :
      warns  ? `DEBUG · ${buffer.length} · warn ${warns}` :
               `DEBUG · ${buffer.length}`;
  }
  if (errors > 0) {
    pillEl.style.background = "#c53030";
    pillEl.style.color = "#fff";
  } else if (warns > 0) {
    pillEl.style.background = "#d69e2e";
    pillEl.style.color = "#111";
  } else {
    pillEl.style.background = "rgba(20,20,24,0.92)";
    pillEl.style.color = "#fff";
  }
}

/**
 * Log a line. Level: "log" | "warn" | "error" | "ok".
 */
export function dbg(level, ...args) {
  const entry = {
    stamp: nowStamp(),
    level,
    text: args.map(fmt).join(" "),
  };
  buffer.push(entry);
  while (buffer.length > MAX_LINES) buffer.shift();
  appendRow(entry);
  updatePillCount();
}

function buildPlainLog() {
  const ua = (typeof navigator !== "undefined") ? (navigator.userAgent || "?") : "?";
  const url = (typeof location !== "undefined") ? location.href : "?";
  const header =
    "Empathic Art, debug log\n" +
    "captured: " + new Date().toISOString() + "\n" +
    "url: " + url + "\n" +
    "ua:  " + ua + "\n" +
    "----\n";
  const body = buffer.map(e => `${e.stamp} [${e.level}] ${e.text}`).join("\n");
  return header + body + "\n";
}

async function copyLog() {
  const text = buildPlainLog();
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {}
  if (!ok) {
    // Fallback: select the text so the user can long-press → Copy
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:20%;left:5%;width:90%;height:60%;font:12px/1.4 ui-monospace,monospace;z-index:1000001;background:#111;color:#fff;padding:12px;border-radius:8px;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { document.execCommand("copy"); ok = true; } catch {}
      // Leave it visible for 8s so the user can also long-press → select all → copy manually
      setTimeout(() => { if (ta.parentNode) ta.parentNode.removeChild(ta); }, 8000);
    } catch {}
  }
  if (statusEl) {
    statusEl.textContent = ok ? "Copied to clipboard" : "Selected: long-press → Copy";
    statusEl.style.color = ok ? "#6ee7a1" : "#ffcc66";
    setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3500);
  }
}

async function shareLog() {
  const text = buildPlainLog();
  try {
    if (navigator.share) {
      // Try sharing as a file first (works on iOS 15+)
      try {
        const file = new File([text], "empathic-debug.txt", { type: "text/plain" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "Empathic debug log" });
          return;
        }
      } catch {}
      await navigator.share({ title: "Empathic debug log", text });
      return;
    }
  } catch {}
  // No Web Share API — fall back to copy
  copyLog();
}

function mountPill() {
  pillEl = document.createElement("button");
  pillEl.id = "debug-pill";                    // ID so CSS can retarget it
  pillEl.className = "ea-debug-pill";           // and a class as a secondary hook
  pillEl.setAttribute("aria-label", "Open debug log");
  pillEl.style.cssText = [
    "position: fixed",
    // Bottom-LEFT so the pill never overlaps the view switcher (which
    // lives bottom-right at all breakpoints). Overridden by
    // styles/components.css to allow view-specific tweaks.
    "left: max(14px, env(safe-area-inset-left))",
    "bottom: max(60px, calc(env(safe-area-inset-bottom) + 60px))",
    "transform: none",
    "z-index: 999999",
    "background: rgba(20,20,24,0.92)",
    "color: #fff",
    "border: 1px solid rgba(255,255,255,0.24)",
    "border-radius: 999px",
    "padding: 10px 18px",
    "font: 600 12px/1 ui-monospace, SF Mono, Menlo, monospace",
    "letter-spacing: 0.08em",
    "box-shadow: 0 4px 16px rgba(0,0,0,0.45)",
    "backdrop-filter: blur(8px)",
    "-webkit-backdrop-filter: blur(8px)",
    "cursor: pointer",
    "-webkit-tap-highlight-color: transparent",
    "touch-action: manipulation",
  ].join(";");
  const label = document.createElement("span");
  label.setAttribute("data-label", "");
  label.textContent = "DEBUG · 0";
  pillEl.appendChild(label);
  pillEl.addEventListener("click", () => {
    if (sheetEl) sheetEl.style.display = "flex";
    // Re-scroll log to bottom on open
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
  document.body.appendChild(pillEl);
}

function mountSheet() {
  sheetEl = document.createElement("div");
  sheetEl.id = "__debug_sheet";
  sheetEl.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 1000000",
    "background: rgba(6,6,10,0.96)",
    "display: none",
    "flex-direction: column",
    "font-family: ui-monospace, SF Mono, Menlo, monospace",
    "color: #fff",
    "padding-top: env(safe-area-inset-top)",
    "padding-bottom: env(safe-area-inset-bottom)",
  ].join(";");

  // Top bar
  const top = document.createElement("div");
  top.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.1);";
  const title = document.createElement("div");
  title.textContent = "Empathic Debug Log";
  title.style.cssText = "flex:1;font:600 13px/1 ui-monospace,monospace;letter-spacing:0.08em;color:#cbd5e0;";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = "background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.16);border-radius:6px;padding:8px 14px;font:600 12px/1 ui-monospace,monospace;cursor:pointer;-webkit-tap-highlight-color:transparent;";
  closeBtn.addEventListener("click", () => { sheetEl.style.display = "none"; });
  top.appendChild(title);
  top.appendChild(closeBtn);

  // Log body
  logEl = document.createElement("div");
  logEl.style.cssText = "flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:4px 0;";

  // Bottom action bar
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:10px;padding:12px;border-top:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.4);";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "COPY LOG";
  copyBtn.style.cssText = "flex:1;background:#6ee7a1;color:#0a0a0c;border:none;border-radius:8px;padding:14px 12px;font:700 13px/1 ui-monospace,monospace;letter-spacing:0.1em;cursor:pointer;-webkit-tap-highlight-color:transparent;";
  copyBtn.addEventListener("click", copyLog);
  const shareBtn = document.createElement("button");
  shareBtn.textContent = "SHARE";
  shareBtn.style.cssText = "flex:1;background:#4a90e2;color:#fff;border:none;border-radius:8px;padding:14px 12px;font:700 13px/1 ui-monospace,monospace;letter-spacing:0.1em;cursor:pointer;-webkit-tap-highlight-color:transparent;";
  shareBtn.addEventListener("click", shareLog);
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "CLR";
  clearBtn.style.cssText = "background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.16);border-radius:8px;padding:14px 14px;font:600 12px/1 ui-monospace,monospace;cursor:pointer;-webkit-tap-highlight-color:transparent;";
  clearBtn.addEventListener("click", () => {
    buffer.length = 0;
    if (logEl) logEl.innerHTML = "";
    updatePillCount();
  });
  actions.appendChild(copyBtn);
  actions.appendChild(shareBtn);
  actions.appendChild(clearBtn);

  // Status row (below actions)
  statusEl = document.createElement("div");
  statusEl.style.cssText = "min-height:16px;padding:4px 12px 8px;font:12px/1.3 ui-monospace,monospace;color:#6ee7a1;text-align:center;";

  sheetEl.appendChild(top);
  sheetEl.appendChild(logEl);
  sheetEl.appendChild(actions);
  sheetEl.appendChild(statusEl);
  document.body.appendChild(sheetEl);

  // Backfill any lines that were logged before the sheet mounted
  for (const entry of buffer) appendRow(entry);
}

export function mountDebugOverlay() {
  if (mounted) return;
  if (!isDebugOn()) return;
  mounted = true;

  const attach = () => {
    if (!document.body) { requestAnimationFrame(attach); return; }
    mountSheet();
    mountPill();

    // Mirror console methods
    ["log", "warn", "error"].forEach((m) => {
      const orig = console[m].bind(console);
      console[m] = (...args) => {
        try { dbg(m === "log" ? "log" : m, ...args); } catch {}
        orig(...args);
      };
    });

    // Global error + rejection capture
    window.addEventListener("error", (e) => {
      dbg("error", "GLOBAL ERROR:", e.message, "@", (e.filename || "").split("/").pop() + ":" + e.lineno);
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason;
      const msg = r && r.message ? r.message : String(r);
      dbg("error", "UNHANDLED REJECTION:", msg);
    });

    dbg("ok", "debug overlay mounted");
    dbg("log", "ua:", navigator.userAgent);
    dbg("log", "url:", location.href);

    // Optional synthetic-data presets, useful for screenshots and demos.
    // ?debug=1&preset=long-trail seeds a rich multi-emotion session so a
    // full colored trail is visible immediately, without waiting out a
    // real session.
    const preset = new URLSearchParams(window.location.search).get("preset");
    if (preset === "long-trail") {
      import("./seed-long-trail.js")
        .then((mod) => mod.seedLongTrail())
        .catch((err) => dbg("error", "seed-long-trail failed:", err && err.message));
    }
  };
  attach();
}

/** Reads the ?debug=1 URL flag. The overlay is off unless this is set. */
export function isDebugOn() {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}
