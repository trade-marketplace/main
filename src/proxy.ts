import { NextResponse, type NextRequest } from "next/server";

import { configuredMaintenance, maintenanceException, maintenancePhase } from "@/lib/maintenance";
import { refreshSession } from "@/server/auth/refresh";

// Next.js runs this before every matching request (Next 16 renamed `middleware.ts` to `proxy.ts`).
// It keeps the Supabase session fresh and redirects page visits by role. What it does: src/server/auth/refresh.ts.
// It's only the first line: every page, action and route handler checks the role again (src/server/auth/guard.ts).
export function proxy(request: NextRequest) {
  const window = configuredMaintenance();
  const now = Date.now();
  if (window && maintenancePhase(window, now) === "page" && !maintenanceException(request.nextUrl.pathname)) {
    const headers = { "Retry-After": String(Math.ceil((window.until - now) / 1000)), "Cache-Control": "no-store" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new NextResponse("Back at " + window.endTime + ".", { status: 503, headers });
    }
    if (request.nextUrl.pathname === "/maintenance") return NextResponse.next({ status: 503, headers });
    return NextResponse.rewrite(new URL("/maintenance", request.url), { status: 503, headers });
  }
  // Preserve the previous session bypass for file-shaped URLs outside a window.
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|txt|xml)$/.test(request.nextUrl.pathname)) return NextResponse.next();
  return refreshSession(request);
}

export const config = {
  matcher: [
    // Match page routes with file extensions as well. Only actual static namespaces skip the proxy.
    "/((?!_next/static/|_next/image(?:/|$)|favicon\\.ico$|fonts/).*)",
  ],
};
