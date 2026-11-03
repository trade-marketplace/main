# Worker job board (#138)

`/jobs` is a TRADIE-only reader. Every action gets its actor from `withRole`; it reloads the current role, email/office-ID proof, pause, trade/licence records, work area and office-enabled trades. Basic discovery uses #137's rules, not the stricter phone-dependent Verified badge. Quiet availability does not hide manual browsing.

The server scans candidates in batches of 100, applies `eligibleJobsFor`, then uses #95's `workerJobListView`. It never caps the first raw batch and calls that an empty result. Counts, distance, kind/trade/schedule/Saved filters, and sorting operate on eligible projected rows. Distance and the database bounding box use only the persisted approximate pin; no house-coordinate radius/count/sort oracle or fresh jitter is introduced. Missing/invalid safe pins fail closed. The requested distance is bounded by the worker's stored radius.

Pages contain 12 cards. A continuation records a stable sort key and ID plus the snapshot time and a hash of the current query/proof/work-area/settings scope. Missing anchors do not break continuation. Changing eligibility or the Saved set invalidates affected continuation. A new-jobs refresh replaces the list; append de-duplicates IDs. Late poll responses are discarded after a refresh, filter or bookmark change.

Earnings come from the actual central worker projection: frozen worker gross plus holiday pay. Customer totals, margins, GST, other estimates, exact addresses, customer contacts and private proof records never enter the board DTO. REVIEW/QUOTE_BOUNTY cards have no earnings amount. BOOKABLE cards retain their earnings tag even if the worker estimated the earlier unpriced job. Missing frozen pay is shown honestly as “Pay pending”. No bounty reward formula or expiry is inferred here.

Only final-page cards fetch `workerJobView` for safe schedule/photo references. The cover-photo signer rechecks shared file access and looks up one photo path on the server. Discarded/off-page candidates and update counts never get signed URLs. Unavailable photos keep the kit's no-photo fallback.

Saved stores UUIDs only under `trade.jobs.saved.v1.<ownerId>` in this browser. It survives reload, is isolated per account and has explicit damaged/quota-denied storage feedback. It is not cross-device Saved. No read permission or database model is added. A quiet count reload preserves bookmark focus and its save animation.

The Map toggle and worker `/jobs/[id]` currently provide the explicitly scoped heading/summary and Back boundaries. Full map (#139), claim/estimate detail (#144/#145) and work-area editor (#135) remain separate work. Changing the underlying area goes to Contact us; widening the board only widens to the existing stored radius. Alerts and Contact handoffs carry a canonical board return path. Worker detail is a separate role-dispatched component, without a worker-only shared jobs layout: customer Posted (#121), guest/new-job routes and customer `/jobs/[id]/windows` (#119) can coexist.

Guarded `/dev/components/job-board?state=` previews cover ready, empty, not-verified, loading, error, offline, saved (`&saved=1`), no-photo, pay-pending, new-jobs, loading-more and storage-error. Server preview fixtures pass through the actual eligibility and central worker view; only safe display data reaches the preview client. Production/dev guards are unchanged.
