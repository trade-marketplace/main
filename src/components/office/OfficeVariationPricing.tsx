"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { ErrorState } from "@/components/feedback/ErrorState";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { MoneyField, TextField } from "@/components/forms/TextFields";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { Pill } from "@/components/status/Pill";
import { inputKey, type PriceFields, type PricingPreview } from "@/lib/office-pricing";
import { EXTRA_WORK_QUEUE, VARIATION_PRICING_MESSAGES, VARIATION_STATUS_LABELS, type VariationPreviewResult, type VariationPricingData, type VariationPricingFailure, type VariationPublishResult } from "@/lib/office-variation";
import styles from "./pricing.module.css";
import variationStyles from "./variation-pricing.module.css";

export type OfficeVariationPricingProps = {
  data: VariationPricingData | null; back?: string;
  preview: (input: unknown) => Promise<VariationPreviewResult>;
  publish: (input: unknown) => Promise<VariationPublishResult>;
  loading?: boolean; offline?: boolean; initialConfirm?: boolean; initialSent?: boolean; initialChanged?: boolean; initialFailure?: string;
};
const errorMessage = (failure: VariationPricingFailure) => failure.message ?? VARIATION_PRICING_MESSAGES[failure.error];
type Confirmation = { preview: PricingPreview; revision: number; fields: PriceFields; requestId: string };

