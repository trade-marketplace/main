# Worker eligibility (#137)

`src/server/workers/eligibility.ts` is the shared rule for discovery, map/list filtering, estimate pings,
estimating and claiming. Load private facts with `WORKER_ELIGIBILITY_SELECT` and `JOB_ELIGIBILITY_SELECT`.
`eligibleJobsFor(worker, jobs, context)` returns **server-only job IDs**; it is not a job presentation DTO.
Board/map readers must pass selected jobs through their worker read tier before sending anything to a browser.

- All intents need a TRADIE account, current confirmed email, explicit office identity check, no office pause,
  and a valid work-area centre/suburb/radius. Missing facts fail closed.
- Other is available with those basics, without selecting Other or proving a phone. A verified badge is a
  separate, stricter rule: phone confirmation remains badge-only. No SMS or new confirmation gate is introduced.
- Restricted work needs the selected matching trade and its checked, unexpired licence, including check
  time/actor and a known expiry. Expiry uses the New Zealand calendar, as in Trades & licences.
- Discovery includes unassigned REVIEW, QUOTE_BOUNTY and BOOKABLE jobs. `canEstimate` accepts REVIEW/QUOTE_BOUNTY;
  `canClaim` accepts BOOKABLE only. Nobody can discover, estimate or claim their own job.
- Office-disabled trades are unavailable. The worker's own available switch controls pings, not manual browsing
  or taking work. Existing assigned work can still be finished after an office pause.

All preclaim area checks use the **stored approximate pin**, never the house coordinate or a new random pin.
The private adapter validates the persisted 100–300 m ring against #97's constants, then compares the worker's
radius with the unrounded distance to that approximate point. Missing/invalid points stay unavailable. The exact
point participates only in validating the stored privacy ring and never in work-area filtering or output.

The real status-machine claim path and `saveEligibleEstimate` both lock the job and current proofs, then read
and apply this rule again inside the mutation transaction. A previous discovery/badge decision grants nothing.
Migration `20261104013700_worker_eligibility` adds a narrow lock adapter: a transaction-local
`app.eligibility_worker_id` names the rows to lock when the server updates the job's `updated_at`. Its trigger uses
`TG_TABLE_SCHEMA`, quoted identifiers and an empty search path, so isolated test schemas behave like production.
The adapter runs after the ordinary timestamp trigger and preserves the job's timestamp for this lock-only
write. A subsequent real claim uses the normal timestamp behaviour after the GUC is cleared.
It takes locks in job → profile → worker profile → matching trade/licence → settings order. Profile and worker
profile locks are exclusive, preventing proof-row insertion phantoms and shared-lock upgrades. It does not alter
proof timestamps or decide eligibility; TypeScript remains the single policy.

The GUC is a trusted server lock target, **not an authorization grant**. Browser roles cannot mutate jobs or
estimates. The trigger functions use SECURITY INVOKER, revoke public/anon/authenticated execution, and retain
RLS. A second database trigger rejects own-job estimate inserts, reassignment and edits even for direct server
writes or legacy rows; system-only edit flags remain updateable.
Refused commands roll back the job lock write and any attempted estimate/status changes together.

The old reference files were read from `willimobro/Trade-Marketplace`, branch
`feature/in-app-home-20261023`. Its electrical-only readiness/pending-trade gate and old pay wording are not
carried over: current DECISIONS, launch trades and this issue's series plan supersede them.
