import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role, Trade } from "@/generated/prisma/client";
import { beginLicenceStage, claimLicenceStage, MAX_PENDING_LICENCE_UPLOADS, SIGNED_STAGE_MS, STAGE_CLEANUP_GRACE_MS, type LicenceStaging } from "@/server/account/licence-upload";
import { licenceDocumentCleanup } from "@/server/scheduler/licence-document-cleanup";
import { licenceUploadCleanup } from "@/server/scheduler/licence-upload-cleanup";
import { tradesRoute } from "@/server/account/trades-route";
import { createLicenceDocumentUploader } from "@/server/account/licence-documents";
import type { FileStore } from "@/server/files/storage";
import { loadTrades, saveTrade } from "@/server/account/trades";
import { transitionJob, TransitionPreconditionError, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { licenceExpiryReminder } from "@/server/scheduler/licence-reminders";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("trades, licences and expiry reminders (Postgres)", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date("2026-11-03T11:05:00Z"); // New Zealand Nov 4, UTC Nov 3.
  async function person(role: Role = "TRADIE") {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.test`, role, firstName: "Test", emailVerifiedAt: now } });
    if (role === "TRADIE") await schema.db.workerProfile.create({ data: { userId: id } });
    return id;
  }
  const document = (id: string) => `licences/${id}/${"a".repeat(32)}.pdf`;
  const details = (trade = "ELECTRICAL", expiresOn = "2027-03-31") => ({ trade, number: trade === "ELECTRICAL" ? "E 123456" : "PGDB 98211", expiresOn });
  const save = (id: string, expiresOn = "2027-03-31") => saveTrade(schema.db, id, details("ELECTRICAL", expiresOn), async () => document(id), now);
  async function reviewed(id: string, expiresOn: string | null, status: "VERIFIED" | "REJECTED" | "PENDING" = "VERIFIED") {
    const office = await person("ADMIN");
    await save(id);
    return schema.db.licence.update({ where: { userId_trade: { userId: id, trade: "ELECTRICAL" } }, data: { expiresOn: expiresOn ? new Date(expiresOn) : null, status, checkedById: status === "PENDING" ? null : office, checkedAt: status === "PENDING" ? null : now, rejectionReason: status === "REJECTED" ? "Licence photo was unreadable" : null } });
  }
  const remind = () => licenceExpiryReminder.run({ db: schema.db, now, limit: 200 });

  it("keeps staging records behind RLS and revokes browser-role table privileges", async () => {
    const tables = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(`SELECT relrowsecurity FROM pg_class WHERE oid = '"${schema.name}".licence_upload_stages'::regclass`);
    expect(tables).toEqual([{ relrowsecurity: true }]);
    const grants = await schema.db.$queryRawUnsafe<{ allowed: boolean }[]>(`SELECT has_table_privilege(oid, '"${schema.name}".licence_upload_stages', 'SELECT,INSERT,UPDATE,DELETE') AS allowed FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
    expect(grants.every(row => !row.allowed)).toBe(true);
    expect(await schema.db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE oid = '"${schema.name}".licence_document_cleanup'::regclass`)).toEqual([{ relrowsecurity: true }]);
    const cleanupGrants = await schema.db.$queryRawUnsafe<{ allowed: boolean }[]>(`SELECT has_table_privilege(oid, '"${schema.name}".licence_document_cleanup', 'SELECT,INSERT,UPDATE,DELETE') AS allowed FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
    expect(cleanupGrants.every(row => !row.allowed)).toBe(true);
  });
  it("adds Other without a licence or upload, and repeated requests never duplicate the trade", async () => {
    const id = await person(); const input = { trade: "OTHER", number: "", expiresOn: "" };
    await saveTrade(schema.db, id, input, null, now); await saveTrade(schema.db, id, input, null, now);
    expect(await schema.db.workerTrade.count({ where: { userId: id } })).toBe(1);
    expect(await schema.db.licence.count({ where: { userId: id } })).toBe(0);
  });
  it("stores restricted work for office checking and returns only the current worker's safe rows", async () => {
    const first = await person(); const second = await person();
    const result = await save(first);
    expect(result).toMatchObject({ ok: true, snapshot: { rows: [{ trade: "ELECTRICAL", licence: { status: "PENDING", hasDocument: true } }] } });
    const stored = await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: first, trade: "ELECTRICAL" } } });
    expect(stored).toMatchObject({ documentPath: document(first), status: "PENDING", checkedAt: null, expiryRemindedAt: null });
    expect(await loadTrades(schema.db, second, now)).toEqual({ today: "2026-11-04", rows: [] });
    expect(JSON.stringify(await loadTrades(schema.db, first, now))).not.toContain(document(first));
    expect(await schema.db.auditLog.findMany({ where: { recordId: stored.id } })).toEqual([expect.objectContaining({ actorId: first, action: "licence.submitted" })]);
  });
  it("keeps rejection feedback until a replacement is uploaded, then returns it to Checking", async () => {
    const id = await person(); const licence = await reviewed(id, "2027-03-31", "REJECTED");
    expect((await loadTrades(schema.db, id, now)).rows[0].licence?.rejectionReason).toBe("Licence photo was unreadable");
    expect(await saveTrade(schema.db, id, details(), null, now)).toMatchObject({ ok: false, fields: { document: expect.any(String) } });
    expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).status).toBe("REJECTED");
    expect(await save(id)).toMatchObject({ ok: true });
    expect(await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).toMatchObject({ status: "PENDING", rejectionReason: null, checkedAt: null, checkedById: null, expiryRemindedAt: null });
  });
  it("never accepts a foreign document path, self-verification, customer identity or invalid expiry", async () => {
    const id = await person(); const upload = vi.fn(async () => document(id));
    expect(await saveTrade(schema.db, id, details("ELECTRICAL", "2026-11-03"), upload, now)).toMatchObject({ ok: false, error: "invalid" });
    expect(upload).not.toHaveBeenCalled();
    await expect(saveTrade(schema.db, id, details(), async () => document(randomUUID()), now)).rejects.toMatchObject({ code: "not-allowed" });
    const customer = await person("CUSTOMER");
    expect(await saveTrade(schema.db, customer, details(), upload, now)).toEqual({ ok: false, error: "forbidden" });
    expect(upload).not.toHaveBeenCalled();
    await saveTrade(schema.db, id, { ...details(), status: "VERIFIED" } as ReturnType<typeof details>, upload, now);
    expect((await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: id, trade: "ELECTRICAL" } } })).status).toBe("PENDING");
  });
  it("reminds once at the 30-day boundary, safely under concurrent runs", async () => {
    const id = await person(); const licence = await reviewed(id, "2026-12-04");
    await Promise.all([remind(), remind()]); await remind();
    expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).expiryRemindedAt).toEqual(now);
    expect(await schema.db.notification.findMany({ where: { userId: id, type: "licence.expiring" } })).toEqual([expect.objectContaining({ payload: expect.objectContaining({ licenceId: licence.id, expiresOn: "2026-12-04" }) })]);
  });
  it("skips expired, undated, distant, pending and rejected licences", async () => {
    for (const [expiry, status] of [["2026-11-03", "VERIFIED"], [null, "VERIFIED"], ["2026-12-05", "VERIFIED"], ["2026-11-20", "PENDING"], ["2026-11-20", "REJECTED"]] as const) {
      const id = await person(); const licence = await reviewed(id, expiry, status);
      await remind();
      expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).expiryRemindedAt).toBeNull();
      expect(await schema.db.notification.count({ where: { userId: id, type: "licence.expiring" } })).toBe(0);
    }
  });
  it("rolls the reminder marker back when delivery fails, so the next run can recover", async () => {
    const id = await person(); const licence = await reviewed(id, "2026-11-20");
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_reminder() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'licence.expiring' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_reminder BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_reminder()`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await remind()).failed).toBeGreaterThan(0); }
    finally { log.mockRestore(); await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_reminder ON "${schema.name}".notifications`); }
    expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).expiryRemindedAt).toBeNull();
    await remind(); expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).expiryRemindedAt).toEqual(now);
  });
  it("renews the reminder eligibility only after a new licence is submitted and checked", async () => {
    const id = await person(); const licence = await reviewed(id, "2026-11-20");
    await remind(); await save(id, "2027-03-31");
    expect((await schema.db.licence.findUniqueOrThrow({ where: { id: licence.id } })).expiryRemindedAt).toBeNull();
    await schema.db.licence.update({ where: { id: licence.id }, data: { status: "VERIFIED", expiresOn: new Date("2026-12-01"), checkedById: await person("ADMIN"), checkedAt: now } });
    await remind();
    expect(await schema.db.notification.count({ where: { userId: id, type: "licence.expiring" } })).toBe(2);
  });
  it("blocks restricted work after expiry at New Zealand midnight, while Other stays licence-free", async () => {
    const worker = await person(); await reviewed(worker, "2026-11-03");
    const customer = await person("CUSTOMER");
    const job = (category: Trade) => schema.db.job.create({ data: { customerId: customer, category, title: "A test job", description: "A test job requiring work", addressLine1: "1 Test St", suburb: "Windsor", city: "Invercargill", status: "BOOKABLE", priceCents: 10000 } });
    const deps: StatusMachineDeps = { audit: async () => {}, notify: async () => {} };
    await expect(transitionJob(schema.db, deps, { jobId: (await job("ELECTRICAL")).id, transition: "claim", actor: { role: "TRADIE", userId: worker }, now })).rejects.toBeInstanceOf(TransitionPreconditionError);
    expect((await transitionJob(schema.db, deps, { jobId: (await job("OTHER")).id, transition: "claim", actor: { role: "TRADIE", userId: worker }, now })).to).toBe("ASSIGNED");
    await schema.db.licence.update({ where: { userId_trade: { userId: worker, trade: "ELECTRICAL" } }, data: { expiresOn: new Date("2026-11-04") } });
    expect((await transitionJob(schema.db, deps, { jobId: (await job("ELECTRICAL")).id, transition: "claim", actor: { role: "TRADIE", userId: worker }, now })).to).toBe("ASSIGNED");
  });
  it("bounds concurrent private staging grants and consumes only an unexpired owned grant once", async () => {
    const id = await person(); const staging: LicenceStaging = { sign: vi.fn(async () => "https://files.test/signed-write"), read: vi.fn(), remove: vi.fn() };
    const grants = await Promise.all(Array.from({ length: MAX_PENDING_LICENCE_UPLOADS + 3 }, () => beginLicenceStage(schema.db, id, staging, now)));
    expect(grants.filter(Boolean)).toHaveLength(MAX_PENDING_LICENCE_UPLOADS);
    expect(staging.sign).toHaveBeenCalledTimes(MAX_PENDING_LICENCE_UPLOADS);
    const stage = grants.find(Boolean)!;
    expect(await claimLicenceStage(schema.db, randomUUID(), stage.path, now)).toBe(false);
    expect(await claimLicenceStage(schema.db, id, stage.path + "forged", now)).toBe(false);
    expect(await claimLicenceStage(schema.db, id, stage.path, now)).toBe(true);
    expect(await claimLicenceStage(schema.db, id, stage.path, now)).toBe(false);
    const unused = grants.filter(Boolean)[1]!;
    expect(await claimLicenceStage(schema.db, id, unused.path, new Date(now.getTime() + SIGNED_STAGE_MS))).toBe(false);
    // Finishing does not discard tracking while a signed upload token could still recreate the raw object.
    expect(await schema.db.licenceUploadStage.count({ where: { userId: id } })).toBe(MAX_PENDING_LICENCE_UPLOADS);
  });
  it("finalizes a 6 MB private PDF through byte validation, removes its raw copy, and never accepts raw scripts", async () => {
    const id = await person(); const instant = new Date();
    const files = new Map<string, Uint8Array>();
    const staging: LicenceStaging = { sign: vi.fn(async () => "https://files.test/signed-write"), read: async path => files.get(path)!, remove: vi.fn(async path => { files.delete(path); }) };
    const store: FileStore = { put: vi.fn(), signedUrl: vi.fn(), remove: vi.fn() };
    const upload = createLicenceDocumentUploader(schema.db, store);
    const viewer = { userId: id, role: "TRADIE" as const, firstName: "Test", email: "test@example.test", emailVerified: true };
    const send = async (bytes: Uint8Array) => {
      const stage = (await beginLicenceStage(schema.db, id, staging, instant))!; files.set(stage.path, bytes);
      const form = new FormData(); form.set("trade", "ELECTRICAL"); form.set("number", "E 123456"); form.set("expiresOn", "2027-03-31"); form.set("stagedDocument", stage.path);
      const response = await tradesRoute(viewer, new Request("https://example.test/api/profile/trades", { method: "POST", body: form }), { db: () => schema.db, limit: async () => ({ allowed: true }), staging: () => staging, upload });
      expect(files.has(stage.path)).toBe(false); expect(await schema.db.licenceUploadStage.findUnique({ where: { path: stage.path } })).toMatchObject({ finalizedAt: expect.any(Date) });
      return response;
    };
    const pdf = Buffer.alloc(6 * 1024 * 1024, 32); pdf.write("%PDF-1.7\n");
    expect((await send(pdf)).status).toBe(200); expect(store.put).toHaveBeenCalledTimes(1);
    expect((await send(Buffer.from("<script>alert(1)</script>"))).status).toBe(400); expect(store.put).toHaveBeenCalledTimes(1);
    expect((await send(Buffer.from("%PDF-1.7\n/JavaScript(alert)"))).status).toBe(400); expect(store.put).toHaveBeenCalledTimes(1);
  });
  it("cleans abandoned and recreated raw uploads only after signed-token expiry, bounded per run and retryable", async () => {
    await schema.db.licenceUploadStage.deleteMany();
    const id = await person(); const staging: LicenceStaging = { sign: vi.fn(async () => "https://files.test/signed-write"), read: vi.fn(), remove: vi.fn(async () => {}) };
    const first = (await beginLicenceStage(schema.db, id, staging, now))!; const second = (await beginLicenceStage(schema.db, id, staging, now))!;
    await claimLicenceStage(schema.db, id, first.path, now);
    const rule = licenceUploadCleanup(() => staging);
    expect((await rule.run({ db: schema.db, now: new Date(now.getTime() + SIGNED_STAGE_MS), limit: 1 })).due).toBe(0);
    const expired = new Date(now.getTime() + SIGNED_STAGE_MS + STAGE_CLEANUP_GRACE_MS);
    vi.mocked(staging.remove).mockRejectedValueOnce(new Error("storage down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await rule.run({ db: schema.db, now: expired, limit: 1 })).failed).toBe(1); } finally { log.mockRestore(); }
    expect(await schema.db.licenceUploadStage.count({ where: { userId: id } })).toBe(2);
    expect((await rule.run({ db: schema.db, now: expired, limit: 1 })).done).toBe(1);
    expect((await rule.run({ db: schema.db, now: expired, limit: 1 })).done).toBe(1);
    expect(staging.remove).toHaveBeenCalledWith(first.path); expect(staging.remove).toHaveBeenCalledWith(second.path);
    expect(await schema.db.licenceUploadStage.count({ where: { userId: id } })).toBe(0);
  });

  it("queues superseded documents after successful replacement, preserves shared/current files and retries failed deletion", async () => {
    await schema.db.licenceDocumentCleanup.deleteMany();
    const id = await person(); const old = document(id); const replacement = `licences/${id}/${"b".repeat(32)}.pdf`; const another = `licences/${id}/${"c".repeat(32)}.pdf`;
    await save(id);
    await saveTrade(schema.db, id, details("PLUMBING"), async () => old, now);
    await saveTrade(schema.db, id, details(), async () => replacement, now);
    expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path: old } })).toMatchObject({ userId: id });
    const store = { remove: vi.fn(async () => {}) }; const rule = licenceDocumentCleanup(() => store);
    expect((await rule.run({ db: schema.db, now, limit: 1 })).skipped).toBe(1); expect(store.remove).not.toHaveBeenCalled();
    await saveTrade(schema.db, id, details("PLUMBING"), async () => another, now);
    vi.mocked(store.remove).mockRejectedValueOnce(new Error("storage down")); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await rule.run({ db: schema.db, now, limit: 1 })).failed).toBe(1); } finally { log.mockRestore(); }
    expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path: old } })).not.toBeNull();
    expect((await rule.run({ db: schema.db, now, limit: 1 })).done).toBe(1); expect(store.remove).toHaveBeenLastCalledWith("documents", [old]);
    expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path: old } })).toBeNull();
    await saveTrade(schema.db, id, details(), async () => replacement, now);
    expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path: replacement } })).toBeNull();
    expect((await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: id, trade: "ELECTRICAL" } } })).documentPath).toBe(replacement);
  });
  it("serializes a new shared-path attachment with cleanup so a currently uploaded file survives", async () => {
    await schema.db.licenceDocumentCleanup.deleteMany();
    const id = await person(); const old = document(id); const next = `licences/${id}/${"d".repeat(32)}.pdf`;
    await save(id); await saveTrade(schema.db, id, details(), async () => next, now);
    const files = new Set([old, next]); const store = { remove: vi.fn(async (_bucket: string, paths: string[]) => { for (const path of paths) files.delete(path); }) };
    let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; }); let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
    const saving = saveTrade(schema.db, id, details("GAS"), async () => { files.add(old); started(); await ready; return old; }, now);
    await entered; const cleanup = licenceDocumentCleanup(() => store).run({ db: schema.db, now, limit: 1 }); release();
    await saving; await cleanup;
    expect(files.has(old)).toBe(true); expect(store.remove).not.toHaveBeenCalled();
    expect((await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: id, trade: "GAS" } } })).documentPath).toBe(old);
  });

  it("commits a new-file cleanup intent before Storage put, so an audit rollback cannot strand the final document", async () => {
    await schema.db.licenceDocumentCleanup.deleteMany();
    const id = await person(); const files = new Map<string, Uint8Array>();
    const store: FileStore = {
      signedUrl: vi.fn(),
      put: vi.fn(async (_bucket, path, bytes) => { expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path } })).toMatchObject({ userId: id }); files.set(path, bytes); }),
      remove: vi.fn(async (_bucket, paths) => { for (const path of paths) files.delete(path); }),
    };
    const upload = createLicenceDocumentUploader(schema.db, store);
    const viewer = { userId: id, role: "TRADIE" as const };
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_licence_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'licence.submitted' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_licence_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_licence_audit()`);
    try { await expect(saveTrade(schema.db, id, details(), async () => (await upload(viewer, Buffer.from("%PDF-1.7\nlicence"))).path, now)).rejects.toThrow(); }
    finally { await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_licence_audit ON "${schema.name}".audit_log`); }
    expect(await schema.db.licence.count({ where: { userId: id } })).toBe(0); expect(files.size).toBe(1);
    const path = [...files.keys()][0]!; expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path } })).not.toBeNull();
    expect((await licenceDocumentCleanup(() => store).run({ db: schema.db, now, limit: 1 })).done).toBe(1);
    expect(files.size).toBe(0); expect(await schema.db.licenceDocumentCleanup.findUnique({ where: { path } })).toBeNull();
  });

  it("gives identical uploads different final keys so an ambiguous late delete cannot remove a new attachment", async () => {
    await schema.db.licenceDocumentCleanup.deleteMany();
    const id = await person(); const files = new Map<string, Uint8Array>(); let failDelete = true;
    const store: FileStore = { signedUrl: vi.fn(), put: vi.fn(async (_bucket, path, bytes) => { files.set(path, bytes); }),
      remove: vi.fn(async (_bucket, paths) => { for (const path of paths) files.delete(path); if (failDelete) { failDelete = false; throw new Error("response lost after removal"); } }),
    };
    const upload = createLicenceDocumentUploader(schema.db, store); const viewer = { userId: id, role: "TRADIE" as const }; const pdf = Buffer.from("%PDF-1.7\nsame licence");
    const send = async (trade = "ELECTRICAL") => { await saveTrade(schema.db, id, details(trade), async () => (await upload(viewer, pdf)).path, now); return (await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: id, trade: trade as "ELECTRICAL" | "GAS" } } })).documentPath!; };
    const old = await send(); const replacement = await send(); expect(replacement).not.toBe(old);
    const rule = licenceDocumentCleanup(() => store); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await rule.run({ db: schema.db, now, limit: 1 })).failed).toBe(1); } finally { log.mockRestore(); }
    const sharedTrade = await send("GAS"); expect(sharedTrade).not.toBe(old); expect(sharedTrade).not.toBe(replacement);
    expect((await rule.run({ db: schema.db, now, limit: 1 })).done).toBe(1);
    // The original removal arrives after its retry and the later uploads. It still names only the old key.
    files.delete(old); expect(files.has(replacement)).toBe(true); expect(files.has(sharedTrade)).toBe(true);
  });

});
