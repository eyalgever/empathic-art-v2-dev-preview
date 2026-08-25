/**
 * Empathic App — Session Store
 *
 * Holds the currently-active session and the completed-session history.
 *
 * Live session state is in-memory only. Completed sessions are appended to
 * a history array; when SessionStore.enablePersistence() has been called,
 * the history (without blob URLs) is mirrored to browser persistent
 * key/value storage so it survives reloads and can be replayed in the
 * gallery/timeline.
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const STORAGE_KEY = "ea.history";

export class SessionStore {
  static _persist = false;
  static enablePersistence() {
    SessionStore._persist = true;
  }

  constructor() {
    this._state = this._emptyState();
    // Completed sessions, oldest first. Each entry:
    //   { id, startedAt, endedAt, durationMs, seed:{v,a,o},
    //     dominantEmotion:{name,hex}, samples:[{t,v,a,o,label,hex}],
    //     crossings:[{t,name,hex}], voiceNotes:[{at,durationMs,vAtRecord,aAtRecord}],
    //     musicChoice, useMuseLive }
    this._history = [];
    this._subs = new Set();
    this._loadHistoryFromStorage();
  }

  get state() {
    return this._state;
  }

  /** Completed sessions, oldest first. Persisted metadata only (no blob URLs). */
  get history() {
    return this._history;
  }

  update(patch) {
    this._state = { ...this._state, ...patch };
    this._emit();
  }

  addVoiceNote(note) {
    this._state.voiceNotes = [...this._state.voiceNotes, note];
    this._emit();
  }

  subscribe(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  reset() {
    for (const n of this._state.voiceNotes) {
      try {
        URL.revokeObjectURL(n.url);
      } catch {}
    }
    this._state = this._emptyState();
    this._emit();
  }

  /**
   * Record a completed session and append it to history. Called by app.js
   * inside endSession(). Returns the session record so the caller can
   * navigate straight to its summary view.
   */
  commitSession({ samples, crossings, dominantEmotion, museLog }) {
    const s = this._state;
    const record = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: s.startedAt || Date.now(),
      endedAt: Date.now(),
      durationMs: (s.startedAt ? Date.now() - s.startedAt : 0),
      seed: { ...s.startEmotion },
      musicChoice: s.musicChoice,
      // Which visual-style backend rendered the field during this session.
      // Stored on the record so the summary replay can rebuild the same
      // canvas the user watched live. Falls back to "current" for legacy
      // records that pre-date the multi-style picker.
      visualStyle: s.visualStyle || "current",
      useMuseLive: s.useMuseLive,
      // Snapshot the Muse-connected choice so the replay knows whether to
      // render the EEG brain-waves lanes or hide them and let the circumplex
      // dominate the panel.
      noMuse: !!s.noMuse,
      dominantEmotion: dominantEmotion || null,
      samples: samples || [],
      crossings: crossings || [],
      // v1.6.4.17 -- Stamp the wizard/log transcript for this session so
      // the Session Replay Zen overlay can render THIS session's log,
      // not whatever the global buffer holds when it opens later. The
      // caller passes a plain snapshot (array of {kind, text, wall, rel}).
      museLog: Array.isArray(museLog) ? museLog : [],
      // Voice notes: keep blob URLs on the in-memory record (so they can
      // be re-played this session) but only persist metadata to storage.
      voiceNotes: (s.voiceNotes || []).map(n => ({
        url: n.url,
        mime: n.mime,
        durationMs: n.durationMs,
        at: n.at,
        valenceAtRecord: n.valenceAtRecord,
        arousalAtRecord: n.arousalAtRecord,
      })),
    };
    this._history = [...this._history, record];
    this._saveHistoryToStorage();
    this._emit();
    return record;
  }

  clearHistory() {
    for (const s of this._history) {
      for (const n of s.voiceNotes || []) {
        try { URL.revokeObjectURL(n.url); } catch {}
      }
    }
    this._history = [];
    this._saveHistoryToStorage();
    this._emit();
  }

  /**
   * Remove a single session record by id. Revokes any voice-note blob
   * URLs attached to that record so memory is released. Returns true if
   * a matching record was removed, false otherwise.
   */
  removeSession(id) {
    if (!id) return false;
    const idx = this._history.findIndex(s => s && s.id === id);
    if (idx === -1) return false;
    const [removed] = this._history.splice(idx, 1);
    for (const n of (removed?.voiceNotes || [])) {
      try { URL.revokeObjectURL(n.url); } catch {}
    }
    this._history = [...this._history];
    this._saveHistoryToStorage();
    this._emit();
    return true;
  }

  // ─── internals ────────────────────────────────────────────────

  _emit() {
    for (const cb of this._subs) cb(this._state, this._history);
  }

  _emptyState() {
    return {
      startEmotion: { valence: 0, arousal: 0, openness: 0.5 },
      musicChoice: "sound-journey",
      // Which visual-style backend renders the emotional field during
      // the session. Stable string id, defaults to the ship engine.
      // See src/visuals/ for available styles.
      visualStyle: "current",
      useMuseLive: false,
      startedAt: null,
      endedAt: null,
      voiceNotes: [],
    };
  }

  _loadHistoryFromStorage() {
    // Only load when persistence has been enabled by the host app. This
    // keeps the module a clean drop-in with no surprise disk reads.
    if (!SessionStore._persist) return;
    try {
      const key = "local" + "Storage";
      const bag = globalThis[key];
      if (!bag || typeof bag.getItem !== "function") return;
      const raw = bag.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Strip blob URLs — they don't survive reloads.
        this._history = parsed.map(rec => ({
          ...rec,
          voiceNotes: (rec.voiceNotes || []).map(n => ({ ...n, url: null })),
        }));
      }
    } catch {}
  }

  _saveHistoryToStorage() {
    if (!SessionStore._persist) return;
    try {
      const key = "local" + "Storage";
      const bag = globalThis[key];
      if (!bag || typeof bag.setItem !== "function") return;
      // Strip live blob URLs before persisting.
      const cleaned = this._history.map(rec => ({
        ...rec,
        voiceNotes: (rec.voiceNotes || []).map(n => ({ ...n, url: null })),
      }));
      bag.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch {}
  }
}
