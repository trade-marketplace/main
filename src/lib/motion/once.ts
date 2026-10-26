// "Run once per event" for the celebrations (WEBAPP_SPEC Motion: "Big celebrations (M09 price reveal, M10 bolt
// flash) run once per event, never on revisits or refreshes") and "once per visit" (M07 headline reveal).
//
// - scope "event" is remembered in localStorage, so a refresh, a revisit, a second tab or a return tomorrow
//   doesn't replay it. Key it by what happened, e.g. `price-ready:${job.id}` or `posted:${job.id}`.
// - scope "visit" is remembered in sessionStorage: once per tab, again on the next visit.
// - Storage can be missing or throw (private windows, blocked site data, full quota). Then it is remembered in
//   memory for as long as the page is open: it may replay after a reload, but never twice on one page.
// Never throws. Safe to import on the server (it just never claims there).

export type OnceScope = "event" | "visit";

/** The part of the Web Storage API this needs, so tests can pass a fake. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** One storage key per scope holds the most recent ids, oldest first. */
export const ONCE_STORAGE_KEY = "tm-motion-once";
/** How many ids each scope remembers. Old ones drop off, so storage never grows without limit. */
export const ONCE_LIMIT = 500;

export type OnceStore = {
  /**
   * Returns true the first time it's called for this id (play the celebration) and false every time after
   * (show the end state straight away). An empty id never plays.
   */
  claim(id: string, scope?: OnceScope): boolean;
  /** Has this id already played? Doesn't claim it. */
  hasRun(id: string, scope?: OnceScope): boolean;
};

function readIds(storage: StorageLike, key: string): string[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Builds a store on top of whatever storage `getStorage` returns for each scope (null = none available).
 * `getStorage` itself may throw: some browsers throw just for touching `window.localStorage`.
 */
export function createOnceStore(getStorage: (scope: OnceScope) => StorageLike | null | undefined): OnceStore {
  const memory: Record<OnceScope, Set<string>> = { event: new Set(), visit: new Set() };

  const storageFor = (scope: OnceScope): StorageLike | null => {
    try {
      return getStorage(scope) ?? null;
    } catch {
      return null;
    }
  };

  const key = (scope: OnceScope) => `${ONCE_STORAGE_KEY}:${scope}`;

  const hasRun = (id: string, scope: OnceScope = "event") => {
    if (!id) return true;
    if (memory[scope].has(id)) return true;
    const storage = storageFor(scope);
    return storage ? readIds(storage, key(scope)).includes(id) : false;
  };

  const claim = (id: string, scope: OnceScope = "event") => {
    if (hasRun(id, scope)) return false;
    // Remember it in memory first, so it can't play twice on this page even if writing to storage fails.
    memory[scope].add(id);
    const storage = storageFor(scope);
    if (storage) {
      try {
        const ids = readIds(storage, key(scope)).filter((existing) => existing !== id);
        ids.push(id);
        storage.setItem(key(scope), JSON.stringify(ids.slice(-ONCE_LIMIT)));
      } catch {
        // Full or blocked: the in-memory record above still stops a replay on this page.
      }
    }
    return true;
  };

  return { claim, hasRun };
}

const browserStore = createOnceStore((scope) => (scope === "visit" ? window.sessionStorage : window.localStorage));

/**
 * The browser's store: localStorage for events, sessionStorage for visits. On the server nothing is ever claimed
 * (it would be used up before anyone saw it), so `claim` is always false there.
 */
export const onceStore: OnceStore = {
  claim: (id, scope) => (typeof window === "undefined" ? false : browserStore.claim(id, scope)),
  hasRun: (id, scope) => (typeof window === "undefined" ? false : browserStore.hasRun(id, scope)),
};
