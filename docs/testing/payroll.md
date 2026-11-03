# Bank and tax verification (#134)

The shared validators use IRD's [Payroll Calculations & Business Rules 2026/27, sections 6–7](https://www.ird.govt.nz/digital-service-providers/services-catalogue/returns-and-information/payday-filing/payroll-calculations-and-business-rules).
The IRD number's secondary weights apply only when the primary result is 10. Bank checks select the current bank's
A/B/D/F/X algorithm and left-pad each component separately. A checksum cannot establish ownership or account existence.

Matt approved 3.5% support after the plan was written. Current options are unenrolled, 3.5/4/6/8/10%, plus 3% labelled
as an approved temporary reduction. IRD's 2026/27 specification says the default increases to 4% on 1 April 2028.
The application stores the worker's selected rate; it does not automatically alter an existing choice or payroll deductions.
Existing integer rates are retained by the decimal-column migration.

`tests/unit/payroll-db.test.ts` uses migrated throwaway Postgres to check encryption contexts, password and current-role
proof, masked responses, field-name-only audit rows, rejected writes and the new contribution rate. The payout tests
check that a missing-details payout remains queued and receives exactly one in-app reminder. The existing Earnings
missing-details banner points to `/profile/payroll`; saving refreshes both pages.

Guarded previews: `/dev/components/payroll?state=missing|saved|editing|validation|error|no-key|loading|offline|saving|load-error`.
The screenshots bot can capture each state. Preview actions use synthetic values and never Auth or a database.
`E2E_DEV_BASE_URL` enables the preview browser tests: five widths, every state, axe, keyboard, validation, save/masks,
password rejection, cancelled edits, offline recovery and a tax-help popup.

For the real protected-page/action journey, migrate a disposable plain Postgres on localhost named `issue134` or
`…local_payroll…`. Start the app with that database, a disposable test `FIELD_ENCRYPTION_KEY`,
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54334`, and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_security`.
Run `tests/e2e/payroll.spec.ts` with `PAYROLL_E2E_APP_URL` and `PAYROLL_E2E_DATABASE_URL` pointing at the local app/database.
The test starts the existing isolated Security Auth double on 54334 (override with `PAYROLL_E2E_AUTH_PORT`), logs in a
synthetic tradie, clicks the Account link, saves through the real Supabase SDK/server action, checks encrypted database
values and absence of plaintext in the action response, reloads masked values, and visits Earnings and back.
It does not contact a real Supabase project or modify live accounts. Standard CI keeps the opt-in local journeys off,
while always checking production route protection and preview 404s. Never use real keys or commit verification artifacts.
