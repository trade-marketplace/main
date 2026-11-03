import "server-only";
import { BOARD_TRADES, DEFAULT_BOARD_QUERY, type BoardCard, type BoardPage } from "@/lib/job-board";
import { tradeLabel } from "@/lib/account/trades";
import { haversineKm } from "@/lib/geo/distance";
import { workerJobListView, type JobSummarySource } from "@/server/views/jobs";
import { eligibleJobsFor } from "@/server/workers/eligibility";
import { eligibilityExample, PREVIEW_NOW } from "../job-eligibility/preview-data";

export const BOARD_STATES = ["ready", "empty", "not-verified", "loading", "error", "offline", "saved", "no-photo", "pay-pending", "new-jobs", "loading-more", "storage-error", "detail"] as const;
export function previewBoard(state: string): BoardPage {
  const { worker } = eligibilityExample(state === "not-verified" ? "id-unchecked" : "ready");
  worker.id = "22222222-2222-4222-8222-222222222138";
  const viewer = { userId: worker.id, role: "TRADIE" as const };
  const titles = ["Sub wiring", "Control panel", "Power point", "Switchboard", "Light switch", "Outdoor lights", "Hot water cylinder", "Move a couch + boxes"];
  const raw: JobSummarySource[] = Array.from({ length: 20 }, (_, i) => ({ id: `13800000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, jobNumber: i + 1,
    title: titles[i % titles.length], category: i % 4 === 3 ? "OTHER" : "ELECTRICAL", status: i % 5 === 2 ? "QUOTE_BOUNTY" : i % 3 === 1 ? "REVIEW" : "BOOKABLE",
    customerId: "customer-example", workerId: null, suburb: ["Windsor", "Gladstone", "Rosedale"][i % 3], city: "Invercargill", asap: i % 4 === 1,
    createdAt: new Date(PREVIEW_NOW.getTime() - i * 60_000), updatedAt: PREVIEW_NOW, lat: -46.4132 + i * .001, lng: 168.3538,
    approxLat: -46.4117 + i * .001, approxLng: 168.3538, priceCents: 99_999,
    pricing: state === "pay-pending" || i === 3 ? null : { workerGrossCents: 20_000 + i * 500, holidayPayCents: 1600, gstCents: 9000 } }));
  const ids = eligibleJobsFor(worker, raw.map(job => ({ ...job, lat: job.lat ?? null, lng: job.lng ?? null, approxLat: job.approxLat ?? null, approxLng: job.approxLng ?? null })), { now: PREVIEW_NOW });
  const cards: BoardCard[] = state === "empty" ? [] : raw.filter(job => ids.includes(job.id)).flatMap(job => {
    const safe = workerJobListView(viewer, job);
    return safe && safe.point ? [{ ...safe, distanceKm: haversineKm({ lat: -46.4132, lng: 168.3538 }, safe.point),
      photoUrl: state === "no-photo" || job.jobNumber === 3 ? null : `/images/examples/${["wires", "board", "outlet", "furniture", "switch", "house", "tanks", "furniture"][(job.jobNumber - 1) % 8]}.jpg`,
      tradeLabel: tradeLabel(safe.category), whenLabel: job.asap ? "ASAP" : "Flexible", alreadyEstimated: job.jobNumber === 2 }] : [];
  });
  return { meta: { ownerId: worker.id, areaName: "Invercargill", maxDistanceKm: 50, distanceKm: 25,
    blocked: state === "not-verified" ? "identity-required" : null,
    trades: BOARD_TRADES.map(trade => ({ trade, label: tradeLabel(trade), allowed: trade === "ELECTRICAL" || trade === "OTHER", reason: trade === "ELECTRICAL" || trade === "OTHER" ? null : "not verified" })) },
    cards, counts: { all: cards.length, ready: cards.filter(card => card.status === "BOOKABLE").length, estimate: cards.filter(card => card.status !== "BOOKABLE").length, bounty: cards.filter(card => card.status === "QUOTE_BOUNTY").length, saved: 3, estimated: 1 },
    total: cards.length, nextCursor: null, before: PREVIEW_NOW.toISOString(), scope: JSON.stringify(DEFAULT_BOARD_QUERY) };
}
