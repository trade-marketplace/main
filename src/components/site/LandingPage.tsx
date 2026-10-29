"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button, buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { CategoryRail, CategoryTile } from "@/components/cards/CategoryTile";
import { AddressField } from "@/components/forms/AddressField";
import { TextField } from "@/components/forms/TextFields";
import { Avatar } from "@/components/media/Avatar";
import { StarRating } from "@/components/media/Stars";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { Pill } from "@/components/status/Pill";
import { formatCents } from "@/components/status/PriceBlock";
import { CATEGORIES, CATEGORY_INFO, type Category } from "@/lib/cards";
import { checkCoverage } from "@/lib/geo/coverage";
import type { Point } from "@/lib/geo/distance";
import { GEO_ASKED_KEY, LANDING_DRAFT_KEY, LANDING_QUERY_MAX, LANDING_LOCATION_MAX, jobStartPath, type LandingData, type LandingLocation } from "@/lib/landing";
import { staggerStyle } from "@/lib/motion/helpers";
import { useOncePerEvent, useParallax } from "@/lib/motion/hooks";
import { searchLandingPlacesAction } from "@/server/landing-actions";
import type { AddressSearchResult } from "@/server/geo/address-search";

import { TRADIE_SIGNUP_PATH } from "./site-links";
import styles from "./landing.module.css";

const EXAMPLES = ["Power point", "Leaking tap", "Heat pump", "Hang a door", "Move a couch", "Fix a fence"];
const STEPS = [
  { title: "Post it", icon: "edit_note", text: "Tell us what needs doing and snap a photo or two. Free, no sign-up to start." },
  { title: "Accept the price", short: "Accept", icon: "sell", text: "One fair, fixed price. Happy? Accept and pay. Not? Say no. It costs nothing." },
  { title: "Sorted", icon: "bolt", text: "Someone local turns up and gets it done. You check it, rate it, done." },
];
const PROMISES = [
  { icon: "sell", text: "One fair, fixed price", detail: "You see the price before anyone turns up. That's what you pay." },
  { icon: "verified", text: "Checked, local tradies", detail: "Licences checked by hand. Rated by people near you." },
  { icon: "photo_camera", text: "No surprise bills", detail: "Extra work? You see photos and the cost and say yes first." },
];
const FAQ = [
  ["Is it really free to post?", "Yes. Posting and getting a price is free. You only pay if you accept the price."],
  ["Who are the tradies?", "Local tradies and workers. Restricted work needs a licence checked by the office."],
  ["What if the job needs more work?", "Your tradie sends photos and details of the extra work. You see the price and say yes before it starts."],
  ["When do I pay?", "You pay when you accept the fixed price. If you don't want to go ahead, say no. Posting your job costs nothing."],
];
let browserLocation: Promise<Point | null> | undefined;
function locationOnce(): Promise<Point | null> {
  if (browserLocation) return browserLocation;
  try { if (sessionStorage.getItem(GEO_ASKED_KEY)) return Promise.resolve(null); sessionStorage.setItem(GEO_ASKED_KEY, "1"); } catch { /* the browser still owns permission */ }
  browserLocation = new Promise((resolve) => navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }), () => resolve(null), { timeout: 5000, maximumAge: 300_000 }));
  return browserLocation;
}

export type LandingPreview = { state?: string; searchPlaces?: typeof searchLandingPlacesAction };

