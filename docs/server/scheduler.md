# Scheduled jobs (#99)

The timer that runs the time-based rules. Decision #61: **Supabase pg_cron, every minute** (Vercel Cron's free plan only
runs daily).

```
pg_cron (every minute) → run_scheduled_jobs() → pg_net POST → /api/scheduler/run → runScheduledRules()
```

- `run_scheduled_jobs()` (migration `20261102099000_scheduled_jobs`) reads the route URL and the shared secret from
  **Supabase Vault** and posts to the route. If pg_net or either secret is missing it does nothing, so a half-set-up
  project is quiet rather than noisy. On plain Postgres (CI, local tests) there is no pg_cron: the migration only
  schedules the job when pg_cron and pg_net exist.
- `/api/scheduler/run` (`src/app/api/scheduler/run/route.ts`, logic in `src/server/scheduler/handler.ts`) is **POST
  only** and needs `Authorization: Bearer <SCHEDULER_SECRET>`. No secret configured = 503, wrong or missing token =
  401, other methods = 405. It answers with counts only.
- `runScheduledRules` (`src/server/scheduler/runner.ts`) runs the rules in `src/server/scheduler/rules.ts` in order.

## The rules

| Rule | Finds | Does | Once-only guard |
|---|---|---|---|
| `auto-sign-off` | `SUBMITTED` jobs whose evidence was sent `settings.auto_release_hours` (48) ago, no open problem report | `auto-sign-off` transition through the status machine (#93), audit row `job.auto_completed`, notifies customer and worker | the machine's conditional update: only one run wins |
| `bounty-expiry` | `QUOTE_BOUNTY` for `settings.bounty_expiry_hours` (24) | marks `bounty.expired`, notifies the office. **The job's status does not change** | `scheduled_job_marks` |
| `price-slow-banner` | `REVIEW` jobs posted 24h ago | marks `price.slow`: the customer's job page shows "taking longer than 24h" while the mark exists and the job is still `REVIEW`. No notification | `scheduled_job_marks` |
| `unclaimed-alert` | `BOOKABLE` for 48h | marks `job.unclaimed`, notifies the office | `scheduled_job_marks` |
| `review-reminder` | `COMPLETED` 24h to 7 days ago with no review | marks `review.reminded`, one `review.reminder` to the customer | `scheduled_job_marks` |
| `window-expiry` | unassigned `BOOKABLE` jobs whose nonempty dated selection is entirely before today in Auckland, excluding explicit Any time | sends the customer `job.reschedule_requested`, linked to the owned time-window editor; claim is blocked until new windows are added | mark and notification are atomic under the job row lock; an owned window update clears the mark, and the notification event id includes the window-set revision |
| `support-photo-cleanup` | private support-photo cleanup intents at least 24h old, at most 10 per run | checks current message references under the upload/attachment path lock; removes unreferenced objects, retries failed removals | durable intent plus deletion tombstone; referenced photos stay private and retained |
| `draft-photo-raw-cleanup` | private raw stages after their two-hour token expiry plus five minutes, at most 10 per run | removes raw objects again, including late signed uploads, then removes the stage record | failed removals retain the record for retry |
| `draft-photo-cleanup` | processed photo intents due after 24h, at most 10 per run | keeps exact draft/job photo references under the same draft-owner lock; defers referenced checks another day | durable intent before put and a committed deletion tombstone; no cascading account FK |

"Entered the status" is the latest `job_status_history` row for that status. Each marked rule writes its
`scheduled_job_marks` row and its notification in **one transaction**, so a failure rolls both back and the job is due
again next minute. Notification ids come from the event id (`scheduler:<rule>:<job id>`), so a retry never duplicates.

## Safe to run twice, late, or at once

- Twice or at the same moment: see the guard column. A second run finds nothing due.
- Late or after downtime: each rule takes the **oldest due jobs first**, up to 200 per rule per run (`DEFAULT_LIMIT`).
  A backlog drains over the next runs in due order; nothing is skipped because it is old (except review reminders older
  than 7 days, which would only be noise).
- One job failing is logged and counted (`failed`); the jobs behind it still run and it is retried next minute.
- A job that moved on between the search and the action (signed off, priced, claimed) is left alone (`skipped`).

Support-photo upload intents commit before Storage receives bytes. Uploads always use new owner/job-bound random
paths. A failed attachment/audit leaves its intent intact; deleting a saved photo reference queues cleanup again.
Before remote removal the cleanup persists a tombstone so an ambiguous Storage failure cannot allow a new attachment
to that path. The next minute retries it; any remaining message reference preserves the object.

## Turning it on (William, once per environment)

1. Set `SCHEDULER_SECRET` in Vercel (32+ random characters, `openssl rand -base64 36`).
2. In Supabase, enable the **pg_cron** and **pg_net** extensions (the migration does it where it can) and add two Vault
   secrets: `scheduler_url` (e.g. `https://trademarketplace.nz/api/scheduler/run`) and `scheduler_secret` (the same value
   as `SCHEDULER_SECRET`):
   ```sql
   select vault.create_secret('https://trademarketplace.nz/api/scheduler/run', 'scheduler_url');
   select vault.create_secret('<the secret>', 'scheduler_secret');
   ```
3. Check `select * from cron.job_run_details order by start_time desc limit 5;` and that `net._http_response` shows 200s.

Previews and staging should point `scheduler_url` at their own deployment, or leave the secrets unset to keep timers off.

## Adding a rule

Add a `SchedulerRule` to `rules.ts` and to `SCHEDULER_RULES`; if it is once-only, add its name to the `rule` CHECK in a
new migration and use `markOnce`. Test it in `tests/unit/scheduler.test.ts`, including running it twice and late.
