import "server-only";

// Launch is in-app only. Registering a future provider and changing this catalogue never changes callers.
// Email and push preferences are stored now; no email, push or SMS provider is enabled here.
export type NotificationChannel = "IN_APP" | "EMAIL" | "PUSH";

type EventRule = { readonly channels: readonly NotificationChannel[]; readonly description: string };

export const NOTIFICATION_EVENTS = {
  "job.posted": { channels: ["IN_APP"], description: "A job was posted." },
  "job.priced": { channels: ["IN_APP"], description: "The fixed price is ready." },
  "job.paid": { channels: ["IN_APP"], description: "The job payment was confirmed." },
  "job.claimed": { channels: ["IN_APP"], description: "A worker claimed the job." },
  "job.window_booked": { channels: ["IN_APP"], description: "A customer time window was booked." },
  "job.on_my_way": { channels: ["IN_APP"], description: "The worker is on the way." },
  "job.running_late": { channels: ["IN_APP"], description: "The worker is running late." },
  "job.reschedule_requested": { channels: ["IN_APP"], description: "A different time was requested." },
  "variation.requested": { channels: ["IN_APP"], description: "Extra work needs a price." },
  "variation.priced": { channels: ["IN_APP"], description: "The extra-work price is ready." },
  "variation.approved": { channels: ["IN_APP"], description: "The customer approved extra work." },
  "variation.declined": { channels: ["IN_APP"], description: "The customer declined extra work." },
  "job.submitted": { channels: ["IN_APP"], description: "Completion evidence is ready for sign-off." },
  "job.signed_off": { channels: ["IN_APP"], description: "The customer signed off the job." },
  "job.auto_completed": { channels: ["IN_APP"], description: "The sign-off timer completed the job." },
  "job.cancel_requested": { channels: ["IN_APP"], description: "A cancellation needs office review." },
  "job.cancelled": { channels: ["IN_APP"], description: "The job was cancelled." },
  "job.reinstated": { channels: ["IN_APP"], description: "The office reinstated the job." },
  "job.status_overridden": { channels: ["IN_APP"], description: "The office changed the job status." },
  "payout.queued": { channels: ["IN_APP"], description: "A worker payout was queued." },
  "payout.paid": { channels: ["IN_APP"], description: "A worker payout was paid." },
  "bounty.available": { channels: ["IN_APP"], description: "A quote bounty is available." },
  "crew.invited": { channels: ["IN_APP"], description: "A worker was invited to a crew." },
  "licence.verified": { channels: ["IN_APP"], description: "The office verified a licence." },
  "licence.rejected": { channels: ["IN_APP"], description: "The office rejected a licence." },
} as const satisfies Record<string, EventRule>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export function isNotificationEvent(event: string): event is NotificationEvent {
  return Object.hasOwn(NOTIFICATION_EVENTS, event);
}
