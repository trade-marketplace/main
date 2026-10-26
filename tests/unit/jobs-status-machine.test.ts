import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobStatus, Prisma, PrismaClient, Role, Trade } from "@/generated/prisma/client";
import { priceJob } from "@/server/pricing/price-job";
import {
  type Actor,
  type ActorKind,
  IllegalTransitionError,
  type JobFacts,
  JobNotFoundError,
  type JobSnapshot,
  JobTransitionError,
  type StatusMachineDeps,
  TRANSITIONS,
  type TransitionName,
  TransitionForbiddenError,
  TransitionPreconditionError,
  type TransitionRequest,
  decideTransition,
  transitionJob,
} from "@/server/jobs/status-machine";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// The job status machine (#93): every transition from every status, by every kind of actor, then the same
// against a real database, including two people acting at once.

const STATUSES: JobStatus[] = [
  "REVIEW",
  "QUOTE_BOUNTY",
  "PRICED",
  "BOOKABLE",
  "ASSIGNED",
  "SUBMITTED",
  "COMPLETED",
  "CANCEL_REVIEW",
  "CANCELLED",
];
const KINDS: ActorKind[] = ["customer", "worker", "office", "system"];

const CUSTOMER = "00000000-0000-4000-8000-00000000000c";
const WORKER = "00000000-0000-4000-8000-00000000000a";
const OFFICE = "00000000-0000-4000-8000-00000000000f";

function actorOf(kind: ActorKind): Actor {
  switch (kind) {
    case "customer":
      return { role: "CUSTOMER", userId: CUSTOMER };
    case "worker":
      return { role: "TRADIE", userId: WORKER };
    case "office":
      return { role: "ADMIN", userId: OFFICE };
    case "system":
      return { role: "SYSTEM", source: "test" };
  }
}

function snapshot(status: JobStatus, data: Partial<JobSnapshot> = {}): JobSnapshot {
  const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
  return {
    id: "job-1",
    jobNumber: 1001,
    status,
    customerId: CUSTOMER,
    workerId: claimed ? WORKER : null,
    category: "OTHER",
    priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12_000,
    ...data,
  };
}

/** Facts and input under which each transition's preconditions all hold. */
const HAPPY_FACTS: JobFacts = {
  hasPricing: true,
  jobPaymentPaid: true,
  moneyHeld: false,
  workerLicensed: true,
  evidenceSentAt: new Date("2026-10-01T00:00:00Z"),
  extraWorkOpen: false,
  problemOpen: false,
  autoReleaseHours: 48,
  statusBeforeCancelReview: "ASSIGNED",
};
function happyRequest(transition: TransitionName, kind: ActorKind): TransitionRequest {
  return {
    jobId: "job-1",
    transition,
    actor: actorOf(kind),
    reason: "Customer rang the office",
    to: "CANCELLED",
    now: new Date("2026-10-10T00:00:00Z"),
  };
}
function happyJob(transition: TransitionName, status: JobStatus): JobSnapshot {
  // Sending the price needs a price on the job already (priceJob, #94).
  return transition === "send-price" ? snapshot(status, { priceCents: 12_000 }) : snapshot(status);
}

describe("decideTransition: every transition × status × actor", () => {
  const names = Object.keys(TRANSITIONS) as TransitionName[];
  const cases = names.flatMap((transition) =>
    STATUSES.flatMap((status) => KINDS.map((kind) => ({ transition, status, kind }))),
  );

  it.each(cases)("$transition from $status by the $kind", ({ transition, status, kind }) => {
    const rule = TRANSITIONS[transition];
    const run = () => decideTransition(happyJob(transition, status), happyRequest(transition, kind), HAPPY_FACTS);

    if (!rule.by.includes(kind)) {
      expect(run).toThrow(TransitionForbiddenError);
    } else if (rule.from !== "any" && !rule.from.includes(status)) {
      expect(run).toThrow(IllegalTransitionError);
    } else if (transition === "override" && status === "CANCELLED") {
      // Overriding to the status it's already in changes nothing, so it's refused.
      expect(run).toThrow(TransitionPreconditionError);
    } else {
      const plan = run();
      expect(plan.from).toBe(status);
      if (rule.to) expect(plan.to).toBe(rule.to);
    }
  });

  it("covers every server status in sitemap.json job_statuses as a target", () => {
    const targets = new Set<JobStatus>();
    for (const name of Object.keys(TRANSITIONS) as TransitionName[]) {
      const to = TRANSITIONS[name].to;
      if (to) targets.add(to);
    }
    targets.add("CANCEL_REVIEW"); // cancel / decline after paying
    targets.add("REVIEW"); // override (e.g. back to estimates)
    expect([...targets].sort()).toEqual([...STATUSES].sort());
  });
});

