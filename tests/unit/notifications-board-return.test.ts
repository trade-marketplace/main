import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "@/app/(app)/profile/notifications/page";
import { boardAlertsRoute } from "@/lib/job-board";
import { decideRoute } from "@/lib/auth/routes";
import { loadPreferencesAction } from "@/server/notifications/preference-actions";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/notifications/preference-actions", () => ({ loadPreferencesAction: vi.fn(), savePreferenceAction: vi.fn() }));

async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => { throw Error("Expected the real page guard to redirect"); }, (thrown: unknown) => thrown);
  expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;/);
  return (error as { digest: string }).digest.split(";")[2];
}

describe("Alerts board-return authentication contract", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps the same canonical nested return path in the page guard and proxy", async () => {
    const board = "/jobs?sort=earn&distance=10&trade=electrical&unknown=discard";
    const canonical = "/jobs?trade=electrical&distance=10&sort=earn";
    const destination = boardAlertsRoute(board);
    expect(destination).toEqual({ href: `/profile/notifications?next=${encodeURIComponent(canonical)}`, back: canonical });
    const redirect = await redirectedTo(NotificationsPage({ searchParams: Promise.resolve({ next: board }) }));
    expect(new URL(redirect, "https://same.test").searchParams.get("next")).toBe(destination.href);
    expect(decideRoute("/profile/notifications", null, destination.href)).toEqual({ action: "redirect", to: redirect });
    expect(loadPreferencesAction).not.toHaveBeenCalled();
  });
  it.each([undefined, null, ["/jobs", "/jobs"], { next: "/jobs" }, "https://evil.test/jobs", "//evil.test/jobs", "/admin"])("fails closed before authentication for %j", async value => {
    expect(boardAlertsRoute(value)).toEqual({ href: "/profile/notifications", back: null });
    const redirect = await redirectedTo(NotificationsPage({ searchParams: Promise.resolve({ next: value }) }));
    expect(redirect).toBe("/login?next=%2Fprofile%2Fnotifications");
    expect(loadPreferencesAction).not.toHaveBeenCalled();
  });
});
