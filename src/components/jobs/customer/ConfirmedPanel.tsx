"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { Avatar } from "@/components/media/Avatar";
import { Banner } from "@/components/overlays/Banner";
import { CUSTOMER_JOB_POLL_MS, customerJobHref, customerJobWindowsReturn } from "@/lib/customer-job";
import { CUSTOMER_WORKER_LICENCE_LABELS, type CustomerWorkerCard } from "@/lib/customer-worker-card";
import type { CustomerJobView } from "@/server/views";
import styles from "./confirmed.module.css";

const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const updateTime = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const periods = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;

export function ConfirmedPanel({ job, card, back, online, preview = false, windowsHref }: {
  job: CustomerJobView; card?: CustomerWorkerCard | null; back: string; online: boolean; preview?: boolean; windowsHref?: string;
}) {
  const router = useRouter(), [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = useRef<HTMLSpanElement>(null), avatarUrl = card?.avatarUrl;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const image = avatar.current?.querySelector("img");
      if (avatarUrl && image?.complete && image.naturalWidth === 0) setFailedAvatar(avatarUrl);
    });
    return () => cancelAnimationFrame(frame);
  }, [avatarUrl]);
  // Preset notifications do not necessarily advance jobs.updated_at. Refresh the owned server
  // card independently so the existing revision-only frame poll cannot miss a new update.
  useEffect(() => {
    if (preview || !online) return;
    const refresh = () => { if (navigator.onLine && document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.refresh(); };
    const timer = setInterval(refresh, CUSTOMER_JOB_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [preview, online, router]);
  const worker = job.worker;
  if (!worker) return null;
  const name = `${worker.firstName}${worker.lastInitial ? ` ${worker.lastInitial}` : ""}`;
  const src = card?.avatarUrl && card.avatarUrl !== failedAvatar ? card.avatarUrl : null;
  const licence = card?.licensed ? CUSTOMER_WORKER_LICENCE_LABELS[job.category] : null;
  const returnTo = customerJobWindowsReturn(job.id, customerJobHref(job.id, back));
  return <div className={styles.panel}>
    <div className={styles.person}>
      <span ref={avatar} onErrorCapture={event => { if (event.target instanceof HTMLImageElement && card?.avatarUrl) setFailedAvatar(card.avatarUrl); }}><Avatar name={name} src={src} size="lg" decorative /></span>
      <div className={styles.identity}><h3 className={styles.name}>{name}</h3>
        {card?.rating && card.rating.count > 0 && <p className={styles.rating}><Icon name="star" fill decorative size="sm" />{card.rating.average.toFixed(1)} ({card.rating.count})</p>}
        {licence && <p className={styles.licence}><Icon name="verified" fill decorative size="sm" />{licence}</p>}
      </div>
    </div>
    {worker.phone && <TextLink href={`tel:${worker.phone}`}><Icon name="call" decorative size="sm" />Call {worker.firstName}</TextLink>}
    {card && <>
      <p className={styles.booking}>{job.bookedDate ? `${worker.firstName}’s booked in ${date.format(new Date(`${job.bookedDate}T00:00:00Z`))}${job.bookedTime ? ` · ${periods[job.bookedTime]}` : ""}` : `${worker.firstName} will book one of your times.`}</p>
      {card.askedForTimes && card.updates[0]?.type === "job.reschedule_requested" && <Banner tone="info" title={`${worker.firstName} asked for other times.`} action={<TextLink href={windowsHref ?? `/jobs/${job.id}/windows?from=${encodeURIComponent(returnTo)}`}>Add times</TextLink>} />}
      {card.updates.length > 0 && <ul className={styles.updates} aria-label="Job updates" aria-live="polite">{card.updates.map(update => <li key={update.id}><span>{update.label}{update.lateMinutes !== null ? ` · ${update.lateMinutes} min` : ""}</span><time dateTime={update.createdAt}>{updateTime.format(new Date(update.createdAt))}</time></li>)}</ul>}
    </>}
  </div>;
}