describe("decideTransition: preconditions and what-ifs", () => {
  const decide = (
    status: JobStatus,
    request: Partial<TransitionRequest> & { transition: TransitionName },
    facts: JobFacts = HAPPY_FACTS,
    job: Partial<JobSnapshot> = {},
  ) => decideTransition(snapshot(status, job), { jobId: "job-1", actor: actorOf("customer"), ...request }, facts);

  const failure = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof TransitionPreconditionError) return error.failure;
      throw error;
    }
    throw new Error("expected a precondition failure");
  };

  it("cancels free before payment, with no reason needed", () => {
    expect(decide("REVIEW", { transition: "cancel" }, { moneyHeld: false }).to).toBe("CANCELLED");
    expect(decide("PRICED", { transition: "decline-price" }, { moneyHeld: false }).to).toBe("CANCELLED");
  });

  it("sends a cancel after paying to CANCEL_REVIEW, and needs a reason", () => {
    for (const status of ["BOOKABLE", "ASSIGNED"] as const) {
      const plan = decide(status, { transition: "cancel", reason: "Changed my mind" }, { moneyHeld: false });
      expect(plan).toMatchObject({ to: "CANCEL_REVIEW", action: "job.cancel_requested", reason: "Changed my mind" });
      expect(failure(() => decide(status, { transition: "cancel", reason: "  " }))).toBe("reason-required");
    }
  });

  it("keeps the worker on the job while a cancellation is reviewed (they see On hold)", () => {
    expect(decide("ASSIGNED", { transition: "cancel", reason: "Moving house" }).workerId).toBe(WORKER);
  });

  it("treats a paid quick look as paid: cancelling or declining then goes to review", () => {
    expect(decide("QUOTE_BOUNTY", { transition: "cancel", reason: "No longer needed" }, { moneyHeld: true }).to).toBe(
      "CANCEL_REVIEW",
    );
    expect(decide("PRICED", { transition: "decline-price", reason: "Too dear" }, { moneyHeld: true }).to).toBe(
      "CANCEL_REVIEW",
    );
  });

  it("refuses a customer acting on someone else's job", () => {
    expect(() => decide("REVIEW", { transition: "cancel" }, {}, { customerId: randomUUID() })).toThrow(
      TransitionForbiddenError,
    );
  });

  it("needs a verified licence to claim restricted work, but not Other work", () => {
    const claim = { transition: "claim" as const, actor: actorOf("worker") };
    expect(failure(() => decide("BOOKABLE", claim, { workerLicensed: false }, { category: "ELECTRICAL" }))).toBe(
      "licence-required",
    );
    expect(decide("BOOKABLE", claim, { workerLicensed: true }, { category: "ELECTRICAL" }).workerId).toBe(WORKER);
    expect(decide("BOOKABLE", claim, { workerLicensed: false }, { category: "OTHER" }).workerId).toBe(WORKER);
  });

  it("won't let a worker claim their own job", () => {
    const claim = { transition: "claim" as const, actor: actorOf("worker") };
    expect(failure(() => decide("BOOKABLE", claim, HAPPY_FACTS, { customerId: WORKER }))).toBe("own-job");
  });

  it("only lets the job's own worker submit, once evidence is sent and no extra work is open", () => {
    const submit = { transition: "submit" as const, actor: actorOf("worker") };
    expect(() => decide("ASSIGNED", submit, HAPPY_FACTS, { workerId: randomUUID() })).toThrow(TransitionForbiddenError);
    expect(failure(() => decide("ASSIGNED", submit, { ...HAPPY_FACTS, evidenceSentAt: null }))).toBe(
      "evidence-not-sent",
    );
    expect(failure(() => decide("ASSIGNED", submit, { ...HAPPY_FACTS, extraWorkOpen: true }))).toBe("extra-work-open");
    expect(decide("ASSIGNED", submit).to).toBe("SUBMITTED");
  });

  it("needs a price (and its breakdown) before sending it", () => {
    const send = { transition: "send-price" as const, actor: actorOf("office") };
    expect(failure(() => decide("REVIEW", send, { hasPricing: true }, { priceCents: null }))).toBe("not-priced");
    expect(failure(() => decide("REVIEW", send, { hasPricing: false }, { priceCents: 100 }))).toBe("not-priced");
  });

  it("needs a paid job payment before the job is bookable", () => {
    const paid = { transition: "mark-paid" as const, actor: actorOf("system") };
    expect(failure(() => decide("PRICED", paid, { jobPaymentPaid: false }))).toBe("not-paid");
  });

  it("auto signs off only after the release window, and never while a problem is open", () => {
    const sentAt = new Date("2026-10-01T00:00:00Z");
    const auto = (hoursLater: number, problemOpen = false) =>
      decide(
        "SUBMITTED",
        {
          transition: "auto-sign-off",
          actor: actorOf("system"),
          now: new Date(sentAt.getTime() + hoursLater * 3_600_000),
        },
        { evidenceSentAt: sentAt, autoReleaseHours: 48, problemOpen },
      );
    expect(failure(() => auto(47.9))).toBe("sign-off-not-due");
    expect(auto(48).to).toBe("COMPLETED");
    expect(failure(() => auto(100, true))).toBe("problem-open");
  });

  it("reinstates a cancellation to the status it came from", () => {
    const reinstate = { transition: "reinstate" as const, actor: actorOf("office"), reason: "Customer changed mind" };
    expect(decide("CANCEL_REVIEW", reinstate, { statusBeforeCancelReview: "BOOKABLE" }, { workerId: null }).to).toBe(
      "BOOKABLE",
    );
    expect(decide("CANCEL_REVIEW", reinstate, { statusBeforeCancelReview: "QUOTE_BOUNTY" }).to).toBe("QUOTE_BOUNTY");
    expect(decide("CANCEL_REVIEW", reinstate, { statusBeforeCancelReview: null }).to).toBe("ASSIGNED");
  });

  it("only lets the office override, always with a reason", () => {
    const override = { transition: "override" as const, actor: actorOf("office"), to: "BOOKABLE" as const };
    expect(failure(() => decide("ASSIGNED", { ...override, reason: "" }))).toBe("reason-required");
    expect(failure(() => decide("ASSIGNED", { ...override, to: undefined, reason: "x" }))).toBe("no-target");
    expect(() => decide("ASSIGNED", { ...override, actor: actorOf("worker"), reason: "x" })).toThrow(
      TransitionForbiddenError,
    );
    // Back before claim lets the worker go; reassigning keeps the status and swaps the worker.
    expect(decide("ASSIGNED", { ...override, reason: "Worker sick" }).workerId).toBeNull();
    const other = randomUUID();
    expect(decide("ASSIGNED", { ...override, to: "ASSIGNED", workerId: other, reason: "Reassigned" })).toMatchObject({
      to: "ASSIGNED",
      workerId: other,
    });
    expect(failure(() => decide("ASSIGNED", { ...override, to: "ASSIGNED", reason: "x" }))).toBe("same-status");
  });

  it("gives every refusal the shared typed base class and a code", () => {
    try {
      decide("COMPLETED", { transition: "cancel" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JobTransitionError);
      expect(error).toMatchObject({ code: "illegal-transition", from: "COMPLETED", transition: "cancel" });
    }
  });
});

