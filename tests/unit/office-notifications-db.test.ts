import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { officeInbox } from "@/app/admin/notifications/inbox";
import type { Role } from "@/generated/prisma/client";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office notification access", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(), email = id + "@example.test";
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: role } });
    return id;
  }
  async function notice(userId: string, type = "variation.requested") {
    return schema.db.notification.create({ data: { userId, type, payload: { jobId: "owned-job" } } });
  }

  it("returns owned office destinations and limits single and bulk read markers to this viewer", async () => {
    const viewer = await person("ADMIN"), other = await person("ADMIN");
    const first = await notice(viewer), second = await notice(viewer, "job.cancel_requested"), foreign = await notice(other);
    const initial = await officeInbox(schema.db, viewer, {});
    expect(initial).toMatchObject({ ok: true, inbox: { unread: 2, total: 2 } });
    if (!initial.ok) throw Error("Expected an office inbox");
    expect(initial.inbox.items.map(item => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(initial.inbox.items.map(item => item.href)).toEqual(["/admin/jobs/owned-job", "/admin/jobs/owned-job"]);
    expect(await officeInbox(schema.db, viewer, {}, foreign.id)).toMatchObject({ ok: true, inbox: { unread: 2 } });
    expect(await officeInbox(schema.db, viewer, { filter: "unread" }, first.id)).toMatchObject({ ok: true, inbox: { unread: 1, items: [{ id: second.id }] } });
    expect(await officeInbox(schema.db, viewer, {}, null)).toMatchObject({ ok: true, inbox: { unread: 0 } });
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
  });

  it("labels scheduler notices and opens their office jobs", async () => {
    const viewer = await person("ADMIN");
    await notice(viewer, "bounty.expired");
    await notice(viewer, "job.unclaimed");
    const result = await officeInbox(schema.db, viewer, {});
    expect(result).toMatchObject({ ok: true, inbox: { items: expect.arrayContaining([
      expect.objectContaining({ line: "Bounty expired", icon: "timer_off", href: "/admin/jobs/owned-job" }),
      expect.objectContaining({ line: "Unclaimed > 48h", icon: "schedule", href: "/admin/jobs/owned-job" }),
    ]) } });
  });

  it.each(["CUSTOMER", "TRADIE"] as const)("denies %s even if they have a notification", async role => {
    const viewer = await person(role), own = await notice(viewer);
    for (const readId of [undefined, own.id, null]) {
      expect(await officeInbox(schema.db, viewer, {}, readId)).toEqual({ ok: false, error: "forbidden" });
    }
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt).toBeNull();
  });
});
