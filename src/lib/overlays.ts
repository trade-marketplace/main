// The rules behind the overlays (#78: dialog, drawer, sheet, menu, toast), kept as plain functions so they can be
// unit tested without a browser. The components are in src/components/overlays. Safe on server and browser.

/** Why an overlay asked to close. Callers rarely need it; it's there for analytics and the odd special case. */
export type CloseReason = "escape" | "scrim" | "close-button" | "swipe";

/** Everything a keyboard can Tab to, before checking that it's visible and not inert. */
export const TABBABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Focus trap: where Tab (or Shift+Tab) goes from the `index`-th of `count` tabbable controls inside an overlay.
 * -1 means focus is on something that isn't in the list (the title, which takes focus when it opens).
 * Returns the index to focus, "stay" when there is nothing to Tab to, or null to let the browser move as usual.
 */
export function trapTab(count: number, index: number, backwards: boolean): number | "stay" | null {
  if (count === 0) return "stay";
  if (backwards) return index <= 0 ? count - 1 : null;
  return index === -1 || index >= count - 1 ? 0 : null;
}

/** What a key does inside an open menu: move to an item, close it, or nothing (null). */
export type MenuMove = { focus: number } | { close: "escape" | "tab" } | null;

/** Menu keys (WAI-ARIA menu button): arrows wrap, Home/End jump, Esc closes and returns to the button, Tab leaves. */
export function menuKey(key: string, index: number, count: number): MenuMove {
  if (key === "Escape") return { close: "escape" };
  if (key === "Tab") return { close: "tab" };
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return { focus: index < 0 ? 0 : (index + 1) % count };
    case "ArrowUp":
      return { focus: index < 0 ? count - 1 : (index - 1 + count) % count };
    case "Home":
    case "PageUp":
      return { focus: 0 };
    case "End":
    case "PageDown":
      return { focus: count - 1 };
    default:
      return null;
  }
}

/**
 * Type-ahead in a menu: the next item (after `from`, wrapping) whose label starts with what has been typed.
 * Typing the same letter again moves through the items that start with it. -1 when nothing matches.
 */
export function typeaheadIndex(labels: readonly string[], from: number, typed: string): number {
  const query = typed.toLocaleLowerCase("en-NZ");
  if (!query || labels.length === 0) return -1;
  const repeated = [...query].every((ch) => ch === query[0]);
  const needle = repeated ? query[0] : query;
  // A longer query keeps the current item if it still matches; a single (or repeated) letter moves on.
  const start = repeated ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < labels.length; step++) {
    const i = (start + step) % labels.length;
    if (labels[i].trim().toLocaleLowerCase("en-NZ").startsWith(needle)) return i;
  }
  return -1;
}

/** Type-ahead forgets what was typed after this long without a key. */
export const TYPEAHEAD_RESET_MS = 500;

/**
 * Bottom sheet swipe: close when it has been dragged down far enough (a quarter of its height, at most 120px),
 * or flicked down fast (over 0.5px/ms after at least 24px). Otherwise it springs back.
 */
export function sheetShouldClose(dragged: number, ms: number, height: number): boolean {
  if (dragged <= 0) return false;
  if (dragged >= Math.min(120, height / 4)) return true;
  return dragged >= 24 && ms > 0 && dragged / ms > 0.5;
}

/**
 * How far to slide a popup (menu, tooltip) sideways so it stays `gutter` px inside a screen `width` wide.
 * `left` and `right` are where it would be drawn. 0 when it already fits; it never pushes past the left edge.
 */
export function shiftIntoView(left: number, right: number, width: number, gutter = 16): number {
  if (right > width - gutter) return Math.max(gutter - left, width - gutter - right);
  if (left < gutter) return gutter - left;
  return 0;
}

/** A toast: one short confirmation (“Saved.”), optionally with one action, nearly always Undo. */
export type ToastInput = {
  message: string;
  /** A Material Symbols name. Decorative: the message says the same. Default "check_circle". */
  icon?: string;
  /** One action, e.g. { label: "Undo", onAction: restore }. Pressing it runs onAction and closes the toast. */
  action?: { label: string; onAction: () => void };
};

export type ToastItem = ToastInput & { id: number };

/**
 * The toast queue. One toast shows at a time (WEBAPP_SPEC M14, bottom right); a newer one replaces the one on
 * screen at once, so a quick run of “Saved.” toasts never piles up. Dismissing an old id does nothing.
 */
export type ToastState = { current: ToastItem | null; nextId: number };

export const EMPTY_TOASTS: ToastState = { current: null, nextId: 1 };

export function showToast(state: ToastState, input: ToastInput): ToastState {
  return { current: { ...input, id: state.nextId }, nextId: state.nextId + 1 };
}

export function dismissToast(state: ToastState, id: number): ToastState {
  return state.current?.id === id ? { ...state, current: null } : state;
}
