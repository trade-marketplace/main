"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { DraftWhere } from "@/components/jobs/DraftWhere";
import { JobWindows, JobWindowsLoadError, JobWindowsLoading } from "@/components/jobs/JobWindows";
import { WizardFrame } from "@/components/jobs/PostJobWizard";
import { Banner } from "@/components/overlays/Banner";
import { initialWizardDraft, whereErrors } from "@/lib/post-job-wizard";
import { waitlistSharePath } from "@/lib/waitlist";
import styles from "@/components/jobs/post-job.module.css";

// A fixed Auckland calendar day keeps preview labels stable across bot runs and time zones.
const NOW = new Date("2026-11-04T00:00:00Z");
const inside = { id: "example-inside", label: "12 Dee Street, Invercargill", line1: "12 Dee Street", suburb: "Gladstone", city: "Invercargill", postcode: "9810", point: { lat: -46.4132, lng: 168.3538 }, coverage: { status: "inside" as const, distanceKm: 1 } };
const outside = { ...inside, id: "example-outside", label: "12 Princes Street, Dunedin", line1: "12 Princes Street", suburb: "Dunedin Central", city: "Dunedin", postcode: "9016", point: { lat: -45.874, lng: 170.503 }, coverage: { status: "outside" as const, distanceKm: 175, waitlistPath: "/coming-soon" } };
export function WhereDemo({ state, embedded = false }: { state: string; embedded?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => initialWizardDraft({ postKey: "8608ab1f-2862-4c44-9490-88f5e17375bd", description: "Lights in the lounge keep flickering and the switch is getting warm.", category: "ELECTRICAL", photoPaths: [],
    ...(state === "empty" || state === "invalid" ? {} : { addressLine1: ["results", "loading", "outside"].includes(state) ? "12 Dee" : inside.line1, suburb: inside.suburb, city: inside.city, postcode: inside.postcode, locationSource: "TYPED" as const, timeWindows: [{ date: state === "expired" ? "2026-11-03" : "2026-11-04", timeOfDay: "MORNING" as const }], asap: state === "review" }),
  }, true));
  const [fields, setFields] = useState<Record<string, string>>(() => state === "invalid" ? whereErrors(draft, NOW) : {});
  const [review, setReview] = useState(state === "review");
  useEffect(() => { if (["results", "loading", "outside"].includes(state)) document.getElementById("job-address")?.focus(); }, [state]);
  if (state.startsWith("update")) {
    const Container = embedded ? "section" : "main"; const id = embedded ? undefined : "main";
    if (state === "update-loading") return <Container id={id}><JobWindowsLoading embedded={embedded} /></Container>;
    if (state === "update-load-error") return <Container id={id}><JobWindowsLoadError embedded={embedded} /></Container>;
    const initial = { id: "8608ab1f-2862-4c44-9490-88f5e17375bd", jobNumber: 1042, title: draft.description, editable: state !== "update-claimed", revision: "preview", schedule: { asap: false, anyTime: false, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" as const }] } };
    return <Container id={id}><JobWindows embedded={embedded} initial={initial} initialNow={NOW.toISOString()} preview={state.slice(7)} save={async (_id, schedule) => ({ status: "saved", snapshot: { ...initial, schedule } })} /></Container>;
  }
  const suggestions = state === "outside" ? [outside] : [inside];
  return <WizardFrame step={review ? 3 : 2} saved={state !== "saving"} summary={draft} backHref="/dev/components/post-job-photos?state=full" saveExit={() => router.push("/")}
    stepHrefs={["/dev/components/post-job?state=describe", "/dev/components/post-job-photos?state=full", "/dev/components/post-job-where?state=manual"]}>
    <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    {state === "save-error" && <Banner tone="alert" title="Couldn’t save." className={styles.notice} />}
    <h1 className={styles.title}>{review ? "All good?" : "Where and when?"}</h1>
    {review ? <Button variant="secondary" width="auto" onClick={() => setReview(false)}>Back</Button> : <DraftWhere draft={draft} now={NOW} fields={fields} busy={state === "saving"} offline={state === "offline"} backHref="/dev/components/post-job-photos?state=full"
      onChange={next => { setDraft(next); setFields({}); }} onNext={() => { const errors = whereErrors(draft, NOW); setFields(errors); if (!Object.keys(errors).length) setReview(true); }} onOutside={(_next, suggestion) => router.push(waitlistSharePath(suggestion.suburb))}
      preview={{ manual: ["manual", "offline", "expired", "save-error"].includes(state), status: state === "loading" ? "loading" : ["results", "outside"].includes(state) ? "ready" : state === "manual" ? "error" : "idle", suggestions: ["results", "outside"].includes(state) ? suggestions : [] }} />}
  </WizardFrame>;
}
