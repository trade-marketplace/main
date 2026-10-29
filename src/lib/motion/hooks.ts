"use client";
// React hooks for the named animations M01–M27 (#73). The CSS classes live in src/styles/motion.css; these
// cover the parts that need JavaScript: once-per-event celebrations, count-ups, exits, measuring, scrolling.
// Every hook honours prefers-reduced-motion (everything becomes an instant change). /dev/motion uses each one.
import {
  type DragEvent,
  type FocusEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";

import { countUpValue, type Easing, easeOut } from "./easing";
import { isAtBottom, parallaxOffset } from "./helpers";
import { onceStore, type OnceScope } from "./once";
import { prefersReducedMotion, subscribeReducedMotion } from "./reduced-motion";
import { MOTION_MS } from "./timings";

const noSubscribe = () => () => {};

/**
 * False on the server and while hydrating, true afterwards. Lets motion start from its first frame when a
 * component mounts in the browser, while server HTML (and the hydration pass) always shows the end state.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

/** True when the visitor asks for reduced motion. False on the server and while hydrating. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => prefersReducedMotion(), () => false);
}

// Each mounted component gets its own decision per event id, made once and kept for as long as it's mounted, so
// re-renders (and React's StrictMode double renders) never claim twice or flip the answer.
const decisions = new WeakMap<object, Map<string, boolean>>();

/**
 * Once per event: true only the first time this event id is shown, ever (scope "event", remembered in
 * localStorage) or this visit (scope "visit", sessionStorage). False on the server and while hydrating, so the
 * server HTML always shows the end state; after hydration the very first viewer gets the animation.
 * A null/empty id never plays. See src/lib/motion/once.ts for what happens when storage is blocked.
 */
export function useOncePerEvent(eventId: string | null | undefined, scope: OnceScope = "event"): boolean {
  const [mount] = useState(() => ({}));
  const getSnapshot = () => {
    if (!eventId) return false;
    let byId = decisions.get(mount);
    if (!byId) {
      byId = new Map();
      decisions.set(mount, byId);
    }
    const key = `${scope}:${eventId}`;
    let decision = byId.get(key);
    if (decision === undefined) {
      decision = onceStore.claim(eventId, scope);
      byId.set(key, decision);
    }
    return decision;
  };
  return useSyncExternalStore(noSubscribe, getSnapshot, () => false);
}

/**
 * M09 price reveal and M10 bolt flash: play once per event, and never under reduced motion (the end state shows
 * straight away; the event still counts as seen). Key it by what happened: `price-ready:${job.id}`.
 */
export function useCelebration(eventId: string | null | undefined): boolean {
  const first = useOncePerEvent(eventId, "event");
  const reduced = usePrefersReducedMotion();
  return first && !reduced;
}

export type CountUpOptions = {
  /** Start counting. False (or reduced motion) shows the final value. */
  run?: boolean;
  /** Change it to count again from the start (e.g. a new event). */
  runKey?: string | number;
  from?: number;
  duration?: number;
  delay?: number;
  ease?: Easing;
};

/**
 * M09 / M17: a number that counts up from `from` (0) to `target` on the --trade-ease-out curve.
 * Returns the value to show this frame; format it yourself (money, whole numbers). Server HTML and reduced
 * motion show `target`.
 */
export function useCountUp(
  target: number,
  { run = true, runKey = 0, from = 0, duration = MOTION_MS.m17Count, delay = 0, ease = easeOut }: CountUpOptions = {},
): number {
  const reduced = usePrefersReducedMotion();
  const isClient = useIsClient();
  const active = run && isClient && !reduced && duration > 0;
  const token = `${target}|${from}|${runKey}`;
  const [frame, setFrame] = useState<{ token: string; value: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const elapsed = now - start;
      setFrame({ token, value: countUpValue({ from, to: target, elapsed, duration, delay, ease }) });
      if (elapsed < delay + duration) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, token, from, target, duration, delay, ease]);

  if (!active) return target;
  return frame?.token === token ? frame.value : from;
}

/** True from the first time the element is on screen (M17: count up the first time KPIs enter view). */
export function useInViewOnce<T extends Element>(ref: RefObject<T | null>, rootMargin = "0px"): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      const raf = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(raf);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

