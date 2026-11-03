import type { Metadata } from "next";
import { PostedJob, CustomerJobSummary } from "@/components/jobs/PostedJob";
import type { CustomerJobView } from "@/server/views";
import type { PushCardState } from "@/lib/browser-push";
import { guardDevPage } from "@/server/dev-pages";
import { postConfirmationEmail } from "@/server/notifications/post-confirmation-template";

export const metadata: Metadata = { title: "Posted (dev)", robots: { index: false, follow: false } };
const ownerId = "11111111-1111-4111-8111-111111111121";
function example(status: CustomerJobView["status"] = "REVIEW", index = 1): CustomerJobView {
  return { id: `12100000-0000-4000-8000-${String(index).padStart(12, "0")}`, jobNumber: 1042, title: "Flickering lounge lights", category: "ELECTRICAL", status,
    suburb: "Gladstone", city: "Invercargill", asap: false, createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z", priceCents: status === "REVIEW" ? null : 12500, gstCents: null,
    description: "Lights in the lounge keep flickering and the switch is getting warm.", address: { line1: "12 Dee Street", line2: null, postcode: "9810", accessNotes: "Use the side entrance." }, point: null,
    anyTime: true, timeWindows: [], bookedDate: null, bookedTime: null, photos: [], photosNeedCheck: false, worker: null };
}
const cards: PushCardState[] = ["loading", "ready", "requesting", "enabled", "denied", "unsupported", "unavailable", "error"];
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage(); const params = await searchParams, state = typeof params.state === "string" ? params.state : "ready";
  if (state === "email") {
    const email = postConfirmationEmail({ jobId: example().id, customerId: ownerId, jobNumber: 1042, title: example().title, recipientEmail: "preview@example.test" });
    return <iframe title="Posted confirmation email" srcDoc={email.html} sandbox="" style={{ border: 0, width: "100%", height: "1050px" }} />;
  }
  if (state === "detail" || state === "legacy") return <CustomerJobSummary job={{ ...example(state === "detail" ? "PRICED" : "REVIEW"), anyTime: state !== "legacy", asap: state === "legacy" }} />;
  if (state === "status-gallery") return <>{(["QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as const).map((status, index) => <PostedJob key={status} job={example(status, index + 2)} ownerId={ownerId} push={null} previewState="unavailable" />)}</>;
  return <PostedJob job={example()} ownerId={ownerId} push={null} previewState={cards.includes(state as PushCardState) ? state as PushCardState : "ready"} />;
}
