"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { EmptyCard } from "@/components/cards/EmptyCard";
import { ServiceJobCard } from "@/components/cards/ServiceJobCard";
import { ErrorState, LoadingRegion, Skeleton } from "@/components/feedback";
import { AddressField } from "@/components/forms/AddressField";
import { TextField } from "@/components/forms/TextFields";
import { Avatar } from "@/components/media/Avatar";
import { StarRating } from "@/components/media/Stars";
import { Dialog } from "@/components/overlays/Dialog";
import { Pill } from "@/components/status/Pill";
import { CATEGORY_INFO } from "@/lib/cards";
import { checkCoverage } from "@/lib/geo/coverage";
import { jobStartPath, LANDING_DRAFT_KEY, LANDING_LOCATION_MAX, LANDING_QUERY_MAX, type LandingLocation } from "@/lib/landing";
import { serviceDescription, type ServiceData, type ServicePreviewState } from "@/lib/services";
import type { WaitlistResult, WaitlistState } from "@/lib/waitlist";
import { searchLandingPlacesAction } from "@/server/landing-actions";
import type { AddressSearchResult } from "@/server/geo/address-search";

import { ServiceWaitlist } from "./ServiceWaitlist";
import landing from "./landing.module.css";
import styles from "./service.module.css";

const STEPS = [
  { title: "Post it", text: "Tell us what needs doing and snap a photo or two. Free, no sign-up to start.", icon: "edit_note" },
  { title: "Accept the price", short: "Accept", text: "One fair, fixed price. Happy? Accept and pay. Not? Say no. It costs nothing.", icon: "sell" },
  { title: "Sorted", text: "Someone local turns up and gets it done. You check it, rate it, done.", icon: "bolt" },
];
const WAITLIST_STATES: Partial<Record<ServicePreviewState, WaitlistState>> = { sending: "loading", joined: "joined", "already-on-list": "already-on-list", "waitlist-error": "error", offline: "offline" };
type Props = { data: ServiceData; submit: (form: FormData) => Promise<WaitlistResult>; preview?: { state: ServicePreviewState; searchPlaces?: typeof searchLandingPlacesAction } };

