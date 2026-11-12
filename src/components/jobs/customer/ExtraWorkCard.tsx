"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { formatCents } from "@/components/status/PriceBlock";
import type { ViewerPhoto } from "@/components/media/PhotoViewer";
import { claimExtraDialog, type CustomerExtra } from "@/lib/customer-extras";
import { approveVariationAction, declineVariationAction, variationPhotoUrlsAction } from "@/server/variations/actions";
import { ExtraWorkDialog } from "./ExtraWorkDialog";
import styles from "./extra-work.module.css";

type Decision = { ok: true; href?: string } | { ok: false; error: string; message?: string };
export type ExtraWorkActions = {
  approve: (id: string, revision: number) => Promise<Decision>;
  decline: (id: string, revision: number) => Promise<Decision>;
  photos: (id: string) => Promise<readonly { url: string }[] | { ok: false; error: string }>;
};
type Props = { extras: readonly CustomerExtra[]; name: string; online: boolean; failed?: boolean; preview?: string; actions?: ExtraWorkActions };

export function ExtraWorkCard(props: Props) {
  return <ToastProvider initial={props.preview === "declined" ? { message: `Declined. ${props.name}’s been told.` } : undefined}><ExtraWorkList {...props} /></ToastProvider>;
}

function ExtraWorkList({ extras, name, online, failed, preview, actions }: Props) {
  const router = useRouter();
  const [changed, setChanged] = useState(preview === "changed");
  if (preview === "loading") return <div className={styles.card} role="status" aria-label="Loading extra work" aria-busy="true"><Skeleton width="60%" /><SkeletonText lines={2} /><Skeleton height="3rem" /></div>;
  if (failed || preview === "error") return <Banner tone="alert" title="Couldn’t load the extra work." action={<Button variant="tertiary" disabled={!online ? "You’re offline" : false} onClick={() => router.refresh()}>Try again</Button>} />;
  return <div className={styles.list}>{changed && <Banner tone="info" live>The extra work changed. Have another look.</Banner>}{extras.map(extra => <ExtraWorkItem key={`${extra.id}:${extra.revision}`} extra={extra} name={name} online={online} preview={preview} actions={actions} automatic={extra.id === extras.find(item => item.status === "PRICED")?.id} onChanged={() => setChanged(true)} />)}</div>;
}

function ExtraWorkItem({ extra, name, online, preview, actions, automatic, onChanged }: Omit<Props, "extras" | "failed"> & { extra: CustomerExtra; automatic: boolean; onChanged: () => void }) {
  const router = useRouter(), session = useOptionalSessionExpired(), toast = useToast();
  const [open, setOpen] = useState(Boolean(preview && ["dialog", "photo-open", "decline-confirm", "declining", "paying", "pay-error", "offline"].includes(preview)));
  const [confirm, setConfirm] = useState(preview === "decline-confirm" || preview === "declining");
  const [busy, setBusy] = useState<"pay" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(preview === "pay-error" ? "Couldn’t start the payment. Try again." : null);
  const [declined, setDeclined] = useState(false);
  const [photos, setPhotos] = useState<ViewerPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false), [photosFailed, setPhotosFailed] = useState(false);
  const [photoAttempt, setPhotoAttempt] = useState(0);
  const [photoOpen, setPhotoOpen] = useState(preview === "photo-open");
  const seen = useRef(false), pending = useRef(false), mounted = useRef(true), photoRequest = useRef(0);
  const trigger = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const saving = busy ?? (preview === "paying" ? "pay" : preview === "declining" ? "decline" : null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (preview || !automatic || extra.status !== "PRICED" || seen.current) return;
    const frame = requestAnimationFrame(() => {
      seen.current = true;
      let show = true;
      try { show = claimExtraDialog(extra.id, extra.revision, window.sessionStorage); } catch { /* Storage may be disabled. */ }
      if (show) setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [extra.id, extra.revision, extra.status, preview, automatic]);

  // Fetch fresh signed URLs every time the dialog opens, with late responses isolated from a new request.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const request = ++photoRequest.current;
    const frame = requestAnimationFrame(() => {
      setPhotosLoading(true); setPhotosFailed(false);
      void (actions?.photos ?? variationPhotoUrlsAction)(extra.id).then(result => {
        if (cancelled || request !== photoRequest.current) return;
        if (!Array.isArray(result)) { setPhotosFailed(true); return; }
        setPhotos(result.map((photo, index) => ({ src: photo.url, alt: `Extra work · ${index + 1}` })));
        setPhotosFailed(result.length < extra.photoCount);
      }).catch(() => { if (!cancelled) setPhotosFailed(true); }).finally(() => { if (!cancelled) setPhotosLoading(false); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [open, extra.id, extra.photoCount, actions, photoAttempt]);

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    let frame = 0;
    const restore = () => {
      if (document.querySelector("dialog[open]")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { (trigger.current?.querySelector("button") ?? root.current?.querySelector("h2"))?.focus({ preventScroll: true }); restoreFocus.current = false; observer.disconnect(); });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    restore();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open]);

  function close() { if (!pending.current && !saving) { restoreFocus.current = true; setOpen(false); setPhotoOpen(false); } }
  function look() { if (online && !saving) { setConfirm(false); setError(null); setOpen(true); } }
  async function decide(kind: "pay" | "decline") {
    if (pending.current || !online || saving) return;
    pending.current = true; setBusy(kind); setError(null);
    try {
      const result = await (kind === "pay" ? actions?.approve ?? approveVariationAction : actions?.decline ?? declineVariationAction)(extra.id, extra.revision);
      if (!mounted.current) return;
      if (session?.check(result)) { setOpen(false); return; }
      if (result.ok) {
        if (kind === "pay" && "href" in result && result.href) router.push(result.href);
        else if (kind === "decline") { restoreFocus.current = true; setOpen(false); setDeclined(true); toast.show({ message: `Declined. ${name}’s been told.` }); router.refresh(); }
      } else if (result.error === "changed" || result.error === "not-payable") { setOpen(false); onChanged(); router.refresh(); }
      else setError("message" in result && result.message ? result.message : kind === "pay" ? "Couldn’t start the payment. Try again." : "Couldn’t decline the extra work. Try again.");
    } catch { if (mounted.current) setError(kind === "pay" ? "Couldn’t start the payment. Try again." : "Couldn’t decline the extra work. Try again."); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  const status = declined ? "DECLINED" : extra.status;
  return <section ref={root} className={styles.card} aria-label="Extra work">
    {status === "REQUESTED" ? <p>{name} asked for extra work. We’re pricing it.</p> : status === "DECLINED" ? <h2 tabIndex={-1} className={styles.heading}>Extra work declined.</h2> : status === "APPROVED" ? <h2 className={styles.heading}>Extra work approved · +{formatCents(extra.priceCents ?? 0)}</h2> : <>
      <h2 className={styles.heading}>Needs your OK</h2><p>{name} found extra work.</p>
      <span ref={trigger}><Button disabled={!online ? "You’re offline" : Boolean(saving)} onClick={look}>Have a look</Button></span>
    </>}
    {status === "PRICED" && <ExtraWorkDialog extra={extra} name={name} open={open} confirm={confirm} busy={saving} online={online} error={error} photos={photos} photosLoading={photosLoading} photosFailed={photosFailed} photoOpen={photoOpen}
      onPhotoClose={() => setPhotoOpen(false)} onRetryPhotos={() => setPhotoAttempt(value => value + 1)} onClose={close} onConfirm={() => setConfirm(true)} onBack={() => setConfirm(false)} onDecline={() => void decide("decline")} onPay={() => void decide("pay")} />}
  </section>;
}
