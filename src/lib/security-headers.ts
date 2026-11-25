// Security headers sent with every response (#220). next.config.ts applies them to all paths.
//
// The CSP is deliberately narrow: it stops other sites framing ours (clickjacking), injected <base> tags and plugins,
// and forms posting off-site. It does not restrict scripts, styles or connections yet: Next's inline scripts, Stripe,
// Mapbox and Firebase need a nonce-based policy, which is its own task. Geolocation stays on for our own pages (the
// landing page and work-area map ask for it); camera and microphone are never used.

export type SecurityHeader = { key: string; value: string };

export const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; ");

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Older browsers that don't read frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // One year, this host only (Matt, via Claude, 24 Nov): browsers remember it, so subdomains are left out until every
  // *.trademarketplace.nz address is known to serve HTTPS. Browsers ignore it on plain-HTTP local development.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites see only our origin, never a job id, `next` path or token in the URL.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
];