// ---------------------------------------------------------------- Against the database

describe.skipIf(!testDatabaseUrl)("transitionJob (database)", () => {
  const schema = useTestSchema(import.meta.filename);

  const audit = vi.fn<StatusMachineDeps["audit"]>();
  const notify = vi.fn<StatusMachineDeps["notify"]>();
  // The real audit helper (#100) isn't here yet: write the row the way it will, so the trigger defaults are checked.
  const deps: StatusMachineDeps = {
    audit: async (tx, entry) => {
      await audit(tx, entry);
      await tx.auditLog.create({
        data: {
          action: entry.action,
          recordType: entry.recordType,
          recordId: entry.recordId,
          before: entry.before,
          after: entry.after,
          reason: entry.reason,
        },
      });
    },
    notify: async (tx, change) => notify(tx, change),
  };
  afterEach(() => {
    audit.mockReset();
    notify.mockReset();
  });

  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Test" } });
    return id;
  }

  async function worker(licensedFor?: Trade) {
    const id = await person("TRADIE");
    if (licensedFor) {
      await schema.db.workerTrade.create({ data: { userId: id, trade: licensedFor } });
      await schema.db.licence.create({
        data: {
          userId: id,
          trade: licensedFor,
          number: "EW123456",
          status: "VERIFIED",
          checkedAt: new Date(),
          checkedById: await person("ADMIN"),
        },
      });
    }
    return id;
  }

  async function job(status: JobStatus, data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
    return schema.db.job.create({
      data: {
        customerId: await person(),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status,
        priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12_000,
        workerId: claimed ? await worker() : null,
        ...data,
      },
    });
  }

  async function pay(jobId: string, kind: "JOB" | "QUICK_LOOK" = "JOB") {
    await schema.db.payment.create({
      data: {
        jobId,
        kind,
        amountCents: kind === "JOB" ? 12_000 : 3_000,
        status: "PAID",
        paidAt: new Date(),
        idempotencyKey: randomUUID(),
      },
    });
  }

  async function sendEvidence(jobId: string, workerId: string) {
    await schema.db.jobMaterials.create({ data: { jobId, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId, workerId, notes: "Hung and trimmed." } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId, path: `evidence/${jobId}/1.jpg` } });
    await schema.db.completionEvidence.update({
      where: { jobId },
      data: { declaration: "I did this work.", declaredAt: new Date(), submittedAt: new Date() },
    });
  }

  const history = (jobId: string) =>
    schema.db.jobStatusHistory.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
  const stored = (jobId: string) => schema.db.job.findUniqueOrThrow({ where: { id: jobId } });
  const run = (request: TransitionRequest) => transitionJob(schema.db, deps, request);
  const customerOf = async (jobId: string): Promise<Actor> => ({
    role: "CUSTOMER",
    userId: (await stored(jobId)).customerId,
  });
  const office = async (): Promise<Actor> => ({ role: "ADMIN", userId: await person("ADMIN") });
  const system: Actor = { role: "SYSTEM", source: "test" };

  /** Runs the transition and checks the row, the history (with its actor), the audit row and the notification. */
  async function expectMoved(request: TransitionRequest, from: JobStatus, to: JobStatus) {
    const change = await run(request);
    expect(change).toMatchObject({ jobId: request.jobId, from, to, transition: request.transition });
    expect((await stored(request.jobId)).status).toBe(to);

    const last = (await history(request.jobId)).at(-1);
    expect(last).toMatchObject({ fromStatus: from, toStatus: to });
    expect(last?.changedById).toBe(request.actor.role === "SYSTEM" ? null : request.actor.userId);

    const logged = await schema.db.auditLog.findFirstOrThrow({
      where: { recordId: request.jobId },
      orderBy: { createdAt: "desc" },
    });
    expect(logged).toMatchObject({ recordType: "jobs", before: expect.objectContaining({ status: from }) });
    expect(logged.after).toMatchObject({ status: to });
    // The audit row's actor defaults to app.actor_id, set by the machine.
    expect(logged.actorId).toBe(request.actor.role === "SYSTEM" ? null : request.actor.userId);
    expect(notify).toHaveBeenCalledWith(expect.anything(), change);
    return change;
  }

  /** Runs a refused transition and checks nothing at all changed. */
  async function expectRefused(request: TransitionRequest, error: new (...args: never[]) => Error) {
    const before = await stored(request.jobId);
    const historyBefore = (await history(request.jobId)).length;
    await expect(run(request)).rejects.toThrow(error);
    expect(await stored(request.jobId)).toEqual(before);
    expect(await history(request.jobId)).toHaveLength(historyBefore);
    expect(await schema.db.auditLog.count({ where: { recordId: request.jobId } })).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  }

  describe("allowed transitions", () => {
    it("send-to-bounty: REVIEW → QUOTE_BOUNTY", async () => {
      const { id } = await job("REVIEW");
      await expectMoved({ jobId: id, transition: "send-to-bounty", actor: system }, "REVIEW", "QUOTE_BOUNTY");
    });

    it("send-price: REVIEW → PRICED once priced", async () => {
      const { id } = await job("REVIEW");
      const by = await office();
      await priceJob(schema.db, {
        jobId: id,
        minutes: 60,
        materialsCents: 0,
        pricedById: by.role === "SYSTEM" ? null : by.userId,
      });
      await expectMoved({ jobId: id, transition: "send-price", actor: by }, "REVIEW", "PRICED");
    });

    it("send-price: QUOTE_BOUNTY → PRICED once priced", async () => {
      const { id } = await job("QUOTE_BOUNTY");
      await priceJob(schema.db, { jobId: id, minutes: 60, materialsCents: 0 });
      await expectMoved({ jobId: id, transition: "send-price", actor: await office() }, "QUOTE_BOUNTY", "PRICED");
    });

    it("mark-paid: PRICED → BOOKABLE once the job payment is paid", async () => {
      const { id } = await job("PRICED");
      await pay(id);
      await expectMoved({ jobId: id, transition: "mark-paid", actor: system }, "PRICED", "BOOKABLE");
    });

    it("decline-price: PRICED → CANCELLED, free", async () => {
      const { id } = await job("PRICED");
      await expectMoved({ jobId: id, transition: "decline-price", actor: await customerOf(id) }, "PRICED", "CANCELLED");
    });

    it("decline-price: PRICED → CANCEL_REVIEW when a quick look was paid", async () => {
      const { id } = await job("PRICED");
      await pay(id, "QUICK_LOOK");
      await expectMoved(
        { jobId: id, transition: "decline-price", actor: await customerOf(id), reason: "Too dear" },
        "PRICED",
        "CANCEL_REVIEW",
      );
    });

    for (const status of ["REVIEW", "QUOTE_BOUNTY", "PRICED"] as const) {
      it(`cancel: ${status} → CANCELLED before paying`, async () => {
        const { id } = await job(status);
        await expectMoved({ jobId: id, transition: "cancel", actor: await customerOf(id) }, status, "CANCELLED");
      });
    }

    for (const status of ["BOOKABLE", "ASSIGNED"] as const) {
      it(`cancel: ${status} → CANCEL_REVIEW after paying`, async () => {
        const { id, workerId } = await job(status);
        await pay(id);
        await expectMoved(
          { jobId: id, transition: "cancel", actor: await customerOf(id), reason: "Sorted it myself" },
          status,
          "CANCEL_REVIEW",
        );
        expect((await stored(id)).workerId).toBe(workerId);
      });
    }

    it("claim: BOOKABLE → ASSIGNED (Other work, no licence needed)", async () => {
      const { id } = await job("BOOKABLE");
      const by = await worker();
      await expectMoved(
        { jobId: id, transition: "claim", actor: { role: "TRADIE", userId: by } },
        "BOOKABLE",
        "ASSIGNED",
      );
      expect((await stored(id)).workerId).toBe(by);
    });

    it("claim: BOOKABLE → ASSIGNED (electrical, with a verified licence)", async () => {
      const { id } = await job("BOOKABLE", { category: "ELECTRICAL" });
      const by = await worker("ELECTRICAL");
      await expectMoved(
        { jobId: id, transition: "claim", actor: { role: "TRADIE", userId: by } },
        "BOOKABLE",
        "ASSIGNED",
      );
    });

    it("submit: ASSIGNED → SUBMITTED once evidence is sent", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await sendEvidence(id, workerId as string);
      await expectMoved(
        { jobId: id, transition: "submit", actor: { role: "TRADIE", userId: workerId as string } },
        "ASSIGNED",
        "SUBMITTED",
      );
    });

    it("sign-off: SUBMITTED → COMPLETED by the customer", async () => {
      const { id } = await job("SUBMITTED");
      await expectMoved({ jobId: id, transition: "sign-off", actor: await customerOf(id) }, "SUBMITTED", "COMPLETED");
    });

    it("auto-sign-off: SUBMITTED → COMPLETED 48h after the evidence was sent", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await sendEvidence(id, workerId as string);
      await schema.db.job.update({ where: { id }, data: { status: "SUBMITTED" } });
      const later = new Date(Date.now() + 49 * 3_600_000);
      await expectMoved(
        { jobId: id, transition: "auto-sign-off", actor: system, now: later },
        "SUBMITTED",
        "COMPLETED",
      );
    });

    it("approve-cancel: CANCEL_REVIEW → CANCELLED with a reason", async () => {
      const { id } = await job("CANCEL_REVIEW");
      await expectMoved(
        { jobId: id, transition: "approve-cancel", actor: await office(), reason: "Refunded in full" },
        "CANCEL_REVIEW",
        "CANCELLED",
      );
    });

    it("reinstate: CANCEL_REVIEW → back to where it was (BOOKABLE)", async () => {
      const { id } = await job("BOOKABLE");
      await pay(id);
      await run({ jobId: id, transition: "cancel", actor: await customerOf(id), reason: "Not sure" });
      await expectMoved(
        { jobId: id, transition: "reinstate", actor: await office(), reason: "Customer wants to go ahead" },
        "CANCEL_REVIEW",
        "BOOKABLE",
      );
    });

    it("reinstate: CANCEL_REVIEW → back to where it was (ASSIGNED, same worker)", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await pay(id);
      await run({ jobId: id, transition: "cancel", actor: await customerOf(id), reason: "Not sure" });
      await expectMoved(
        { jobId: id, transition: "reinstate", actor: await office(), reason: "Customer wants to go ahead" },
        "CANCEL_REVIEW",
        "ASSIGNED",
      );
      expect((await stored(id)).workerId).toBe(workerId);
    });

    it("override: the office forces a status, with the reason in the audit log", async () => {
      const { id } = await job("ASSIGNED");
      await expectMoved(
        { jobId: id, transition: "override", actor: await office(), to: "BOOKABLE", reason: "Worker is sick" },
        "ASSIGNED",
        "BOOKABLE",
      );
      expect((await stored(id)).workerId).toBeNull();
      expect(audit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: "Worker is sick", action: "job.status_overridden" }),
      );
      const logged = await schema.db.auditLog.findFirstOrThrow({ where: { recordId: id } });
      expect(logged.reason).toBe("Worker is sick");
    });
  });

  describe("forbidden transitions change nothing", () => {
    it("claiming a job that isn't bookable", async () => {
      const { id } = await job("PRICED");
      await expectRefused(
        { jobId: id, transition: "claim", actor: { role: "TRADIE", userId: await worker() } },
        IllegalTransitionError,
      );
    });

    it("claiming electrical work without a licence", async () => {
      const { id } = await job("BOOKABLE", { category: "ELECTRICAL" });
      await expectRefused(
        { jobId: id, transition: "claim", actor: { role: "TRADIE", userId: await worker() } },
        TransitionPreconditionError,
      );
    });

    it("a customer claiming", async () => {
      const { id } = await job("BOOKABLE");
      await expectRefused({ jobId: id, transition: "claim", actor: await customerOf(id) }, TransitionForbiddenError);
    });

    it("cancelling someone else's job", async () => {
      const { id } = await job("REVIEW");
      await expectRefused(
        { jobId: id, transition: "cancel", actor: { role: "CUSTOMER", userId: await person() } },
        TransitionForbiddenError,
      );
    });

    it("cancelling a finished job", async () => {
      const { id } = await job("COMPLETED");
      await expectRefused({ jobId: id, transition: "cancel", actor: await customerOf(id) }, IllegalTransitionError);
    });

    it("cancelling after paying without a reason", async () => {
      const { id } = await job("BOOKABLE");
      await expectRefused(
        { jobId: id, transition: "cancel", actor: await customerOf(id) },
        TransitionPreconditionError,
      );
    });

    it("marking a job paid with no paid payment", async () => {
      const { id } = await job("PRICED");
      await expectRefused({ jobId: id, transition: "mark-paid", actor: system }, TransitionPreconditionError);
    });

    it("sending a price that was never worked out", async () => {
      const { id } = await job("REVIEW");
      await expectRefused({ jobId: id, transition: "send-price", actor: await office() }, TransitionPreconditionError);
    });

    it("submitting without sending evidence", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await expectRefused(
        { jobId: id, transition: "submit", actor: { role: "TRADIE", userId: workerId as string } },
        TransitionPreconditionError,
      );
    });

    it("submitting while extra work is waiting", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await sendEvidence(id, workerId as string);
      await schema.db.variation.create({
        data: { jobId: id, requestedById: workerId as string, description: "Second door", requestedMinutes: 60 },
      });
      await expectRefused(
        { jobId: id, transition: "submit", actor: { role: "TRADIE", userId: workerId as string } },
        TransitionPreconditionError,
      );
    });

    it("someone else's worker submitting", async () => {
      const { id } = await job("ASSIGNED");
      await expectRefused(
        { jobId: id, transition: "submit", actor: { role: "TRADIE", userId: await worker() } },
        TransitionForbiddenError,
      );
    });

    it("auto sign-off while a problem report is open", async () => {
      const { id, workerId, customerId } = await job("ASSIGNED");
      await sendEvidence(id, workerId as string);
      await schema.db.job.update({ where: { id }, data: { status: "SUBMITTED" } });
      await schema.db.problemReport.create({
        data: { jobId: id, reportedById: customerId, topic: "Door sticks", details: "Won't close." },
      });
      const later = new Date(Date.now() + 49 * 3_600_000);
      await expectRefused(
        { jobId: id, transition: "auto-sign-off", actor: system, now: later },
        TransitionPreconditionError,
      );
    });

    it("auto sign-off before the 48 hours are up", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await sendEvidence(id, workerId as string);
      await schema.db.job.update({ where: { id }, data: { status: "SUBMITTED" } });
      await expectRefused({ jobId: id, transition: "auto-sign-off", actor: system }, TransitionPreconditionError);
    });

    it("an office override without a reason", async () => {
      const { id } = await job("ASSIGNED");
      await expectRefused(
        { jobId: id, transition: "override", actor: await office(), to: "CANCELLED" },
        TransitionPreconditionError,
      );
    });

    it("a worker overriding", async () => {
      const { id, workerId } = await job("ASSIGNED");
      await expectRefused(
        {
          jobId: id,
          transition: "override",
          actor: { role: "TRADIE", userId: workerId as string },
          to: "COMPLETED",
          reason: "Done",
        },
        TransitionForbiddenError,
      );
    });

    it("an override the database refuses (ASSIGNED with no worker) rolls back", async () => {
      const { id } = await job("BOOKABLE");
      await expect(
        run({ jobId: id, transition: "override", actor: await office(), to: "ASSIGNED", reason: "Testing" }),
      ).rejects.toThrow();
      expect((await stored(id)).status).toBe("BOOKABLE");
      expect(await history(id)).toHaveLength(1);
    });

    it("a job that doesn't exist", async () => {
      await expect(run({ jobId: randomUUID(), transition: "cancel", actor: system })).rejects.toThrow(JobNotFoundError);
    });

    it("rolls the status back when the audit or notification step fails", async () => {
      const { id } = await job("REVIEW");
      notify.mockRejectedValueOnce(new Error("notifications are down"));
      await expect(run({ jobId: id, transition: "send-to-bounty", actor: system })).rejects.toThrow(
        "notifications are down",
      );
      expect((await stored(id)).status).toBe("REVIEW");
      expect(await history(id)).toHaveLength(1);
      expect(await schema.db.auditLog.count({ where: { recordId: id } })).toBe(0);
    });
  });

  describe("two people acting at once", () => {
    it("two workers claim: exactly one wins, the other gets a typed error", async () => {
      const { id } = await job("BOOKABLE");
      const workers = await Promise.all([worker(), worker(), worker(), worker()]);
      const results = await Promise.allSettled(
        workers.map((userId) => run({ jobId: id, transition: "claim", actor: { role: "TRADIE", userId } })),
      );

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      for (const loss of lost) expect(loss.reason).toBeInstanceOf(IllegalTransitionError);

      const final = await stored(id);
      expect(final.status).toBe("ASSIGNED");
      expect(final.workerId).toBe((won[0] as PromiseFulfilledResult<{ workerAfter: string }>).value.workerAfter);
      // One history row for the claim, one audit row, one notification.
      expect((await history(id)).filter((h) => h.toStatus === "ASSIGNED")).toHaveLength(1);
      expect(await schema.db.auditLog.count({ where: { recordId: id } })).toBe(1);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it("a customer cancels while a worker claims: one goes first, the other is decided against it", async () => {
      for (let round = 0; round < 5; round++) {
        const { id } = await job("BOOKABLE");
        await pay(id);
        const by = await worker();
        const [claim, cancel] = await Promise.allSettled([
          run({ jobId: id, transition: "claim", actor: { role: "TRADIE", userId: by } }),
          run({ jobId: id, transition: "cancel", actor: await customerOf(id), reason: "Changed my mind" }),
        ]);
        const final = await stored(id);
        // The cancel always lands: straight from BOOKABLE, or as a request to cancel the claimed job.
        expect(cancel.status).toBe("fulfilled");
        expect(final.status).toBe("CANCEL_REVIEW");
        if (claim.status === "fulfilled") {
          // Claim first: the worker stays on the job, which is on hold while the office reviews.
          expect(final.workerId).toBe(by);
          expect((await history(id)).map((h) => h.toStatus)).toEqual(["BOOKABLE", "ASSIGNED", "CANCEL_REVIEW"]);
        } else {
          // Cancel first: the claim is refused and changed nothing.
          expect(claim.reason).toBeInstanceOf(IllegalTransitionError);
          expect(final.workerId).toBeNull();
          expect((await history(id)).map((h) => h.toStatus)).toEqual(["BOOKABLE", "CANCEL_REVIEW"]);
        }
      }
    });
  });
});

// A fake transaction runner, so the run loop is checked without a database.
describe("transitionJob without a database", () => {
  it("goes round again when the conditional update loses, and decides against the winner's state", async () => {
    let reads = 0;
    const tx = {
      $queryRaw: async () => [],
      job: {
        findUnique: async () =>
          ++reads === 1
            ? snapshot("BOOKABLE", { id: "job-1" })
            : snapshot("ASSIGNED", { id: "job-1", workerId: randomUUID() }),
        updateMany: async () => ({ count: 0 }),
      },
      licence: { count: async () => 1 },
    };
    const db = { $transaction: async (work: (t: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
    const deps: StatusMachineDeps = { audit: vi.fn(), notify: vi.fn() };
    await expect(
      transitionJob(db, deps, { jobId: "job-1", transition: "claim", actor: actorOf("worker") }),
    ).rejects.toThrow(IllegalTransitionError);
    expect(reads).toBe(2);
    expect(deps.audit).not.toHaveBeenCalled();
  });
});
