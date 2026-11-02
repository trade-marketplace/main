# Office: All jobs

Issue #170 (F04). Route: `/admin/jobs`. Mockup: pages.html `w-o-jobs` ("Office · all jobs").

| Part | Code |
|---|---|
| The page (checks the office role, reads a page of jobs) | `src/app/admin/jobs/page.tsx` |
| Export CSV (same filters, no paging) | `src/app/admin/jobs/export/route.ts` |
| What the office sees and does | `src/components/office/AllJobs.tsx` |
| Filters, search, sort and page in the URL | `src/lib/office-jobs.ts` |
| The database reads and the CSV | `src/server/office/jobs.ts` |

## What it does

- **Every job** in a table: Job (title, `TM-1005 · Electrical`), Status (the office's pill words), Customer and
  Tradie ("Sarah T"), Price (incl GST, "—" until priced) and Updated ("46m ago"). Newest change first.
- **Filters** are chips with menus: Status (All, Active, To price, Waiting on customer, Unclaimed, In progress,
  Sign-off, Completed, Cancellations), Trade, Region (every city a job is in) and Date (how recently it changed).
- **Search** finds a job number however it's typed (`TM-1005`, `tm1005`, `1005`), or words in the title, the
  suburb or either person's name. It searches 300ms after the last key.
- **Sort** by any column but Status. Unpriced jobs go last when sorting by price.
- **25 a page**, with "Showing 1–25 of 128" and Previous / Next. A page past the end shows the last page.
- **Everything is in the URL** (`?status=price&trade=ELECTRICAL&q=tap&sort=price.desc&page=2`), so Back, refresh
  and a shared link show the same list. Filters, sort and page push a new entry; typing a search replaces it.
- **Export CSV** downloads every job matching the filters, search and sort (not just the page), up to 5,000 rows.
  It's greyed out when nothing matches. Titles that look like spreadsheet formulas are made safe.
- **Clicking a row** (or its title link, by keyboard) opens `/admin/jobs/[id]`, the job admin view (F05, #171,
  docs/components/office-job.md).

## States

| State | How to see it |
|---|---|
| The list | `/admin/jobs` as office (the seed has ten jobs, one per status) |
| Nothing matches (the issue's "Empty filter") | `/admin/jobs?q=nothing-matches`: "No jobs match that." and Clear filters |
| No jobs at all | An empty database: "No jobs yet." |
| Loading | Skeleton rows (M15) while a filter, sort, search or page change is on its way |
| Can't load | Database down: "Can't load jobs" with Try again; the error is in the server log |

## Tests

- `tests/unit/office-jobs.test.tsx`: the URL state (and junk in it), the database filter and order, paging, the
  rows, the CSV (escaping and formula cells), the export route, every state of the page, the role check.
- `tests/e2e/office-jobs-signed-in.spec.ts`: signed in as the seeded office user against a local build and a
  seeded throwaway database (never Supabase). Axe and no sideways scroll at all five widths, filters by keyboard,
  Back, search, Clear filters, sort, Export CSV, opening a job, and a customer or signed-out visitor getting no
  list and no export. How to run it is at the top of the file.

## Notes for review

- **William:** the page and the export both check the ADMIN role on the server (and the proxy keeps everyone
  else out of `/admin`). The reads select only what the table shows. The export isn't written to the audit log,
  because the log records changes to a record and an export doesn't fit it. Say if you want an export entry
  added.
- **Matt:**
  - No photo thumbnails yet. The mockup has one per row, but job photos are private and need signed links from
    the upload service (#96). The rows add them once that's in.
  - Updated shows "46m ago" / "3 days ago" rather than the mockup's mix of times ("9:14", "Mon").
  - The status pills use the office words already in the kit (In progress, Payroll, Cancellation), which differ a
    little from the mockup's (Assigned, Completed, Cancel review).
