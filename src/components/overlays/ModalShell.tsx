"use client";
// The one modal behind <Dialog>, <Drawer> and <Sheet> (#78). Not exported from the kit: use those three.
//
// It is a native <dialog> opened with showModal(), so the browser makes the rest of the page inert (no clicks,
// no Tab, hidden from screen readers), puts it above everything, and treats it as a dialog (aria-modal). On top
// of that this file adds what the spec asks for (WEBAPP_SPEC "Dialogs", FRONTEND_SPEC "Sheet"):
// - focus moves to the title when it opens (no accidental Enter on a button), or to `initialFocusRef`;
// - Tab and Shift+Tab wrap inside it (the focus trap); focus goes back to whatever opened it on close;
// - Esc, a click on the scrim, the close button and (sheets) a swipe down ask to close, unless not dismissible;
// - the page behind doesn't scroll while it is open;
// - M12 / M13 / sheet motion in and out (src/styles/motion.css), instant under prefers-reduced-motion.
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { IconButton } from "@/components/Button";
import { usePresence } from "@/lib/motion/hooks";
import { EXIT_MS } from "@/lib/motion/timings";
import { type CloseReason, sheetShouldClose, TABBABLE, trapTab } from "@/lib/overlays";

import styles from "./overlays.module.css";

export type ModalLayout = "dialog" | "drawer" | "sheet";

/** What <Dialog>, <Drawer> and <Sheet> all take. */
export type ModalProps = {
  /** Show it. The parent owns this: set it to false in onClose. It animates out before it unmounts. */
  open: boolean;
  /**
   * Asked to close: Esc, the scrim, the close button or a swipe (the reason says which). Set `open` to false here.
   * Never called when `dismissible` is false.
   */
  onClose?: (reason: CloseReason) => void;
  /** The heading. It names the overlay for screen readers and takes focus when it opens. */
  title: ReactNode;
  /** A small line or a status pill above the title, e.g. “Sub wiring · TM-1005”. */
  eyebrow?: ReactNode;
  /** One short sentence under the title. Screen readers read it as the description. */
  description?: ReactNode;
  children?: ReactNode;
  /** The buttons. In a dialog, put them in reading order (Cancel, then the main action); on a phone sheet the
   *  main action goes on top by itself. */
  footer?: ReactNode;
  /**
   * Default true. False: no close button, and Esc, the scrim and swiping do nothing, so the only way out is a
   * button in it. Only for things that can't be skipped, like “You’ve been logged out” (B07).
   */
  dismissible?: boolean;
  /** Focus this instead of the title when it opens (e.g. the first field of a form drawer). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** The close button's name. Default “Close”. */
  closeLabel?: string;
  className?: string;
};

type ShellProps = ModalProps & {
  layout: ModalLayout;
  role?: "dialog" | "alertdialog";
  size?: "sm" | "md" | "lg";
};

// ---- Scroll lock: one count for the whole page, so a dialog over a drawer unlocks only when both are gone.
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

function lockScroll(): () => void {
  const root = document.documentElement;
  if (locks++ === 0) {
    saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    // Keep the page where it was: the scrollbar goes away, so pad by its width.
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
  }
  return () => {
    if (--locks === 0 && saved) {
      root.style.overflow = saved.overflow;
      root.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}

/** The controls inside `root` that Tab can reach right now, in order. A radio group counts once. */
function tabbables(root: HTMLElement): HTMLElement[] {
  const groups = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.closest("[inert]") || el.getClientRects().length === 0) return false;
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const checked = root.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
      if (checked ? checked !== el : groups.has(el.name)) return false;
      groups.add(el.name);
    }
    return true;
  });
}

/** True while `ref`'s content is taller than its box, so it scrolls and must be reachable by keyboard. */
function useOverflowing(ref: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);
  return overflowing;
}

export function ModalShell(props: ShellProps) {
  const { mounted, exiting } = usePresence(props.open, EXIT_MS[props.layout]);
  if (!mounted) return null;
  return <ModalSurface {...props} exiting={exiting} />;
}

const ANIMATION: Record<ModalLayout, [string, string]> = {
  dialog: ["tm-anim-dialog", "tm-anim-dialog-out"],
  drawer: ["tm-anim-drawer", "tm-anim-drawer-out"],
  sheet: ["tm-anim-sheet", "tm-anim-sheet-out"],
};

