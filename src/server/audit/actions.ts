import "server-only";

// Every action the audit log may record (#100), with the table it's about and whether it needs a reason. Callers
// pick from this list, so nobody writes a free-text action: `audit(viewer, "job.cancelled", …)` type-checks,
// `audit(viewer, "job cancelled", …)` doesn't. Names are dotted lower case, past tense (the database checks the
// format: audit_log_action_format). Adding an action is adding a line here; renaming one would split a record's
// timeline, so don't: add the new name and leave the old one.
//
// A reason is required where the office overrides something or says no: it's shown on the job's timeline (F05)
// and, for rejections, to the person affected (WEBAPP_SPEC F08: "rejection needs a reason the tradie will see").

/** The tables audited, by their Postgres name (audit_log.record_type). */
export const AUDIT_RECORD_TYPES = [
  "jobs",
  "payments",
  "variations",
  "payouts",
  "job_materials",
  "settings",
  "trade_evidence_rules",
  "licences",
  "worker_profiles",
  "payroll_details",
  "profiles",
  "completion_evidence",
  "reviews",
  "problem_reports",
  "support_threads",
] as const;

export type AuditRecordType = (typeof AUDIT_RECORD_TYPES)[number];

type ActionRule = { readonly record: AuditRecordType; readonly reason?: "required" };

export const AUDIT_ACTIONS = {
  // Jobs. The status machine (#93) names the transition when there is one; `job.status_changed` is for the rest.
  "job.priced": { record: "jobs" },
  "job.sent_to_bounty": { record: "jobs" },
  "job.price_sent": { record: "jobs" },
  "job.paid": { record: "jobs" },
  "job.claimed": { record: "jobs" },
  "job.submitted": { record: "jobs" },
  "job.completed": { record: "jobs" },
  // By the sign-off timer when the customer didn't answer in 48 hours.
  "job.auto_completed": { record: "jobs" },
  "job.cancel_requested": { record: "jobs" },
  "job.cancelled": { record: "jobs", reason: "required" },
  "job.cancel_declined": { record: "jobs", reason: "required" },
  "job.reassigned": { record: "jobs", reason: "required" },
  "job.unassigned": { record: "jobs", reason: "required" },
  "job.status_changed": { record: "jobs" },
  // The office forcing a status the normal rules wouldn't allow (#93 "office override, always logged").
  "job.status_overridden": { record: "jobs", reason: "required" },

  // Money in: payments from Stripe (webhooks act as the system) and refunds by the office.
  "payment.created": { record: "payments" },
  "payment.paid": { record: "payments" },
  "payment.failed": { record: "payments" },
  "payment.refunded": { record: "payments", reason: "required" },
  "payment.partially_refunded": { record: "payments", reason: "required" },

  // Extra work.
  "variation.priced": { record: "variations" },
  "variation.approved": { record: "variations" },
  "variation.declined": { record: "variations" },

  // Money out: what workers are owed, and the pay runs.
  "payout.queued": { record: "payouts" },
  "payout.adjusted": { record: "payouts", reason: "required" },
  "payout.exported": { record: "payouts" },
  "payout.paid": { record: "payouts" },

  // Materials on the trade account.
  "materials.budget_set": { record: "job_materials" },
  "materials.spend_reported": { record: "job_materials" },

  // Office settings: rates, margin, coverage, evidence rules.
  "settings.updated": { record: "settings" },
  "evidence_rule.updated": { record: "trade_evidence_rules" },

  // People.
  "licence.verified": { record: "licences" },
  "licence.rejected": { record: "licences", reason: "required" },
  "licence.expired": { record: "licences" },
  "worker.paused": { record: "worker_profiles", reason: "required" },
  "worker.unpaused": { record: "worker_profiles" },
  "payroll_details.updated": { record: "payroll_details" },
  "profile.role_changed": { record: "profiles", reason: "required" },

  // Sign-off, reviews and support.
  "evidence.approved": { record: "completion_evidence" },
  "evidence.flagged": { record: "completion_evidence", reason: "required" },
  "review.hidden": { record: "reviews", reason: "required" },
  "review.shown": { record: "reviews" },
  "problem_report.resolved": { record: "problem_reports" },
  "support_thread.closed": { record: "support_threads" },
} as const satisfies Record<string, ActionRule>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** The table an action is about: `AuditRecordTypeFor<"job.cancelled">` is `"jobs"`. */
export type AuditRecordTypeFor<A extends AuditAction> = (typeof AUDIT_ACTIONS)[A]["record"];

/** True when the action can't be logged without a reason. */
export type AuditReasonRequired<A extends AuditAction> = (typeof AUDIT_ACTIONS)[A] extends { reason: "required" }
  ? true
  : false;

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(AUDIT_ACTIONS, value);
}

export function auditReasonRequired(action: AuditAction): boolean {
  const rule: ActionRule = AUDIT_ACTIONS[action];
  return rule.reason === "required";
}
