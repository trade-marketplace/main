"use client";
import { useId } from "react";
import { Button } from "@/components/Button";
import { RadioGroup } from "@/components/forms/ChoiceFields";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { DECLINE_PRICE_REASONS, type DeclinePriceReason } from "@/lib/customer-price";
import styles from "./price-ready.module.css";

export function DeclinePriceDialog({ open, online, saving, failed, reason, onReason, onClose, onDecline }: {
  open: boolean; online: boolean; saving: boolean; failed: boolean; reason: DeclinePriceReason | null;
  onReason: (reason: DeclinePriceReason) => void; onClose: () => void; onDecline: () => void;
}) {
  const name = useId();
  return <Dialog open={open} title="No worries." onClose={onClose} dismissible={!saving} size="sm" phoneLayout="dialog"
    footer={<div className={styles.footer}><div className={styles.buttons}><Button variant="secondary" disabled={saving} onClick={onClose}>Go back</Button><Button loading={saving} disabled={!online ? "You’re offline" : saving} onClick={onDecline}>No thanks</Button></div><p className={styles.note}>Saying no is free.</p></div>}>
    <div className={styles.body}>
      <RadioGroup label="Want to tell us why? (optional)" name={name} options={DECLINE_PRICE_REASONS.map(value => ({ value, label: value }))} value={reason ?? ""} onChange={value => onReason(value as DeclinePriceReason)} disabled={saving} />
      {!online && <Banner tone="alert" title="You’re offline" live />}
      {failed && <Banner tone="alert" title="Couldn’t cancel the job." live action={<Button variant="tertiary" disabled={!online ? "You’re offline" : saving} onClick={onDecline}>Try again</Button>} />}
    </div>
  </Dialog>;
}