function ModalSurface({
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  closeLabel = "Close",
  className,
  layout,
  role = "dialog",
  size = "md",
  exiting,
}: ShellProps & { exiting: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const bodyScrolls = useOverflowing(bodyRef);

  // Read in event handlers, which only run after render, so they always see the latest values.
  const live = useRef({ onClose, dismissible, exiting });
  useLayoutEffect(() => {
    live.current = { onClose, dismissible, exiting };
  });
  const requestClose = (reason: CloseReason) => {
    const { onClose: close, dismissible: canClose, exiting: leaving } = live.current;
    if (canClose && !leaving) close?.(reason);
  };

  // Our own close() also fires the dialog's (async) close event: that one isn't a request to close.
  const closedByUs = useRef(false);

  // Open as a modal, focus the title, lock the page. On unmount: close, unlock, and put focus back.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    (initialFocusRef?.current ?? titleRef.current)?.focus();
    const unlock = lockScroll();
    return () => {
      closedByUs.current = true;
      if (dialog.open) dialog.close();
      unlock();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // Only on mount: a new initialFocusRef while open must not move focus again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc. A control inside that uses Esc itself (an open menu, a tooltip) stops it before it gets here.
  const escapeStopped = useRef(false);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") escapeStopped.current = true;
  };
  const onKeyUp = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") escapeStopped.current = false; // the browser's cancel (if any) came before this
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      escapeStopped.current = false;
      event.preventDefault(); // we decide, not the browser (it would close a dialog that isn't dismissible)
      requestClose("escape");
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const list = tabbables(ref.current);
    const target = trapTab(list.length, list.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    if (target !== "stay") list[target].focus();
  };
  // The browser's own close request: Esc that nobody handled, or Android's back gesture.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    const stopped = escapeStopped.current;
    escapeStopped.current = false;
    if (!stopped) requestClose("escape");
  };
  // If the browser closes it anyway (it can after repeated Esc), reopen a dialog that must stay, or report it.
  const onNativeClose = () => {
    const dialog = ref.current;
    const ours = closedByUs.current;
    closedByUs.current = false;
    if (ours || !dialog?.isConnected || dialog.open || live.current.exiting) return;
    if (live.current.dismissible) requestClose("escape");
    else dialog.showModal();
  };

  // The scrim: a click that starts and ends on the <dialog> itself, outside the panel (which fills it).
  const pressedScrim = useRef(false);
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressedScrim.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressedScrim.current && event.target === event.currentTarget) requestClose("scrim");
    pressedScrim.current = false;
  };

  // Sheets: drag the handle or the header down to close.
  const drag = useRef<{ y: number; t: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragHandlers =
    layout === "sheet" && dismissible
      ? {
          onPointerDown: (event: PointerEvent<HTMLElement>) => {
            if (event.button !== 0 || (event.target as Element).closest("button, a, input, select, textarea")) return;
            drag.current = { y: event.clientY, t: event.timeStamp, id: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          },
          onPointerMove: (event: PointerEvent<HTMLElement>) => {
            if (!drag.current || !ref.current) return;
            ref.current.style.translate = `0 ${Math.max(0, event.clientY - drag.current.y)}px`;
          },
          onPointerUp: (event: PointerEvent<HTMLElement>) => {
            const start = drag.current;
            drag.current = null;
            setDragging(false);
            const dialog = ref.current;
            if (!start || !dialog) return;
            const dragged = Math.max(0, event.clientY - start.y);
            if (sheetShouldClose(dragged, event.timeStamp - start.t, dialog.offsetHeight)) requestClose("swipe");
            else dialog.style.translate = "";
          },
          onPointerCancel: () => {
            drag.current = null;
            setDragging(false);
            if (ref.current) ref.current.style.translate = "";
          },
        }
      : {};

  const [animIn, animOut] = ANIMATION[layout];
  const classes = [
    styles.modal,
    styles[layout],
    layout === "dialog" && styles[size],
    exiting ? animOut : animIn,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog
      ref={ref}
      className={classes}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-exiting={exiting || undefined}
      data-dragging={dragging || undefined}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onCancel={onCancel}
      onClose={onNativeClose}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className={styles.panel}>
        {layout === "sheet" && <div className={styles.grab} aria-hidden="true" {...dragHandlers} />}
        <div className={styles.head} {...dragHandlers}>
          <div className={styles.headText}>
            {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className={styles.title}>
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <span className={styles.close}>
              <IconButton icon="close" label={closeLabel} onClick={() => requestClose("close-button")} />
            </span>
          )}
        </div>
        {children && (
          <div ref={bodyRef} className={styles.body} tabIndex={bodyScrolls ? 0 : undefined}>
            {children}
          </div>
        )}
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </dialog>
  );
}
