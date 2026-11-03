// Stripe's webhook (#151). POST only; the work and its tests are in src/server/payments/webhook.ts. Add this URL in the
// Stripe dashboard (Developers → Webhooks): https://<site>/api/stripe/webhook, with the events listed in docs/SERVICES.md.
import { handleWebhookPost, liveWebhookDeps } from "@/server/payments/webhook";

export const dynamic = "force-dynamic";
// Node, not the edge runtime: signature checking and the database client need it.
export const runtime = "nodejs";

export const POST = (request: Request) => handleWebhookPost(request, liveWebhookDeps);

const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
