# Posted confirmation and optional browser pings

The job-creation transaction freezes one G05 email in `job_post_confirmations`. A replay returns the existing
owned job without adding or changing that message. The scheduler sends it after commit through the existing
Resend transport, using `posted:<jobId>:EMAIL`; queuing is not delivery. The worker rechecks the current owner,
verified customer role and original recipient address. It never retargets a pending email after an address change.

Set the existing server-only `RESEND_API_KEY` to enable sending from `hello@trademarketplace.nz`; this confirmation
does not require the contact inbox. Without a mailer, messages remain pending. Each message gets at most five
provider attempts (1, 2, 4, 8 minute backoff) within 23 hours of its first attempt, inside Resend's 24-hour
idempotency retention. The stored body stays unchanged across deployments and retries.

Browser pings use the chosen Firebase project. Populate the public Firebase web fields/VAPID key and the matching
server-only service-account JSON documented in `.env.example`. No credentials or provider resources are provisioned
by this change. Missing or invalid configuration shows the unavailable state; permission alone never promises pings.
`npm run dev` and `npm run build` bundle the official modular messaging worker locally. The worker route exposes only
the validated public web configuration. The runtime G05 renderer's token CSS is explicitly included in output tracing.

The Posted card appears while the price is pending (REVIEW/QUOTE_BOUNTY), and asks once per customer in this browser
using the shared bounded once store. Resolved/cancelled success revisits show their current status without this ask. It asks the native
browser only after **Yes please**. Dismissing the native prompt ends that request; retrying a granted registration
does not ask again. Cookie-only preflight must complete before a token is bound, so a lost binding response can
retry with the acknowledged HttpOnly device proof. Another unproved device cannot take over a known token. A proven
device can change accounts atomically; old deliveries keep their old owner and fail fresh authorization checks.

Only a new customer-owned `job.priced` inbox row with an explicit enabled PUSH preference and active registration
queues a delivery. The worker rechecks owner, current PRICED status, verified role, device and preference before
provider invocation. FCM receives an opaque delivery id, never job content. `channelsSent` is updated only after
provider acceptance. Retries reuse that delivery id; a fresh session/device/owner/status-checked atomic display
claim allows at most one popup across foreground/background duplicates, including after dismissal. A crash after
claiming can lose the optional popup; the durable in-app inbox remains available. Logout revokes the proven device.

Both delivery rules use the scheduler invocation's shared physical deadline and small batches. Claiming/releasing
a lease without calling a provider does not consume a provider attempt. OAuth retries are explicitly disabled;
each token/API request has a physical timeout. Provider calls run outside database transactions. No page GET sends
an email, backfills a queue or asks browser permission.
