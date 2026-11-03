"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { CustomerSignup } from "@/components/auth/CustomerSignup";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { DraftReview } from "@/components/jobs/DraftReview";
import { WizardFrame } from "@/components/jobs/PostJobWizard";
import { Dialog } from "@/components/overlays/Dialog";
import { initialWizardDraft } from "@/lib/post-job-wizard";
import type { DraftPhoto, PhotoSnapshot } from "@/lib/jobs/draft-photo-manager";
import styles from "@/components/jobs/post-job.module.css";

export function ReviewDemo({ state }: { state: string }) {
  const router = useRouter();
  const [signup, setSignup] = useState(state.startsWith("signup"));
  const [error, setError] = useState(state === "error");
  const photos: DraftPhoto[] = state === "no-photos" ? [] : ["wires", "outlet", "switch"].map((name, index) => ({ id: name, name: `${name}.jpg`, src: `/images/examples/${name}.jpg`, status: state === "uploading" && index === 1 ? "uploading" : state === "photo-error" && index === 1 ? "failed" : "done", progress: 0.4, prepared: true, generation: index }));
  const snapshot: PhotoSnapshot = { photos, problems: [], restoring: state === "loading", saving: false, storageError: false };
  const draft = { ...initialWizardDraft({ postKey: "8608ab1f-2862-4c44-9490-88f5e17375bd", description: "Lights in the lounge keep flickering and the switch is getting warm.", category: "ELECTRICAL", photoPaths: [], addressLine1: "12 Dee Street", addressLine2: "Shop 2", suburb: "Gladstone", city: "Invercargill", postcode: "9810", locationSource: "TYPED", accessNotes: "Use the side entrance.", asap: true, anyTime: false, timeWindows: [{ date: "2026-11-04", timeOfDay: "MORNING" }, { date: "2026-11-05", timeOfDay: "AFTERNOON" }] }, true), completedPhotos: true, completedWhere: true };
  const hrefs = ["/dev/components/post-job?state=describe", "/dev/components/post-job-photos?state=full", "/dev/components/post-job-where?state=manual"];
  const busy = state === "posting";
  return <><WizardFrame step={3} saved={!busy && state !== "loading" && state !== "uploading"} summary={draft} photoPreviews={photos} stepHrefs={hrefs} busy={busy} saveExit={busy ? undefined : () => router.push("/")}>
    <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    <h1 className={styles.title}>{state === "posted" ? "Posted." : "All good?"}</h1>
    {state === "posted" ? <><p>TM-1042</p><Button href="/">Home</Button></> : <DraftReview draft={draft} photos={snapshot} editHrefs={hrefs} backHref={hrefs[2]} busy={busy} offline={state === "offline"} error={error} onPost={() => state === "guest" ? setSignup(true) : setError(true)} onEdit={() => {}} />}
  </WizardFrame><Dialog open={signup} onClose={() => setSignup(false)} title="Create account" footer={<Link href="/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview">Log in instead</Link>}>
    <CustomerSignup embedded next="/jobs/new?step=review" previewPending={state === "signup-pending"} previewOffline={state === "signup-offline" || state === "signup-recovery"} initialState={state === "signup-error" || state === "signup-recovery" ? { ok: false, error: "unavailable", values: {} } : undefined} />
  </Dialog></>;
}
