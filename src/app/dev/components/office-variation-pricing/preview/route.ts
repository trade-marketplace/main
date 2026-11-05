import { guardDevPage } from "@/server/dev-pages";
import { VARIATION_STATES, previewVariationExample, type VariationState } from "../preview-data";
/** Fictitious read-only calculator; no access to a real variation or payment. */
export async function POST(request: Request) {
  guardDevPage();
  try {
    const raw: unknown = await request.json(), input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const state: VariationState = VARIATION_STATES.includes(input.state as VariationState) ? input.state as VariationState : "ready";
    return Response.json(previewVariationExample(raw, state));
  } catch { return Response.json({ ok: false, error: "invalid" }, { status: 400 }); }
}
