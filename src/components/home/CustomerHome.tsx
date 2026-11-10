"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { CategoryRail, CategoryTile } from "@/components/cards/CategoryTile";
import { EmptyCard } from "@/components/cards/EmptyCard";
import { JobRow } from "@/components/cards/JobRow";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { JobRowSkeleton } from "@/components/feedback/Skeleton";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { StatusPill } from "@/components/status/StatusPill";
import { CATEGORY_INFO, type Category } from "@/lib/cards";
import { HOME_SUGGESTIONS, homeJobHref, type CustomerHomeResult, type HomeJob } from "@/lib/customer-home";
import { customerJobActionLabel } from "@/lib/customer-jobs";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { jobStartPath, LANDING_QUERY_MAX } from "@/lib/landing";
import styles from "./customer-home.module.css";

const STEPS = [
  ["edit_note", "Post it", "Tell us what needs doing and snap a photo or two. Free, no sign-up to start."],
  ["sell", "Accept the price", "One fair, fixed price. Happy? Accept and pay. Not? Say no. It costs nothing."],
  ["bolt", "Sorted", "Someone local turns up and gets it done. You check it, rate it, done."],
] as const;

export function CustomerHome({ result, loading = false, previewOffline = false }: { result: CustomerHomeResult; loading?: boolean; previewOffline?: boolean }) {
  const router = useRouter();
  const browserOnline = useOnlineStatus();
  const online = browserOnline && !previewOffline;
  const [description, setDescription] = useState("");
  const descriptionInput = useRef<HTMLInputElement>(null);
  const data = result.ok ? result.data : null;
  const coverage = data?.coverage ?? INVERCARGILL_COVERAGE;
  const location = data?.location ?? { label: "", point: null };
  const start = (text = description, category?: Category) => jobStartPath({ description: text, category, location }, coverage);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (online) router.push(start()); }

  return <div className={`${styles.page} tm-anim-enter`} data-mode="customer">
    <section className={styles.band} aria-labelledby="home-heading"><div className={styles.wrap}>
      <h1 id="home-heading" className={styles.heading}>{data?.firstName ? `Kia ora ${data.firstName}. ` : ""}What needs doing?</h1>
      <form className={styles.search} onSubmit={submit}>
        <TextField ref={descriptionInput} id="home-job-description" label="What needs doing?" labelHidden name="description" type="search" icon="search" placeholder="Describe the job, e.g. “new power point in the lounge”" value={description} onChange={event => setDescription(event.target.value)} maxLength={LANDING_QUERY_MAX} className={styles.searchField} />
        <Button type="submit" variant="hero" width="auto" className={styles.startButton} disabled={!online ? "You’re offline" : false}>Get a price</Button>
      </form>
    </div></section>
    <div className={`${styles.wrap} ${styles.content}`}>
      {data && <CategoryRail label="Start a job by category" className={styles.categories}>{data.categories.map(category => <li key={category}><CategoryTile category={category} headingLevel={2} href={start(description, category)} /></li>)}</CategoryRail>}
      <div className={styles.notices}>
        <OfflineBanner sticky={false} online={previewOffline ? false : undefined} onRetry={() => router.refresh()} className={styles.notice} />
        {data?.outside && <Banner tone="info" title={`We’re in ${coverage.name}.`} className={styles.notice} action={<TextLink inline href={start("")}>Join the waitlist</TextLink>}>Not in your area yet.</Banner>}
      </div>
      <div className={styles.columns}>
        <div className={styles.jobs}><LoadingRegion loading={loading} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
          {!result.ok ? <div className={styles.card}><ErrorState title="Can’t load your jobs" message="Check your connection and try again." onRetry={() => router.refresh()} /></div> : <>
            {data!.needsYou.length > 0 && <section aria-labelledby="needs-heading"><SectionHeading id="needs-heading" label="Needs you" count={data!.counts.needsYou} /><div className={styles.rows}>{data!.needsYou.map(job => <HomeJobRow key={job.id} job={job} />)}</div></section>}
            <section aria-labelledby="progress-heading"><SectionHeading id="progress-heading" label="In progress" count={data!.counts.inProgress} />
              {data!.inProgress.length ? <div className={styles.rows}>{data!.inProgress.map(job => <HomeJobRow key={job.id} job={job} />)}</div> : <EmptyCard icon="inbox" title="Nothing on yet." message="Got something that needs doing? Post it free and we’ll get you a price." />}
              {data!.counts.inProgress === 0 && data!.counts.needsYou === 0 && data!.recent.length === 0 && <ol className={styles.steps} aria-label="How it works">{STEPS.map(([icon, title, text]) => <li key={title}><Icon name={icon} decorative /><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>}
            </section>
            {data!.recent.length > 0 && <section aria-labelledby="recent-heading"><SectionHeading id="recent-heading" label="Recent" /><div className={styles.rows}>{data!.recent.map(job => <HomeJobRow key={job.id} job={job} />)}</div></section>}
          </>}
        </LoadingRegion></div>
        <aside className={styles.aside} aria-label="Job ideas and trust"><section className={styles.card} aria-labelledby="popular-heading"><h2 id="popular-heading">Popular right now</h2><ul className={styles.chips}>{HOME_SUGGESTIONS.map(text => <li key={text}><button type="button" onClick={() => { setDescription(text); descriptionInput.current?.focus(); }} className={styles.chip}>{text}</button></li>)}</ul></section>
          <section className={`${styles.card} ${styles.trust}`} aria-labelledby="trust-heading"><Icon name="verified_user" fill decorative /><div><h2 id="trust-heading">How we check tradies</h2><p>Licences checked by hand. <TextLink href="/trust" inline>Learn more</TextLink></p></div></section>
        </aside>
      </div>
    </div>
  </div>;
}

function SectionHeading({ id, label, count }: { id: string; label: string; count?: number }) {
  return <div className={styles.sectionHeading}><h2 id={id}>{label}{count !== undefined && count > 0 ? <span className={styles.count}> {count}</span> : null}</h2><TextLink href="/dashboard" inline>All my jobs</TextLink></div>;
}
function HomeJobRow({ job }: { job: HomeJob }) {
  const href = homeJobHref(job.id);
  const action = job.action ? customerJobActionLabel(job.action) : null;
  return <JobRow href={href} title={job.title} category={CATEGORY_INFO[job.category.toLowerCase() as keyof typeof CATEGORY_INFO].name} meta={`TM-${job.jobNumber} · ${job.suburb}`} status={<StatusPill status={job.status} audience="customer" context={{ extraWork: job.action === "extra-work" }} />} price={job.action === "price" && job.priceCents !== null ? new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(job.priceCents / 100) : undefined} action={action ? <Button href={href} variant="secondary" size="sm" width="auto">{action}</Button> : undefined} />;
}