/**
 * Keeps an overlay mounted while it animates out (M12 drawer 200ms, M13 dialog 150ms, M14 toast 200ms).
 * `exiting` is true during the exit: swap the in class for the out class. Reduced motion: unmounts at once.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; exiting: boolean } {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), reduced ? 0 : exitMs);
    return () => clearTimeout(timer);
  }, [open, mounted, exitMs, reduced]);

  return { mounted: open || mounted, exiting: !open && mounted };
}

/**
 * A counter that goes up when `value` changes in a way that should replay an animation: use it as the `key` of
 * the animated element. M20: useBump(count, wentUp). M23: useBump(saved, becameTrue).
 */
export function useBump<T>(value: T, shouldBump: (previous: T, next: T) => boolean): number {
  const [state, setState] = useState({ value, count: 0 });
  if (!Object.is(state.value, value)) {
    const next = { value, count: shouldBump(state.value, value) ? state.count + 1 : state.count };
    setState(next);
    return next.count;
  }
  return state.count;
}

/**
 * M25: keeps the previous value for `ms` after a change, so the old and new pill can cross-fade in a .tm-swap.
 * `swapKey` changes on every change: use it as the new pill's key. Reduced motion: no previous, instant swap.
 */
export function useSwap<T>(value: T, ms: number = MOTION_MS.base): { current: T; previous: T | null; swapKey: number } {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<{ current: T; previous: T | null; key: number }>({
    current: value,
    previous: null,
    key: 0,
  });
  let shown = state;
  if (!Object.is(state.current, value)) {
    shown = { current: value, previous: reduced ? null : state.current, key: state.key + 1 };
    setState(shown);
  }

  const { key, previous } = shown;
  useEffect(() => {
    if (previous === null) return;
    const timer = setTimeout(() => setState((s) => (s.key === key ? { ...s, previous: null } : s)), ms);
    return () => clearTimeout(timer);
  }, [key, previous, ms]);

  return { current: shown.current, previous: shown.previous, swapKey: shown.key };
}

/**
 * M16: moves the `.tm-tab-indicator` (marked `data-tab-indicator`) inside the tab list to the active tab.
 * The list must be positioned. Re-measures when `activeKey` changes and when the list resizes.
 * Pass axis="y" for a sidebar: --tm-tab-y is its top offset and --tm-tab-scale its fraction of the list's height.
 */
export function useTabIndicator<T extends HTMLElement>(
  listRef: RefObject<T | null>,
  activeKey: unknown,
  activeSelector = '[aria-selected="true"], [aria-current="page"]',
  axis: "x" | "y" = "x",
): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    const bar = list?.querySelector<HTMLElement>("[data-tab-indicator]");
    if (!list || !bar) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(activeSelector);
      const size = axis === "y" ? list.clientHeight : list.clientWidth;
      if (!active || size === 0) return;
      bar.style.setProperty(`--tm-tab-${axis}`, `${axis === "y" ? active.offsetTop : active.offsetLeft}px`);
      bar.style.setProperty("--tm-tab-scale", String((axis === "y" ? active.offsetHeight : active.offsetWidth) / size));
    };
    measure();
    let raf = 0;
    if (bar.dataset.ready !== "true") raf = requestAnimationFrame(() => (bar.dataset.ready = "true"));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [listRef, activeKey, activeSelector, axis]);
}

/**
 * M06: moves the hero bolt at 0.3x the scroll, at most 60px (sets --tm-parallax-y for .tm-parallax).
 * Scrolls the window unless `scrollContainer` is given. Reduced motion: the bolt stays still.
 */
export function useParallax<T extends HTMLElement>(
  ref: RefObject<T | null>,
  {
    scrollContainer,
    factor = MOTION_MS.m06Factor,
    max = MOTION_MS.m06MaxPx,
  }: { scrollContainer?: RefObject<HTMLElement | null>; factor?: number; max?: number } = {},
): void {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reduced) {
      element.style.setProperty("--tm-parallax-y", "0px");
      return;
    }
    const container = scrollContainer?.current ?? null;
    const source: HTMLElement | Window = container ?? window;
    const read = () => (container ? container.scrollTop : window.scrollY);
    let raf = 0;
    const update = () => {
      raf = 0;
      element.style.setProperty("--tm-parallax-y", `${parallaxOffset(read(), factor, max)}px`);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    source.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      source.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, scrollContainer, factor, max, reduced]);
}

