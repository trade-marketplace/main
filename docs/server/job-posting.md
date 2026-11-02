# Job drafts and posting (#116)

The wizard can use `saveDraftAction`, `loadDraftAction` and `postJobAction` in `src/server/jobs/actions.ts`.
It supplies no customer id: the server reads the session and rechecks the profile, role and email verification.
Screens and browser persistence belong to the wizard issues.

Make one UUID `postKey` when starting a draft. Keep it with the draft in localStorage under `DRAFT_STORAGE_KEY`
(`src/lib/job-draft.ts`), including while signed out. Send it in each draft save and as the second argument to
`postJobAction`. Saves merge the entered step with earlier steps; an invalid step leaves the previous draft intact.
After sign-up and email verification, upload the browser-local photos and post with the same key. A retry returns
the existing job to its owner, even if the input changed. A key belonging to another customer is refused.

`uploadDraftPhoto` in `src/server/jobs/draft-photos.ts` is the server-side staging helper for the future wizard's
upload transport. It uses the existing image checks, WebP processing, private bucket and upload rate limit. It
accepts only a trusted customer viewer, and names files `drafts/<customer id>/<postKey>/<content hash>.webp`.
`draftPhotoUrlAction` provides owner-only expiring previews when a draft is restored. Posted attachments keep those
paths and are viewed through the existing `jobPhotoUrls` service, which checks job access before signing. Browser
Storage reads cannot list or fetch these staging paths; no new Storage policy or public URL is added.

Posting returns `posted` (job id and number), `needs-account` (including an unverified email), `forbidden`,
`invalid` (field prompts copied from C02–C05), `outside-area` (the existing waitlist path, suburb, area and account
email), `photos-pending`, or `rate-limited`. The caller retains the draft for every refusal. Outside-area results
offer the existing waitlist; they do not subscribe someone without their consent.

All job changes commit in one transaction: validation, rate limit, current coverage, stored-photo checks,
REVIEW creation through the status machine, initial actor history, attachments, time windows, draft deletion and
`job.posted` audit. Worker notifications run after commit, contain only the job id and number, and use a stable
event id so a retry can recover a delivery failure. Only available workers with the matching trade, a current
licence when required, and a work area containing the job receive them. A typed address waits for the office's
location check before area matching.

The migration adds server-only `job_drafts` (RLS enabled, no browser grants/policies) and nullable unique
`jobs.post_key`. The C03 no-photo path is allowed and sets `jobs.photos_need_check` for office review, also recorded
in the posting audit; any supplied photo must still have finished uploading. William reviews the schema and
authorization changes before merge.
