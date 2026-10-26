import { expect, test } from "@playwright/test";

// The proxy (src/proxy.ts) on the real built app (#101). E2E runs have Supabase off, so everyone is signed out.
// Signed-in redirects by role are unit-tested in tests/unit/auth-refresh.test.ts.

test("sends a signed-out visitor from an app page to log in, remembering the page", async ({ request }) => {
  const response = await request.get("/dashboard?tab=active", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers()["location"], "http://site.invalid");
  expect(`${location.pathname}${location.search}`).toBe("/login?next=%2Fdashboard%3Ftab%3Dactive");
});

test("leaves public pages alone", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});
