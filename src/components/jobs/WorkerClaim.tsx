"use client";
import { pointsLabel } from "@/lib/points";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Dialog } from "@/components/overlays/Dialog";
import { Pill } from "@/components/status/Pill";
import { PriceBlock, formatCents } from "@/components/status/PriceBlock";
import { tradeLabel } from "@/lib/account/trades";
import { DAY_PARTS } from "@/lib/job-time-windows";
import { boardJobHref } from "@/lib/job-board";
import { claimMessageHref } from "@/lib/claim-return";
import type { AuthFailure } from "@/lib/auth/results";
import { CLAIM_FAILURE_COPY, type ClaimPoints, type WorkerClaimResult, type WorkerClaimView } from "@/lib/worker-claim";
import type { EligibilityFailure } from "@/server/workers/eligibility";
import { claimWorkerJobAction } from "@/server/jobs/worker-claim-actions";
import styles from "./worker-claim.module.css";

type Photos = { src: string; alt: string }[];
type Props = { job: WorkerClaimView; back: string; failure?: EligibilityFailure | null; photos?: Photos; photosFailed?: boolean; preview?: string; contactHref?: string;
  /** The worker's points and the claim cost (#491); null once the job is theirs. */
  points?: ClaimPoints | null;
  claim?: (id: string) => Promise<WorkerClaimResult | AuthFailure> };
