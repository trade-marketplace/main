import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getViewer, type Viewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { copyDraftAddressAction, listDraftAddressesAction } from "@/server/jobs/posting-actions";
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
import { deleteAddress, saveAddress } from "@/server/account/addresses";
import { loadDraft, saveDraft } from "@/server/jobs/drafts";
import { postJob } from "@/server/jobs/post-job";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("saved address copies in the where step", () => {
  const schema = useTestSchema(import.meta.filename), now = new Date("2026-11-04T00:00:00Z");
  async function person(): Promise<Viewer> {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role: "CUSTOMER", email: `${id}@example.test`, firstName: "Customer", emailVerifiedAt: now } });
    return { userId: id, role: "CUSTOMER", email: `${id}@example.test`, firstName: "Customer", emailVerified: true };
  }
  async function address(viewer: Viewer, source: "SEARCH" | "PIN" | "TYPED" = "SEARCH") {
    return schema.db.address.create({ data: { userId: viewer.userId, label: "Home", line1: "12 Campbell St", line2: source === "TYPED" ? null : "Unit 2", suburb: "Windsor", city: "Invercargill", postcode: source === "TYPED" ? null : "9810", locationSource: source, lat: source === "TYPED" ? null : -46.4132, lng: source === "TYPED" ? null : 168.3538, isDefault: true } });
  }
  async function checkpoint(viewer: Viewer) {
    const postKey = randomUUID();
    const data = { postKey, description: "Move a sofa and assemble a bench", category: "OTHER" as const, photoPaths: [], addressLine1: "Old address", addressLine2: "Old unit", suburb: "Old suburb", city: "Invercargill", postcode: "9811", locationSource: "SEARCH" as const, point: { lat: -46.42, lng: 168.35 }, accessNotes: "Side gate", asap: true, anyTime: false, timeWindows: [{ date: "2026-11-04", timeOfDay: "MORNING" as const }] };
    expect(await saveDraft(schema.db, viewer, data, { manualCategory: true })).toEqual({ status: "saved" }); return data;
  }
  it.each(["SEARCH", "PIN", "TYPED"] as const)("copies every field of a %s row and preserves the other draft steps, schedule and access notes", async source => {
    const me = await person(), row = await address(me, source), original = await checkpoint(me);
    const copied = await saveDraft(schema.db, me, { addressLine1: "Forged client address", addressLine2: "Forged unit", suburb: "Forged suburb", city: "Forged city", postcode: "9999", locationSource: "SEARCH", point: { lat: -40, lng: 175 } }, { wizardStep: "where", expectedPostKey: original.postKey, savedAddressId: row.id });
    const expected = { ...original, addressLine1: row.line1, addressLine2: row.line2 ?? undefined, suburb: row.suburb, city: row.city, postcode: row.postcode ?? undefined, locationSource: source, point: source === "TYPED" ? undefined : { lat: row.lat, lng: row.lng } };
    expect(copied).toEqual({ status: "saved", draft: expected, manualCategory: true });
    expect(await loadDraft(schema.db, me)).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(await schema.db.address.findUnique({ where: { id: row.id } })).toEqual(row);
  });
  it("refuses another customer's id, missing ids, a stale draft key and revoked role with no writes", async () => {
    const me = await person(), them = await person(), own = await address(me), foreign = await address(them), original = await checkpoint(me);
    const before = await schema.db.jobDraft.findUnique({ where: { profileId: me.userId } });
    for (const id of [foreign.id, randomUUID()]) expect(await saveDraft(schema.db, me, {}, { wizardStep: "where", expectedPostKey: original.postKey, savedAddressId: id })).toEqual({ status: "forbidden" });
    expect(await saveDraft(schema.db, me, {}, { wizardStep: "where", expectedPostKey: randomUUID(), savedAddressId: own.id })).toEqual({ status: "forbidden" });
    expect(await saveDraft(schema.db, me, {}, { wizardStep: "where", savedAddressId: "not-an-id" })).toEqual({ status: "invalid", fields: { addressLine1: "Address" } });
    expect(await schema.db.jobDraft.findUnique({ where: { profileId: me.userId } })).toEqual(before);
    await schema.db.profile.update({ where: { id: me.userId }, data: { role: "TRADIE" } });
    expect(await saveDraft(schema.db, me, {}, { wizardStep: "where", expectedPostKey: original.postKey, savedAddressId: own.id })).toEqual({ status: "forbidden" });
    expect(await schema.db.jobDraft.findUnique({ where: { profileId: me.userId } })).toEqual(before);
    expect(await schema.db.job.count({ where: { customerId: me.userId } })).toBe(0);
  });
  it("does not create any draft for a foreign address when the customer has no checkpoint", async () => {
    const me = await person(), them = await person(), foreign = await address(them);
    expect(await saveDraft(schema.db, me, {}, { wizardStep: "where", savedAddressId: foreign.id })).toEqual({ status: "forbidden" });
    expect(await schema.db.jobDraft.findUnique({ where: { profileId: me.userId } })).toBeNull();
  });
  it("uses the actual guarded copy action, keeps guest/other-role choices empty and rechecks owner binding", async () => {
    const me = await person(), them = await person(), own = await address(me), foreign = await address(them), original = await checkpoint(me);
    vi.mocked(getDb).mockReturnValue(schema.db); vi.mocked(getDb).mockClear(); vi.mocked(getViewer).mockResolvedValue(null);
    expect(await listDraftAddressesAction()).toEqual({ status: "loaded", addresses: [], ownerId: null }); expect(getDb).not.toHaveBeenCalled();
    expect(await copyDraftAddressAction(own.id, original.postKey, me.userId)).toMatchObject({ error: "session-expired" });
    vi.mocked(getViewer).mockResolvedValue({ ...me, role: "TRADIE" }); expect(await listDraftAddressesAction()).toEqual({ status: "loaded", addresses: [], ownerId: null }); expect(await copyDraftAddressAction(own.id, original.postKey, me.userId)).toMatchObject({ error: "forbidden" });
    vi.mocked(getViewer).mockResolvedValue(me); const listed = await listDraftAddressesAction(); expect(listed.status).toBe("loaded"); if (listed.status !== "loaded") throw Error("Fixture list failed"); expect(listed.addresses.map(row => row.id)).toEqual([own.id]);
    const before = await loadDraft(schema.db, me);
    expect(await copyDraftAddressAction(own.id, original.postKey, them.userId)).toEqual({ status: "forbidden" }); expect(await copyDraftAddressAction(foreign.id, original.postKey, me.userId)).toEqual({ status: "forbidden" }); expect(await loadDraft(schema.db, me)).toEqual(before);
    expect(await copyDraftAddressAction(own.id, original.postKey, me.userId)).toEqual({ status: "saved", address: { addressLine1: own.line1, addressLine2: own.line2, suburb: own.suburb, city: own.city, postcode: own.postcode, locationSource: "SEARCH", point: { lat: own.lat, lng: own.lng } } });
  });
  it("retains an independent draft after editing/deleting the saved row and the same independent job after posting", async () => {
    const me = await person(), row = await address(me), original = await checkpoint(me);
    const answer = await saveDraft(schema.db, me, {}, { wizardStep: "where", expectedPostKey: original.postKey, savedAddressId: row.id });
    expect(answer.status).toBe("saved"); if (answer.status !== "saved") throw Error("Fixture copy failed");
    const snapshot = await loadDraft(schema.db, me);
    expect((await saveAddress(schema.db, me, { id: row.id, label: "Changed", line1: "90 Different Road", line2: "", suburb: "Gladstone", city: "Invercargill", postcode: "9811", locationSource: "TYPED", point: null })).ok).toBe(true);
    expect(await loadDraft(schema.db, me)).toEqual(snapshot);
    expect((await deleteAddress(schema.db, me, row.id)).ok).toBe(true); expect(await loadDraft(schema.db, me)).toEqual(snapshot);
    const posted = await postJob(schema.db, me, snapshot, original.postKey, { now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }), notifyWorkers: async () => {} });
    expect(posted.status).toBe("posted"); if (posted.status !== "posted") throw Error("Fixture post failed");
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: posted.jobId } });
    expect(job).toMatchObject({ addressLine1: row.line1, addressLine2: row.line2, suburb: row.suburb, city: row.city, postcode: row.postcode, locationSource: "SEARCH", lat: row.lat, lng: row.lng });
    expect(await schema.db.address.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await schema.db.jobDraft.findUnique({ where: { profileId: me.userId } })).toBeNull();
  });
});
