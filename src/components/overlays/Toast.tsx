"use client";
// Toasts (#78): web.css .w-toast (bottom right, 360px) and components.css .tm-toast (full width on a phone),
// M14: rises in (200ms), stays 4s while a signature hairline shrinks, pauses while the pointer is over it or
// focus is in it, then goes (200ms). Screen readers hear it (role="status") without losing their place.
// One at a time: a new toast replaces the one on screen. For short confirmations: “Saved.”, “Sent.”, “Copied.”,
// with Undo where it can be undone. Errors are banners, not toasts (they mustn't disappear by themselves).
//
//   <ToastProvider> once, around the page (it draws the toast area at the end).
//   const toast = useToast();
//   toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: restore } });
//
// Never make a toast the only way to do something: it goes after 4 seconds. Undo should also be possible from
// the page (e.g. add the photo again).
import { createContext, type FocusEvent, type ReactNode, useContext, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useHoverOrFocus, usePresence, useToastTimer } from "@/lib/motion/hooks";
import { EXIT_MS } from "@/lib/motion/timings";
import { dismissToast, EMPTY_TOASTS, showToast, type ToastInput, type ToastItem } from "@/lib/overlays";

import styles from "./overlays.module.css";

export type { ToastInput } from "@/lib/overlays";

export type ToastApi = {
  /** Shows a toast (replacing any on screen) and returns its id. */
  show: (toast: ToastInput) => number;
  /** Hides that toast now, if it's still the one showing. */
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** The toast functions. Needs a <ToastProvider> above it. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() needs a <ToastProvider> around it.");
  return api;
}

export type ToastProviderProps = {
  children: ReactNode;
  /** Show this toast when the page loads (previews, and “You’re in.” after sign-up). */
  initial?: ToastInput;
};

export function ToastProvider({ children, initial }: ToastProviderProps) {
  const [state, setState] = useState(() => (initial ? showToast(EMPTY_TOASTS, initial) : EMPTY_TOASTS));
  // `show` hands back the new id straight away, so keep the next id outside React's batching.
  const nextId = useRef(state.nextId);
  const [api] = useState<ToastApi>(() => ({
    show: (toast) => {
      const id = nextId.current++;
      setState((s) => showToast({ ...s, nextId: id }, toast));
      return id;
    },
    dismiss: (id) => setState((s) => dismissToast(s, id)),
  }));

  return (
    <ToastContext value={api}>
      {children}
      <ToastRegion current={state.current} onDismiss={api.dismiss} />
    </ToastContext>
  );
}

/**
 * The live region is always on the page, so screen readers are already listening when a toast arrives.
 * The last toast stays drawn while it animates out.
 */
function ToastRegion({ current, onDismiss }: { current: ToastItem | null; onDismiss: (id: number) => void }) {
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const { mounted, exiting } = usePresence(Boolean(current), EXIT_MS.toast);
  const shown = current ?? (mounted ? last : null);

  return (
    <div className={styles.toastRegion} role="status">
      {shown && <Toast key={shown.id} toast={shown} exiting={exiting} onDismiss={onDismiss} />}
    </div>
  );
}

function Toast({ toast, exiting, onDismiss }: { toast: ToastItem; exiting: boolean; onDismiss: (id: number) => void }) {
  const hover = useHoverOrFocus();
  const ref = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  useToastTimer(() => onDismiss(toast.id), { active: !exiting, paused: hover.active, runKey: toast.id });

  // Someone who Tabbed into the toast mustn't be left on nothing when it goes: send them back where they were.
  const leave = () => {
    if (ref.current?.contains(document.activeElement) && cameFrom.current?.isConnected) cameFrom.current.focus();
    onDismiss(toast.id);
  };

  return (
    <div
      ref={ref}
      className={`${styles.toast} ${exiting ? "tm-anim-toast-out" : "tm-anim-toast"}`}
      data-paused={hover.active ? "true" : "false"}
      {...hover.handlers}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        hover.handlers.onFocus();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          cameFrom.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") leave();
      }}
    >
      <Icon name={toast.icon ?? "check_circle"} fill decorative className={styles.toastIcon} />
      <p className={styles.toastMessage}>{toast.message}</p>
      {toast.action && (
        <Button
          variant="tertiary"
          className={styles.toastAction}
          onClick={() => {
            toast.action?.onAction();
            leave();
          }}
        >
          {toast.action.label}
        </Button>
      )}
      {!exiting && <span className="tm-toast-timer" aria-hidden="true" />}
    </div>
  );
}
