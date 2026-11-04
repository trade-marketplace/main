"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { BoltFlash } from "@/components/motion/BoltFlash";
import { Banner } from "@/components/overlays/Banner";
import { Drawer } from "@/components/overlays/Drawer";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { tradeLabel } from "@/lib/account/trades";
import type { AuthFailure } from "@/lib/auth/results";
import { estimateFields, workerEstimateSchema, type EstimateFields, type EstimateResult } from "@/lib/worker-estimate";
import { saveWorkerEstimateAction } from "@/server/jobs/worker-estimate-actions";
import type { WorkerJobView } from "@/server/views";
import type { EligibilityFailure } from "@/server/workers/eligibility";
import { PointsChip, WorkerEstimateFields, WorkerEstimateNotice, WorkerEstimateSummary } from "./WorkerEstimateParts";
import { QUOTE_POINTS } from "@/lib/points";
import styles from "./worker-estimate.module.css";

type Props = {
  job: Pick<WorkerJobView, "title" | "suburb" | "city">;
  details?: WorkerJobView; back: string; failure?: EligibilityFailure | null;
  photos?: { src: string; alt: string }[]; photosFailed?: boolean; preview?: string;
  save?: (id: string, input: EstimateFields) => Promise<EstimateResult | AuthFailure>;
};
const SENT_TOAST = { message: `Quote sent. +${QUOTE_POINTS} ${QUOTE_POINTS === 1 ? "point" : "points"}`, icon: "toll" };
export function WorkerJobBoundary(props: Props) {
  return <ToastProvider initial={props.preview === "sent" ? SENT_TOAST : undefined}><WorkerJob {...props} /></ToastProvider>;
}
function WorkerJob({ job, details, back, failure: initialFailure, photos = [], photosFailed, preview, save = saveWorkerEstimateAction }: Props) {
  const router = useRouter(), toast = useToast(), session = useOptionalSessionExpired(), online = useOnlineStatus(), formId = useId();
  const [own, setOwn] = useState(details?.ownEstimate ?? null);
  const [value, setValue] = useState(() => estimateFields(details?.ownEstimate ?? null));
  const [open, setOpen] = useState(["drawer", "error", "offline", "saving", "invalid"].includes(preview ?? ""));
  const [failure, setFailure] = useState(initialFailure);
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const [error, setError] = useState(preview === "error");
  const [sent, setSent] = useState(preview === "sent" ? "preview-estimate-sent" : null);
  const [fields, setFields] = useState<Partial<Record<keyof EstimateFields, string>>>(preview === "invalid" ? { hours: "Use half-hour steps from 0.5 to 40." } : {});
  const form = useRef<HTMLFormElement>(null);
  const offline = !online || preview === "offline", saving = busy || preview === "saving";
  const estimateOpen = details?.status === "REVIEW" || details?.status === "QUOTE_BOUNTY";
  function change<K extends keyof EstimateFields>(key: K, next: EstimateFields[K]) { setValue(previous => ({ ...previous, [key]: next })); setFields(previous => ({ ...previous, [key]: undefined })); }
  function step(delta: number) { const hours = Number(value.hours); change("hours", String(Math.min(40, Math.max(0.5, (Number.isFinite(hours) ? hours : 0.5) + delta)))); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || offline || failure || !estimateOpen || !details) return;
    if (!workerEstimateSchema.safeParse(value).success) {
      const parsed = workerEstimateSchema.safeParse(value), next: typeof fields = {};
      if (!parsed.success) for (const issue of parsed.error.issues) {
        const key = issue.path[0]; if (key === "hours") next.hours = "Use half-hour steps from 0.5 to 40.";
        if (key === "materials") next.materials = "Enter a materials cost of $0 or more.";
        if (key === "note") next.note = "Keep your note to 2,000 characters.";
      }
      setFields(next); form.current?.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus(); return;
    }
    pending.current = true; setBusy(true); setError(false);
    try {
      const result = await save(details.id, value);
      if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "saved") { setOwn(result.estimate); setValue(estimateFields(result.estimate)); setSent(`estimate-sent:${details.id}:${Date.now()}`); setOpen(false); toast.show(SENT_TOAST); router.refresh(); }
      else if (result.status === "invalid") { setFields(result.fields); setError(Object.keys(result.fields).length === 0); form.current?.querySelector<HTMLElement>(`[name="${Object.keys(result.fields)[0]}"]`)?.focus(); }
      else if (result.status === "ineligible") { setFailure(result.failure); setOpen(false); }
      else setError(true);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={styles.canvas} data-mode="trade"><div className={styles.page}>
    <TextLink href={back}>Back to jobs</TextLink>
    <div className={styles.layout}><div className={styles.content}>
      {photos.length ? <PhotoGallery photos={photos} label={`Photos of ${job.title}`} className={styles.gallery} /> : details ? <div className={styles.noPhotos}><Icon name="photo_camera" decorative /><span>{photosFailed ? "Couldn’t load photos." : "No photos yet"}</span>{photosFailed && <Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>}</div> : null}
      {details && <div className={styles.meta}><span className={styles.trade}><Icon name="construction" size="sm" decorative />{tradeLabel(details.category)}</span><span>{job.suburb} · TM-{details.jobNumber}</span></div>}
      <h1 className={styles.title}>{job.title}</h1>
      {details && <p className={styles.description}>{details.description}</p>}
      <div className={styles.person}>{details && <span className={styles.avatar} aria-hidden="true">{details.customerFirstName.charAt(0)}</span>}<div>{details && <b>{details.customerFirstName}</b>}<p>{job.suburb}, {job.city}{details?.asap ? " · wanted ASAP" : ""}</p></div></div>
    </div>{details && (estimateOpen || own || failure) && <aside className={styles.card} aria-label={own ? "Your quote" : "Quote this job"}>
      <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
      {failure ? <WorkerEstimateNotice failure={failure} /> : null}
      {sent && <BoltFlash eventId={sent} mark="bolt" size={44} />}
      {(own || (!failure && estimateOpen)) && <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{own ? "Your quote" : "Quote this job"}</h2><PointsChip earned={Boolean(own)} />
      </div>}
      {own ? <WorkerEstimateSummary own={own} canEdit={estimateOpen && !failure} />
      : !failure && estimateOpen ? <p className={styles.small}>{details.estimateCount === 0 ? "No quotes yet" : `${details.estimateCount} ${details.estimateCount === 1 ? "quote" : "quotes"} in`}</p> : null}
      {own && <Button href={back} icon="arrow_forward" width="full">Next job</Button>}
      {!failure && estimateOpen && <Button variant={own ? "secondary" : "hero"} icon={own ? undefined : "bolt"} onClick={() => setOpen(true)} width="full">{own ? "Edit" : "Quote now"}</Button>}
    </aside>}</div>
    {details && <Drawer open={open} onClose={() => setOpen(false)} dismissible={!saving} title="Your quote" eyebrow={`${job.title} · TM-${details.jobNumber}`} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" form={formId} loading={saving} disabled={offline || Boolean(failure)}>Send quote<span className={styles.sendPoints} aria-hidden="true">+{QUOTE_POINTS}</span></Button></>}>
      <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
      {error && <Banner tone="alert" title="Couldn’t save." live />}
      <form id={formId} ref={form} onSubmit={event => void submit(event)} className={styles.form} noValidate>
        <WorkerEstimateFields value={value} fields={fields} saving={saving} change={change} step={step} />
      </form>
    </Drawer>}
  </div></section>;
}
export function WorkerJobLoading() { return <section className={styles.canvas} data-mode="trade"><div className={styles.page} role="status" aria-label="Loading job"><h1 className={styles.srOnly}>Job</h1><div className={styles.layout}><div className={styles.content}><Skeleton height={360} /><Skeleton width="60%" height={40} /><SkeletonText /></div><div className={styles.card}><Skeleton height={18} /><Skeleton height={61} /></div></div></div></section>; }
export function WorkerJobLoadError({ back = "/jobs" }: { back?: string }) { const router = useRouter(); return <section className={styles.canvas} data-mode="trade"><div className={styles.page}><TextLink href={back}>Back to jobs</TextLink><div className={styles.card}><h1 className={styles.title}>Couldn’t load this job</h1><Banner tone="alert">Try again</Banner><Button onClick={() => router.refresh()}>Try again</Button></div></div></section>; }
