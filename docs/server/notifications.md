# Notifications (#98)

Features use one server-only call. **Launch is in-app only**: no email, push or SMS sends occur, and importing the
module or building the app opens no database connection.

```ts
import { notify } from "@/server/notifications/notify";

await notify("job.claimed", [customerId, workerId], {
  eventId: commandId,
  payload: { jobId, jobNumber },
});
```

`eventId` identifies the durable source event, not a delivery attempt: use the stored command/webhook/event id and
reuse it on every retry. Never generate a new id inside a retry. A later, separate event needs a new id even if it
has the same type and job. Reusing one id for another event type is an input error.

The event id and recipient determine a UUIDv8 notification id. The existing database primary key and an upsert
deduplicate repeated or concurrent calls, including after a process restart. A replay does not clear `readAt`,
replace the first payload, or change the inbox time. Repeated recipients are collapsed; conflicting payloads for
one recipient in a call are refused. An empty recipient list does nothing.

## Payloads and recipients

The feature chooses the recipients: this service does not invent who should receive a business event. Put only
shared, authorised fields (normally job id and number) in `data.payload`. Put private fields on their recipient:

```ts
await notify("job.priced", [
  { userId: customerId, payload: { customerPriceCents } },
  { userId: workerId, payload: { earningsCents } },
], { eventId, payload: { jobId, jobNumber } });
```

The worker's row must never contain the customer price; the customer's must never contain estimates or margins
(AGENTS.md §5). The service merges each recipient's own payload onto the shared fields. Server callers remain
responsible for authorisation, choosing valid recipients and safe data. No action or API route is exposed here.

## Event catalogue and defaults

The typed catalogue is `src/server/notifications/events.ts`. All defaults below are **in-app only**. Registering a
provider alone cannot send an optional channel; a central default must enable it too. Future email/push defaults
require a product decision. No SMS at launch (DECISIONS.md #63).

| Event | Default channels | Meaning |
|---|---|---|
| `job.posted` | IN_APP | Job posted |
| `job.priced` | IN_APP | Fixed price ready |
| `job.paid` | IN_APP | Job payment confirmed |
| `job.claimed` | IN_APP | Worker claimed job |
| `job.window_booked` | IN_APP | Customer time window booked |
| `job.on_my_way` | IN_APP | Worker on the way |
| `job.running_late` | IN_APP | Worker delayed |
| `job.reschedule_requested` | IN_APP | Different time requested |
| `variation.requested` | IN_APP | Extra work needs a price |
| `variation.priced` | IN_APP | Extra-work price ready |
| `variation.approved` | IN_APP | Customer approved extra work |
| `variation.declined` | IN_APP | Customer declined extra work |
| `job.submitted` | IN_APP | Completion evidence ready |
| `job.signed_off` | IN_APP | Customer signed off |
| `job.auto_completed` | IN_APP | Sign-off timer completed job |
| `job.cancel_requested` | IN_APP | Office cancellation review needed |
| `job.cancelled` | IN_APP | Job cancelled |
| `job.reinstated` | IN_APP | Office reinstated job |
| `job.status_overridden` | IN_APP | Office changed status |
| `payout.queued` | IN_APP | Worker payout queued |
| `payout.paid` | IN_APP | Worker payout paid |
| `bounty.available` | IN_APP | Quote bounty available |
| `crew.invited` | IN_APP | Crew invitation |
| `licence.verified` | IN_APP | Office verified licence |
| `licence.rejected` | IN_APP | Office rejected licence |

Add a new typed event in the catalogue and document its default channels here. Existing callers do not change
when a delivery channel is added. Bounty expiry, fair-price thresholds, payouts and onboarding policy are not
decided by this catalogue.

## Optional channels and preferences

`createNotify(db, options)` is the injectable factory. A future bootstrap can register `channels.EMAIL` or
`channels.PUSH` and configure `eventChannels` once. A channel adapter receives the persisted notification, event
id and stable `idempotencyKey` (`<notification UUID>:<channel>`). It **must** honour that key: a network response or
the subsequent `channelsSent` update can be lost, and concurrent retries can reach the provider. Only successful
sends are added to the row's existing `channelsSent` array; replays skip those channels. No real adapters ship in
this issue.

The new `notification_preferences` table has one `enabled` choice per user and optional channel. No row follows
the event's central defaults; `enabled: false` skips that channel. An explicit `true` permits a channel only when
that event enables it. IN_APP cannot be switched off. Preference lookup happens after saving the in-app row, and
a lookup failure never sends an optional channel or removes in-app. At launch no optional provider is active, so
the preference table is not queried at all.

Authenticated settings server actions can write preferences later; there is deliberately no browser write
policy. RLS permits users to read only their own preferences. The existing notifications RLS remains unchanged.
**Schema changes and the migration need William's review. The migration has not been applied to Supabase.**

## Failures and transactions

Each send/save gets three attempts by default (100ms, 200ms backoff), configurable from one to five. Exhausted
failures are logged once with event, event id, user id, channel and attempt count. Logs exclude the exception
message, provider response and payload. Healthy recipients still get their rows. Optional-channel failure is
returned in `result.failures`, keeping in-app. An exhausted in-app failure throws `NotificationDeliveryError` with
the partial result so the source event can be retried with its original id. A replay resumes failed channels.

`createNotify(tx, { maxAttempts: 1 })` can write inside a feature's existing Prisma transaction, including the
status machine's injected notification callback. Set one attempt there: Postgres errors abort a transaction, so
retry the **whole outer transaction** with its durable command id. Do not send external providers inside a
transaction; they cannot roll back with the business change. Before enabling external delivery for transactional
callers, add a durable post-commit worker/outbox. This issue implements neither live providers nor cron work.

## Verification

`tests/unit/notifications.test.ts` uses a recording fake database and fake adapters. It covers the main in-app
path, channel opt-out while keeping in-app, replay/concurrent idempotency, preserving read state, private
recipient payloads, retry/exhaustion, partial failures, optional-channel registration, preference outages and
input validation. With `TEST_DATABASE_URL` set to a throwaway local Postgres, integration tests run the real
migrations and cover concurrent deduplication, read-state preservation, persisted opt-outs, transaction rollback,
preference uniqueness/cascade and RLS isolation with browser writes refused. The migration also has static checks.
No Supabase database, secrets or provider credentials are used by these tests.
