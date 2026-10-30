import { preferenceKey, type PreferenceChange, type PreferenceError, type PreferenceSnapshot, type PreferenceSource } from "./notification-preferences";

type Failure = { error: PreferenceError; change: PreferenceChange };
export type EditorSnapshot = PreferenceSnapshot & { saving: boolean; failure: Failure | null };

/** One write at a time; rapid changes to the same cell collapse to the latest intention. */
export function createPreferenceEditor(initial: PreferenceSnapshot, save: PreferenceSource["save"], saved: (change: PreferenceChange, before: boolean) => void) {
  let state: EditorSnapshot = { ...initial, saving: false, failure: null };
  const confirmed = new Map<string, boolean>(initial.rows.flatMap(row => (["EMAIL", "PUSH"] as const).map(channel => [`${row.event}:${channel}`, row.channels[channel].enabled] as const)));
  const queued = new Map<string, PreferenceChange>();
  const listeners = new Set<() => void>();
  const savedListeners = new Set<typeof saved>();
  let writing = false;
  let online = true;
  let active = true;
  const publish = (next: Partial<EditorSnapshot>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  const paint = (change: PreferenceChange) => state.rows.map(row => row.event === change.event ? { ...row, channels: { ...row.channels, [change.channel]: { ...row.channels[change.channel], enabled: change.enabled } } } : row);

  async function drain() {
    if (writing || !online || !active) return;
    writing = true;
    try {
      while (queued.size && online && active) {
        const [key, change] = queued.entries().next().value!;
        queued.delete(key);
        const before = confirmed.get(key)!;
        let result;
        try { result = await save(change); }
        catch { result = { ok: false as const, error: "unavailable" as const }; }
        if (!result.ok) {
          const retry = queued.get(key) ?? change;
          queued.clear();
          publish({ saving: false, failure: { error: result.error, change: retry }, rows: state.rows.map(row => ({ ...row, channels: Object.fromEntries((["EMAIL", "PUSH"] as const).map(channel => [channel, { ...row.channels[channel], enabled: confirmed.get(`${row.event}:${channel}`)! }])) as typeof row.channels })) });
          return;
        }
        confirmed.set(key, result.change.enabled);
        // The latest toggle may already equal this acknowledgement. Keep its original Undo instead of
        // sending an identical write whose "before" value would hide the confirmation altogether.
        if (queued.get(key)?.enabled === result.change.enabled) queued.delete(key);
        // A late acknowledgement never paints over a newer local choice or creates a stale Undo.
        if (!queued.has(key)) publish({ rows: paint(result.change) });
        if (!queued.size && before !== result.change.enabled && active) {
          saved(result.change, before);
          savedListeners.forEach(listener => listener(result.change, before));
        }
      }
    } finally {
      writing = false;
      publish({ saving: queued.size > 0 });
    }
  }

  function change(change: PreferenceChange) {
    const cell = state.rows.find(row => row.event === change.event)?.channels[change.channel];
    if (!cell || cell.locked || !online || !active) return;
    const key = preferenceKey(change);
    queued.delete(key);
    queued.set(key, change);
    publish({ rows: paint(change), saving: true, failure: null });
    void drain();
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeSaved: (listener: typeof saved) => { savedListeners.add(listener); return () => { savedListeners.delete(listener); }; },
    change,
    retry: () => { if (state.failure) change(state.failure.change); },
    setOnline: (value: boolean) => { online = value; if (value) void drain(); },
    activate: () => { active = true; void drain(); },
    deactivate: () => { active = false; },
  };
}
