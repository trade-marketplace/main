import { describe, expect, it, vi } from "vitest";

import { isForbidden, isSessionExpired } from "@/lib/auth/results";
import type { Role } from "@/lib/mode";
import { createGuards, isSameOriginRequest } from "@/server/auth/guard";
import type { Viewer } from "@/server/auth/viewer";

function viewer(role: Role): Viewer {
  return { userId: `user-${role}`, email: `${role.toLowerCase()}@example.nz`, role, firstName: "Sam", emailVerified: true };
}

/** Guards whose "who is signed in" answer is fixed: a role, or null for signed out / session gone. */
function guardsFor(role: Role | null) {
  return createGuards(async () => (role ? viewer(role) : null));
}

/** Where a Next.js `redirect()` was sent, read from the error it throws. */
async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  const digest = (error as { digest?: string }).digest ?? "";
  expect(digest.startsWith("NEXT_REDIRECT")).toBe(true);
  return digest.split(";")[2];
}

describe("requireRole (pages)", () => {
  it("returns the viewer when their role may open the page", async () => {
    await expect(guardsFor("CUSTOMER").requireRole(["CUSTOMER"])).resolves.toMatchObject({ role: "CUSTOMER" });
  });

  it("redirects a tradie on a customer-only page to their home", async () => {
    expect(await redirectedTo(guardsFor("TRADIE").requireRole(["CUSTOMER"]))).toBe("/jobs");
  });

  it("redirects a customer on an office page to their home", async () => {
    expect(await redirectedTo(guardsFor("CUSTOMER").requireRole(["ADMIN"]))).toBe("/");
  });

  it("sends someone signed out to log in, coming back to the page", async () => {
    expect(await redirectedTo(guardsFor(null).requireRole(["TRADIE"], { next: "/earnings" }))).toBe(
      "/login?next=%2Fearnings",
    );
  });

  it("requireUser lets any signed-in role in", async () => {
    for (const role of ["CUSTOMER", "TRADIE", "ADMIN"] as const) {
      await expect(guardsFor(role).requireUser()).resolves.toMatchObject({ role });
    }
  });
});

describe("withRole (server actions)", () => {
  const postJob = (role: Role | null, handler = vi.fn(async (who: Viewer, title: string) => ({ ok: true, who, title }))) => ({
    action: guardsFor(role).withRole(["CUSTOMER"], handler),
    handler,
  });

  it("runs the action for the right role, passing the checked viewer first", async () => {
    const { action, handler } = postJob("CUSTOMER");
    await expect(action("Fix tap")).resolves.toMatchObject({ ok: true, title: "Fix tap", who: { role: "CUSTOMER" } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("refuses a server action called by the wrong role, without running it", async () => {
    const { action, handler } = postJob("TRADIE");
    const result = await action("Fix tap");
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(isForbidden(result)).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses office users too: only the roles listed may run it", async () => {
    const { action, handler } = postJob("ADMIN");
    expect(await action("Fix tap")).toEqual({ ok: false, error: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers session-expired (not a redirect) when the session ran out mid-form, keeping the form's values", async () => {
    const handler = vi.fn(async (...args: [Viewer, unknown, FormData]) => ({ ok: true, args }));
    const action = guardsFor(null).withRole(["CUSTOMER"], handler);
    const form = new FormData();
    form.set("title", "Leaking tap");
    form.set("description", "Kitchen, drips all night");
    form.set("password", "never-echoed-back");

    const result = await action(null, form);

    expect(isSessionExpired(result)).toBe(true);
    expect(result).toEqual({
      ok: false,
      error: "session-expired",
      values: { title: "Leaking tap", description: "Kitchen, drips all night" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers session-expired with no values for an action that takes no form", async () => {
    const { action } = postJob(null);
    expect(await action("Fix tap")).toEqual({ ok: false, error: "session-expired", values: {} });
  });

  it("checks the role again on every call (a role change takes effect straight away)", async () => {
    let role: Role = "CUSTOMER";
    const guards = createGuards(async () => viewer(role));
    const action = guards.withRole(["CUSTOMER"], async () => "done");
    expect(await action()).toBe("done");
    role = "TRADIE";
    expect(await action()).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("authorize", () => {
  it("defaults to any signed-in role", async () => {
    await expect(guardsFor("ADMIN").authorize()).resolves.toMatchObject({ ok: true, viewer: { role: "ADMIN" } });
    await expect(guardsFor(null).authorize()).resolves.toMatchObject({ ok: false, error: "session-expired" });
  });
});

describe("withRoleRoute (route handlers)", () => {
  const ok = async (who: Viewer) => Response.json({ id: who.userId });

  function request(method: string, headers: Record<string, string> = {}) {
    return new Request("https://trademarketplace.nz/api/thing", {
      method,
      headers: { host: "trademarketplace.nz", ...headers },
    });
  }

  it("runs for the right role", async () => {
    const response = await guardsFor("TRADIE").withRoleRoute(["TRADIE"], ok)(request("GET"), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "user-TRADIE" });
  });

  it("answers 401 session-expired when signed out", async () => {
    const response = await guardsFor(null).withRoleRoute(["TRADIE"], ok)(request("GET"), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session-expired" });
  });

  it("answers 403 forbidden for the wrong role", async () => {
    const response = await guardsFor("CUSTOMER").withRoleRoute(["TRADIE"], ok)(request("GET"), {});
    expect(response.status).toBe(403);
  });

  it("refuses a write from another site before checking anything else", async () => {
    const handler = vi.fn(ok);
    const response = await guardsFor("TRADIE").withRoleRoute(["TRADIE"], handler)(
      request("POST", { origin: "https://evil.example" }),
      {},
    );
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("isSameOriginRequest", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://trademarketplace.nz/api/x", { method: "POST", headers });

  it("allows reads from anywhere", () => {
    expect(isSameOriginRequest(new Request("https://trademarketplace.nz/api/x"))).toBe(true);
  });

  it("allows a write from our own pages", () => {
    expect(isSameOriginRequest(post({ origin: "https://trademarketplace.nz", host: "trademarketplace.nz" }))).toBe(
      true,
    );
  });

  it("uses the forwarded host behind Vercel's proxy", () => {
    expect(
      isSameOriginRequest(
        post({ origin: "https://trademarketplace.nz", host: "internal", "x-forwarded-host": "trademarketplace.nz" }),
      ),
    ).toBe(true);
  });

  it("refuses a write from another site, or with no Origin", () => {
    expect(isSameOriginRequest(post({ origin: "https://evil.example", host: "trademarketplace.nz" }))).toBe(false);
    expect(isSameOriginRequest(post({ host: "trademarketplace.nz" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "null", host: "trademarketplace.nz" }))).toBe(false);
  });
});
