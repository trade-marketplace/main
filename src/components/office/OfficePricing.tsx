"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { DataTable, TableItem, type Column } from "@/components/data";
import { EmptyState, ErrorState, LiveMessage, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { MoneyField, TextAreaField, TextField } from "@/components/forms";
import { Icon } from "@/components/Icon";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { Banner, Dialog } from "@/components/overlays";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { inputKey, PRICING_MESSAGES, type PriceFields, type PreviewResult, type PricingEstimate, type PricingFailure, type PricingPreview, type PricingWorkspace, type PublishResult } from "@/lib/office-pricing";
import styles from "./pricing.module.css";

type Preview = (input: unknown) => Promise<PreviewResult>;
type Submit = (input: unknown) => Promise<PublishResult>;
export type OfficePricingProps = { data: PricingWorkspace | null; preview: Preview; publish: Submit; requestPhotos: Submit; loading?: boolean; offline?: boolean; initialDialog?: "confirm" | "photos" | "visit"; initialError?: string; initialSent?: boolean; initialErrors?: Partial<Record<keyof PriceFields, string>> };
const message = (result: PricingFailure) => result.message ?? PRICING_MESSAGES[result.error];
export function OfficePricing({ data, preview, publish, requestPhotos, loading = false, offline = false, initialDialog, initialError, initialSent = false, initialErrors }: OfficePricingProps) {
  const router = useRouter(), sessionExpired = useOptionalSessionExpired(), browserOnline = useOnlineStatus(), online = browserOnline && !offline;
  const [fields, setFields] = useState<PriceFields>(() => data?.fields ?? { hours: "", materials: "0.00" });
  const [price, setPrice] = useState<PricingPreview | null>(() => data?.preview ?? null), [calculating, setCalculating] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof PriceFields, string>>>({}), [failure, setFailure] = useState<string | null>(initialError ?? null);
  const [dialog, setDialog] = useState(initialDialog ?? null), [confirmation, setConfirmation] = useState(initialDialog === "confirm" ? data?.preview ?? null : null);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(initialSent), [done, setDone] = useState<string | null>(null), [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(""), [retry, setRetry] = useState(0);
  const currentKey = inputKey(fields), priceReady = !!price && price.inputKey === currentKey && !calculating && !!data?.canPrice && online;
  useEffect(() => {
    let cancelled = false;
    if (!data?.canPrice || !online || sent || !fields.hours.trim()) return;
    if (initialErrors && currentKey === inputKey(data.fields)) return;
    if (price?.inputKey === currentKey && price.token === data.preview?.token) return;
    const timer = setTimeout(async () => {
      setCalculating(true); setErrors({});
      try {
        const result = await preview({ jobId: data.id, ...fields });
        if (cancelled) return;
        if (sessionExpired?.check(result, { resend: () => { setPrice(null); setRetry(value => value + 1); } })) return;
        if (result.ok) { setPrice(result.preview); setFailure(null); }
        else { setPrice(null); if (result.field === "hours" || result.field === "materials") setErrors({ [result.field]: message(result) }); else setFailure(message(result)); }
      } catch { if (!cancelled) { setPrice(null); setFailure("Can’t calculate this price. Try again."); } }
      finally { if (!cancelled) setCalculating(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); setCalculating(false); };
    // Server actions and the initial server token are stable. Only current input/version may enable sending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, online, data?.id, data?.canPrice, data?.preview?.token, sent, retry]);
  const open = (name: "confirm" | "photos" | "visit") => {
    if (busy || !online) return;
    setFailure(null); setRequestId(crypto.randomUUID());
    if (name === "confirm") { if (!priceReady) return; setConfirmation(price); }
    setDialog(name);
  };
  const send = async () => {
    if (!data || !confirmation || !online || busy) return;
    setBusy(true); setFailure(null);
    try {
      const result = await publish({ jobId: data.id, ...fields, token: confirmation.token, requestId });
      if (sessionExpired?.check(result, { resend: send })) return;
      if (result.ok) { setSent(true); setDialog(null); router.refresh(); }
      else { setFailure(message(result)); if (result.error === "changed" || result.error === "frozen") { setDialog(null); setPrice(null); router.refresh(); } }
    } catch { setFailure(PRICING_MESSAGES.unavailable); }
    finally { setBusy(false); }
  };
  const ask = async () => {
    if (!data || !online || busy || !body.trim()) return;
    setBusy(true); setFailure(null);
    try {
      const result = await requestPhotos({ jobId: data.id, body, requestId });
      if (sessionExpired?.check(result, { resend: ask })) return;
      if (result.ok) { setDialog(null); setBody(""); setDone("Message sent."); }
      else setFailure(message(result));
    } catch { setFailure(PRICING_MESSAGES.unavailable); }
    finally { setBusy(false); }
  };
  const displayedErrors = initialErrors && data && currentKey === inputKey(data.fields) ? initialErrors : errors;
  const displayedFields = data?.canPrice ? fields : data?.fields ?? fields;
  const displayPrice = data?.canPrice ? price?.inputKey === currentKey ? price : null : data?.preview;
  const columns: Column<PricingEstimate>[] = [
    { key: "tradie", header: "Tradie", primary: true, cell: row => <TableItem title={row.name} meta={row.stale ? "Made before the job was edited" : row.needsSiteVisit ? "Needs a site visit" : undefined} /> },
    { key: "record", header: "Track record", cell: row => row.record },
    { key: "hours", header: "Hours", cell: row => row.hours }, { key: "materials", header: "Materials", cell: row => row.materials },
    { key: "note", header: "Note", cell: row => row.note ?? "—" },
  ];
  if (loading) return <div className={styles.page} aria-busy="true" aria-label="Loading pricing workspace"><h1 className={styles.title}>Price a job</h1><Skeleton width="50%" height="2.5rem" /><div className={styles.grid}><Skeleton height="24rem" /><Skeleton height="24rem" /></div></div>;
  if (!data) return <ErrorState title="Can’t load this job" onRetry={() => router.refresh()} headingLevel={1} />;
  return <div className={styles.page}>
    <OfflineBanner online={offline ? false : undefined} sticky={false} onRetry={() => router.refresh()} />
    <nav className={styles.crumbs} aria-label="Breadcrumb"><Link href="/admin">Queues</Link><Icon name="chevron_right" size="sm" decorative /><Link href="/admin">To price</Link><Icon name="chevron_right" size="sm" decorative /><Link href={`/admin/jobs/${data.id}`}>{data.number}</Link></nav>
    {sent ? <section className={styles.card}><h1>Price sent to customer</h1><p>{data.title}</p><p>The customer has been notified.</p><Button href="/admin" width="auto">Back to queues</Button></section> : <>
      <header><h1 className={styles.title}>{data.title}</h1><p className={styles.sub}><span className={styles.desktopWords}>{data.trade} · {data.suburb} · posted {data.posted} ago</span><span className={styles.phoneWords}>{data.number} · {data.trade} · {data.suburb}</span></p></header>
      {failure && !dialog && <Banner tone="alert" live>{failure} <Button variant="tertiary" onClick={() => { setFailure(null); setPrice(null); setRetry(value => value + 1); router.refresh(); }}>Try again</Button></Banner>}
      {done && <Banner tone="good" live onDismiss={() => setDone(null)}>{done}</Banner>}<LiveMessage message={done} />
      {!data.canPrice && <Banner tone="info">{data.preview ? "This job’s price is saved. This workspace is read-only." : "This job can’t be priced here. This workspace is read-only."}</Banner>}
      <div className={styles.grid}>
        <div className={styles.evidence}>
          <section className={styles.card} aria-label="Job details"><p className={styles.description}>{data.description}</p>{data.asap && <p>ASAP</p>}{data.accessNotes && <p>{data.accessNotes}</p>}
            {data.photos.length > 0 && <PhotoGallery photos={data.photos} />}
            {data.photosFailed ? <Banner tone="alert">Can’t load photos. <Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button></Banner> : data.photos.length === 0 && <p className={styles.muted}>No photos yet.</p>}
            {data.canPrice && <Button variant="secondary" size="sm" width="auto" disabled={!online ? "You’re offline" : false} onClick={() => open("photos")}>Ask for more photos</Button>}
          </section>
          <section className={styles.estimates} aria-labelledby="estimates-title"><h2 id="estimates-title">Blind estimates ({data.estimates.length})</h2>
            <DataTable caption="Blind quotes" columns={columns} rows={data.estimates} rowId={row => row.id} rowLabel={row => row.name} empty={<EmptyState icon="pending" title="No quotes yet" message={data.noEstimatesAfterDay ? "It’s been over 24 hours. The office can price this from the photos." : "The office can price this from the photos."} />} />
            {data.suggestion && <div className={styles.stats}><Icon name="analytics" decorative /><div><p><strong>{data.trimmed ? <><span className={styles.desktopWords}>Trimmed average (drop highest + lowest):</span><span className={styles.phoneWords}>Trimmed average (drop high + low):</span></> : "Average:"}</strong> {data.suggestion}</p><p><strong>Spread:</strong> {data.spread}</p><p>Review the spread. If photos aren’t enough, consider a quick look.</p></div></div>}
            {data.siteVisitRequested && <Banner tone="info" icon="visibility">Needs a site visit</Banner>}
          </section>
        </div>
        <section className={`${styles.card} ${styles.builder}`} aria-labelledby="price-title"><h2 id="price-title">Set the price</h2>
          <TextField label="Hours" value={displayedFields.hours} inputMode="decimal" maxLength={12} error={displayedErrors.hours} disabled={!data.canPrice || busy} onChange={event => setFields(current => ({ ...current, hours: event.target.value }))} />
          <MoneyField label="Materials" value={displayedFields.materials} maxLength={16} hint="At cost, ex GST" error={displayedErrors.materials} disabled={!data.canPrice || busy} onChange={event => setFields(current => ({ ...current, materials: event.target.value }))} />
          <div role="region" aria-label="Price breakdown" aria-live="polite" aria-busy={calculating} className={styles.breakdown}>{calculating ? <Skeleton height="10rem" /> : displayPrice ? <Breakdown price={displayPrice} /> : <p>{data.canPrice ? "Enter hours and materials to see the price." : "No price has been saved."}</p>}</div>
          {data.canPrice && <><Button disabled={!online ? "You’re offline" : !priceReady ? "Check the hours and materials" : false} onClick={() => open("confirm")}>Send price to customer</Button><Button variant="secondary" disabled={!online ? "You’re offline" : false} onClick={() => open("visit")}>Needs a site visit</Button></>}
          <p className={styles.muted}><span className={styles.desktopWords}>Calculated on the server from Settings.</span><span className={styles.phoneWords}>Uses the rates in Settings. Calculated on the server.</span> Priced jobs keep their rates.</p>
        </section>
      </div>
    </>}
    {dialog === "confirm" && confirmation && <Dialog open title="Send price to customer" role="alertdialog" dismissible={!busy} onClose={() => setDialog(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDialog(null)}>Not now</Button><Button loading={busy} disabled={!online ? "You’re offline" : false} onClick={send}>Send price to customer</Button></>}>
      <p>This is what the customer will see.</p><div className={styles.customer}><h3>{confirmation.customer.title}</h3><p>{confirmation.customer.suburb}</p><dl><div><dt>Fixed price (incl GST)</dt><dd>{confirmation.customer.total}</dd></div><div><dt>GST included</dt><dd>{confirmation.customer.gst}</dd></div></dl></div>{failure && <Banner tone="alert" live>{failure}</Banner>}
    </Dialog>}
    {dialog === "photos" && <Dialog open title="Ask for more photos" dismissible={!busy} onClose={() => setDialog(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDialog(null)}>Not now</Button><Button loading={busy} disabled={!online ? "You’re offline" : !body.trim() ? "Write a message first" : false} onClick={ask}>Send message</Button></>}><p>Shared with the customer, assigned tradie and office.</p><TextAreaField label="Message to customer" maxLength={2000} value={body} onChange={event => setBody(event.target.value)} />{failure && <Banner tone="alert" live>{failure}</Banner>}</Dialog>}
    {dialog === "visit" && <Dialog open title="Needs a site visit" onClose={() => setDialog(null)} footer={<Button disabled={!online ? "You’re offline" : false} onClick={() => open("photos")}>Ask for more photos</Button>}><p>Paid quick looks are coming soon. Ask the customer for more photos while the office reviews the job.</p></Dialog>}
  </div>;
}
function Breakdown({ price }: { price: PricingPreview }) {
  return <><dl className={styles.lines}><div><dt>Fixed price (ex GST)</dt><dd>{price.exGst}</dd></div><div><dt>{price.gstLabel}</dt><dd>{price.gst}</dd></div><div className={styles.total}><dt>Customer pays</dt><dd>{price.total}</dd></div><div><dt>Tradie earns</dt><dd>{price.workerEarns}</dd></div><div><dt>Materials budget</dt><dd>{price.materials}</dd></div><div><dt>Margin</dt><dd>{price.margin}</dd></div></dl>{price.minimum && <p className={styles.muted}>{price.minimum}</p>}</>;
}
