"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Banner } from "@/components/overlays/Banner";
import { PriceBlock, formatCents } from "@/components/status/PriceBlock";
import type { AuthFailure } from "@/lib/auth/results";
import { claimPriceReveal, hasPreviousPrice, priceReadyTicks, type DeclinePriceReason, type DeclinePriceResult } from "@/lib/customer-price";
import { PAYMENT_ERROR_MESSAGES, type StartPaymentResult } from "@/lib/payments/results";
import { declineCustomerPriceAction } from "@/server/jobs/customer-price-actions";
import { startPaymentAction } from "@/server/payments/actions";
import type { CustomerJobView } from "@/server/views";
import { DeclinePriceDialog } from "./DeclinePriceDialog";
import styles from "./price-ready.module.css";

export type PriceReadyActions = {
  pay: (id: string) => Promise<StartPaymentResult | AuthFailure>;
  decline: (id: string, revision: string, reason: DeclinePriceReason | null) => Promise<DeclinePriceResult | AuthFailure>;
};
const subscribe = () => () => {};
function usePriceReveal(id: string) {
  const [decisions] = useState(() => new Map<string, boolean>());
  return useSyncExternalStore(subscribe, () => {
    if (!decisions.has(id)) {
      let play = false;
      try { play = claimPriceReveal(id, window.localStorage, window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { /* No storage, no animation. */ }
      decisions.set(id, play);
    }
    return decisions.get(id)!;
  }, () => false);
}

export function PriceReadyPanel({ job, previousPriceCents = null, online, preview, actions, onDeclined }: {
  job: CustomerJobView; previousPriceCents?: number | null; online: boolean; preview?: string; actions?: PriceReadyActions;
  /** Called once the job has closed, before the page refreshes, so the page can move focus to its new status. */
  onDeclined?: () => void;
}) {
  const router = useRouter(), session = useOptionalSessionExpired(), pending = useRef(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const reveal = usePriceReveal(job.id);
  const [dialog, setDialog] = useState(Boolean(preview?.startsWith("decline")));
  const [reason, setReason] = useState<DeclinePriceReason | null>(null);
  const [revision, setRevision] = useState(job.updatedAt);
  const [busy, setBusy] = useState<"pay" | "decline" | null>(null);
  const [payError, setPayError] = useState<string | null>(preview === "pay-error" ? PAYMENT_ERROR_MESSAGES.unavailable : null);
  const [declineError, setDeclineError] = useState(preview === "decline-error");
  const [returnFocus, setReturnFocus] = useState(false);
  const paying = busy === "pay" || preview === "paying", saving = busy === "decline" || preview === "decline-saving";
  const disabled = !online ? "You’re offline" : paying || saving;
  // A reconnect can refresh the server frame while the dialog is open. Resolve the current
  // trigger after the kit finishes closing, rather than retaining a potentially replaced node.
  useEffect(() => {
    if (!returnFocus || dialog) return;
    let frame = 0;
    const restore = () => {
      if (document.querySelector("dialog[open]")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        trigger.current?.querySelector("button")?.focus({ preventScroll: true });
        setReturnFocus(false); observer.disconnect();
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    restore();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [returnFocus, dialog]);
  async function pay() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy("pay"); setPayError(null);
    try {
      const result = await (actions?.pay ?? startPaymentAction)(job.id);
      if (session?.check(result)) return;
      if (result.ok) router.push(result.href);
      else setPayError("message" in result ? result.message : PAYMENT_ERROR_MESSAGES.unavailable);
    } catch { setPayError(PAYMENT_ERROR_MESSAGES.unavailable); }
    finally { pending.current = false; setBusy(null); }
  }
  function open() { if (!disabled) { setReason(null); setRevision(job.updatedAt); setDeclineError(false); setDialog(true); } }
  async function decline() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy("decline"); setDeclineError(false);
    try {
      const result = await (actions?.decline ?? declineCustomerPriceAction)(job.id, revision, reason);
      if (session?.check(result)) { setDialog(false); return; }
      if ("status" in result && ["declined", "changed"].includes(result.status)) {
        // This panel unmounts when the job closes, so the dialog can't hand focus back to its opener.
        if (result.status === "declined") onDeclined?.();
        setDialog(false); router.refresh();
      }
      else setDeclineError(true);
    } catch { setDeclineError(true); }
    finally { pending.current = false; setBusy(null); }
  }
  return <div className={styles.panel}>
    {hasPreviousPrice(job.priceCents, previousPriceCents) && <p className={styles.previous}><del aria-hidden="true">{formatCents(previousPriceCents!)}</del><span className={styles.srOnly}>Was {formatCents(previousPriceCents!)}, now {formatCents(job.priceCents!)}</span></p>}
    {job.priceCents !== null && <PriceBlock audience="customer" priceCents={job.priceCents} ticks={priceReadyTicks(job.category)} revealId={reveal ? `price-ready:${job.id}` : null} />}
    {payError && <Banner tone="alert" live action={<Button variant="tertiary" disabled={disabled} onClick={() => void pay()}>Try again</Button>}>{payError}</Banner>}
    <div className={styles.actions}><Button loading={paying} disabled={disabled} onClick={() => void pay()}>Accept &amp; pay</Button><span ref={trigger}><Button variant="secondary" disabled={disabled} onClick={open}>No thanks</Button></span></div>
    <p className={styles.note}>Saying no is free.</p>
    <DeclinePriceDialog open={dialog} online={online} saving={saving} failed={declineError} reason={reason} onReason={setReason} onClose={() => { if (!pending.current && !saving) { setReturnFocus(true); setDialog(false); } }} onDecline={() => void decline()} />
  </div>;
}
