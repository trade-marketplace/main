"use client";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/Button";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { PhotoViewer, type ViewerPhoto } from "@/components/media/PhotoViewer";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { Skeleton } from "@/components/feedback/Skeleton";
import { formatCents } from "@/components/status/PriceBlock";
import { Pill } from "@/components/status/Pill";
import type { CustomerExtra } from "@/lib/customer-extras";
import { TABBABLE, trapTab } from "@/lib/overlays";
import styles from "./extra-work.module.css";

export function ExtraWorkDialog({ extra, name, open, confirm, busy, online, error, photos, photosLoading, photosFailed, photoOpen, onPhotoClose, onRetryPhotos, onClose, onConfirm, onBack, onDecline, onPay }: {
  extra: CustomerExtra; name: string; open: boolean; confirm: boolean; busy: "pay" | "decline" | null; online: boolean; error: string | null;
  photos: readonly ViewerPhoto[]; photosLoading: boolean; photosFailed: boolean; photoOpen?: boolean;
  onPhotoClose: () => void; onRetryPhotos: () => void; onClose: () => void; onConfirm: () => void; onBack: () => void; onDecline: () => void; onPay: () => void;
}) {
  const disabled = !online ? "You’re offline" : Boolean(busy);
  const viewerKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewer = event.target instanceof HTMLElement ? event.target.closest('dialog[aria-label="Extra work photos"]') : null;
    if (!viewer) return;
    // Keep the inner viewer's keys away from the enclosing decision's modal handler.
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const controls = [...viewer.querySelectorAll<HTMLElement>(TABBABLE)].filter(control => control.getClientRects().length > 0);
    const target = trapTab(controls.length, controls.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    if (target !== "stay") controls[target]?.focus();
  };
  return <Dialog className={styles.dialog} open={open} onClose={onClose} dismissible={!busy} size={confirm ? "sm" : "lg"}
    eyebrow={confirm ? undefined : <Pill kind="action">Needs your OK</Pill>} title={confirm ? "Decline the extra work?" : `${name} found extra work`}
    footer={<div className={styles.footer}><div className={styles.buttons}>
      <Button variant="secondary" disabled={Boolean(busy)} onClick={confirm ? onBack : onConfirm}>{confirm ? "Go back" : "Decline"}</Button>
      <Button disabled={disabled} loading={Boolean(busy)} onClick={confirm ? onDecline : onPay}>{confirm ? "Decline" : `Approve & pay ${formatCents(extra.priceCents ?? 0)}`}</Button>
    </div>{!confirm && <p className={styles.note}>If you decline, {name} finishes the original job only.</p>}</div>}>
    <div className={styles.body} onKeyDown={viewerKeys}>
      {confirm ? <p>{name} finishes the original job only.</p> : <>
        <p className={styles.description}>{extra.description}</p>
        {photosLoading ? <div role="status" aria-label="Loading extra work photos"><Skeleton height="12.5rem" /></div> : photos.length > 0 && <PhotoGallery photos={photos} label="Extra work photos" className={styles.photos} />}
        {photosFailed && <Banner tone="alert" title="Couldn’t load the photos." action={<Button variant="tertiary" disabled={disabled} onClick={onRetryPhotos}>Try again</Button>} />}
        <div className={styles.cost}><span className={styles.note}>Extra cost · fixed · incl. GST</span><strong className={styles.amount}>+{formatCents(extra.priceCents ?? 0)}</strong></div>
      </>}
      {!online && <Banner tone="alert" title="You’re offline" live />}
      {error && <Banner tone="alert" live action={<Button variant="tertiary" disabled={disabled} onClick={confirm ? onDecline : onPay}>Try again</Button>}>{error}</Banner>}
      <PhotoViewer photos={photos} index={photoOpen ? 0 : null} onIndexChange={() => {}} onClose={onPhotoClose} label="Extra work photos" />
    </div>
  </Dialog>;
}
