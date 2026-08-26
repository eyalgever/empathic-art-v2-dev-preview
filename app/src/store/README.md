# src/store

A single class, `SessionStore`, that holds the live session state in memory and appends completed sessions to a history array.

## SessionStore

```js
import { SessionStore } from "./store/session-store.js";

SessionStore.enablePersistence();
const store = new SessionStore();
```

### Static API

| Member                          | Description                                                                 |
|----------------------------------|-------------------------------------------------------------------------------|
| `SessionStore.enablePersistence()` | Opts the whole class into browser persistent storage. Must be called before history is loaded, in practice, once at boot, before `new SessionStore()`. |

Persistence is off by default. A fresh `new SessionStore()` with no call to `enablePersistence()` is a clean in-memory store with no disk reads and no disk writes, this is intentional, so the module drops into any host build (iPhone native app, web app, or Apple Watch companion) with no surprise storage side effects unless the host app opts in.

### Instance API

| Member                                             | Description                                                                 |
|------------------------------------------------------|-------------------------------------------------------------------------------|
| `constructor()`                                      | Creates an empty live state and loads history from storage if persistence is enabled. |
| `state` (getter)                                     | Returns the current live session state object.                              |
| `history` (getter)                                   | Returns the array of completed session records, oldest first.               |
| `update(patch)`                                      | Shallow-merges `patch` into the live state and notifies subscribers.        |
| `addVoiceNote(note)`                                 | Appends a voice note object to the live state's `voiceNotes` array and notifies subscribers. |
| `subscribe(cb)`                                      | Registers `cb(state, history)` to run on every change. Returns an unsubscribe function. |
| `reset()`                                            | Revokes any live voice-note blob URLs, then restores the live state to its empty defaults. |
| `commitSession({ samples, crossings, dominantEmotion })` | Builds a session record from the current live state plus the arguments, appends it to history, persists if enabled, and returns the record. |
| `clearHistory()`                                     | Revokes all voice-note blob URLs across history, empties the history array, and persists the empty array if enabled. |

### Live state shape

The empty/default live state, returned by the `state` getter before any `update()` calls:

```js
{
  startEmotion: { valence: 0, arousal: 0, openness: 0.5 },
  musicChoice: "sound-journey",
  useMuseLive: false,
  startedAt: null,
  endedAt: null,
  voiceNotes: [],
}
```

`app.js` calls `update()` throughout the session lifecycle to set `startedAt`, `musicChoice`, `useMuseLive`, `noMuse`, and so on as the user makes choices on the "before" screen and moves into a live session.

### Session record shape

`commitSession(...)` returns (and appends to `history`) a record of this shape:

```js
{
  id: "s_<timestamp36>_<random6>",
  startedAt: 1751000000000,
  endedAt: 1751000042000,
  durationMs: 42000,
  seed: { valence: 0, arousal: 0, openness: 0.5 },
  musicChoice: "sound-journey",
  useMuseLive: false,
  noMuse: false,
  dominantEmotion: { name: "Joy", hex: "#ffcc33" },
  samples: [
    { t: 0, v: 0.2, a: 0.4, o: 0.5, label: "Joy", hex: "#ffcc33" }
  ],
  crossings: [
    { t: 12000, name: "Awe", hex: "#7dd3fc" }
  ],
  voiceNotes: [
    {
      url: null,
      mime: "audio/webm",
      durationMs: 3200,
      at: 15000,
      valenceAtRecord: 0.3,
      arousalAtRecord: 0.5
    }
  ]
}
```

`id` is generated from the current timestamp in base 36 plus six random base-36 characters, so it sorts roughly chronologically while remaining unique across sessions started in the same millisecond. `seed` is a snapshot of the `startEmotion` the user selected before the session began. `samples` and `crossings` are supplied by the caller, `app.js` builds these arrays as the session runs (from the Muse or simulated stream, see [`src/muse/README.md`](../muse/README.md)) and passes them into `commitSession()` when the session ends.

**Important, voice note URLs are stripped before persisting.** The live, in-memory record keeps the real `Blob` URL for the current session so notes can be replayed immediately. Before that record is written to storage (and whenever history is reloaded from storage), every voice note's `url` field is overwritten with `null`. Blob URLs are only valid for the lifetime of the page that created them, they cannot survive a reload, so persisting them would silently produce broken audio references. Code that plays back historical voice notes must be written to expect `url: null` on any note that was loaded from storage rather than created in the current session.

### Persistence details

**This uses `localStorage`, not IndexedDB.** The storage key is the literal string `"ea.history"`. The source obtains the storage object via `globalThis["local" + "Storage"]`, a string concatenation that evaluates to `globalThis.localStorage` with no functional difference from writing `localStorage` directly. This is worth stating plainly because an app with this much binary/blob-adjacent data (fluid frames, EEG samples, voice note metadata) might be assumed to use IndexedDB; it does not. The entire history array is serialized with `JSON.stringify` and written as one string value under one key.

Practical implications of this choice:

- `localStorage` has a per-origin size ceiling around 5-10MB depending on browser. A heavy-use build that accumulates many long sessions per day should call `clearHistory()` on a schedule (see [`INTEGRATION.md`](../../INTEGRATION.md#custom-persistence)) or replace persistence entirely (see below).
- Reads and writes are synchronous and block the main thread briefly. `samples` arrays are the largest contributor to record size, a long session can accumulate thousands of entries.
- All storage calls are wrapped in `try/catch` and fail silently. A full quota, private-browsing storage block, or disabled storage will not throw or interrupt the app; history will simply not persist for that session.

### Swapping the persistence backend

To use IndexedDB, a remote API, or any other backend instead of `localStorage`, replace the bodies of `_loadHistoryFromStorage()` and `_saveHistoryToStorage()` in `src/store/session-store.js`. Both are private methods called only from the constructor and from `commitSession()` / `clearHistory()`, so the public API (`state`, `history`, `update`, `commitSession`, `clearHistory`, `subscribe`) does not need to change for callers in `app.js` or elsewhere.

### Depends on

None. `session-store.js` has no internal imports.

### Consumed by

[`src/app.js`](../../ARCHITECTURE.md) is the sole consumer. It calls `SessionStore.enablePersistence()` once at boot, constructs one `store = new SessionStore()` instance for the app's lifetime, calls `update()` as the user configures and runs a session, and calls `commitSession(...)` inside its `endSession()` routine when a session finishes. The returned record is used to navigate straight to that session's summary/replay view (see [`src/after/README.md`](../after/README.md)).