/**
 * M06 nav fill: true once the target's chosen edge passes `offset` px from the top.
 * Site headers use the top edge so moving hero content never crosses transparent navigation.
 * Put it on the nav as data-solid. Scrolls the window unless `scrollContainer` is given.
 */
export function useScrolledPast<T extends Element>(
  targetRef: RefObject<T | null>,
  { offset = 0, edge = "bottom", scrollContainer }: { offset?: number; edge?: "top" | "bottom"; scrollContainer?: RefObject<HTMLElement | null> } = {},
): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const root = scrollContainer?.current ?? null;
    if (edge === "top") {
      const source = root ?? window;
      let frame = 0;
      const update = () => {
        frame = 0;
        setPast(target.getBoundingClientRect().top < (root?.getBoundingClientRect().top ?? 0) + offset);
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
      update();
      source.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      return () => {
        source.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        if (frame) cancelAnimationFrame(frame);
      };
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rootTop = entry.rootBounds?.top ?? 0;
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < rootTop);
      },
      { root, rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef, scrollContainer, offset, edge]);
  return past;
}

/** M08: the value, `ms` after it last changed (suggestions update as you type, 150ms debounce). */
export function useDebouncedValue<T>(value: T, ms: number = MOTION_MS.m08Debounce): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * M19: when `changeKey` changes (a new message), scrolls the thread to the bottom, but only if it was already
 * at the bottom, so someone reading back up isn't moved.
 */
export function useStickToBottom<T extends HTMLElement>(ref: RefObject<T | null>, changeKey: unknown): void {
  const atBottom = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      atBottom.current = isAtBottom(element);
    };
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [ref]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !atBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [ref, changeKey]);
}

const subscribeClock = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const readClock = () => Math.floor(Date.now() / 1000) * 1000;

/** The current time to the second, ticking every second. Null on the server and while hydrating. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribeClock, readClock, () => null);
}

/** M27: milliseconds left until `endsAt` (0 once expired), ticking every second. Null until hydrated. */
export function useCountdown(endsAt: number): number | null {
  const now = useNow();
  return now === null ? null : Math.max(0, endsAt - now);
}

/**
 * M14: calls `onDone` after `duration` (4s) of the toast being shown and not paused. Pausing (hover or focus)
 * stops the clock and the hairline together; `runKey` starts a new toast's full 4 seconds.
 */
export function useToastTimer(
  onDone: () => void,
  {
    active = true,
    paused = false,
    duration = MOTION_MS.m14Life,
    runKey = 0,
  }: { active?: boolean; paused?: boolean; duration?: number; runKey?: string | number } = {},
): void {
  const remaining = useRef(duration);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    remaining.current = duration;
  }, [duration, runKey, active]);
  useEffect(() => {
    if (!active || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => done.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [active, paused, runKey]);
}

/** M14: is the pointer over, or focus inside, this element? Spread `handlers` on it. */
export function useHoverOrFocus() {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    active: hover || focus,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setFocus(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false);
      },
    },
  };
}

/** M26: tracks a file being dragged over a drop zone. Spread `props` on the .tm-dropzone element. */
export function useDropZone(onFiles?: (files: FileList) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return {
    over,
    props: {
      "data-over": over ? "true" : "false",
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        if (event.dataTransfer?.files?.length) onFiles?.(event.dataTransfer.files);
      },
    },
  };
}

/**
 * M02: runs `update` inside a view transition (180ms page cross-fade; elements sharing a morphName() morph in
 * 320ms). React state set in `update` is flushed inside the transition. Falls back to a plain update where the
 * browser has no View Transitions or the visitor wants reduced motion.
 */
export function startViewTransition(update: () => void): void {
  const doc = typeof document === "undefined" ? undefined : document;
  if (!doc || typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}
