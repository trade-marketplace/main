"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { DraftWhere, savedAddressMatches, type CopiedAddress } from "@/components/jobs/DraftWhere";
import { DraftReview } from "@/components/jobs/DraftReview";
import { initialWizardDraft, whereErrors } from "@/lib/post-job-wizard";
import type { SavedAddress } from "@/lib/account/addresses";
import styles from "@/components/jobs/post-job.module.css";
import { WizardFrame, PostJobWizard } from "@/components/jobs/PostJobWizard";
import type { JobDraft } from "@/lib/job-draft";
export function PostJobDemo({ state }: { state: string }) {
  if (state.startsWith("where-")) return <SavedWhereDemo state={state} />;
  const initialDraft: JobDraft = state === "empty" || state === "invalid" ? {} : {
    description: state === "other" ? "Moving some furniture and assembling a garden bench." : "Lights in the lounge keep flickering and the switch is getting warm. Pretty sure some wires behind it are exposed.",
    ...(state === "other" ? { category: "OTHER" as const } : state === "photos" ? { category: "ELECTRICAL" as const, postKey: "8608ab1f-2862-4c44-9490-88f5e17375bd" } : {}),
  };
  return <PostJobWizard previewState={state} initialDraft={initialDraft} loadFailed={state === "load-error"} save={async () => ({ status: "saved", draft: initialDraft, manualCategory: null })} />;
}

const NOW = new Date("2026-11-04T00:00:00Z");
const ADDRESSES: SavedAddress[] = [
  { id: "ce61bba4-8123-4000-8000-000000000001", label: "Home", line1: "12 Campbell St", line2: null, suburb: "Windsor", city: "Invercargill", postcode: "9810", lat: -46.4132, lng: 168.3538, locationSource: "SEARCH", isDefault: true, createdAt: NOW.toISOString() },
  { id: "ce61bba4-8123-4000-8000-000000000002", label: "Rental", line1: "24 Example Street", line2: "Unit 2", suburb: "Gladstone", city: "Invercargill", postcode: "9810", lat: -46.4, lng: 168.36, locationSource: "SEARCH", isDefault: false, createdAt: NOW.toISOString() },
  { id: "ce61bba4-8123-4000-8000-000000000003", label: "Workshop", line1: "18 Example Road", line2: null, suburb: "Windsor", city: "Invercargill", postcode: null, lat: null, lng: null, locationSource: "TYPED", isDefault: false, createdAt: NOW.toISOString() },
];
function copy(address: SavedAddress): CopiedAddress { return { addressLine1: address.line1, addressLine2: address.line2 ?? undefined, suburb: address.suburb, city: address.city, postcode: address.postcode ?? undefined, locationSource: address.locationSource ?? "TYPED", point: address.lat === null || address.lng === null ? undefined : { lat: address.lat, lng: address.lng } }; }
function SavedWhereDemo({ state }: { state: string }) {
  const router = useRouter();
  const selected = state === "where-saved-typed" ? ADDRESSES[2] : ADDRESSES[0];
  const other = ["where-saved-other", "where-no-saved"].includes(state);
  const [draft, setDraft] = useState(() => initialWizardDraft({ postKey: "ce61bba4-8123-4000-8000-000000000552", description: "Move a sofa and assemble a garden bench.", category: "OTHER", photoPaths: [], timeWindows: [{ date: "2026-11-04", timeOfDay: "MORNING" }], ...(other ? {} : copy(selected)) }, true));
  const [fields, setFields] = useState<Record<string, string>>({}); const [review, setReview] = useState(state === "where-saved-review"); const [posted, setPosted] = useState(state === "where-saved-posted");
  const online = useOnlineStatus();
  const offline = !online || state === "where-saved-offline", busy = state === "where-saved-loading";
  const back = "/dev/components/post-job?state=photos";
  if (posted) return <WizardFrame step={3} saveExit={() => router.push("/")}><h1 className={styles.title}>Posted.</h1><Button href="/" width="full-on-phone">Home</Button></WizardFrame>;
  return <WizardFrame step={review ? 3 : 2} saved={!busy} summary={draft} backHref={back} busy={busy} saveExit={() => router.push("/")} stepHrefs={["/dev/components/post-job", back, `/dev/components/post-job?state=${state}`]}>
    <OfflineBanner online={!offline} sticky={false} />
    <h1 className={styles.title}>{review ? "All good?" : "Where and when?"}</h1>
    {review ? <><DraftReview draft={draft} photos={{ photos: [], problems: [], restoring: false, saving: false, storageError: false }} editHrefs={[back, back, `/dev/components/post-job?state=${state}`]} backHref={`/dev/components/post-job?state=${state}`} busy={false} offline={offline} error={false} onPost={() => setPosted(true)} onEdit={() => setReview(false)} /></> : <DraftWhere draft={draft} now={NOW} fields={fields} busy={busy} offline={offline} backHref={back} onChange={next => { setDraft(next); setFields({}); }} onOutside={() => {}} onNext={() => { const errors = whereErrors(draft, NOW); setFields(errors); if (!Object.keys(errors).length) setReview(true); }} preview={{ manual: other, saved: { addresses: state === "where-no-saved" ? [] : ADDRESSES, selectedId: ADDRESSES.find(address => savedAddressMatches(draft, address))?.id ?? "other", error: state === "where-saved-error", loadError: state === "where-saved-load-error", copy: async id => { const row = ADDRESSES.find(address => address.id === id); return row ? { status: "saved", address: copy(row) } : { status: "unavailable" }; } } }} />}
  </WizardFrame>;
}
