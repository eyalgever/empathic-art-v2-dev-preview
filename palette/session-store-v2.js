/**
 * Empathic Art v2 — SessionStore (lightweight)
 *
 * Records per-second samples during a session and persists to localStorage.
 * Simpler than v1: no in-memory active-session state, no subscriptions,
 * just append-only sample writes and one commit at session end.
 *
 * Storage keys:
 *   ea.v2.sessions        JSON array of session records (oldest first)
 *   ea.v2.session_seq     integer session sequence (auto-increment)
 *
 * Session record shape:
 *   {
 *     id: string,               // 's_<base36 timestamp>_<random>'
 *     seq: number,               // 1-based counter (Session 01, 02, ...)
 *     styleId: string,           // e.g. 'chapel'
 *     styleName: string,         // e.g. 'Chapel'
 *     startedAt: number,         // Date.now() at Begin
 *     endedAt: number,           // Date.now() at commit
 *     durationMs: number,
 *     samples: [                 // sub-sampled to ~1 Hz
 *       { t, v, a, hr, emo }    // t = ms since startedAt; emo = top emotion name or null
 *     ],
 *     dominantEmotion: { name, hex } | null,
 *   }
 *
 * @author  Eyal Gever
 * @license MIT
 */

const KEY_SESSIONS = 'ea.v2.sessions';
const KEY_SEQ      = 'ea.v2.session_seq';
const MAX_SESSIONS = 60;   // rolling window, drop oldest
const SAMPLE_HZ    = 1;    // 1 sample per second
const COMMIT_KEY   = 'ea.v2.active_session'; // partial in-flight, in case of reload

export class SessionStoreV2 {
  constructor() {
    this._history = this._loadHistory();
    this._seq     = this._loadSeq();

    // Live-session buffers (in memory only)
    this._active  = null;
    this._lastSampleT = 0;

    // Beforeunload: commit whatever we have so nothing is lost on tab close
    window.addEventListener('beforeunload', () => {
      if (this._active) this._flushActive('unload');
    });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this._active) {
        this._flushActive('hidden');
      }
    });
  }

  /** All completed sessions, oldest first. */
  get history() { return this._history.slice(); }

  /** Total completed sessions. Used to decide "first session" vs "session 2+". */
  get sessionCount() { return this._history.length; }

  /** The most-recently completed session, or null. */
  get lastSession() {
    return this._history.length ? this._history[this._history.length - 1] : null;
  }

  /**
   * Begin a session. Called after Begin, once we know which style was picked.
   * Returns the session id.
   */
  begin({ styleId, styleName }) {
    this._seq += 1;
    this._saveSeq();
    this._active = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      seq: this._seq,
      styleId, styleName,
      startedAt: Date.now(),
      endedAt: null,
      durationMs: 0,
      samples: [],
      dominantEmotion: null,
    };
    this._lastSampleT = 0;
    return this._active.id;
  }

  /**
   * Push a live sample. Call every frame; internally throttled to SAMPLE_HZ.
   *   v, a in [-1, 1]; hr in bpm or null; emo = string ('happy', 'neutral', ...) or null.
   */
  push({ v, a, hr, emo }) {
    if (!this._active) return;
    const now = performance.now();
    const period = 1000 / SAMPLE_HZ;
    if (now - this._lastSampleT < period) return;
    this._lastSampleT = now;

    const t = Date.now() - this._active.startedAt;
    this._active.samples.push({
      t,
      v: v == null ? null : Number(v.toFixed(3)),
      a: a == null ? null : Number(a.toFixed(3)),
      hr: hr == null ? null : Math.round(hr),
      emo: emo || null,
    });
  }

  /** Update dominant emotion — called opportunistically as we detect a stable top emotion. */
  setDominantEmotion(name, hex) {
    if (this._active) this._active.dominantEmotion = { name, hex };
  }

  /**
   * End the current session and commit to history. If no session is active, no-op.
   * Returns the committed record, or null.
   */
  end() {
    if (!this._active) return null;
    return this._flushActive('normal');
  }

  _flushActive(reason) {
    const s = this._active;
    if (!s) return null;
    s.endedAt = Date.now();
    s.durationMs = s.endedAt - s.startedAt;

    // Drop no-op sessions (< 3 seconds, no samples) — user probably bailed
    if (s.durationMs < 3000 && s.samples.length < 2) {
      this._active = null;
      return null;
    }

    this._history.push(s);
    // Roll oldest out if over cap
    while (this._history.length > MAX_SESSIONS) this._history.shift();
    this._saveHistory();

    const committed = s;
    this._active = null;
    return committed;
  }

  clearHistory() {
    this._history = [];
    this._saveHistory();
  }

  _loadHistory() {
    try {
      const raw = localStorage.getItem(KEY_SESSIONS);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _saveHistory() {
    try {
      localStorage.setItem(KEY_SESSIONS, JSON.stringify(this._history));
    } catch (e) {
      // Quota exceeded — drop oldest and retry once
      if (this._history.length > 10) {
        this._history = this._history.slice(-Math.floor(this._history.length * 0.6));
        try { localStorage.setItem(KEY_SESSIONS, JSON.stringify(this._history)); } catch {}
      }
    }
  }

  _loadSeq() {
    try {
      const raw = localStorage.getItem(KEY_SEQ);
      return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
    } catch {
      return 0;
    }
  }

  _saveSeq() {
    try { localStorage.setItem(KEY_SEQ, String(this._seq)); } catch {}
  }
}
