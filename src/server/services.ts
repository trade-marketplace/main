import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { Category } from "@/lib/cards";
import type { ServiceContent, ServiceData } from "@/lib/services";
import { serviceWaitlistInput } from "@/lib/services";
import { suburbKey, type WaitlistResult } from "@/lib/waitlist";
import { getDb } from "@/server/db";
import { loadCoverage } from "@/server/geo/coverage-settings";

const custom = { name: "Something else", icon: "search", custom: true };
const jobs = (values: [string, string][]) => [...values.map(([name, icon]) => ({ name, icon })), custom];

/** Launch trade configuration (#333). Future office/CMS data can supply this same content contract.
 * Availability is server configuration; public query strings never switch a trade on or off. */
export const SERVICE_CONTENT: Record<Category, ServiceContent> = {
  electrical: { category: "electrical", live: true, heroImage: "/images/services/meter.png", headline: "Electricians", intro: "Licence-checked sparkies. One fixed price.", popularHeading: "Popular electrical jobs", jobs: jobs([
    ["New power point", "electrical_services"], ["Lights & downlights", "light"], ["Heat pump circuit", "heat_pump"], ["Fault finding", "bolt"], ["EV charger", "ev_charger"], ["Switchboard upgrade", "electric_meter"], ["Rewire a room", "outlet"],
  ]) },
  plumbing: { category: "plumbing", live: true, heroImage: "/images/services/pipe.png", headline: "Plumbers", intro: "Plumbing jobs. One fixed price. Someone local sorts it.", popularHeading: "Popular plumbing jobs", jobs: jobs([
    ["Leaking tap", "water_drop"], ["Blocked drain", "plumbing"], ["Replace a toilet", "bathroom"], ["New kitchen tap", "water"], ["Hot water problem", "water_heater"], ["Leaking pipe", "plumbing"], ["Shower repairs", "shower"],
  ]) },
  gas: { category: "gas", live: true, headline: "Gas fitters", intro: "Gas fitting jobs. One fixed price. Someone local sorts it.", popularHeading: "Popular gas fitting jobs", jobs: jobs([
    ["Gas hob installation", "skillet"], ["Gas hot water", "water_heater"], ["Gas heater servicing", "local_fire_department"], ["Gas appliance connection", "valve"],
  ]) },
  construction: { category: "construction", live: true, heroImage: "/images/services/gun.png", headline: "Builders", intro: "Building jobs. One fixed price. Someone local sorts it.", popularHeading: "Popular building jobs", jobs: jobs([
    ["Fix a fence", "fence"], ["Hang a door", "door_front"], ["Deck repairs", "deck"], ["Replace weatherboards", "home_repair_service"], ["Repair steps", "stairs"], ["Fit shelves", "shelves"], ["Fix a gate", "fence"],
  ]) },
  other: { category: "other", live: true, headline: "Anything else", intro: "Moving, cleaning, gardening, assembly. Any kind of labour. One fixed price.", popularHeading: "Popular jobs", jobs: jobs([
    ["Move a couch", "weekend"], ["Cleaning", "cleaning_services"], ["Gardening", "yard"], ["Furniture assembly", "handyman"], ["Rubbish removal", "delete"], ["Help with a move", "local_shipping"], ["General labour", "construction"],
  ]) },
};

type ServiceStore = Pick<PrismaClient, "review">;
export async function loadService(category: Category, db: ServiceStore | null = process.env.DATABASE_URL?.trim() ? getDb() : null): Promise<ServiceData> {
  const coverage = await loadCoverage();
  if (!db) return { ...SERVICE_CONTENT[category], coverage, reviews: [] };
  try {
    const reviews = await db.review.findMany({
      where: { hiddenAt: null, comment: { not: null }, job: { trade: tradeValue(category) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3,
      select: { id: true, rating: true, comment: true, reviewer: { select: { firstName: true } } },
    });
    return { ...SERVICE_CONTENT[category], coverage, reviews: reviews.filter((r) => r.comment?.trim()).map((r) => ({ id: r.id, rating: r.rating, comment: r.comment!, name: r.reviewer.firstName })) };
  } catch {
    console.error("Service reviews unavailable.");
    return { ...SERVICE_CONTENT[category], coverage, reviews: [], reviewsUnavailable: true };
  }
}

function tradeValue(category: Category) {
  return ({ electrical: "ELECTRICAL", plumbing: "PLUMBING", gas: "GAS", construction: "CONSTRUCTION", other: "OTHER" } as const)[category];
}

export type ServiceWaitlistStore = Pick<PrismaClient, "serviceWaitlistEntry">;
export async function saveServiceWaitlist(input: unknown, database: () => ServiceWaitlistStore | null = () => process.env.DATABASE_URL?.trim() ? getDb() : null): Promise<WaitlistResult> {
  const parsed = serviceWaitlistInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", ...(field === "email" || field === "suburb" ? { field } : {}) };
  }
  try {
    const db = database();
    if (!db) return { status: "error" };
    const { trade, ...details } = parsed.data;
    await db.serviceWaitlistEntry.create({ data: { ...details, suburbKey: suburbKey(details.suburb), trade: tradeValue(trade) } });
    return { status: "joined" };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return { status: "already-on-list" };
    console.error("Service waitlist could not be saved.");
    return { status: "error" };
  }
}
