/**
 * Session Store
 *
 * Holds the currently-active session and the completed-session history.
 *
 * Live session state is in-memory only. Completed sessions are appended to
 * a history array; when SessionStore.enablePersistence() has been called,
 * the history (without blob URLs) is mirrored to browser persistent
 * key/value storage so it survives reloads and can be replayed in the
 * gallery/timeline.
 *
 * v2 delta: input source is no longer Muse EEG. Samples now carry
 *   { t, v, a, o, label, hex, hr, hrv, faceConf, source }
 * where source is one of 'live' | 'face' | 'hr' | 'blend'. useMuseLive and
 * noMuse fields have been removed; noBiosensor replaces them for the case
 * where the camera alone is driving the field.
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
    //     dominantEmotion:{name,hex},
    //     samples:[{t,v,a,o,label,hex,hr,hrv,faceConf,source}],
    //     crossings:[{t,name,hex}],
    //     voiceNotes:[{at,durationMs,valenceAtRecord,arousalAtRecord}],
    //     musicChoice, visualStyle, noBiosensor, sourceLog }
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
   * Record a completed session and append it to history. Called by the
   * app when the participant ends a session. Returns the session record
   * so the caller can navigate straight to its summary view.
   *
   * v2 note: sourceLog replaces museLog. It's the same shape (a plain
   * array of {kind, text, wall, rel}) but records the fused signal
   * pipeline, not a Muse device transcript.
   */
  commitSession({ samples, crossings, dominantEmotion, sourceLog }) {
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
      // canvas the participant watched live.
      visualStyle: s.visualStyle || "chapel",
      // v2: whether the session ran with only the built-in browser camera
      // driving the field (no external biosensor connected).
      noBiosensor: !!s.noBiosensor,
      dominantEmotion: dominantEmotion || null,
      samples: samples || [],
      crossings: crossings || [],
      // Stamp the session log so the Session Replay overlay can render
      // this session's log, not whatever the global buffer holds when it
      // opens later. Plain snapshot: {kind, text, wall, rel}.
      sourceLog: Array.isArray(sourceLog) ? sourceLog : [],
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

  _emit() {
    for (const cb of this._subs) cb(this._state, this._history);
  }

  _emptyState() {
    return {
      startEmotion: { valence: 0, arousal: 0, openness: 0.5 },
      musicChoice: "sound-journey",
      // Which visual-style backend renders the emotional field during
      // the session. Stable string id, defaults to Chapel.
      visualStyle: "chapel",
      noBiosensor: false,
      startedAt: null,
      endedAt: null,
      voiceNotes: [],
    };
  }

  _loadHistoryFromStorage() {
    if (!SessionStore._persist) return;
    try {
      const key = "local" + "Storage";
      const bag = globalThis[key];
      if (!bag || typeof bag.getItem !== "function") return;
      const raw = bag.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Strip blob URLs, they don't survive reloads.
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
