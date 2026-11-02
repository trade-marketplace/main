import "server-only";

import { SYSTEM_ACTOR, createAudit } from "@/server/audit/audit";
import type { AuditAction } from "@/server/audit/audit";
import type { StatusMachineDeps } from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";

// What the status machine (#93) needs to write alongside a status change, for the changes the scheduler makes:
// today only the 48h auto sign-off. The machine names it `job.auto_signed_off`; the audit catalogue calls it
// `job.auto_completed` (like the notification), so the name is translated here.
const AUDIT_ACTION: Record<string, AuditAction> = { "job.auto_signed_off": "job.auto_completed" };

export const schedulerDeps: StatusMachineDeps = {
  async audit(tx, entry) {
    const action = AUDIT_ACTION[entry.action];
    if (!action) throw new Error(`The scheduler doesn't make "${entry.action}" changes.`);
    await createAudit(tx)(SYSTEM_ACTOR, action, { type: "jobs", id: entry.recordId }, entry.before, entry.after, entry.reason);
  },
  async notify(tx, change) {
    if (change.transition !== "auto-sign-off") throw new Error(`The scheduler doesn't make "${change.transition}" changes.`);
    // Only the job's number and id: the same for the customer and the worker (AGENTS.md §5).
    const recipients = [change.customerId, ...(change.workerAfter ? [change.workerAfter] : [])];
    await createNotify(tx)("job.auto_completed", recipients, {
      eventId: `scheduler:job.auto_completed:${change.jobId}`,
      payload: { jobId: change.jobId, jobNumber: change.jobNumber },
    });
  },
};
