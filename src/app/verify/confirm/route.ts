import { NextRequest, NextResponse } from "next/server";

import { verificationPath } from "@/lib/auth/verification";
import { confirmVerification } from "@/server/auth/email-verification";
import { verificationAuth, verificationProfiles, VERIFICATION_COMPLETE_COOKIE } from "@/server/auth/verification";
import { authCookieOptions } from "@/server/supabase";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let state: "verified" | "expired" | "invalid" | "unavailable";
  try {
    state = await confirmVerification(verificationAuth(), verificationProfiles, params.get("token_hash"), params.get("type"));
  } catch {
    state = "unavailable";
  }
  const destination = new URL(verificationPath(params.get("next")), request.url);
  if (state !== "verified") destination.searchParams.set("state", state);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (state === "verified") response.cookies.set(VERIFICATION_COMPLETE_COOKIE, "1", { ...authCookieOptions(), maxAge: 86_400 });
  return response;
}
