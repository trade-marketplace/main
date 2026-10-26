import type { NextRequest } from "next/server";

import { refreshSession } from "@/server/auth/refresh";

// Next.js runs this before every matching request (Next 16 renamed `middleware.ts` to `proxy.ts`).
// It keeps the Supabase session fresh and redirects page visits by role. What it does: src/server/auth/refresh.ts.
// It's only the first line: every page, action and route handler checks the role again (src/server/auth/guard.ts).
export function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  matcher: [
    // Everything except Next.js's own files and static files from public/ (fonts, icons, images).
    "/((?!_next/static|_next/image|favicon\\.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|txt|xml)$).*)",
  ],
};
