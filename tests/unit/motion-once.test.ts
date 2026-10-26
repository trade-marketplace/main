import { describe, expect, it } from "vitest";

import { createOnceStore, ONCE_LIMIT, ONCE_STORAGE_KEY, onceStore, type StorageLike } from "@/lib/motion/once";

/** A Map-backed fake of localStorage / sessionStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
  };
  return storage;
}

describe("once per event (M09 price reveal, M10 bolt flash)", () => {
  it("plays the first time an event is shown and never again", () => {
    const store = createOnceStore(() => fakeStorage());
    expect(store.claim("price-ready:job-1")).toBe(true);
    expect(store.claim("price-ready:job-1")).toBe(false);
    expect(store.claim("price-ready:job-1")).toBe(false);
  });

  it("plays again for a different event", () => {
    const store = createOnceStore(() => fakeStorage());
    expect(store.claim("posted:job-1")).toBe(true);
    expect(store.claim("posted:job-2")).toBe(true);
    expect(store.claim("paid:job-1")).toBe(true);
  });

  it("doesn't replay on a refresh or a revisit: events are remembered in storage, not the page", () => {
    const local = fakeStorage();
    expect(createOnceStore(() => local).claim("price-ready:job-1")).toBe(true);
    // A new page load builds a new store on the same localStorage.
    const afterRefresh = createOnceStore(() => local);
    expect(afterRefresh.claim("price-ready:job-1")).toBe(false);
    expect(afterRefresh.hasRun("price-ready:job-1")).toBe(true);
  });

  it("keeps events in localStorage and visits (M07) in sessionStorage", () => {
    const local = fakeStorage();
    const session = fakeStorage();
    const store = createOnceStore((scope) => (scope === "visit" ? session : local));
    store.claim("posted:job-1");
    store.claim("headline:landing", "visit");
    expect(JSON.parse(local.getItem(`${ONCE_STORAGE_KEY}:event`)!)).toEqual(["posted:job-1"]);
    expect(JSON.parse(session.getItem(`${ONCE_STORAGE_KEY}:visit`)!)).toEqual(["headline:landing"]);
    // The same id in the other scope is a different thing.
    expect(store.claim("posted:job-1", "visit")).toBe(true);
  });

  it("a once-per-visit reveal plays again on the next visit (new sessionStorage)", () => {
    const local = fakeStorage();
    const firstVisit = createOnceStore((scope) => (scope === "visit" ? fakeStorage() : local));
    expect(firstVisit.claim("headline:landing", "visit")).toBe(true);
    const nextVisit = createOnceStore((scope) => (scope === "visit" ? fakeStorage() : local));
    expect(nextVisit.claim("headline:landing", "visit")).toBe(true);
  });

  it("hasRun doesn't use the event up", () => {
    const store = createOnceStore(() => fakeStorage());
    expect(store.hasRun("sorted:job-1")).toBe(false);
    expect(store.claim("sorted:job-1")).toBe(true);
  });

  it("never plays for an empty event id", () => {
    const store = createOnceStore(() => fakeStorage());
    expect(store.claim("")).toBe(false);
  });

  describe("when storage is missing or throws", () => {
    it("still plays only once on the page when there is no storage at all", () => {
      const store = createOnceStore(() => null);
      expect(store.claim("posted:job-1")).toBe(true);
      expect(store.claim("posted:job-1")).toBe(false);
    });

    it("doesn't throw when even touching storage throws (blocked site data)", () => {
      const store = createOnceStore(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });
      expect(() => store.claim("posted:job-1")).not.toThrow();
      expect(store.claim("posted:job-1")).toBe(false);
    });

    it("doesn't throw when reading or writing throws (private mode, full quota)", () => {
      const broken: StorageLike = {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        },
      };
      const store = createOnceStore(() => broken);
      expect(store.claim("paid:job-1")).toBe(true);
      expect(store.claim("paid:job-1")).toBe(false);
    });

    it("treats unreadable stored data as empty instead of failing", () => {
      const store = createOnceStore(() => fakeStorage({ [`${ONCE_STORAGE_KEY}:event`]: "{not json" }));
      expect(store.claim("posted:job-1")).toBe(true);
      const notAList = createOnceStore(() => fakeStorage({ [`${ONCE_STORAGE_KEY}:event`]: '{"a":1}' }));
      expect(notAList.claim("posted:job-1")).toBe(true);
    });
  });

  it(`remembers at most ${ONCE_LIMIT} events per scope, dropping the oldest`, () => {
    const local = fakeStorage();
    const store = createOnceStore(() => local);
    for (let i = 0; i <= ONCE_LIMIT; i++) store.claim(`job-${i}`);
    const kept: string[] = JSON.parse(local.getItem(`${ONCE_STORAGE_KEY}:event`)!);
    expect(kept).toHaveLength(ONCE_LIMIT);
    expect(kept[0]).toBe("job-1");
    expect(kept.at(-1)).toBe(`job-${ONCE_LIMIT}`);
  });

  it("never claims on the server, so the celebration isn't used up before anyone sees it", () => {
    expect(typeof window).toBe("undefined");
    expect(onceStore.claim("posted:job-1")).toBe(false);
    expect(onceStore.hasRun("posted:job-1")).toBe(false);
  });
});
