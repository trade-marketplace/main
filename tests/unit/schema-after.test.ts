import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { JobStatus, Prisma, Role, Trade } from "@/generated/prisma/client";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Schema 4 (#92): completion evidence, reviews, notifications, problem reports, support threads and the audit log.

describe.skipIf(!testDatabaseUrl)("Schema 4: after the job", () => {
  const schema = useTestSchema(import.meta.filename);

  const email = () => `${randomUUID()}@example.nz`;

  /** Makes a Supabase Auth user (the stand-in table on plain Postgres) and its profile. */
  async function createPerson(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: email(), role, firstName: "Test" } });
  }

  async function createWorker() {
    const worker = await createPerson("TRADIE");
    await schema.db.workerProfile.create({ data: { userId: worker.id } });
    return worker;
  }

  /** A paid job claimed by a worker (or further along, with `status`). */
  async function claimedJob(category: Trade = "ELECTRICAL", status: JobStatus = "ASSIGNED") {
    const customer = await createPerson();
    const worker = await createWorker();
    const job = await schema.db.job.create({
      data: {
        customerId: customer.id,
        category,
        title: "Replace a light switch",
        description: "Hallway switch is cracked.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status: "ASSIGNED",
        priceCents: 23805,
        workerId: worker.id,
      },
    });
    if (status !== "ASSIGNED") await schema.db.job.update({ where: { id: job.id }, data: { status } });
    return { customer, worker, job };
  }

  /** The worker reports what they spent on materials ($0 is still a report). */
  function reportSpend(jobId: string, spentCents = 0) {
    return schema.db.jobMaterials.create({ data: { jobId, budgetCents: 0, spentCents, spentAt: new Date() } });
  }

  const declaration = { declaration: "I did this work and it is safe and complete.", declaredAt: new Date() };

  function evidence(jobId: string, workerId: string, data: Partial<Prisma.CompletionEvidenceUncheckedCreateInput> = {}) {
    return schema.db.completionEvidence.create({ data: { jobId, workerId, ...data } });
  }

  const send = (jobId: string, data: Prisma.CompletionEvidenceUncheckedUpdateInput = {}) =>
    schema.db.completionEvidence.update({ where: { jobId }, data: { submittedAt: new Date(), ...data } });

  /** Electrical evidence that's been sent: CoC number and file, declaration, materials. */
  async function sentElectrical() {
    const people = await claimedJob("ELECTRICAL");
    await reportSpend(people.job.id);
    await evidence(people.job.id, people.worker.id, { cocNumber: "COC-12345", cocPath: "coc/1.pdf", ...declaration });
    const sent = await send(people.job.id);
    return { ...people, evidence: sent };
  }

  /** A job sent for sign-off, ready for the customer's review. */
  function review(job: { id: string; customerId: string; workerId: string | null }, data: Partial<Prisma.ReviewUncheckedCreateInput> = {}) {
    return schema.db.review.create({
      data: { jobId: job.id, reviewerId: job.customerId, workerId: job.workerId as string, rating: 5, ...data },
    });
  }

  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  describe("the migration", () => {
    it("creates every table, with row-level security on all of them", async () => {
      const tables = await schema.db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
        schema.name,
      );
      expect(tables.map((table) => table.relname)).toEqual(
        expect.arrayContaining([
          "audit_log",
          "completion_evidence",
          "completion_evidence_photos",
          "notifications",
          "problem_report_photos",
          "problem_reports",
          "reviews",
          "support_messages",
          "support_threads",
          "trade_evidence_rules",
        ]),
      );
      expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
    });

    it("keeps money out of these tables: materials spend stays in job_materials", async () => {
      const columns = await schema.db.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name IN ('completion_evidence', 'reviews', 'notifications',
           'problem_reports', 'support_threads', 'support_messages', 'trade_evidence_rules')
           AND (column_name LIKE '%cents' OR column_name LIKE '%bps' OR column_name LIKE '%price%')`,
        schema.name,
      );
      expect(columns).toEqual([]);
    });

    it("has the partial indexes the queues and the bell use", async () => {
      const indexes = await schema.db.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1`,
        schema.name,
      );
      expect(indexes.map((index) => index.indexname)).toEqual(
        expect.arrayContaining(["notifications_unread", "problem_reports_open_by_job", "reviews_reported_queue"]),
      );
    });
  });

  describe("completion evidence", () => {
    it("has evidence rules for every trade: CoC for electrical, photos and notes for the rest", async () => {
      const rules = await schema.db.tradeEvidenceRule.findMany({ orderBy: { trade: "asc" } });
      expect(rules.map(({ trade, cocRequired, cocFileRequired, minPhotos, notesRequired }) => ({
        trade,
        cocRequired,
        cocFileRequired,
        minPhotos,
        notesRequired,
      }))).toEqual([
        { trade: "ELECTRICAL", cocRequired: true, cocFileRequired: true, minPhotos: 0, notesRequired: false },
        { trade: "PLUMBING", cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true },
        { trade: "GAS", cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true },
        { trade: "CONSTRUCTION", cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true },
        { trade: "OTHER", cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true },
      ]);
    });

    it("sends electrical evidence with a CoC number and file, a declaration and the materials spend", async () => {
      const before = new Date(Date.now() - 1000);
      const { evidence: sent } = await sentElectrical();
      expect(sent).toMatchObject({ cocNumber: "COC-12345", cocPath: "coc/1.pdf", officeCheck: null });
      expect(sent.submittedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("won't send electrical evidence without the CoC number or its file", async () => {
      const { job, worker } = await claimedJob("ELECTRICAL");
      await reportSpend(job.id);
      await evidence(job.id, worker.id, { ...declaration });
      await expect(send(job.id)).rejects.toThrow(/needs a CoC number/);
      await expect(send(job.id, { cocNumber: "COC-1" })).rejects.toThrow(/needs the CoC file/);
      await expect(send(job.id, { cocNumber: "COC-1", cocPath: "coc/1.pdf" })).resolves.toBeTruthy();
    });

    it("sends other trades' evidence with photos and notes, and not without", async () => {
      const { job, worker } = await claimedJob("OTHER");
      await reportSpend(job.id);
      await evidence(job.id, worker.id, { ...declaration });
      await expect(send(job.id)).rejects.toThrow(/needs notes/);
      await expect(send(job.id, { notes: "Moved the couch upstairs." })).rejects.toThrow(/at least 1 photo/);
      await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: `evidence/${job.id}/1.jpg` } });
      const sent = await send(job.id, { notes: "Moved the couch upstairs." });
      expect(sent.submittedAt).not.toBeNull();
    });

    it("needs the declaration ticked", async () => {
      const { job, worker } = await claimedJob("ELECTRICAL");
      await reportSpend(job.id);
      await evidence(job.id, worker.id, { cocNumber: "COC-1", cocPath: "coc/1.pdf" });
      await expect(send(job.id)).rejects.toThrow(/declaration ticked/);
      await expect(
        schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { declaration: "words, no tick" } }),
      ).rejects.toThrow(/completion_evidence_declaration_pair/);
    });

    it("needs the materials spend reported, $0 included", async () => {
      const { job, worker } = await claimedJob("ELECTRICAL");
      await evidence(job.id, worker.id, { cocNumber: "COC-1", cocPath: "coc/1.pdf", ...declaration });
      await expect(send(job.id)).rejects.toThrow(/materials spend reported/);
      await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 5000 } });
      await expect(send(job.id)).rejects.toThrow(/materials spend reported/);
      await schema.db.jobMaterials.update({ where: { jobId: job.id }, data: { spentCents: 4210, spentAt: new Date() } });
      await expect(send(job.id)).resolves.toBeTruthy();
    });

    it("keeps a draft for later: nothing is checked until it's sent", async () => {
      const { job, worker } = await claimedJob("PLUMBING");
      const draft = await evidence(job.id, worker.id);
      expect(draft).toMatchObject({ submittedAt: null, notes: null });
      const edited = await schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { notes: "Half done" } });
      expect(edited.notes).toBe("Half done");
    });

    it("follows the trade's rules as the office changes them", async () => {
      await schema.db.tradeEvidenceRule.update({ where: { trade: "GAS" }, data: { cocRequired: true } });
      try {
        const { job, worker } = await claimedJob("GAS");
        await reportSpend(job.id);
        await evidence(job.id, worker.id, { notes: "Swapped the regulator.", ...declaration });
        await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: "evidence/gas.jpg" } });
        await expect(send(job.id)).rejects.toThrow(/GAS evidence needs a CoC number/);
        await expect(send(job.id, { cocNumber: "GAS-7" })).resolves.toBeTruthy();
      } finally {
        await schema.db.tradeEvidenceRule.update({ where: { trade: "GAS" }, data: { cocRequired: false } });
      }
    });

    it("what if the trade isn't configured? The evidence can't be sent", async () => {
      const saved = await schema.db.tradeEvidenceRule.delete({ where: { trade: "CONSTRUCTION" } });
      try {
        const { job, worker } = await claimedJob("CONSTRUCTION");
        await reportSpend(job.id);
        await evidence(job.id, worker.id, { notes: "Fence done.", ...declaration });
        await expect(send(job.id)).rejects.toThrow(/CONSTRUCTION isn't configured/);
      } finally {
        await schema.db.tradeEvidenceRule.create({ data: saved });
      }
    });

    it("rejects rules that make no sense", async () => {
      await expect(schema.db.tradeEvidenceRule.update({ where: { trade: "OTHER" }, data: { minPhotos: -1 } })).rejects.toThrow(
        /trade_evidence_rules_min_photos/,
      );
      await expect(
        schema.db.tradeEvidenceRule.update({ where: { trade: "OTHER" }, data: { cocFileRequired: true } }),
      ).rejects.toThrow(/trade_evidence_rules_coc_file_needs_coc/);
    });

    it("is only from the job's worker, on a claimed job, one per job", async () => {
      const { job } = await claimedJob("ELECTRICAL");
      const stranger = await createWorker();
      await expect(evidence(job.id, stranger.id)).rejects.toThrow(/only the job's worker/);

      const customer = await createPerson();
      const unclaimed = await schema.db.job.create({
        data: {
          customerId: customer.id,
          category: "OTHER",
          title: "Move a couch",
          description: "Upstairs.",
          addressLine1: "2 Example St",
          suburb: "Gladstone",
          city: "Invercargill",
        },
      });
      await expect(evidence(unclaimed.id, stranger.id)).rejects.toThrow();

      const { job: mine, worker } = await claimedJob("OTHER");
      await evidence(mine.id, worker.id);
      await expect(evidence(mine.id, worker.id)).rejects.toThrow(/Unique constraint failed/);
    });

    it("can't change, lose photos or be deleted once sent", async () => {
      const { job } = await sentElectrical();
      await expect(
        schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { cocNumber: "COC-99999" } }),
      ).rejects.toThrow(/evidence was sent: it can't change/);
      await expect(
        schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: "evidence/late.jpg" } }),
      ).rejects.toThrow(/its photos can't change/);
      await expect(schema.db.completionEvidence.delete({ where: { jobId: job.id } })).rejects.toThrow(/it's kept/);
      await expect(
        schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { submittedAt: null } }),
      ).rejects.toThrow(/only when the office flags it/);
    });

    it("keeps photos fixed once sent, but lets a draft's photos change", async () => {
      const { job, worker } = await claimedJob("OTHER");
      await reportSpend(job.id);
      await evidence(job.id, worker.id, { notes: "Done.", ...declaration });
      const photo = await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: "evidence/a.jpg" } });
      await schema.db.completionEvidencePhoto.update({ where: { id: photo.id }, data: { position: 1 } });
      await send(job.id);
      await expect(schema.db.completionEvidencePhoto.delete({ where: { id: photo.id } })).rejects.toThrow(
        /its photos can't change/,
      );
    });

    it("lets the office approve it, or flag it with a note so the worker fixes it and sends it again", async () => {
      const office = await createPerson("ADMIN");
      const { job, evidence: first } = await sentElectrical();
      await expect(
        schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { officeCheck: "FLAGGED", checkedAt: new Date() } }),
      ).rejects.toThrow(/completion_evidence_flag_has_note/);
      await schema.db.completionEvidence.update({
        where: { jobId: job.id },
        data: { officeCheck: "FLAGGED", checkNote: "CoC is for another address", checkedById: office.id, checkedAt: new Date() },
      });
      const draft = await schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { submittedAt: null } });
      expect(draft).toMatchObject({ submittedAt: null, officeCheck: "FLAGGED" });
      await schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { cocPath: "coc/2.pdf" } });
      const again = await send(job.id);
      expect(again).toMatchObject({ cocPath: "coc/2.pdf", officeCheck: null, checkNote: null, checkedAt: null });
      expect(again.submittedAt!.getTime()).toBeGreaterThanOrEqual(first.submittedAt!.getTime());

      const approved = await schema.db.completionEvidence.update({
        where: { jobId: job.id },
        data: { officeCheck: "APPROVED", checkedById: office.id, checkedAt: new Date() },
      });
      expect(approved.officeCheck).toBe("APPROVED");
    });

    it("can't be checked by the office before it's sent", async () => {
      const { job, worker } = await claimedJob("OTHER");
      await evidence(job.id, worker.id);
      await expect(
        schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { officeCheck: "APPROVED", checkedAt: new Date() } }),
      ).rejects.toThrow(/checked once it's sent/);
    });
  });

  describe("reviews", () => {
    it("takes 1–5 stars, quick tags and a comment from the job's customer, once per job", async () => {
      const { job } = await claimedJob("ELECTRICAL", "SUBMITTED");
      const posted = await review(job, { rating: 4, tags: ["On time", "Tidy"], comment: "Quick and tidy." });
      expect(posted).toMatchObject({ rating: 4, tags: ["On time", "Tidy"], comment: "Quick and tidy.", hiddenAt: null });
      await expect(review(job)).rejects.toThrow(/Unique constraint failed/);
    });

    it("rejects 0 or 6 stars and an empty comment", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      await expect(review(job, { rating: 0 })).rejects.toThrow(/reviews_rating_1_to_5/);
      await expect(review(job, { rating: 6 })).rejects.toThrow(/reviews_rating_1_to_5/);
      await expect(review(job, { comment: "  " })).rejects.toThrow(/reviews_comment_present/);
    });

    it("is by the job's customer about the job's worker, once the work is done", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      const stranger = await createPerson();
      const otherWorker = await createWorker();
      await expect(review(job, { reviewerId: stranger.id })).rejects.toThrow(/by the job's customer/);
      await expect(review(job, { workerId: otherWorker.id })).rejects.toThrow(/by the job's customer/);
      const { job: unfinished } = await claimedJob("ELECTRICAL", "ASSIGNED");
      await expect(review(unfinished)).rejects.toThrow(/once the work is done/);
    });

    it("can be edited for 7 days, which the database records from when it was posted", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      const posted = await review(job, { rating: 3, editableUntil: new Date("2099-01-01") });
      expect(posted.editableUntil.getTime() - posted.createdAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      const edited = await schema.db.review.update({ where: { id: posted.id }, data: { rating: 5, comment: "Better now." } });
      expect(edited).toMatchObject({ rating: 5, comment: "Better now." });
      const extended = await schema.db.review.update({ where: { id: posted.id }, data: { editableUntil: new Date("2099-01-01") } });
      expect(extended.editableUntil).toEqual(posted.editableUntil);
    });

    it("can't be edited after 7 days", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      const old = await review(job, { rating: 2, createdAt: daysAgo(8) });
      expect(old.editableUntil.getTime()).toBeLessThan(Date.now());
      await expect(schema.db.review.update({ where: { id: old.id }, data: { rating: 5 } })).rejects.toThrow(
        /edited for 7 days/,
      );
      await expect(schema.db.review.update({ where: { id: old.id }, data: { comment: "Changed my mind" } })).rejects.toThrow(
        /edited for 7 days/,
      );
    });

    it("can't move to another job or person", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      const { job: other } = await claimedJob("ELECTRICAL", "COMPLETED");
      const posted = await review(job);
      await expect(schema.db.review.update({ where: { id: posted.id }, data: { jobId: other.id } })).rejects.toThrow(
        /can't move/,
      );
    });

    it("what if a review is reported? The office hides it with a reason, even after 7 days, and it's kept", async () => {
      const { job, worker } = await claimedJob("ELECTRICAL", "COMPLETED");
      const office = await createPerson("ADMIN");
      const posted = await review(job, { rating: 1, comment: "Rude and abusive words", createdAt: daysAgo(10) });

      const reported = await schema.db.review.update({
        where: { id: posted.id },
        data: { reportedAt: new Date(), reportedById: worker.id, reportReason: "Abusive" },
      });
      expect(reported.reportReason).toBe("Abusive");
      const queue = await schema.db.review.findMany({ where: { reportedAt: { not: null }, hiddenAt: null } });
      expect(queue.map((r) => r.id)).toContain(posted.id);

      await expect(
        schema.db.review.update({ where: { id: posted.id }, data: { hiddenAt: new Date() } }),
      ).rejects.toThrow(/reviews_hidden_has_reason/);
      const hidden = await schema.db.review.update({
        where: { id: posted.id },
        data: { hiddenAt: new Date(), hiddenReason: "Breaks the review rules: abuse", hiddenById: office.id },
      });
      expect(hidden).toMatchObject({ hiddenReason: "Breaks the review rules: abuse", rating: 1 });
      expect(await schema.db.review.count({ where: { workerId: worker.id, hiddenAt: null } })).toBe(0);
    });

    it("needs a reason to report a review", async () => {
      const { job } = await claimedJob("ELECTRICAL", "COMPLETED");
      const posted = await review(job);
      await expect(schema.db.review.update({ where: { id: posted.id }, data: { reportedAt: new Date() } })).rejects.toThrow(
        /reviews_reported_has_reason/,
      );
    });
  });

  describe("notifications", () => {
    it("records the person, type, payload, when it was read and where it was sent", async () => {
      const person = await createPerson();
      const sent = await schema.db.notification.create({
        data: { userId: person.id, type: "job.priced", payload: { jobId: randomUUID(), jobNumber: 1005 } },
      });
      expect(sent).toMatchObject({ type: "job.priced", readAt: null, channelsSent: [] });
      const emailed = await schema.db.notification.update({
        where: { id: sent.id },
        data: { channelsSent: { push: "EMAIL" } },
      });
      const pushed = await schema.db.notification.update({ where: { id: sent.id }, data: { channelsSent: { push: "PUSH" } } });
      expect(emailed.channelsSent).toEqual(["EMAIL"]);
      expect(pushed.channelsSent).toEqual(["EMAIL", "PUSH"]);
      const read = await schema.db.notification.update({ where: { id: sent.id }, data: { readAt: new Date() } });
      expect(read.readAt).not.toBeNull();
      expect(await schema.db.notification.count({ where: { userId: person.id, readAt: null } })).toBe(0);
    });

    it("needs a dotted lower-case type and an object payload", async () => {
      const person = await createPerson();
      await expect(schema.db.notification.create({ data: { userId: person.id, type: "Job Priced" } })).rejects.toThrow(
        /notifications_type_format/,
      );
      await expect(
        schema.db.notification.create({ data: { userId: person.id, type: "job.priced", payload: [1, 2] } }),
      ).rejects.toThrow(/notifications_payload_object/);
    });

    it("goes when the person's account does", async () => {
      const person = await createPerson();
      await schema.db.notification.create({ data: { userId: person.id, type: "account.welcome" } });
      await schema.db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, person.id);
      expect(await schema.db.notification.count({ where: { userId: person.id } })).toBe(0);
    });
  });

  describe("problem reports", () => {
    it("takes a topic, details and photos from the job's customer or worker, and starts OPEN", async () => {
      const { customer, worker, job } = await claimedJob("ELECTRICAL", "SUBMITTED");
      const report = await schema.db.problemReport.create({
        data: {
          jobId: job.id,
          reportedById: customer.id,
          topic: "Work not finished",
          details: "One switch still loose.",
          photos: { create: [{ path: "problems/1.jpg" }, { path: "problems/2.jpg", position: 1 }] },
        },
        include: { photos: true },
      });
      expect(report).toMatchObject({ status: "OPEN", resolution: null });
      expect(report.photos).toHaveLength(2);
      await schema.db.problemReport.create({
        data: { jobId: job.id, reportedById: worker.id, topic: "Access", details: "Gate locked." },
      });
      expect(await schema.db.problemReport.count({ where: { jobId: job.id, status: "OPEN" } })).toBe(2);
    });

    it("won't take a report from someone not on the job", async () => {
      const { job } = await claimedJob("ELECTRICAL", "SUBMITTED");
      const stranger = await createPerson();
      await expect(
        schema.db.problemReport.create({ data: { jobId: job.id, reportedById: stranger.id, topic: "x", details: "y" } }),
      ).rejects.toThrow(/only the job's customer or worker/);
    });

    it("is resolved by the office with a note and a time, and can be reopened", async () => {
      const { customer, job } = await claimedJob("ELECTRICAL", "SUBMITTED");
      const office = await createPerson("ADMIN");
      const report = await schema.db.problemReport.create({
        data: { jobId: job.id, reportedById: customer.id, topic: "Damage", details: "Scuffed wall." },
      });
      await expect(
        schema.db.problemReport.update({ where: { id: report.id }, data: { status: "RESOLVED" } }),
      ).rejects.toThrow(/problem_reports_resolution_matches_status/);
      const resolved = await schema.db.problemReport.update({
        where: { id: report.id },
        data: { status: "RESOLVED", resolution: "Worker went back and patched it.", resolvedById: office.id },
      });
      expect(resolved.resolvedAt).not.toBeNull();
      const reopened = await schema.db.problemReport.update({ where: { id: report.id }, data: { status: "OPEN" } });
      expect(reopened).toMatchObject({ resolution: null, resolvedAt: null, resolvedById: null });
      await expect(
        schema.db.problemReport.create({
          data: { jobId: job.id, reportedById: customer.id, topic: "x", details: "y", status: "RESOLVED", resolution: "z" },
        }),
      ).rejects.toThrow(/starts OPEN/);
    });
  });

  describe("support threads", () => {
    async function thread(userId: string, data: Partial<Prisma.SupportThreadUncheckedCreateInput> = {}) {
      return schema.db.supportThread.create({ data: { userId, subject: "Question about my bill", ...data } });
    }

    it("holds a conversation between a person and the office, and moves up the inbox with each message", async () => {
      const person = await createPerson();
      const office = await createPerson("ADMIN");
      const open = await thread(person.id, { lastMessageAt: new Date("2026-01-01") });
      const asked = await schema.db.supportMessage.create({ data: { threadId: open.id, authorId: person.id, body: "Hi?" } });
      const answered = await schema.db.supportMessage.create({
        data: { threadId: open.id, authorId: office.id, body: "Hello!", fromOffice: false },
      });
      expect(asked.fromOffice).toBe(false);
      expect(answered.fromOffice).toBe(true);
      const after = await schema.db.supportThread.findUniqueOrThrow({ where: { id: open.id } });
      expect(after.lastMessageAt).toEqual(answered.createdAt);
    });

    it("says who's from the office itself, and keeps internal notes to the office", async () => {
      const person = await createPerson();
      const open = await thread(person.id);
      const claimed = await schema.db.supportMessage.create({
        data: { threadId: open.id, authorId: person.id, body: "I'm the office", fromOffice: true },
      });
      expect(claimed.fromOffice).toBe(false);
      await expect(
        schema.db.supportMessage.create({ data: { threadId: open.id, authorId: person.id, body: "secret", internal: true } }),
      ).rejects.toThrow(/support_messages_internal_from_office/);
    });

    it("won't take a message from someone else", async () => {
      const person = await createPerson();
      const stranger = await createPerson();
      const open = await thread(person.id);
      await expect(
        schema.db.supportMessage.create({ data: { threadId: open.id, authorId: stranger.id, body: "Hi" } }),
      ).rejects.toThrow(/thread's person or the office/);
    });

    it("keeps messages as they were sent, but lets them outlive their author", async () => {
      const person = await createPerson();
      const office = await createPerson("ADMIN");
      const open = await thread(person.id);
      const message = await schema.db.supportMessage.create({ data: { threadId: open.id, authorId: office.id, body: "Done" } });
      await expect(
        schema.db.supportMessage.update({ where: { id: message.id }, data: { body: "Not done" } }),
      ).rejects.toThrow(/can't be edited/);
      await schema.db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, office.id);
      expect(await schema.db.supportMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
        authorId: null,
        body: "Done",
        fromOffice: true,
      });
    });

    it("stamps when it's closed and clears it when reopened", async () => {
      const person = await createPerson();
      const open = await thread(person.id);
      const closed = await schema.db.supportThread.update({ where: { id: open.id }, data: { status: "CLOSED" } });
      expect(closed.closedAt).not.toBeNull();
      const reopened = await schema.db.supportThread.update({ where: { id: open.id }, data: { status: "OPEN" } });
      expect(reopened.closedAt).toBeNull();
    });

    it("can be about a job or a problem report, from the people on it", async () => {
      const { customer, job } = await claimedJob("ELECTRICAL", "SUBMITTED");
      const stranger = await createPerson();
      const report = await schema.db.problemReport.create({
        data: { jobId: job.id, reportedById: customer.id, topic: "Damage", details: "Scuffed wall." },
      });
      const about = await thread(customer.id, { problemReportId: report.id });
      expect(about.jobId).toBe(job.id);
      await expect(thread(customer.id, { problemReportId: report.id })).rejects.toThrow(/Unique constraint failed/);
      await expect(thread(stranger.id, { jobId: job.id })).rejects.toThrow(/from its customer or worker/);
    });
  });

  describe("audit log", () => {
    it("records who did what to which record, before and after, why and when", async () => {
      const office = await createPerson("ADMIN");
      const entry = await schema.db.auditLog.create({
        data: {
          actorId: office.id,
          action: "settings.updated",
          recordType: "settings",
          recordId: "1",
          before: { otherRateCents: 3800 },
          after: { otherRateCents: 4000 },
          reason: "Rate review",
          createdAt: new Date("2000-01-01"),
        },
      });
      expect(entry).toMatchObject({ actorRole: "ADMIN", before: { otherRateCents: 3800 }, after: { otherRateCents: 4000 } });
      expect(Math.abs(entry.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it("takes the actor the server names for the transaction, as job history does, and empty means the system", async () => {
      const office = await createPerson("ADMIN");
      const [, entry] = await schema.db.$transaction([
        schema.db.$executeRawUnsafe(`SELECT set_config('app.actor_id', $1, true)`, office.id),
        schema.db.auditLog.create({ data: { action: "job.cancelled", recordType: "jobs", recordId: randomUUID() } }),
      ]);
      expect(entry).toMatchObject({ actorId: office.id, actorRole: "ADMIN" });
      const system = await schema.db.auditLog.create({ data: { action: "job.auto_completed", recordType: "jobs", recordId: "x" } });
      expect(system).toMatchObject({ actorId: null, actorRole: null });
    });

    it("is append-only: rows can't be changed, deleted or truncated", async () => {
      const entry = await schema.db.auditLog.create({ data: { action: "licence.verified", recordType: "licences", recordId: "a" } });
      await expect(schema.db.auditLog.update({ where: { id: entry.id }, data: { reason: "oops" } })).rejects.toThrow(/append-only/);
      await expect(schema.db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
      await expect(schema.db.$executeRawUnsafe(`TRUNCATE "${schema.name}".audit_log`)).rejects.toThrow(/append-only/);
      expect(await schema.db.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ reason: null });
    });

    it("outlives the person who did it", async () => {
      const office = await createPerson("ADMIN");
      const entry = await schema.db.auditLog.create({
        data: { actorId: office.id, action: "review.hidden", recordType: "reviews", recordId: "r" },
      });
      await schema.db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, office.id);
      expect(await schema.db.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ actorId: office.id });
    });

    it("rejects a malformed action, an empty record and before/after that aren't objects", async () => {
      const base = { action: "job.updated", recordType: "jobs", recordId: "j" };
      await expect(schema.db.auditLog.create({ data: { ...base, action: "Job Updated" } })).rejects.toThrow(/audit_log_action_format/);
      await expect(schema.db.auditLog.create({ data: { ...base, recordId: " " } })).rejects.toThrow(/audit_log_record_id_present/);
      await expect(schema.db.auditLog.create({ data: { ...base, before: "text" } })).rejects.toThrow(/audit_log_before_object/);
      await expect(schema.db.auditLog.create({ data: { ...base, after: [1] } })).rejects.toThrow(/audit_log_after_object/);
    });
  });

  describe("row-level security (Supabase Data API)", () => {
    // Same as Schemas 1–3: plays Supabase's `authenticated` role. `null` is a visitor who isn't signed in.
    async function asSignedIn<T>(userId: string | null, work: (sql: (query: string) => Promise<unknown[]>) => Promise<T>) {
      await schema.db.$executeRawUnsafe(`
        DO $$ BEGIN CREATE ROLE tm_rls_tester NOLOGIN;
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
      await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}", auth TO tm_rls_tester`);
      await schema.db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schema.name}" TO tm_rls_tester`);
      return schema.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE tm_rls_tester`);
        await tx.$executeRawUnsafe(`SELECT set_config('request.jwt.claims', $1, true)`, JSON.stringify(userId ? { sub: userId } : { role: "anon" }));
        return work((query) => tx.$queryRawUnsafe(query.replaceAll("{schema}", `"${schema.name}"`)));
      });
    }

    /** A finished job with everything this schema holds, from both sides and the office. */
    async function jobAfterwards() {
      const { customer, worker, job } = await claimedJob("OTHER");
      const office = await createPerson("ADMIN");
      await reportSpend(job.id, 1200);
      await evidence(job.id, worker.id, { notes: "Done.", ...declaration });
      const photo = await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: `evidence/${job.id}.jpg` } });
      await send(job.id);
      await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED" } });
      const posted = await review(job, { comment: "Great" });
      const forCustomer = await schema.db.notification.create({ data: { userId: customer.id, type: "job.submitted" } });
      const forWorker = await schema.db.notification.create({ data: { userId: worker.id, type: "review.posted" } });
      const problem = await schema.db.problemReport.create({
        data: { jobId: job.id, reportedById: customer.id, topic: "Mess", details: "Left boxes.", photos: { create: [{ path: "p.jpg" }] } },
      });
      const help = await schema.db.supportThread.create({ data: { userId: customer.id, subject: "Boxes", jobId: job.id } });
      const reply = await schema.db.supportMessage.create({ data: { threadId: help.id, authorId: office.id, body: "On it" } });
      const note = await schema.db.supportMessage.create({
        data: { threadId: help.id, authorId: office.id, body: "Customer is upset", internal: true },
      });
      await schema.db.auditLog.create({ data: { actorId: office.id, action: "job.viewed", recordType: "jobs", recordId: job.id } });
      return { customer, worker, office, job, photo, review: posted, forCustomer, forWorker, problem, help, reply, note };
    }

    const everything = (sql: (query: string) => Promise<unknown[]>) =>
      Promise.all([
        sql(`SELECT job_id FROM {schema}.completion_evidence`),
        sql(`SELECT id FROM {schema}.completion_evidence_photos`),
        sql(`SELECT id FROM {schema}.reviews`),
        sql(`SELECT id FROM {schema}.notifications`),
        sql(`SELECT id FROM {schema}.problem_reports`),
        sql(`SELECT id FROM {schema}.problem_report_photos`),
        sql(`SELECT id FROM {schema}.support_threads`),
        sql(`SELECT id FROM {schema}.support_messages`),
        sql(`SELECT id FROM {schema}.audit_log`),
        sql(`SELECT trade FROM {schema}.trade_evidence_rules`),
      ]).then(([evidence, evidencePhotos, reviews, notifications, problems, problemPhotos, threads, messages, audit, rules]) => ({
        evidence: evidence.length,
        evidencePhotos: evidencePhotos.length,
        reviews: reviews.length,
        notifications,
        problems: problems.length,
        problemPhotos: problemPhotos.length,
        threads: threads.length,
        messages,
        audit: audit.length,
        rules: rules.length,
      }));

    const nothing = {
      evidence: 0,
      evidencePhotos: 0,
      reviews: 0,
      notifications: [],
      problems: 0,
      problemPhotos: 0,
      threads: 0,
      messages: [],
      audit: 0,
      rules: 0,
    };

    it("lets a customer read their sent evidence, reviews, notifications, problems and threads, never office notes", async () => {
      const mine = await jobAfterwards();
      await jobAfterwards();
      expect(await asSignedIn(mine.customer.id, everything)).toEqual({
        evidence: 1,
        evidencePhotos: 1,
        reviews: 1,
        notifications: [{ id: mine.forCustomer.id }],
        problems: 1,
        problemPhotos: 1,
        threads: 1,
        messages: [{ id: mine.reply.id }],
        audit: 0,
        rules: 0,
      });
    });

    it("doesn't show a customer the worker's evidence while it's a draft", async () => {
      const { customer, worker, job } = await claimedJob("OTHER");
      await evidence(job.id, worker.id, { notes: "Half done" });
      await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: "draft.jpg" } });
      expect(await asSignedIn(customer.id, everything)).toEqual(nothing);
      expect(await asSignedIn(worker.id, everything)).toMatchObject({ evidence: 1, evidencePhotos: 1 });
    });

    it("lets a worker read their evidence, the visible reviews about them and their notifications", async () => {
      const mine = await jobAfterwards();
      await jobAfterwards();
      expect(await asSignedIn(mine.worker.id, everything)).toEqual({
        ...nothing,
        evidence: 1,
        evidencePhotos: 1,
        reviews: 1,
        notifications: [{ id: mine.forWorker.id }],
      });
      await schema.db.review.update({ where: { id: mine.review.id }, data: { hiddenAt: new Date(), hiddenReason: "Abuse" } });
      expect(await asSignedIn(mine.worker.id, everything)).toMatchObject({ reviews: 0 });
      expect(await asSignedIn(mine.customer.id, everything)).toMatchObject({ reviews: 1 });
    });

    it("shows the office and visitors nothing: the audit log and support notes are server-only", async () => {
      const { office } = await jobAfterwards();
      expect(await asSignedIn(office.id, everything)).toEqual(nothing);
      expect(await asSignedIn(null, everything)).toEqual(nothing);
    });

    it("doesn't let anyone write through the Data API", async () => {
      const { customer, worker, review: posted, forCustomer, job } = await jobAfterwards();
      expect(
        await asSignedIn(customer.id, (sql) => sql(`UPDATE {schema}.reviews SET rating = 1 WHERE id = '${posted.id}' RETURNING id`)),
      ).toEqual([]);
      expect(
        await asSignedIn(worker.id, (sql) =>
          sql(`UPDATE {schema}.reviews SET hidden_at = now(), hidden_reason = 'mine' WHERE id = '${posted.id}' RETURNING id`),
        ),
      ).toEqual([]);
      expect(
        await asSignedIn(customer.id, (sql) =>
          sql(`UPDATE {schema}.notifications SET read_at = now() WHERE id = '${forCustomer.id}' RETURNING id`),
        ),
      ).toEqual([]);
      await expect(
        asSignedIn(worker.id, (sql) =>
          sql(`INSERT INTO {schema}.audit_log (action, record_type, record_id) VALUES ('fake.entry', 'jobs', '${job.id}')`),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asSignedIn(customer.id, (sql) =>
          sql(`INSERT INTO {schema}.problem_reports (job_id, reported_by_id, topic, details) VALUES ('${job.id}', '${customer.id}', 'x', 'y')`),
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await schema.db.review.findUniqueOrThrow({ where: { id: posted.id } })).toMatchObject({ rating: 5, hiddenAt: null });
      expect(await schema.db.notification.findUniqueOrThrow({ where: { id: forCustomer.id } })).toMatchObject({ readAt: null });
    });
  });
});
