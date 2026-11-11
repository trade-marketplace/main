import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Prisma, Role, Trade } from "@/generated/prisma/client";
import { FINISH_DECLARATION, emptyFinishFields, type FinishFields } from "@/lib/finish-job";
import { addEvidenceDocument, addEvidencePhoto, evidencePhotoUrls, loadFinish, removeEvidencePhoto, saveDraft, sendForSignOff } from "@/server/jobs/evidence";
import { createUploadService, type UploadDb } from "@/server/files/service";
import { type InspectableFileStore } from "@/server/files/storage";
import { priceJob } from "@/server/pricing/price-job";
import { notificationId } from "@/server/notifications/notify";
import { inboxItem } from "@/server/notifications/inbox";
import { claimWorkerJob } from "@/server/jobs/worker-claim-command";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("finish evidence transactions", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) { const id = randomUUID(), email = `${id}@example.test`; await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`; return schema.db.profile.create({ data: { id, email, role, firstName: "Sarah", emailVerifiedAt: new Date() } }); }
  async function fixture(category: Trade = "OTHER", budget: number | null = 8500) {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN"), office2 = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.id, category, title: "Finish real work", description: "Fix the outdoor plug.", addressLine1: "150 Private Street", suburb: "Windsor", city: "Invercargill", anyTime: true, lat: -46.4132, lng: 168.3538, approxLat: -46.4117, approxLng: 168.3538 } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 8500, pricedById: office.id });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.id } });
    if (budget !== null) await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: budget } });
    await schema.db.tradeEvidenceRule.upsert({ where: { trade: category }, create: { trade: category, cocRequired: category === "ELECTRICAL", cocFileRequired: category === "ELECTRICAL", minPhotos: 1, notesRequired: true }, update: { cocRequired: category === "ELECTRICAL", cocFileRequired: category === "ELECTRICAL", minPhotos: 1, notesRequired: true } });
    const objects = new Map<string, Uint8Array>(), puts: string[] = [];
    const storage: InspectableFileStore = { async put(bucket, path, bytes) { puts.push(`${bucket}/${path}`); objects.set(`${bucket}/${path}`, bytes); }, async signedUrl(bucket, path) { if (!objects.has(`${bucket}/${path}`)) throw Error("Missing fixture file"); return `https://private-files.example.test/${bucket}/${path}?token=fixture`; }, async exists(bucket, path) { return objects.has(`${bucket}/${path}`); }, async remove(bucket, paths) { for (const path of paths) objects.delete(`${bucket}/${path}`); } };
    const uploads = createUploadService({ db: schema.db as unknown as UploadDb, store: storage });
    const deps = { store: storage, document: uploads.addDocument };
    return { job, customer, office, office2, viewer: { userId: worker.id, role: "TRADIE" as const }, deps, objects, puts };
  }
  const ready = (overrides: Partial<FinishFields> = {}): FinishFields => ({ ...emptyFinishFields(), cocNumber: "COC-150", notes: "Work finished and checked.", declaration: true, ...overrides });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
  const photo = () => readFile("public/images/examples/outlet.jpg");
  async function addPhoto(f: Awaited<ReturnType<typeof fixture>>, id = randomUUID()) { expect((await addEvidencePhoto(schema.db, f.viewer, f.job.id, await photo(), id, f.deps)).status).toBe("uploaded"); return id; }
  it("saves and reloads a draft with spend but no submission, history transition or audit", async () => {
    const f = await fixture(); await addPhoto(f);
    expect(await saveDraft(schema.db, f.viewer, f.job.id, ready({ spent: "72.50", reason: "Private office reason" }))).toEqual({ status: "saved" });
    const view = await loadFinish(schema.db, f.viewer, f.job.id, f.deps);
    expect(view).toMatchObject({ budgetCents: 8500, readOnly: false, fields: { notes: "Work finished and checked.", spent: "72.5", declaration: true, reason: "" } });
    expect(view?.photos).toHaveLength(1); expect(view?.photos[0].src).toContain("token=fixture");
    expect((await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } })).submittedAt).toBeNull();
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: { in: ["job.materials_reported", "job.submitted"] } } })).toBe(0);
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: f.job.id, toStatus: "SUBMITTED" } })).toBe(0);
    expect(JSON.stringify(view)).not.toMatch(/Private office reason|customerId|priceCents|margin|workerRate/);
  });
  it.each(["cocNumber", "cocDocument", "photos", "notes", "declaration", "receipt", "reason"] as const)("missing %s is refused before spending or evidence/submission/audit/notification changes", async missing => {
    const f = await fixture(missing === "cocNumber" || missing === "cocDocument" ? "ELECTRICAL" : "OTHER");
    if (missing !== "photos") await addPhoto(f);
    if (f.job.category === "ELECTRICAL" && missing !== "cocDocument") expect((await addEvidenceDocument(schema.db, f.viewer, f.job.id, "coc", pdf, f.deps)).status).toBe("uploaded");
    const fields = ready({ ...(missing === "cocNumber" ? { cocNumber: "" } : {}), ...(missing === "notes" ? { notes: "" } : {}), ...(missing === "declaration" ? { declaration: false } : {}), ...(missing === "receipt" ? { spent: "10" } : {}), ...(missing === "reason" ? { spent: "95" } : {}) });
    if (missing === "reason") await addEvidenceDocument(schema.db, f.viewer, f.job.id, "receipt", pdf, f.deps);
    const before = await schema.db.completionEvidence.findUnique({ where: { jobId: f.job.id } }), beforeMaterial = await schema.db.jobMaterials.findUnique({ where: { jobId: f.job.id } });
    const result = await sendForSignOff(schema.db, f.viewer, f.job.id, fields, f.deps); expect(result.status).toBe("invalid"); if (result.status === "invalid") expect(result.fields[missing]).toBeTruthy();
    expect(await schema.db.completionEvidence.findUnique({ where: { jobId: f.job.id } })).toEqual(before); expect(await schema.db.jobMaterials.findUnique({ where: { jobId: f.job.id } })).toEqual(beforeMaterial);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: { in: ["job.materials_reported", "job.submitted"] } } })).toBe(0);
    expect(await schema.db.notification.count({ where: { type: "job.submitted", payload: { path: ["jobId"], equals: f.job.id } } })).toBe(0);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("ASSIGNED");
  });
  it("electrical sends CoC plus real converted photos with the exact declaration and one customer notification", async () => {
    const f = await fixture("ELECTRICAL"); await addPhoto(f); await addEvidenceDocument(schema.db, f.viewer, f.job.id, "coc", pdf, f.deps);
    expect(await sendForSignOff(schema.db, f.viewer, f.job.id, ready({ spent: "72.5" }), f.deps)).toEqual({ status: "sent" });
    const evidence = await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } }); expect(evidence).toMatchObject({ declaration: FINISH_DECLARATION, notes: "Work finished and checked.", cocNumber: "COC-150" }); expect(evidence.submittedAt).not.toBeNull(); expect(evidence.declaredAt).not.toBeNull();
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("SUBMITTED");
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: f.job.id, toStatus: "SUBMITTED" } })).toBe(1);
    const audit = await schema.db.auditLog.findFirstOrThrow({ where: { recordId: f.job.id, action: "job.submitted" } });
    expect(audit).toMatchObject({ actorId: f.viewer.userId, actorRole: "TRADIE" });
    const notices = await schema.db.notification.findMany({ where: { type: "job.submitted", payload: { path: ["jobId"], equals: f.job.id } } }); expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ id: notificationId(`${audit.action}:${audit.id}`, f.customer.id), userId: f.customer.id, payload: { jobId: f.job.id, jobNumber: f.job.jobNumber } });
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.materials_reported" } })).toBe(1);
    expect((await loadFinish(schema.db, f.viewer, f.job.id, f.deps))?.readOnly).toBe(true);
  });
  it("a missing materials row is created at budget/spend zero, without inheriting the claim pricing fallback", async () => {
    const f = await fixture("OTHER", null); await addPhoto(f);
    expect((await loadFinish(schema.db, f.viewer, f.job.id, f.deps))?.budgetCents).toBe(0);
    expect(await sendForSignOff(schema.db, f.viewer, f.job.id, ready({ spent: "999" }), f.deps)).toEqual({ status: "sent" });
    expect(await schema.db.jobMaterials.findUniqueOrThrow({ where: { jobId: f.job.id } })).toMatchObject({ budgetCents: 0, spentCents: 0 });
  });
  it("over-budget reason stays in the office audit, and every office user is notified separately from the customer", async () => {
    const f = await fixture(); await addPhoto(f); await addEvidenceDocument(schema.db, f.viewer, f.job.id, "receipt", pdf, f.deps);
    expect(await sendForSignOff(schema.db, f.viewer, f.job.id, ready({ spent: "95", reason: "The damaged cable needed replacing." }), f.deps)).toEqual({ status: "sent" });
    expect(await schema.db.auditLog.findFirstOrThrow({ where: { recordId: f.job.id, action: "job.materials_reported" } })).toMatchObject({ reason: "The damaged cable needed replacing.", actorId: f.viewer.userId });
    expect((await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } })).notes).toBe("Work finished and checked.");
    const notices = await schema.db.notification.findMany({ where: { type: "job.materials_over_budget", payload: { path: ["jobId"], equals: f.job.id } } });
    expect(notices.map(row => row.userId).sort()).toEqual((await schema.db.profile.findMany({ where: { role: "ADMIN" } })).map(person => person.id).sort());
    for (const notice of notices) { expect(notice.userId).not.toBe(f.customer.id); expect(inboxItem(notice).href).toBe(`/admin/jobs/${f.job.id}`); }
    expect((await loadFinish(schema.db, f.viewer, f.job.id, f.deps))?.fields.reason).toBe("The damaged cable needed replacing.");
  });
  it("two concurrent sends write once, and a submitted draft/files cannot be changed", async () => {
    const f = await fixture(); const id = await addPhoto(f);
    expect(await Promise.all([sendForSignOff(schema.db, f.viewer, f.job.id, ready(), f.deps), sendForSignOff(schema.db, f.viewer, f.job.id, ready(), f.deps)])).toEqual([{ status: "sent" }, { status: "sent" }]);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.submitted" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.materials_reported" } })).toBe(1);
    expect(await saveDraft(schema.db, f.viewer, f.job.id, ready({ notes: "Changed" }))).toEqual({ status: "forbidden" });
    expect(await removeEvidencePhoto(schema.db, f.viewer, f.job.id, id, f.deps)).toEqual({ status: "forbidden" });
    expect((await addEvidencePhoto(schema.db, f.viewer, f.job.id, await photo(), randomUUID(), f.deps)).status).toBe("forbidden");
    expect((await addEvidenceDocument(schema.db, f.viewer, f.job.id, "receipt", pdf, f.deps)).status).toBe("forbidden");
    expect(await sendForSignOff(schema.db, f.viewer, f.job.id, {}, f.deps)).toEqual({ status: "sent" });
  });
  it("refuses missing rules and pending extra work without submitting, while drafts remain saveable", async () => {
    const f = await fixture(); await addPhoto(f); await schema.db.tradeEvidenceRule.delete({ where: { trade: "OTHER" } });
    expect((await loadFinish(schema.db, f.viewer, f.job.id, f.deps))?.rule).toBeNull(); expect((await sendForSignOff(schema.db, f.viewer, f.job.id, ready(), f.deps)).status).toBe("invalid");
    expect(await saveDraft(schema.db, f.viewer, f.job.id, ready())).toEqual({ status: "saved" });
    const other = await fixture(); await addPhoto(other); await schema.db.variation.create({ data: { jobId: other.job.id, requestedById: other.viewer.userId, description: "More work", requestedMinutes: 60 } });
    expect((await loadFinish(schema.db, other.viewer, other.job.id, other.deps))?.extraWorkOpen).toBe(true);
    expect((await sendForSignOff(schema.db, other.viewer, other.job.id, ready(), other.deps)).status).toBe("invalid");
  });
  it("rechecks role and current assignment for readers and every edit command", async () => {
    const f = await fixture(), other = await person("TRADIE"); const id = await addPhoto(f), foreign = { userId: other.id, role: "TRADIE" as const };
    for (const viewer of [foreign, { userId: f.customer.id, role: "TRADIE" as const }]) {
      expect(await loadFinish(schema.db, viewer, f.job.id, f.deps)).toBeNull(); expect(await saveDraft(schema.db, viewer, f.job.id, ready())).toEqual({ status: "forbidden" }); expect(await sendForSignOff(schema.db, viewer, f.job.id, ready(), f.deps)).toEqual({ status: "forbidden" });
      expect((await addEvidencePhoto(schema.db, viewer, f.job.id, await photo(), randomUUID(), f.deps)).status).toBe("forbidden"); expect((await addEvidenceDocument(schema.db, viewer, f.job.id, "coc", pdf, f.deps)).status).toBe("forbidden"); expect(await removeEvidencePhoto(schema.db, viewer, f.job.id, id, f.deps)).toEqual({ status: "forbidden" });
    }
    await schema.db.profile.update({ where: { id: f.viewer.userId }, data: { role: "CUSTOMER" } });
    expect(await saveDraft(schema.db, f.viewer, f.job.id, ready())).toEqual({ status: "forbidden" }); expect(await loadFinish(schema.db, f.viewer, f.job.id, f.deps)).toBeNull();
    expect(await loadFinish(schema.db, foreign, randomUUID(), f.deps)).toBeNull(); expect(await loadFinish(schema.db, foreign, "bad", f.deps)).toBeNull();
  });
  it("signs photos only for the current job worker, its customer and office, excluding public-board workers", async () => {
    const f = await fixture(), other = await person("TRADIE"); await addPhoto(f);
    for (const viewer of [f.viewer, { userId: f.customer.id, role: "CUSTOMER" as const }, { userId: f.office.id, role: "ADMIN" as const }]) expect(await evidencePhotoUrls(schema.db, viewer, f.job.id, f.deps)).toHaveLength(1);
    expect(await evidencePhotoUrls(schema.db, { userId: other.id, role: "TRADIE" }, f.job.id, f.deps)).toBeNull();
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "BOOKABLE" } });
    expect(await evidencePhotoUrls(schema.db, { userId: other.id, role: "TRADIE" }, f.job.id, f.deps)).toBeNull(); expect(await loadFinish(schema.db, f.viewer, f.job.id, f.deps)).toBeNull();
  });
  it("photo retries are idempotent, converted files use private evidence paths, and removal deletes only its old object", async () => {
    const f = await fixture(), id = randomUUID(), bytes = await photo();
    const first = await addEvidencePhoto(schema.db, f.viewer, f.job.id, bytes, id, f.deps), retry = await addEvidencePhoto(schema.db, f.viewer, f.job.id, bytes, id, f.deps);
    expect(first).toEqual(retry); expect(f.puts).toHaveLength(1); expect(await schema.db.completionEvidencePhoto.count({ where: { jobId: f.job.id } })).toBe(1);
    expect(f.puts[0]).toMatch(new RegExp(`^photos/evidence/${f.job.id}/[a-f0-9-]+\\.webp$`));
    expect(Buffer.from(f.objects.get(f.puts[0])!).subarray(8, 12).toString()).toBe("WEBP");
    expect(await removeEvidencePhoto(schema.db, f.viewer, f.job.id, id, f.deps)).toEqual({ status: "saved" }); expect(f.objects.has(f.puts[0])).toBe(false);
    await addEvidencePhoto(schema.db, f.viewer, f.job.id, bytes, id, f.deps); expect(f.puts[1]).not.toBe(f.puts[0]);
  });
  it("rejects unsupported/oversize files and the eleventh photo without adding rows", async () => {
    const f = await fixture(); const initial = f.puts.length;
    for (const bytes of [pdf, new Uint8Array(), new Uint8Array(10 * 1024 * 1024 + 1)]) expect((await addEvidencePhoto(schema.db, f.viewer, f.job.id, bytes, randomUUID(), f.deps)).status).toBe("invalid");
    expect(f.puts).toHaveLength(initial);
    for (let i = 0; i < 10; i++) await addPhoto(f);
    expect((await addEvidencePhoto(schema.db, f.viewer, f.job.id, await photo(), randomUUID(), f.deps)).status).toBe("invalid"); expect(await schema.db.completionEvidencePhoto.count({ where: { jobId: f.job.id } })).toBe(10);
    expect((await addEvidenceDocument(schema.db, f.viewer, f.job.id, "coc", Buffer.from("%PDF-1.4 /OpenAction /JavaScript"), f.deps)).status).toBe("invalid");
  });
  it("failed uploads keep the draft intact and missing objects stop submission before writes", async () => {
    const f = await fixture(), failing = { ...f.deps, store: { ...f.deps.store, async put() { throw Error("fixture storage unavailable"); } } };
    expect((await addEvidencePhoto(schema.db, f.viewer, f.job.id, await photo(), randomUUID(), failing)).status).toBe("unavailable"); expect(await schema.db.completionEvidencePhoto.count({ where: { jobId: f.job.id } })).toBe(0);
    await addPhoto(f); f.objects.clear();
    expect((await sendForSignOff(schema.db, f.viewer, f.job.id, ready(), f.deps)).status).toBe("invalid");
    expect((await schema.db.jobMaterials.findUniqueOrThrow({ where: { jobId: f.job.id } })).spentCents).toBeNull();
  });
  it("notification failure rolls back materials, evidence, status, history and both audits", async () => {
    const f = await fixture(); await addPhoto(f);
    const broken = new Proxy(schema.db, { get(target, key) { if (key !== "$transaction") return Reflect.get(target, key, target); return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(client, model) { if (model !== "notification") return Reflect.get(client, model, client); return { upsert: () => { throw Error("fixture notification unavailable"); } }; } }))); } });
    expect(await sendForSignOff(broken, f.viewer, f.job.id, ready(), f.deps)).toEqual({ status: "unavailable" });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("ASSIGNED"); expect((await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } })).submittedAt).toBeNull(); expect((await schema.db.jobMaterials.findUniqueOrThrow({ where: { jobId: f.job.id } })).spentCents).toBeNull(); expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: { in: ["job.materials_reported", "job.submitted"] } } })).toBe(0);
  });
  it("confirms the real claim lifecycle leaves missing materials rows for the explicit zero fallback", async () => {
    const f = await fixture("OTHER", null);
    await schema.db.workerProfile.create({ data: { userId: f.viewer.userId, identityCheckedAt: new Date(), identityCheckedById: f.office.id, baseSuburb: "Invercargill", areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 50, available: true } });
    await schema.db.pointEntry.create({ data: { workerId: f.viewer.userId, delta: 5, reason: "OFFICE" } });
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "BOOKABLE", workerId: null } });
    const claim = await claimWorkerJob(schema.db, f.viewer, f.job.id); expect(claim).toEqual(expect.objectContaining({ status: "claimed" }));
    expect(await schema.db.jobMaterials.findUnique({ where: { jobId: f.job.id } })).toBeNull();
    expect((await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } })).materialsCents).toBe(8500);
  });
});
