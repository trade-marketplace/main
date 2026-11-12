import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { listCustomers } from "@/server/office/customers";
import { listOfficeJobs, exportOfficeJobs, officeJobsWhere } from "@/server/office/jobs";
import { parseCustomersQuery } from "@/lib/office/customers";
import { parseOfficeJobsQuery } from "@/lib/office-jobs";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("read-only office customer lookup", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role, firstName = `Person${randomUUID()}`, phone: string | null = null) {
    const id = randomUUID(), email = `${id}@example.test`; await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, role, firstName, lastName: "Taylor", email, phone, avatarPath: "private-avatar-not-selected" } }); return { userId: id, role, firstName, email };
  }
  async function job(customerId: string, title: string, createdAt = new Date(), category: "OTHER" | "PLUMBING" = "OTHER") { return schema.db.job.create({ data: { customerId, category, title, description: "A test job", addressLine1: "Private job address never selected", suburb: "Windsor", city: "Invercargill", createdAt } }); }
  it("selects only customers and the planned fields, with the default suburb, all-job count and newest creation date", async () => {
    const name = `Lookup${randomUUID()}`, office = await person("ADMIN"), customer = await person("CUSTOMER", name, "+64211234567"), tradie = await person("TRADIE", name), admin = await person("ADMIN", name);
    await schema.db.address.create({ data: { userId: customer.userId, line1: "Private non-default address", suburb: "Avenal", city: "Invercargill" } });
    await schema.db.address.create({ data: { userId: customer.userId, line1: "Private default address", suburb: "Windsor", city: "Invercargill", isDefault: true } });
    await job(customer.userId, "Older", new Date("2026-10-01T01:00:00Z")); const latest = await job(customer.userId, "Newest", new Date("2026-11-11T01:00:00Z"));
    const result = await listCustomers(schema.db, office, parseCustomersQuery({ q: name })); expect(result?.total).toBe(1); expect(result?.rows).toEqual([{ id: customer.userId, name: `${name} Taylor`, email: customer.email, mobile: "+64211234567", suburb: "Windsor", jobs: 2, lastJobAt: latest.createdAt.toISOString(), joinedAt: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toMatch(/Private|private-avatar|addressLine|bank|payment/); expect(result?.rows.map(row => row.id)).not.toContain(tradie.userId); expect(result?.rows.map(row => row.id)).not.toContain(admin.userId);
    expect(await schema.db.auditLog.count()).toBe(0);
  });
  it("searches full names, email and displayed national/E.164 mobile; missing address/jobs stay null/zero", async () => {
    const office = await person("ADMIN"), name = `Search${randomUUID()}`, customer = await person("CUSTOMER", name, "+64219876543");
    for (const q of [`${name} Taylor`, customer.email, "+64 21 987 6543", "021 987 6543"]) expect((await listCustomers(schema.db, office, parseCustomersQuery({ q })))?.rows.map(row => row.id)).toContain(customer.userId);
    const row = (await listCustomers(schema.db, office, parseCustomersQuery({ q: customer.email })))?.rows[0]; expect(row).toMatchObject({ suburb: null, jobs: 0, lastJobAt: null });
    expect((await listCustomers(schema.db, office, parseCustomersQuery({ q: "%" })))?.total).toBe(0);
    expect((await listCustomers(schema.db, office, parseCustomersQuery({ q: "' OR true --" })))?.total).toBe(0);
  });
  it("rechecks the role and refuses customers, tradies, forged and revoked office users", async () => {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN"), query = parseCustomersQuery({});
    for (const viewer of [customer, worker, { ...customer, role: "ADMIN" as const }]) expect(await listCustomers(schema.db, viewer, query)).toBeNull();
    await schema.db.profile.update({ where: { id: office.userId }, data: { role: "CUSTOMER" } }); expect(await listCustomers(schema.db, office, query)).toBeNull();
  });
  it("sorts every supported column in both directions, keeps null last-job dates last, and pages without duplicates", async () => {
    const office = await person("ADMIN"), prefix = `Paging${randomUUID()}`;
    const a = await person("CUSTOMER", `${prefix} A`), b = await person("CUSTOMER", `${prefix} B`), c = await person("CUSTOMER", `${prefix} C`);
    await schema.db.profile.update({ where: { id: a.userId }, data: { createdAt: new Date("2026-10-01T01:00:00Z") } }); await schema.db.profile.update({ where: { id: b.userId }, data: { createdAt: new Date("2026-10-02T01:00:00Z") } }); await schema.db.profile.update({ where: { id: c.userId }, data: { createdAt: new Date("2026-10-03T01:00:00Z") } });
    await job(a.userId, "A old", new Date("2026-10-05T01:00:00Z")); await job(b.userId, "B old", new Date("2026-10-06T01:00:00Z")); await job(b.userId, "B newest", new Date("2026-10-07T01:00:00Z"));
    const ids = async (sort: string) => (await listCustomers(schema.db, office, parseCustomersQuery({ q: prefix, sort })))?.rows.map(row => row.id);
    expect(await ids("name.asc")).toEqual([a.userId, b.userId, c.userId]); expect(await ids("name.desc")).toEqual([c.userId, b.userId, a.userId]); expect(await ids("jobs.desc")).toEqual([b.userId, a.userId, c.userId]); expect(await ids("jobs.asc")).toEqual([c.userId, a.userId, b.userId]); expect(await ids("lastJob.desc")).toEqual([b.userId, a.userId, c.userId]); expect(await ids("lastJob.asc")).toEqual([a.userId, b.userId, c.userId]); expect(await ids("joined.desc")).toEqual([c.userId, b.userId, a.userId]); expect(await ids("joined.asc")).toEqual([a.userId, b.userId, c.userId]);
    for (let i = 0; i < 24; i++) await person("CUSTOMER", `${prefix} ${String(i).padStart(2, "0")}`);
    const first = await listCustomers(schema.db, office, parseCustomersQuery({ q: prefix })), second = await listCustomers(schema.db, office, parseCustomersQuery({ q: prefix, page: "999" }));
    expect(first?.total).toBe(27); expect(first?.rows).toHaveLength(25); expect(second?.rows).toHaveLength(2); expect(second?.query.page).toBe(2); expect(new Set([...first!.rows, ...second!.rows].map(row => row.id)).size).toBe(27);
  });
  it("scopes All jobs and its export to the selected customer alongside existing filters and ignores malformed ids", async () => {
    const office = await person("ADMIN"), a = await person("CUSTOMER", "Sarah"), b = await person("CUSTOMER", "Alex"), one = await job(a.userId, "Scoped other"), two = await job(a.userId, "Scoped plumbing", new Date(), "PLUMBING"), other = await job(b.userId, "Other customer");
    const query = parseOfficeJobsQuery({ customer: a.userId }), result = await listOfficeJobs(office, query, { db: schema.db }); expect(result.total).toBe(2); expect(result.rows.map(row => row.id).sort()).toEqual([one.id, two.id].sort()); expect(result.customerLabel).toBe("Sarah T.");
    const narrowed = parseOfficeJobsQuery({ customer: a.userId, status: "active", trade: "PLUMBING", region: "invercargill", q: "Scoped" }); expect((await listOfficeJobs(office, narrowed, { db: schema.db })).rows.map(row => row.id)).toEqual([two.id]); expect((await exportOfficeJobs(office, narrowed, { db: schema.db })).rows.map(row => row.id)).toEqual([two.id]);
    const invalid = parseOfficeJobsQuery({ customer: "not-a-uuid" }); expect(officeJobsWhere({ ...invalid, customer: "also-bad" }, new Date())).toEqual({}); expect((await listOfficeJobs(office, invalid, { db: schema.db })).rows.map(row => row.id)).toContain(other.id);
  });
});