export function OfficeVariationPricing({ data, back = EXTRA_WORK_QUEUE, preview, publish, loading = false, offline = false, initialConfirm = false, initialSent = false, initialChanged = false, initialFailure }: OfficeVariationPricingProps) {
  const router = useRouter(), session = useOptionalSessionExpired(), browserOnline = useOnlineStatus(), online = browserOnline && !offline;
  const [fields, setFields] = useState<PriceFields>(() => data?.fields ?? { hours: "", materials: "0.00" });
  const [revision, setRevision] = useState(data?.revision ?? 0), [baseToken, setBaseToken] = useState(data?.preview?.token);
  const [price, setPrice] = useState<PricingPreview | null>(() => data?.preview ?? null), [calculating, setCalculating] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof PriceFields, string>>>({});
  const [failure, setFailure] = useState<string | null>(initialFailure ?? null), [changed, setChanged] = useState(initialChanged);
  const [busy, setBusy] = useState(false), pending = useRef(false), [refreshing, startRefresh] = useTransition();
  const [sent, setSent] = useState(initialSent), successHeading = useRef<HTMLHeadingElement>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(() => initialConfirm && data?.preview ? { preview: data.preview, revision: data.revision, fields: data.fields, requestId: "00000000-0000-4000-8000-000000000001" } : null);
  const [retry, setRetry] = useState(0);
  const currentKey = inputKey(fields);
  const stale = changed || (!!data && (data.revision !== revision || data.preview?.token !== baseToken));
  const canEdit = !!data?.canPrice && !stale;
  const ready = canEdit && online && !calculating && !!price && price.inputKey === currentKey;
  useEffect(() => {
    if (!sent || initialSent) return;
    const frame = requestAnimationFrame(() => successHeading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [sent, initialSent]);
  useEffect(() => {
    if (!data || !canEdit || !online || sent || (price?.inputKey === currentKey && !retry)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCalculating(true); setErrors({});
      try {
        const result = await preview({ variationId: data.id, revision, ...fields });
        if (cancelled) return;
        if (session?.check(result, { resend: () => setRetry(value => value + 1) })) return;
        if (result.ok) { setPrice(result.preview); setFailure(null); }
        else {
          setPrice(null);
          if (result.field) setErrors({ [result.field]: errorMessage(result) });
          else { setFailure(errorMessage(result)); if (result.error === "changed" || result.error === "not-in-progress") { setChanged(true); startRefresh(() => router.refresh()); } }
        }
      } catch { if (!cancelled) { setPrice(null); setFailure("Can’t calculate this price. Try again."); } }
      finally { if (!cancelled) setCalculating(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); setCalculating(false); };
    // Inputs and the captured server revision define this request; action functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, data?.id, canEdit, online, revision, sent, retry]);
  function reload() {
    if (!data || refreshing || busy) return;
    setRevision(data.revision); setBaseToken(data.preview?.token); setFields(data.fields); setPrice(data.preview);
    setChanged(false); setFailure(null); setErrors({}); setCalculating(false); setRetry(0);
  }
  function confirm() {
    if (!data || !price || !ready || pending.current) return;
    setFailure(null); setConfirmation({ preview: price, revision, fields: { ...fields }, requestId: crypto.randomUUID() });
  }
  async function send() {
    if (!data || !confirmation || pending.current || !online) return;
    pending.current = true; setBusy(true); setFailure(null);
    try {
      const result = await publish({ variationId: data.id, revision: confirmation.revision, ...confirmation.fields, token: confirmation.preview.token, requestId: confirmation.requestId });
      if (session?.check(result, { resend: send })) return;
      if (result.ok) { setConfirmation(null); setSent(true); startRefresh(() => router.refresh()); }
      else {
        setFailure(errorMessage(result));
        if (result.error === "changed" || result.error === "not-in-progress") { setConfirmation(null); setChanged(true); setPrice(null); startRefresh(() => router.refresh()); }
      }
    } catch { setFailure(VARIATION_PRICING_MESSAGES.unavailable); }
    finally { pending.current = false; setBusy(false); }
  }
  const update = (key: keyof PriceFields, value: string) => { if (pending.current) return; setFields(current => ({ ...current, [key]: value })); setErrors({}); setFailure(null); };
  if (loading) return <div className={styles.page} aria-busy="true" aria-label="Loading pricing workspace"><h1 className={styles.title}>Price extra work</h1><Skeleton width="50%" height="2.5rem" /><div className={styles.grid}><Skeleton height="24rem" /><Skeleton height="24rem" /></div></div>;
  if (!data) return <ErrorState title="Can’t load this extra work" headingLevel={1} onRetry={() => router.refresh()} />;
  const display = data.canPrice ? price?.inputKey === currentKey ? price : null : data.preview;
  return <div className={styles.page}>
    <OfflineBanner online={offline ? false : undefined} sticky={false} className={variationStyles.notice} onRetry={() => { setRetry(value => value + 1); startRefresh(() => router.refresh()); }} />
    <nav className={styles.crumbs} aria-label="Breadcrumb"><Link href="/admin">Queues</Link><Icon name="chevron_right" size="sm" decorative /><Link href={back}>Extra work</Link><Icon name="chevron_right" size="sm" decorative /><span aria-current="page">{data.number}</span></nav>
    {sent ? <section className={styles.card}><h1 ref={successHeading} tabIndex={-1}>Price sent to customer</h1><p>{data.description}</p><p>The customer has been notified.</p><Button href={back} width="auto">Back to queues</Button></section> : <>
      <header><h1 className={styles.title}>Price extra work</h1><p className={styles.sub}>{data.title} · {data.trade} · {data.suburb}</p></header>
      {stale && <Banner className={variationStyles.notice} tone="info" title="Extra work changed" live>Check the latest breakdown before sending. <Button variant="secondary" size="sm" width="auto" disabled={refreshing || busy} onClick={reload}>Reload latest</Button></Banner>}
      {failure && !confirmation && <Banner className={variationStyles.notice} tone="alert" live>{failure} {!stale && <Button variant="tertiary" onClick={() => { setFailure(null); setPrice(null); setRetry(value => value + 1); }}>Try again</Button>}</Banner>}
      {!data.canPrice && <Banner className={variationStyles.notice} tone="info">This workspace is read-only.</Banner>}
      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="request-title"><div><Pill kind={data.status === "APPROVED" ? "good" : data.status === "DECLINED" ? "waiting" : "action"}>{VARIATION_STATUS_LABELS[data.status]}</Pill></div><h2 id="request-title">Tradie request</h2><p className={styles.description}>{data.description}</p><p className={styles.muted}>{data.requester}</p>
          <dl className={variationStyles.request}><div><dt>Hours</dt><dd>{data.requestedHours}</dd></div><div><dt>Materials</dt><dd>{data.requestedMaterials}</dd></div></dl>
          {data.photos.length > 0 && <PhotoGallery photos={data.photos} />}
          {data.photosFailed ? <Banner className={variationStyles.notice} tone="alert">Can’t load photos. <Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button></Banner> : data.photos.length === 0 && <p className={styles.muted}>No photos yet.</p>}
        </section>
        <section className={`${styles.card} ${styles.builder}`} aria-labelledby="price-title"><h2 id="price-title">Set the price</h2>
          <TextField label="Hours" value={data.canPrice ? fields.hours : data.fields.hours} maxLength={12} inputMode="decimal" disabled={!canEdit || busy} error={errors.hours} onChange={event => update("hours", event.target.value)} />
          <MoneyField label="Materials" value={data.canPrice ? fields.materials : data.fields.materials} maxLength={16} hint="At cost, ex GST" disabled={!canEdit || busy} error={errors.materials} onChange={event => update("materials", event.target.value)} />
          <div className={styles.breakdown} role="region" aria-label="Price breakdown" aria-live="polite" aria-busy={calculating}>{calculating ? <Skeleton height="10rem" /> : display ? <VariationBreakdown price={display} /> : <p>{data.canPrice ? "Enter hours and materials to see the price." : "No price has been saved."}</p>}</div>
          {data.canPrice && <Button loading={busy} disabled={!online ? "You’re offline" : !ready ? "Check the hours and materials" : false} onClick={confirm}>Send price to customer</Button>}
          {!data.canPrice && <Button variant="secondary" href={back} width="auto">Back to queues</Button>}
          <p className={styles.muted}>Uses the job’s saved rates.</p>
        </section>
      </div>
    </>}
    {confirmation && !sent && <Dialog open title="Send price to customer" role="alertdialog" dismissible={!busy} onClose={() => { if (!pending.current) { setConfirmation(null); setFailure(null); } }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Not now</Button><Button loading={busy} disabled={!online} onClick={() => void send()}>Send price to customer</Button></>}>
      <p>This is what the customer will see.</p><div className={styles.customer}><h3>{confirmation.preview.customer.title}</h3><p>{confirmation.preview.customer.suburb}</p><dl><div><dt>Fixed price (incl GST)</dt><dd>{confirmation.preview.customer.total}</dd></div><div><dt>GST included</dt><dd>{confirmation.preview.customer.gst}</dd></div></dl></div>
      {!online && <Banner tone="alert" className={variationStyles.notice}>You’re offline.</Banner>}{failure && <Banner tone="alert" className={variationStyles.notice} live>{failure}</Banner>}
    </Dialog>}
  </div>;
}
function VariationBreakdown({ price }: { price: PricingPreview }) {
  return <dl className={styles.lines}><div><dt>Fixed price (ex GST)</dt><dd>{price.exGst}</dd></div><div><dt>{price.gstLabel}</dt><dd>{price.gst}</dd></div><div className={styles.total}><dt>Customer pays</dt><dd>{price.total}</dd></div><div><dt>Tradie earns</dt><dd>{price.workerEarns}</dd></div><div><dt>Materials budget</dt><dd>{price.materials}</dd></div><div><dt>Margin</dt><dd>{price.margin}</dd></div></dl>;
}