export function ServicePage({ data, submit, preview }: Props) {
  const router = useRouter();
  const info = CATEGORY_INFO[data.category];
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<LandingLocation>({ label: data.coverage.name, point: null });
  const [locationOpen, setLocationOpen] = useState(false);
  const [query, setQuery] = useState(location.label);
  const [lookup, setLookup] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: AddressSearchResult }>({ status: "idle" });
  const version = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const outside = checkCoverage(data.coverage, location.point).status === "outside";
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]"))) { event.preventDefault(); input.current?.focus(); } };
    document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    const current = ++version.current;
    if (!locationOpen || query.trim().length < 3 || query === location.label) return;
    const timer = window.setTimeout(async () => {
      setLookup({ status: "loading" });
      try { const result = await (preview?.searchPlaces ?? searchLandingPlacesAction)(query); if (current === version.current) setLookup({ status: result.mode === "search" ? "ready" : "error", result }); }
      catch { if (current === version.current) setLookup({ status: "error" }); }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [locationOpen, query, location.label, preview?.searchPlaces]);
  function draft(text = description) { return { category: data.category, description: text.trim().slice(0, LANDING_QUERY_MAX), location }; }
  function start(text = description) {
    const next = draft(text);
    try { sessionStorage.setItem(LANDING_DRAFT_KEY, JSON.stringify(next)); } catch { /* The URL carries the same draft. */ }
    router.push(jobStartPath(next, data.coverage));
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); start(); }
  const waitlistState = preview ? WAITLIST_STATES[preview.state] ?? "empty" : "empty";

  if (preview?.state === "error") return <ErrorState size="page" title="Couldn’t load this service." message="Try again in a minute." onRetry={() => router.refresh()} />;
  if (preview?.state === "loading") return <ServiceLoading />;
  return <>
    <section className={styles.hero} data-site-hero style={{ "--service-tint": info.tint } as CSSProperties}>
      <BoltMark variant="hero" className={styles.heroBolt} />
      <div className={`${landing.wrap} ${styles.heroGrid}`}>
        <div className={styles.heroText}>
          <nav className={styles.crumbs} aria-label="Breadcrumb"><Link href="/#category-heading">Services</Link><Icon name="chevron_right" decorative /><span aria-current="page">{info.name}</span></nav>
          <h1>{data.headline} in<br />{data.coverage.name}</h1>
          {!data.live && <Pill kind="waiting">Coming soon</Pill>}
          {data.live && <p className={styles.intro}>{data.intro}</p>}
          {data.live ? <form className={`${landing.search} ${styles.search}`} aria-label="What needs doing?" onSubmit={search}>
            <TextField ref={input} className={landing.jobField} label="What needs doing?" labelHidden name="description" placeholder="What needs doing?" icon="search" maxLength={LANDING_QUERY_MAX} value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
            <button className={`${landing.location} ${styles.location}`} type="button" aria-label={`Location: ${location.label}. Change location`} onClick={() => { setQuery(location.label); setLookup({ status: "idle" }); setLocationOpen(true); }}><Icon name="near_me" decorative /><span>{location.label}</span></button>
            <Button type="submit" variant="hero" className={landing.searchButton}>{outside ? "Get notified" : "Get a price"}</Button>
          </form> : <ServiceWaitlist category={data.category} location={data.coverage.name} submit={submit} initialState={waitlistState} />}
        </div>
        <div className={styles.art} aria-hidden="true"><span />{"image" in info.art ? <Image src={data.heroImage ?? info.art.image} width={340} height={340} alt="" priority sizes="(min-width: 1024px) 340px, 200px" /> : <Icon name={info.art.icon} decorative fill />}</div>
      </div>
    </section>
    {data.live && <>
      <section className={`${landing.wrap} ${styles.popular}`} aria-labelledby="popular-heading"><h2 id="popular-heading" className={styles.sectionTitle}>{data.popularHeading}</h2>
        {data.jobs.length ? <div className={styles.jobs}>{data.jobs.map((job) => <ServiceJobCard key={job.name} job={job} category={data.category} href={jobStartPath(draft(serviceDescription(job, description)), data.coverage)} onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); start(serviceDescription(job, description)); }
        }} />)}</div> : <EmptyCard className={styles.emptyJobs} icon="edit_note" title="What needs doing?" message="Tell us about your job and we’ll get you a price." action={<Button onClick={() => input.current?.focus()}>Describe your job</Button>} />}
      </section>
      <section className={`${landing.wrap} ${styles.how}`} aria-labelledby="service-how-heading"><h2 id="service-how-heading" className={styles.sectionTitle}>Three taps. Job sorted.</h2><div className={landing.steps}>{STEPS.map((step, i) => <article key={step.title} className={`${landing.step} tm-lift`}><span className={landing.stepIcon}><Icon name={step.icon} fill decorative /><span>{i + 1}</span></span><h3><span className={landing.desktopStep}>{i + 1}. {step.title}</span><span className={landing.phoneStep}>{step.short ?? step.title}</span></h3><p>{step.text}</p></article>)}</div></section>
      {data.reviewsUnavailable ? <section className={landing.wrap} aria-label="Reviews"><ErrorState title="Couldn’t load reviews." onRetry={() => router.refresh()} /></section> : data.reviews.length > 0 && <section className={landing.reviews} aria-labelledby="service-reviews-heading"><div className={landing.wrap}><h2 id="service-reviews-heading">Getting it sorted</h2><div className={landing.reviewGrid}>{data.reviews.map((review) => <article className={landing.review} key={review.id}><StarRating value={review.rating} showValue={false} /><blockquote>“{review.comment}”</blockquote><div><Avatar name={review.name} size="sm" decorative /><b>{review.name}</b></div></article>)}</div></div></section>}
      <section className={landing.final} aria-labelledby="service-cta-heading"><div className={`${landing.wrap} ${styles.cta}`}><h2 id="service-cta-heading">What needs doing?</h2><Button variant="hero" onClick={() => start()}>Post a job</Button></div></section>
    </>}
    <Dialog open={locationOpen} onClose={() => setLocationOpen(false)} title="Location" footer={<Button onClick={() => { setLocation({ label: query.trim() || data.coverage.name, point: query === location.label ? location.point : null }); setLocationOpen(false); }}>Use location</Button>}>
      <AddressField label="Town or suburb" value={query} maxLength={LANDING_LOCATION_MAX} placeholder="Town or suburb" status={lookup.status} suggestions={lookup.result?.mode === "search" ? lookup.result.suggestions : []} lookupError="Search unavailable. Enter your location." onQueryChange={(value) => { setQuery(value); setLookup({ status: "idle" }); }} onSelect={(place) => {
        const match = lookup.result?.mode === "search" ? lookup.result.suggestions.find((item) => item.id === place.id) : undefined;
        if (match) { setLocation({ label: match.city || match.label, point: match.point }); setQuery(match.city || match.label); setLocationOpen(false); }
      }} />
    </Dialog>
  </>;
}

export function ServiceLoading() {
  return <><h1 className={styles.visuallyHidden}>Service</h1><LoadingRegion loading label="Loading service" skeleton={<div className={styles.loading}><Skeleton width="65%" height={64} /><Skeleton width="50%" height={24} /><Skeleton height={74} /><div className={styles.jobs}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={126} />)}</div></div>} /></>;
}
