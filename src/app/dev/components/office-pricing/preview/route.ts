import { guardDevPage } from "@/server/dev-pages";
import { PRICE_STATES, previewExample, type PriceState } from "../preview-data";
/** Fictitious, read-only calculator for the guarded component demo. Never reads or changes a real job. */
export async function POST(request: Request) {
  guardDevPage();
  try {
    const raw: unknown = await request.json(), value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const state: PriceState = PRICE_STATES.includes(value.state as PriceState) ? value.state as PriceState : "ready";
    return Response.json(previewExample(value, state));
  } catch { return Response.json({ ok: false, error: "invalid" }, { status: 400 }); }
}
