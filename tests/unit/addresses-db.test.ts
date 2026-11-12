import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addressInput, type AddressInput } from "@/lib/account/addresses";
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress } from "@/server/account/addresses";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("saved addresses transactions", () => {
  const schema = useTestSchema(import.meta.filename);
  const input = (label = "Home"): AddressInput => ({ requestId: randomUUID(), label, line1: "12 Never Audit Street", line2: "Unit 2", suburb: "Windsor", city: "Invercargill", postcode: "9810", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 } });
  async function person(role: "CUSTOMER" | "TRADIE" = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Test" } });
    return { userId: id, role };
  }
  async function add(viewer: Awaited<ReturnType<typeof person>>, label = "Home") {
    const answer = await saveAddress(schema.db, viewer, input(label));
    expect(answer.ok).toBe(true); if (!answer.ok) throw Error("Fixture address failed");
    return answer.addresses.find(row => row.label === label)!;
  }
  it("retries the same create key once after commit, including concurrently and at the limit", async () => {
    const me = await person(), data = input("Retry");
    const answers = await Promise.all([saveAddress(schema.db, me, data), saveAddress(schema.db, me, data)]);
    expect(answers.every(answer => answer.ok)).toBe(true);
    expect(await listAddresses(schema.db, me)).toHaveLength(1);
    expect((await listAddresses(schema.db, me))[0].id).toBe(data.requestId);
    expect(await schema.db.auditLog.count({ where: { actorId: me.userId, action: "address.saved" } })).toBe(1);
    for (let i = 1; i < 10; i++) await add(me, `Extra ${i}`);
    expect((await saveAddress(schema.db, me, data)).ok).toBe(true);
    expect(await listAddresses(schema.db, me)).toHaveLength(10);
    expect((await saveAddress(schema.db, me, { ...data, label: "Updated retry" })).ok).toBe(true);
    expect((await listAddresses(schema.db, me)).find(row => row.id === data.requestId)?.label).toBe("Updated retry");
    const other = await person(), foreign = await add(other);
    expect(await saveAddress(schema.db, me, { ...input(), requestId: foreign.id })).toEqual({ ok: false, error: "forbidden" });
    expect((await listAddresses(schema.db, other))[0]).toMatchObject({ id: foreign.id, label: "Home" });
  });
  it("makes the first address default, lists only its owner and keeps default first", async () => {
    const me = await person(), other = await person();
    const first = await add(me), second = await add(me, "Rental"); await add(other, "Other");
    const rows = await listAddresses(schema.db, me);
    expect(rows.map(row => row.id)).toEqual([first.id, second.id]);
    expect(rows.filter(row => row.isDefault)).toHaveLength(1);
    expect(await listAddresses(schema.db, { ...me, role: "TRADIE" })).toEqual([]);
  });
  it("moves default atomically, handles an idempotent retry and never leaves two defaults", async () => {
    const me = await person(), first = await add(me), second = await add(me, "Rental");
    expect((await setDefaultAddress(schema.db, me, second.id)).ok).toBe(true);
    expect((await listAddresses(schema.db, me)).filter(row => row.isDefault).map(row => row.id)).toEqual([second.id]);
    const before = await schema.db.auditLog.count({ where: { actorId: me.userId } });
    expect((await setDefaultAddress(schema.db, me, second.id)).ok).toBe(true);
    expect(await schema.db.auditLog.count({ where: { actorId: me.userId } })).toBe(before);
    expect((await listAddresses(schema.db, me)).find(row => row.id === first.id)?.isDefault).toBe(false);
  });
  it("promotes the most recently added remaining address when deleting default, and permits an empty list", async () => {
    const me = await person(), first = await add(me), second = await add(me, "Rental"), third = await add(me, "Work");
    expect((await deleteAddress(schema.db, me, first.id)).ok).toBe(true);
    expect((await listAddresses(schema.db, me)).filter(row => row.isDefault).map(row => row.id)).toEqual([third.id]);
    const auditCount = await schema.db.auditLog.count({ where: { actorId: me.userId } });
    const retry = await deleteAddress(schema.db, me, first.id);
    expect(retry).toMatchObject({ ok: true });
    if (retry.ok) expect(retry.addresses.map(row => row.id)).toEqual([third.id, second.id]);
    expect(await schema.db.auditLog.count({ where: { actorId: me.userId } })).toBe(auditCount);
    await deleteAddress(schema.db, me, third.id);
    expect((await listAddresses(schema.db, me))[0]).toMatchObject({ id: second.id, isDefault: true });
    await deleteAddress(schema.db, me, second.id); expect(await listAddresses(schema.db, me)).toEqual([]);
  });
  it("refuses an eleventh address but still allows editing at the limit", async () => {
    const me = await person();
    for (let i = 0; i < 10; i++) await add(me, `Address ${i}`);
    expect(await saveAddress(schema.db, me, input("Eleventh"))).toEqual({ ok: false, error: "limit" });
    const first = (await listAddresses(schema.db, me))[0];
    expect((await saveAddress(schema.db, me, { ...addressInput(first), label: "Updated" })).ok).toBe(true);
    expect(await listAddresses(schema.db, me)).toHaveLength(10);
  });
  it("refuses another person's address id for every command without changing rows or audits", async () => {
    const me = await person(), other = await person(), address = await add(other);
    const before = await schema.db.auditLog.count();
    expect(await saveAddress(schema.db, me, { ...input(), id: address.id })).toEqual({ ok: false, error: "forbidden" });
    expect(await saveAddress(schema.db, me, { id: address.id })).toEqual({ ok: false, error: "forbidden" });
    expect(await deleteAddress(schema.db, me, address.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await setDefaultAddress(schema.db, me, address.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await schema.db.auditLog.count()).toBe(before);
    expect(await listAddresses(schema.db, other)).toHaveLength(1);
  });
  it("refuses tradies and a stale customer role before any write", async () => {
    const tradie = await person("TRADIE");
    expect(await saveAddress(schema.db, tradie, input())).toEqual({ ok: false, error: "forbidden" });
    const me = await person(), address = await add(me);
    await schema.db.profile.update({ where: { id: me.userId }, data: { role: "TRADIE" } });
    for (const command of [() => saveAddress(schema.db, me, { ...input(), id: address.id }), () => deleteAddress(schema.db, me, address.id), () => setDefaultAddress(schema.db, me, address.id)]) expect(await command()).toEqual({ ok: false, error: "forbidden" });
    expect(await listAddresses(schema.db, me)).toEqual([]);
  });
  it("serializes simultaneous default changes and simultaneous first inserts", async () => {
    const me = await person(), first = await add(me), second = await add(me, "Rental"), third = await add(me, "Work");
    expect((await Promise.all([setDefaultAddress(schema.db, me, second.id), setDefaultAddress(schema.db, me, third.id)])).every(answer => answer.ok)).toBe(true);
    const rows = await listAddresses(schema.db, me);
    expect(rows.filter(row => row.isDefault)).toHaveLength(1); expect(rows.find(row => row.id === first.id)?.isDefault).toBe(false);
    const empty = await person();
    expect((await Promise.all([saveAddress(schema.db, empty, input("One")), saveAddress(schema.db, empty, input("Two"))])).every(answer => answer.ok)).toBe(true);
    expect((await listAddresses(schema.db, empty)).filter(row => row.isDefault)).toHaveLength(1);
  });
  it("serializes two creates at nine addresses and never admits an eleventh", async () => {
    const me = await person(); for (let i = 0; i < 9; i++) await add(me, `Address ${i}`);
    const answers = await Promise.all([saveAddress(schema.db, me, input("Ten")), saveAddress(schema.db, me, input("Eleven"))]);
    expect(answers.filter(answer => answer.ok)).toHaveLength(1);
    expect(answers.filter(answer => !answer.ok && answer.error === "limit")).toHaveLength(1);
    expect(await listAddresses(schema.db, me)).toHaveLength(10);
  });
  it("deleting a saved address leaves an existing job's independent address unchanged", async () => {
    const me = await person(), address = await add(me);
    const job = await schema.db.job.create({ data: { customerId: me.userId, category: "OTHER", title: "Test saved address", description: "A local address-copy fixture.", addressLine1: address.line1, addressLine2: address.line2, suburb: address.suburb, city: address.city, postcode: address.postcode, lat: address.lat, lng: address.lng, locationSource: "SEARCH", anyTime: true } });
    await deleteAddress(schema.db, me, address.id);
    const after = await schema.db.job.findUnique({ where: { id: job.id } });
    for (const field of ["addressLine1", "addressLine2", "suburb", "city", "postcode", "lat", "lng", "status"] as const) expect(after?.[field]).toEqual(job[field]);
  });
  it("keeps street/unit/postcode/coordinates out of audit snapshots", async () => {
    const me = await person(), first = await add(me), second = await add(me, "Rental");
    await setDefaultAddress(schema.db, me, second.id); await deleteAddress(schema.db, me, first.id);
    const audits = await schema.db.auditLog.findMany({ where: { actorId: me.userId } });
    expect(audits.length).toBeGreaterThan(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({ recordType: "profiles", recordId: me.userId, actorRole: "CUSTOMER" });
      for (const data of [audit.before, audit.after]) expect(Object.keys(data ?? {}).every(key => ["suburb", "label"].includes(key))).toBe(true);
    }
    const json = JSON.stringify(audits.map(audit => [audit.before, audit.after]));
    for (const privateValue of ["Never Audit Street", "Unit 2", "9810", "-46.4132", "168.3538"]) expect(json).not.toContain(privateValue);
  });
  it("persists typed addresses without a point and preserves untouched legacy provenance", async () => {
    const me = await person();
    expect((await saveAddress(schema.db, me, { ...input(), locationSource: "TYPED", point: null })).ok).toBe(true);
    const typed = (await listAddresses(schema.db, me))[0]; expect(typed).toMatchObject({ lat: null, lng: null, locationSource: "TYPED" });
    await schema.db.address.update({ where: { id: typed.id }, data: { locationSource: "PIN", lat: -46.41, lng: 168.35 } });
    const legacy = (await listAddresses(schema.db, me))[0];
    expect((await saveAddress(schema.db, me, { ...addressInput(legacy), label: "Legacy" })).ok).toBe(true);
    expect((await listAddresses(schema.db, me))[0]).toMatchObject({ locationSource: "PIN", lat: -46.41, lng: 168.35, label: "Legacy" });
    expect(await saveAddress(schema.db, me, { ...addressInput(legacy), line1: "Changed street" })).toMatchObject({ ok: false, error: "invalid" });
  });
  it("rolls back a default change when its audit cannot be written", async () => {
    const me = await person(), first = await add(me), second = await add(me, "Rental");
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_address_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='address.default_changed' AND NEW.actor_id='${me.userId}'::uuid THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_address_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_address_audit()`);
    expect(await setDefaultAddress(schema.db, me, second.id)).toEqual({ ok: false, error: "unavailable" });
    expect((await listAddresses(schema.db, me)).filter(row => row.isDefault).map(row => row.id)).toEqual([first.id]);
  });
});