function timing(job: WorkerClaimView) {
  if (job.asap) return "As soon as possible";
  if (job.anyTime) return "Any time";
  return job.timeWindows.map(window => `${new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${window.date}T00:00:00Z`))} · ${DAY_PARTS.find(part => part.value === window.timeOfDay)?.label ?? window.timeOfDay}`).join("; ") || "Check with the customer";
}
function requirements(job: WorkerClaimView) {
  if (!job.needs) return "Check with the office";
  return [job.needs.coc && "CoC on completion", job.needs.photos > 0 && `${job.needs.photos} photos on completion`, job.needs.notes && "Completion notes"].filter(Boolean).join(" · ") || "No certificate required";
}
export function ClaimNumbers({ job, reveal = false }: { job: WorkerClaimView; reveal?: boolean }) {
  return <><PriceBlock audience="tradie" earnCents={job.earn.cents} breakdown={{ minutes: job.earn.minutes, rateCents: job.earn.rateCents, holidayPay: job.earn.holidayPay }} revealId={reveal ? `worker-claim:${job.id}:${job.earn.cents}` : undefined} />
    <dl className={styles.lines}><div><dt>{job.category === "ELECTRICAL" ? "Materials budget (Telfer)" : "Materials budget"}</dt><dd>{formatCents(job.budgetCents)}</dd></div><div><dt>Needs</dt><dd>{requirements(job)}</dd></div><div><dt>When</dt><dd>{timing(job)}</dd></div></dl></>;
}
export function ClaimNextSteps({ job }: { job: WorkerClaimView }) {
  return <ol className={styles.nextSteps}><li>Book one of the customer’s time windows</li>{job.category === "ELECTRICAL" && <li>Grab materials at Telfer: job no. <b>TM-{job.jobNumber}</b></li>}<li>{job.needs?.coc ? "Do the work, upload the CoC" : "Do the work, send completion evidence"}</li></ol>;
}
/** Not enough points to claim (#491): a locked card with a progress bar, so it's obvious at a glance. */
function PointsLocked({ points }: { points: ClaimPoints }) {
  const missing = points.cost - points.balance, have = Math.max(0, points.balance);
  return <div className={styles.locked} role="status">
    <div className={styles.lockedHead}><Icon name="lock" fill decorative /><b>Locked</b><span className={styles.cost}><Icon name="toll" size="sm" fill decorative />{have} / {points.cost}</span></div>
    <div className={styles.meter} aria-hidden="true"><span style={{ width: `${Math.min(100, (have / points.cost) * 100)}%` }} /></div>
    <p>Quote {missing} more {missing === 1 ? "job" : "jobs"} to claim this one.</p>
  </div>;
}
export function WorkerClaim({ job: initial, back, failure: initialFailure, photos = [], photosFailed, preview, contactHref: initialContactHref, points: initialPoints = null, claim = claimWorkerJobAction }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), online = useOnlineStatus(), pending = useRef(false);
  const [job, setJob] = useState(initial), [failure, setFailure] = useState(initialFailure);
  const [confirm, setConfirm] = useState(["confirm", "error", "offline", "saving"].includes(preview ?? ""));
  const [success, setSuccess] = useState(preview === "success"), [lost, setLost] = useState(preview === "lost");
  const [busy, setBusy] = useState(false), [error, setError] = useState(preview === "error");
  const [points, setPoints] = useState(initialPoints);
  const short = Boolean(points && !job.assignedToYou && points.balance < points.cost);
  const [contactHref, setContactHref] = useState(initialContactHref ?? `/messages?job=${encodeURIComponent(job.id)}`);
  const messageHref = claimMessageHref(contactHref, boardJobHref(job.id, back));
  const titleRef = useRef<HTMLSpanElement>(null), addressRef = useRef<HTMLHeadingElement>(null);
  const revealAddress = useRef(false);
  const dialogTitleRef = useCallback((node: HTMLSpanElement | null) => {
    titleRef.current = node;
    if (!node && revealAddress.current) {
      revealAddress.current = false;
      // ModalShell unmounts after its exit motion. Focus after its cleanup closes the native dialog and clears inert.
      requestAnimationFrame(() => addressRef.current?.focus());
    }
  }, []);
  function openOwnedJob() {
    if (confirm || success) { revealAddress.current = true; setConfirm(false); setSuccess(false); }
    else addressRef.current?.focus();
  }
  const offline = !online || preview === "offline", saving = busy || preview === "saving";
  useEffect(() => { if (success) titleRef.current?.closest("h2")?.focus(); }, [success]);
  async function take() {
    if (pending.current || offline || saving || lost || failure || short) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      const result = await claim(job.id);
      if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "claimed") { setJob(result.job); setContactHref(result.contactHref); setConfirm(false); setSuccess(true); }
      else if (result.status === "lost") { setConfirm(false); setLost(true); }
      else if (result.status === "points") { setConfirm(false); setPoints({ balance: result.balance, cost: result.cost }); }
      else if (result.status === "ineligible") { setConfirm(false); setFailure(result.failure); }
      else setError(true);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={styles.canvas} data-mode="trade"><div className={styles.page}>
    <TextLink href={back}>Back to jobs</TextLink>
    {lost && <Banner tone="info" live action={<TextLink href={back} inline>See similar jobs</TextLink>}>Too slow. Someone else got this one.</Banner>}
    <div className={styles.layout}>
      <div className={styles.photos}>{photos.length ? <PhotoGallery photos={photos} label={`Photos of ${job.title}`} className={styles.gallery} /> : <div className={styles.noPhotos}><Icon name="photo_camera" decorative /><span>{photosFailed ? "Couldn’t load photos." : "No photos yet"}</span>{photosFailed && <Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>}</div>}</div>
      <div className={styles.heading}><div className={styles.meta}><span>{tradeLabel(job.category)}</span><span>{job.suburb} · TM-{job.jobNumber}</span></div><h1>{job.title}</h1></div>
      <div className={styles.details}><p>{job.description}</p><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{job.customerFirstName.charAt(0)}</span><div><b>{job.customerFirstName}</b><p>{job.suburb}, {job.city}{job.asap ? " · wanted ASAP" : ""}</p></div></div>
        {job.assignedToYou && job.address && <section className={styles.card} aria-label="Customer contact"><h2 ref={addressRef} tabIndex={-1}>Address</h2><p>{[job.address.line1, job.address.line2, job.suburb, job.city, job.address.postcode].filter(Boolean).join(", ")}</p>{job.address.accessNotes && <p>{job.address.accessNotes}</p>}{job.customerPhone && <TextLink href={`tel:${job.customerPhone.replace(/[^+\d]/g, "")}`}>{job.customerPhone}</TextLink>}<TextLink href={messageHref}>Message {job.customerFirstName}</TextLink></section>}
      </div>
      <aside className={`${styles.card} ${styles.claimCard} tm-claim-lost`} data-lost={lost} aria-label="Claim job">
        <div><Pill kind="good">Paid by customer</Pill></div><ClaimNumbers job={job} reveal />
        <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
        {failure && <Banner tone="alert" live={failure !== initialFailure}>{CLAIM_FAILURE_COPY[failure]}</Banner>}
        {points && !job.assignedToYou && points.cost > 0 && !short && <p className={styles.points}><span className={styles.cost}><Icon name="toll" size="sm" fill decorative />{points.cost}</span>to claim · you have {pointsLabel(points.balance)}</p>}
        {short && points ? <PointsLocked points={points} /> : null}
        {short ? <><Button variant="hero" width="full" disabled icon="lock">Claim job</Button><Button href="/jobs?kind=estimate" width="full" icon="bolt">Quote jobs to unlock</Button></>
        : <Button variant={job.assignedToYou ? "secondary" : "hero"} width="full" disabled={lost || Boolean(failure) || offline || short} onClick={() => job.assignedToYou ? openOwnedJob() : setConfirm(true)}>{job.assignedToYou ? "Open job" : "Claim job"}</Button>}
      </aside>
    </div>
    <Dialog open={confirm || success} onClose={() => { setConfirm(false); setSuccess(false); }} dismissible={!saving} role={success ? "dialog" : "alertdialog"} title={<span ref={dialogTitleRef}>{success ? "It’s yours." : "Take this job?"}</span>} eyebrow={success ? undefined : `${job.title} · TM-${job.jobNumber}`} size="sm" footer={success ? <><Button variant="secondary" onClick={openOwnedJob}>Open job</Button><Button href={messageHref}>Message {job.customerFirstName}</Button></> : <><Button variant="secondary" onClick={() => setConfirm(false)} disabled={saving}>Not now</Button><Button loading={saving} disabled={offline} onClick={() => void take()}>Yes, it’s mine</Button></>}>
      {success ? <div className={styles.success}><BoltFlash eventId={`claimed:${job.id}`} mark="bolt" size={104} /><p>{job.customerFirstName}’s address is unlocked. Next up:</p><ClaimNextSteps job={job} /></div> : <div className={styles.dialogBody}><ClaimNumbers job={job} /><p>{job.suburb}, {job.city}</p><Banner tone="info">Once it’s yours, pick a customer time window. Their address unlocks after you claim.</Banner><OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />{error && <Banner tone="alert" live>Couldn’t claim this job. Try again.</Banner>}</div>}
    </Dialog>
  </div></section>;
}
export function WorkerClaimLoading() { return <section className={styles.canvas} data-mode="trade"><div className={styles.page} role="status" aria-label="Loading job"><h1 className={styles.srOnly}>Job</h1><div className={styles.layout}><div className={styles.photos}><Skeleton height={360} /></div><div className={styles.heading}><SkeletonText /></div><div className={`${styles.card} ${styles.claimCard}`}><Skeleton height={120} /><SkeletonText /></div></div></div></section>; }
export function WorkerClaimLoadError({ back = "/jobs" }: { back?: string }) { const router = useRouter(); return <section className={styles.canvas} data-mode="trade"><div className={styles.page}><TextLink href={back}>Back to jobs</TextLink><div className={styles.card}><h1>Couldn’t load this job</h1><Banner tone="alert">Try again</Banner><Button onClick={() => router.refresh()}>Try again</Button></div></div></section>; }
