import { cookies } from "next/headers";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { claimPushDisplay, PUSH_DEVICE_COOKIE } from "@/server/notifications/browser-push";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "CUSTOMER") return new Response(null, { status: 401 });
  const proof = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value;
  const message = await claimPushDisplay(getDb(), viewer, proof, (await params).id);
  return message ? Response.json(message, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
