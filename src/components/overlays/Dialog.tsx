"use client";
// Dialogs (#78): web.css .w-dialog, M13, WEBAPP_SPEC "Dialogs" (16px radius, 50% scrim, focus trapped, Esc
// closes, focus returns to the trigger). On a phone they become a bottom sheet (FRONTEND_SPEC uses sheets where
// the web uses dialogs), unless phoneLayout="dialog". Every variant and state: /dev/components/overlays.
//
//   <Dialog open={open} onClose={() => setOpen(false)} title="Jack found extra work"
//     footer={<><Button variant="secondary" …>Decline</Button><Button …>Approve & pay</Button></>}>
//     …
//   </Dialog>
//
//   <ConfirmDialog open={open} title="Cancel this job?" confirmLabel="Cancel job" cancelLabel="Keep job"
//     tone="destructive" onConfirm={cancelJob} onCancel={() => setOpen(false)}>
//     It hasn’t been paid for yet, so cancelling is free.
//   </ConfirmDialog>
//
//   Session expired (B07, #108): <Dialog dismissible="close-button" …> with one “Log in again” button in the footer.
//   The × closes it; Esc and the scrim do nothing.
import { type ReactNode, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/Button";

import { Banner } from "./Banner";
import { ModalShell, type ModalProps } from "./ModalShell";

/** The phone breakpoint from tokens.css: below 600px is a phone. */
export const PHONE_QUERY = "(max-width: 599.98px)";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a phone-width screen. False on the server and while hydrating (overlays open after that anyway). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export type DialogProps = ModalProps & {
  /** Width on a computer: sm 460px, md 520px (default), lg 620px. Never wider than the screen. */
  size?: "sm" | "md" | "lg";
  /** Below 600px: "sheet" (default) slides up from the bottom; "dialog" stays a centred box. */
  phoneLayout?: "sheet" | "dialog";
  /** "alertdialog" for a decision that interrupts (confirms). <ConfirmDialog> sets it for you. */
  role?: "dialog" | "alertdialog";
};

export function Dialog({ phoneLayout = "sheet", ...props }: DialogProps) {
  const phone = useIsPhone();
  return <ModalShell {...props} layout={phone && phoneLayout === "sheet" ? "sheet" : "dialog"} />;
}

export type ConfirmDialogProps = Omit<DialogProps, "footer" | "onClose" | "role" | "dismissible"> & {
  /** What the main button says: the action itself, never “OK” or “Yes” (“Cancel job”, “Send price”). */
  confirmLabel: string;
  /** What the other button says. Default “Not now”. */
  cancelLabel?: string;
  /**
   * The main action. If it returns a promise, the button shows a spinner until it settles and the dialog can't
   * be closed meanwhile. Close it yourself (set `open` to false) when it worked; if it throws, it stays open.
   */
  onConfirm: () => unknown;
  /** Cancel, Esc, the scrim or the close button. Set `open` to false here. */
  onCancel: () => void;
  /** "destructive": the main button is the red outline (cancel, delete, log out). Default "default". */
  tone?: "default" | "destructive";
  /** Something went wrong: shown as an alert banner above the buttons, and read out at once. */
  error?: ReactNode;
};

export function ConfirmDialog({
  confirmLabel,
  cancelLabel = "Not now",
  onConfirm,
  onCancel,
  tone = "default",
  error,
  children,
  size = "sm",
  ...props
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    setBusy(true);
    try {
      await result;
    } catch {
      // The caller shows what went wrong with `error`; the dialog stays open so they can try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      {...props}
      size={size}
      role="alertdialog"
      dismissible={!busy}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={busy ? `Wait for “${confirmLabel}” to finish` : false} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "destructive" ? "destructive" : "primary"} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <Banner tone="alert" live>
          {error}
        </Banner>
      )}
    </Dialog>
  );
}
