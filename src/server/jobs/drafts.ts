import "server-only";

import { z } from "zod";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { draftFieldErrors, jobDraftSchema, type DraftFieldErrors, type JobDraft } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";

type Db = Pick<PrismaClient, "$transaction">;
export type WizardStep = "describe" | "photos" | "where" | "review";
const WIZARD_FIELDS: Record<WizardStep, readonly (keyof JobDraft)[]> = {
  describe: ["description", "category"],
  photos: ["photoPaths"],
  where: ["addressLine1", "addressLine2", "suburb", "city", "postcode", "locationSource", "point", "accessNotes", "asap", "anyTime", "timeWindows"],
  review: [],
};
const CLEARABLE_WHERE_FIELDS = new Set<keyof JobDraft>(["addressLine2", "postcode", "point", "accessNotes"]);
type DraftOptions = {
  /** Modern wizard callers replace only the fields owned by this validated step. */
  wizardStep?: WizardStep;
  /** Address facts for this path are read from the current customer's saved row, never from the request. */
  savedAddressId?: string;
  /** Explicit internal full snapshots; photo-only and legacy callers remain patches by default. */
  fullSnapshot?: boolean;
  manualCategory?: boolean;
  expectedDraftAbsent?: boolean;
  expectedPostKey?: string;
  expectedPhotoPaths?: readonly string[];
  validatePhotos?: (tx: Prisma.TransactionClient, postKey: string | undefined, paths: string[]) => Promise<boolean>;
};
type DraftFailure = { status: "needs-account" | "forbidden" | "draft-changed" }
  | { status: "invalid"; fields: DraftFieldErrors }
  | { status: "photos-changed"; photoPaths: string[] };
type WizardSaveResult = DraftFailure | { status: "saved"; draft: JobDraft; manualCategory: boolean | null };
type LegacySaveResult = DraftFailure | { status: "saved" };

export function saveDraft(db: Db, viewer: Viewer | null, input: unknown, options: DraftOptions & { wizardStep: WizardStep }): Promise<WizardSaveResult>;
export function saveDraft(db: Db, viewer: Viewer | null, input: unknown, options?: DraftOptions & { wizardStep?: undefined }): Promise<LegacySaveResult>;
export async function saveDraft(db: Db, viewer: Viewer | null, input: unknown, options: DraftOptions = {}): Promise<WizardSaveResult | LegacySaveResult> {
  if (!viewer) return { status: "needs-account" } as const;
  if (options.savedAddressId !== undefined && (options.wizardStep !== "where" || !z.uuid().safeParse(options.savedAddressId).success)) return { status: "invalid", fields: { addressLine1: "Address" } } as const;
  const parsed = jobDraftSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", fields: draftFieldErrors(parsed.error) } as const;
  return db.$transaction(async (tx): Promise<WizardSaveResult | LegacySaveResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return { status: "forbidden" } as const;
    const previous = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    if (options.expectedDraftAbsent && previous) return { status: "draft-changed" } as const;
    const old = jobDraftSchema.parse(previous?.data ?? {});
    if (options.expectedPostKey && old.postKey !== options.expectedPostKey) return { status: "forbidden" } as const;
    if (options.expectedPostKey && parsed.data.postKey && parsed.data.postKey !== options.expectedPostKey) return { status: "forbidden" } as const;
    if (options.expectedPhotoPaths && JSON.stringify(old.photoPaths ?? []) !== JSON.stringify(options.expectedPhotoPaths)) {
      return { status: "photos-changed", photoPaths: old.photoPaths ?? [] } as const;
    }
    let values = parsed.data;
    if (options.savedAddressId !== undefined) {
      const address = await tx.address.findFirst({ where: { id: options.savedAddressId, userId: viewer.userId }, select: { line1: true, line2: true, suburb: true, city: true, postcode: true, lat: true, lng: true, locationSource: true } });
      if (!address) return { status: "forbidden" } as const;
      if (!address.locationSource || address.locationSource !== "TYPED" && (address.lat === null || address.lng === null)) return { status: "invalid", fields: { addressLine1: "Address" } } as const;
      values = { ...values, addressLine1: address.line1, addressLine2: address.line2 ?? undefined, suburb: address.suburb, city: address.city, postcode: address.postcode ?? undefined, locationSource: address.locationSource, point: address.locationSource === "TYPED" ? undefined : { lat: address.lat!, lng: address.lng! } };
    }
    let next: Record<string, unknown> = { ...(options.fullSnapshot ? {} : old), ...values };
    if (options.wizardStep && previous) {
      // A stale same-key snapshot may include newer fields from another step. Only this step can replace its
      // fields. Omitted incomplete required input keeps its valid checkpoint; omitted optional address fields
      // intentionally clear. The owner lock keeps this merge atomic with other devices' saves.
      next = { ...old };
      for (const field of WIZARD_FIELDS[options.wizardStep]) {
        // Choosing an address is an address-only checkpoint; keep existing schedule/access notes.
        if (options.savedAddressId !== undefined && !["addressLine1", "addressLine2", "suburb", "city", "postcode", "locationSource", "point"].includes(field) && values[field] === undefined) continue;
        if (CLEARABLE_WHERE_FIELDS.has(field)) delete next[field];
        if (values[field] !== undefined) next[field] = values[field];
      }
    }
    const data = jobDraftSchema.parse(next);
    if (options.validatePhotos && JSON.stringify(old.photoPaths ?? []) !== JSON.stringify(data.photoPaths ?? [])) {
      if (!await options.validatePhotos(tx, data.postKey, data.photoPaths ?? [])) return { status: "invalid", fields: { photoPaths: "Add some photos" } } as const;
    }
    const changed = old?.postKey !== data.postKey || old?.description !== data.description || old?.category !== data.category;
    const preserveOrigin = options.wizardStep && previous && (options.wizardStep !== "describe" || parsed.data.description === undefined && !changed);
    const manualCategory = preserveOrigin ? previous?.manualCategory ?? null : options.manualCategory !== undefined
      ? parsed.data.description && parsed.data.category ? options.manualCategory : null
      : changed ? null : previous?.manualCategory ?? null;
    const json = data as Prisma.InputJsonObject;
    await tx.jobDraft.upsert({ where: { profileId: viewer.userId }, create: { profileId: viewer.userId, data: json, manualCategory }, update: { data: json, manualCategory } });
    return options.wizardStep ? { status: "saved", draft: data, manualCategory } as const : { status: "saved" } as const;
  }, { timeout: 30_000 });
}

export async function loadWizardDraft(db: Db, viewer: Viewer | null) {
  if (!viewer) return null;
  return db.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return null;
    const row = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    return row ? { draft: jobDraftSchema.parse(row.data), manualCategory: row.manualCategory } : null;
  });
}

/** The shared #116 service keeps its canonical return shape. */
export async function loadDraft(db: Db, viewer: Viewer | null) {
  return (await loadWizardDraft(db, viewer))?.draft ?? null;
}
