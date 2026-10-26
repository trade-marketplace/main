import "server-only";

import { redirect } from "next/navigation";

import { homeForRole, loginPath } from "@/lib/auth/routes";
import { keptFormValues, type AuthFailure } from "@/lib/auth/results";
import type { Role } from "@/lib/mode";
import { getViewer, type Viewer } from "@/server/auth/viewer";

// Role checks for every page, server action and route handler (#101). The proxy (src/proxy.ts) already redirects
// page visits, but Next.js docs are clear that it must not be the only check: a matcher change or a moved action
// would silently drop it. So everything that reads or changes data checks again here, on the server, with the
// role read from `profiles`. Never trust a role, user id or "is admin" flag sent by the browser.

/** Any signed-in role. */
export const ANY_ROLE: readonly Role[] = ["CUSTOMER", "TRADIE", "ADMIN"];

export type Authorized = { ok: true; viewer: Viewer };

export type Guards = ReturnType<typeof createGuards>;

/** Builds the guards around a viewer loader. The app uses `getViewer`; tests pass a fake. */
export function createGuards(loadViewer: () => Promise<Viewer | null>) {
  /** The check itself: who's asking, and may their role do this? Never throws or redirects. */
  async function authorize(roles: readonly Role[] = ANY_ROLE, formData?: FormData | null) {
    const viewer = await loadViewer();
    if (!viewer) {
      return { ok: false, error: "session-expired", values: keptFormValues(formData) } satisfies AuthFailure;
    }
    if (!roles.includes(viewer.role)) return { ok: false, error: "forbidden" } satisfies AuthFailure;
    return { ok: true, viewer } satisfies Authorized;
  }

  /**
   * For pages and layouts. Signed out → log in (coming back to `next`); wrong role → their own home.
   * Returns the viewer when they may stay.
   */
  async function requireRole(roles: readonly Role[], options: { next?: string } = {}): Promise<Viewer> {
    const viewer = await loadViewer();
    if (!viewer) redirect(loginPath(options.next));
    if (!roles.includes(viewer.role)) redirect(homeForRole(viewer.role));
    return viewer;
  }

  /** For pages any signed-in person may open. */
  function requireUser(options: { next?: string } = {}): Promise<Viewer> {
    return requireRole(ANY_ROLE, options);
  }

  /**
   * Wraps a server action so it only runs for these roles. The handler gets the checked viewer first, then the
   * action's own arguments. Otherwise the action returns `session-expired` (with the form's values, if one of
   * the arguments is FormData) or `forbidden`, and never redirects, so the page keeps what was typed.
   *
   *   export const postJob = withRole(["CUSTOMER"], async (viewer, _prev: State, formData: FormData) => { … });
   */
  function withRole<Args extends unknown[], Result>(
    roles: readonly Role[],
    handler: (viewer: Viewer, ...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result | AuthFailure> {
    return async (...args: Args) => {
      const formData = args.find((arg): arg is FormData => arg instanceof FormData);
      const check = await authorize(roles, formData);
      if (!check.ok) return check;
      return handler(check.viewer, ...args);
    };
  }

  /**
   * Wraps a route handler (`route.ts`). Requests that change something must come from our own pages (same
   * Origin), because unlike server actions, route handlers get no CSRF check from Next.js. Then the role check:
   * 401 `session-expired` or 403 `forbidden`, as JSON.
   */
  function withRoleRoute<Context>(
    roles: readonly Role[],
    handler: (viewer: Viewer, request: Request, context: Context) => Promise<Response>,
  ): (request: Request, context: Context) => Promise<Response> {
    return async (request, context) => {
      if (!isSameOriginRequest(request)) return Response.json({ error: "forbidden" }, { status: 403 });
      const check = await authorize(roles);
      if (!check.ok) {
        return Response.json({ error: check.error }, { status: check.error === "session-expired" ? 401 : 403 });
      }
      return handler(check.viewer, request, context);
    };
  }

  return { authorize, requireRole, requireUser, withRole, withRoleRoute };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True for reads, and for writes whose Origin header matches the host they were sent to. Browsers always send
 * Origin on cross-site POST/PUT/PATCH/DELETE, so a form or script on another site is refused. A write with no
 * Origin at all (curl, server-to-server) is refused too: our own pages always send one.
 */
export function isSameOriginRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

export const { authorize, requireRole, requireUser, withRole, withRoleRoute } = createGuards(getViewer);