export function LandingPage({ data, preview }: { data: LandingData; preview?: LandingPreview }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState(data.location);
  const [locationOpen, setLocationOpen] = useState(Boolean(preview?.state?.startsWith("location-")));
  const [locationQuery, setLocationQuery] = useState(data.location.label);
  const [lookup, setLookup] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: AddressSearchResult }>({ status: "idle" });
  const queryVersion = useRef(0);
  const heroBolt = useRef<HTMLDivElement>(null);
  const jobInput = useRef<HTMLInputElement>(null);
  const reveal = useOncePerEvent("landing-headline", "visit");
  useParallax(heroBolt);
  const outside = checkCoverage(data.coverage, location.point).status === "outside";

  useEffect(() => {
    if (preview || !navigator.geolocation) return;
    let active = true;
    void locationOnce().then((point) => {
      if (!active || !point) return;
      setLocation({ label: checkCoverage(data.coverage, point).status === "inside" ? data.coverage.name : "Your location", point });
    });
    return () => { active = false; };
  }, [data.coverage, preview]);

  useEffect(() => {
    const version = ++queryVersion.current;
    if (!locationOpen || locationQuery.trim().length < 3 || locationQuery === location.label) return;
    const timer = window.setTimeout(async () => {
      setLookup({ status: "loading" });
      try {
        const result = await (preview?.searchPlaces ?? searchLandingPlacesAction)(locationQuery);
        if (version === queryVersion.current) setLookup({ status: result.mode === "search" ? "ready" : "error", result });
      } catch { if (version === queryVersion.current) setLookup({ status: "error" }); }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [locationOpen, locationQuery, location.label, preview?.searchPlaces]);

  function start(category?: Category) {
    const draft = { description: description.trim().slice(0, LANDING_QUERY_MAX), category, location: { ...location, label: location.label.slice(0, LANDING_LOCATION_MAX) } };
    try { sessionStorage.setItem(LANDING_DRAFT_KEY, JSON.stringify(draft)); } catch { /* URL preserves the same details when storage is blocked. */ }
    router.push(jobStartPath(draft, data.coverage));
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); start(); }
  function chooseLocation(next: LandingLocation) { setLocation(next); setLocationQuery(next.label); setLocationOpen(false); setLookup({ status: "idle" }); }
  const animate = (i: number, className?: string) => ({ className: [className, reveal && "tm-anim-reveal"].filter(Boolean).join(" "), style: staggerStyle(i) });
  const examples = () => EXAMPLES.map((text) => <button key={text} type="button" onClick={() => { setDescription(text); ([...document.querySelectorAll<HTMLInputElement>('form[aria-label="What needs doing?"] input')].find((input) => input.getBoundingClientRect().width > 0) ?? jobInput.current)?.focus(); }}><span>{text}</span></button>);

  function search(final = false) {
    return <form className={[styles.search, final && styles.finalSearch].filter(Boolean).join(" ")} onSubmit={submit} aria-label={final ? "Start a job" : "What needs doing?"}>
      <TextField ref={final ? undefined : jobInput} className={styles.jobField} label="What needs doing?" labelHidden icon="search" type="text" name="description" placeholder="What needs doing?"
        value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LANDING_QUERY_MAX} autoComplete="off" />
      <button type="button" className={styles.location} aria-label={`Location: ${location.label}. Change location`} onClick={() => { setLocationQuery(location.label); setLocationOpen(true); }}>
        <Icon name="near_me" decorative /><span>{location.label}</span>
      </button>
      <Button type="submit" variant="hero" className={styles.searchButton}>{outside ? "Get notified" : "Get a price"}</Button>
    </form>;
  }

  return <>
    <section className={styles.hero} data-site-hero>
      <div className={`${styles.heroBolt} tm-parallax`} ref={heroBolt}><BoltMark variant="hero" /></div>
      <div className={styles.heroContent}>
        <h1 className={styles.headline}><span {...animate(0)}>Sorted in</span><span {...animate(1)}>a flash.</span></h1>
        <p {...animate(2, styles.heroCopy)}>Post any job free. Accept the price.<br />Someone local sorts it.</p>
        <div {...animate(3, styles.heroSearch)}>{search()}</div>
        <div className={styles.examples} aria-label="Popular jobs">{examples()}</div>
        <ul className={styles.trust}><li><Icon name="check_circle" fill decorative />Free to post</li><li><Icon name="verified" fill decorative />Licence-checked trades</li><li><Icon name="lock" fill decorative />One fixed price</li></ul>
      </div>
      <Image className={styles.van} src="/images/van.png" alt="" width={600} height={600} priority sizes="(min-width: 1024px) 600px, 270px" />
      <div className={styles.illustration} aria-hidden="true"><div className="tm-hero-float"><div className={styles.priceCard}>
        <div className={styles.priceCardTop}><Pill kind="action">Price ready</Pill><span>Sub wiring</span></div>
        <span className={styles.priceCaption}>Your price</span><strong>{formatCents(data.illustrationCents)}</strong><span className={styles.priceCaption}>Fixed · incl. GST</span>
        <span className={`${buttonClasses({ variant: "hero", width: "full" })} ${styles.artButton}`}>Accept &amp; pay</span>
      </div></div></div>
    </section>
    <div className={styles.phoneSearch}>{search()}</div>
    <div className={styles.phoneExamples} aria-label="Popular jobs">{examples()}</div>
    {outside && <div className={styles.coverage}><Banner tone="info" title={`We're in ${data.coverage.name}.`} action={<button className={styles.changeLocation} onClick={() => setLocationOpen(true)}>Change location</button>} /></div>}
    <section className={`${styles.wrap} ${styles.how}`} aria-labelledby="how-heading">
      <div className={styles.sectionHeading}><h2 id="how-heading">Three taps. Job sorted.</h2></div>
      <div className={styles.steps}>{STEPS.map((step, i) => <article key={step.title} className={`${styles.step} tm-lift`}>
        <span className={styles.stepIcon}><Icon name={step.icon} fill decorative /><span>{i + 1}</span></span>
        <h3><span className={styles.desktopStep}>{i + 1}. {step.title}</span><span className={styles.phoneStep}>{step.short ?? step.title}</span></h3><p>{step.text}</p>
      </article>)}</div>
    </section>
    <section className={styles.categories} aria-labelledby="category-heading"><div className={styles.wrap}>
      <div className={styles.categoryHeading}><div><h2 id="category-heading">All sorts. Any job.</h2></div><Link href="/services">See all services <Icon name="arrow_forward" decorative /></Link></div>
      <CategoryRail label="Trades">{CATEGORIES.map((category) => <li key={category} onClick={(event) => {
        // Preserve the entered text even when a category is the starting action.
        if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); start(category); }
      }}><CategoryTile category={category} sub={CATEGORY_INFO[category].sub} href={jobStartPath({ description, category, location }, data.coverage)} /></li>)}</CategoryRail>
    </div></section>
    <section className={`${styles.wrap} ${styles.why}`} aria-labelledby="why-heading"><div>
      <h2 id="why-heading">No ringing around.<br />No guessing.</h2>
      <ul className={styles.promises}>{PROMISES.map((promise) => <li key={promise.text}><span><Icon name={promise.icon} fill decorative /></span><div><b>{promise.text}</b><p>{promise.detail}</p></div></li>)}</ul>
    </div><div className={styles.collage}>{["wires", "sink", "house"].map((name) => <div key={name} className="tm-zoom"><Image className="tm-zoom__img" src={`/images/examples/large/${name}.jpg`} alt="" width={800} height={600} sizes="(min-width: 1024px) 260px, 45vw" /></div>)}</div></section>
    {data.reviews.length > 0 && <section className={styles.reviews} aria-labelledby="reviews-heading"><div className={styles.wrap}><h2 id="reviews-heading">Kiwis getting it sorted</h2>{data.exampleReviews && <p className={styles.exampleLabel}>Example reviews</p>}<div className={styles.reviewGrid}>{data.reviews.map((review) => <article className={styles.review} key={review.id}><StarRating value={review.rating} showValue={false} /><blockquote>“{review.comment}”</blockquote><div><Avatar name={review.name} size="sm" decorative /><span><b>{review.name}</b>{review.meta && <span className={styles.reviewMeta}>{review.meta}</span>}</span></div></article>)}</div></div></section>}
    <section data-mode="trade" className={styles.tradie} aria-labelledby="tradie-heading"><BoltMark variant="hero" className={styles.tradieBolt} /><div className={styles.wrap}><div><span className={styles.eyebrow}>For tradies</span><h2 id="tradie-heading">Want to work?<br />Easy as.</h2><p className={styles.tradieCopy}>Jobs already priced. No lead fees.<br />You do the work. We find the jobs.</p></div><Button href={TRADIE_SIGNUP_PATH} variant="hero">Join as a tradie</Button></div></section>
    <section className={`${styles.wrap} ${styles.questions}`} aria-labelledby="faq-heading"><div><h2 id="faq-heading">Questions?</h2><p className={styles.faqIntro}>The short answers. More in the <Link href="/help">help centre</Link>.</p></div><Faq /></section>
    <section className={styles.final} aria-labelledby="final-heading"><div className={styles.wrap}><h2 id="final-heading">What needs doing?</h2>{search(true)}</div></section>
    <Dialog open={locationOpen} onClose={() => setLocationOpen(false)} title="Location" footer={<Button onClick={() => chooseLocation({ label: locationQuery.trim() || data.coverage.name, point: locationQuery === location.label ? location.point : null })}>Use location</Button>}>
      <AddressField label="Town or suburb" name="location" placeholder="Town or suburb" value={locationQuery} maxLength={LANDING_LOCATION_MAX} status={preview?.state === "location-loading" ? "loading" : preview?.state === "location-error" ? "error" : lookup.status}
        suggestions={lookup.result?.mode === "search" ? lookup.result.suggestions : []} lookupError="Search unavailable." onQueryChange={(query) => { setLocationQuery(query); setLookup({ status: "idle" }); }}
        onSelect={(place) => { const match = lookup.result?.mode === "search" ? lookup.result.suggestions.find((p) => p.id === place.id) : undefined; if (match) chooseLocation({ label: match.city || match.label, point: match.point }); }} />
    </Dialog>
  </>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  return <div className={styles.faq}>{FAQ.map(([question, answer], i) => <div key={question} className={styles.faqItem}>
    <h3><button id={`${id}-q-${i}`} aria-controls={`${id}-a-${i}`} aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{question}<Icon name="expand_more" className="tm-chevron" decorative /></button></h3>
    <div id={`${id}-a-${i}`} role="region" aria-labelledby={`${id}-q-${i}`} className="tm-accordion" data-open={open === i} inert={open !== i}><div><p>{answer}</p></div></div>
  </div>)}</div>;
}
