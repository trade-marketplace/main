import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app/AppShell";
import { SiteShell } from "@/components/site/SiteShell";
import Home, { generateMetadata } from "@/app/page";
import type { Viewer } from "@/server/auth/viewer";

const sources = vi.hoisted(() => ({ viewer: null as Viewer | null }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => sources.viewer }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  unstable_rethrow: () => undefined,
}));

describe("home role dispatch", () => {
  it("keeps signed-out marketing public and uses the private app shell for a customer", async () => {
    sources.viewer = null;
    expect((await Home()).type).toBe(SiteShell);
    expect(await generateMetadata()).toMatchObject({ alternates: { canonical: "/" } });
    sources.viewer = { userId: "customer", role: "CUSTOMER", firstName: "Sarah", email: "sarah@example.test", emailVerified: true };
    expect((await Home()).type).toBe(AppShell);
    expect(await generateMetadata()).toMatchObject({ title: "Home", robots: { index: false, follow: false } });
  });
  it.each([["TRADIE", "/jobs"], ["ADMIN", "/admin"]] as const)("keeps %s at their existing home", async (role, destination) => {
    sources.viewer = { userId: "person", role, firstName: "Fixture", email: "fixture@example.test", emailVerified: true };
    await expect(Home()).rejects.toThrow(`redirect:${destination}`);
  });
});
