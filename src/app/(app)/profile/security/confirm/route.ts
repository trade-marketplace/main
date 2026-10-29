import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { authorize } from "@/server/auth/guard";
import { confirmSecurityEmail } from "@/server/auth/security-confirm";
import { syncSecurityEmail } from "@/server/auth/security-deps";
import { createSupabaseServerClient } from "@/server/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const check = await authorize(["CUSTOMER", "TRADIE"]);
  // Relative redirects preserve the browser's origin behind proxies and in local previews.
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (!check.ok) return go("/login?next=%2Fprofile%2Fsecurity");
  let confirmed = false;
  try {
    const { auth } = await createSupabaseServerClient();
    confirmed = await confirmSecurityEmail({
      exchange: code => auth.exchangeCodeForSession(code, url.searchParams.has("sb_flow_id") ? { flowId: url.searchParams.get("sb_flow_id")! } : undefined),
      syncEmail: user => syncSecurityEmail(user, true),
      discard: async () => { await auth.signOut({ scope: "local" }); },
    }, check.viewer.userId, url.searchParams.get("code"));
  } catch { /* Invalid/expired links offer a new request on the settings page. */ }
  if (confirmed) revalidatePath("/", "layout");
  return go(confirmed ? "/profile/security" : "/profile/security?confirm=invalid");
}
