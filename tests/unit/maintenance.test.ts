import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { maintenancePhase, maintenanceWindow } from "@/lib/maintenance";
import { config, proxy } from "@/proxy";
import { refreshSession } from "@/server/auth/refresh";

vi.mock("@/server/auth/refresh", () => ({ refreshSession: vi.fn(() => NextResponse.next()) }));

const start = "2025-11-07T23:00:00+13:00";
const end = "2025-11-08T06:00:00+13:00";
const window = maintenanceWindow(start, end)!;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("ignores absent, partial, malformed, timezone-free, and non-increasing windows", () => {
  for (const [from, until] of [
    [undefined, undefined], [start, undefined], [undefined, end], ["", ""],
    ["nope", end], ["2025-02-31T11:00:00Z", end], ["2025-11-07T11:00:00", end],
    [start, start], [end, start],
  ]) {
    expect(maintenanceWindow(from, until)).toBeNull();
  }
  expect(maintenancePhase(null, Date.now())).toBe("off");
});

it("uses exact instants and shows local New Zealand dates and times", () => {
  expect(window.label).toBe("Fri 7 Nov, 11pm–6am");
  expect(window.endTime).toBe("6am");
  expect(maintenanceWindow("2025-11-07T10:00:00Z", "2025-11-07T17:00:00Z")).toEqual(window);
  expect(maintenancePhase(window, window.warnAt - 1)).toBe("off");
  expect(maintenancePhase(window, window.from - 86_400_000)).toBe("banner");
  expect(maintenancePhase(window, window.from - 1)).toBe("banner");
  expect(maintenancePhase(window, window.from)).toBe("page");
  expect(maintenancePhase(window, window.until - 1)).toBe("page");
  expect(maintenancePhase(window, window.until)).toBe("off");
  expect(maintenanceWindow(start, "2025-11-10T06:30:00+13:00")?.label).toBe("Fri 7 Nov, 11pm–Mon 10 Nov, 6:30am");
  expect(maintenanceWindow("2025-04-05T13:30:00Z", "2025-04-05T14:30:00Z")?.label).toBe("Sun 6 Apr, 2:30am NZDT–2:30am NZST");
});

describe("maintenance traffic", () => {
  function duringWindow() {
    vi.stubEnv("MAINTENANCE_FROM", start);
    vi.stubEnv("MAINTENANCE_UNTIL", end);
    vi.useFakeTimers();
    vi.setSystemTime(window.until - 1_001);
  }

  it("returns 503 before role redirects, with whole seconds rounded up until the end", async () => {
    duringWindow();
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/dashboard", "/jobs/abc.txt", "/admin", "/api/stripe/webhook/other"]) {
      expect(matcher.test(path)).toBe(true);
      for (const method of ["GET", "HEAD", "POST"]) {
        const response = await proxy(new NextRequest(new URL(path, "https://example.test"), { method }));
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("2");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    }
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("leaves integrations, robots and static assets on their usual paths", async () => {
    duringWindow();
    for (const path of ["/api/stripe/webhook", "/api/scheduler/run", "/robots.txt", "/_next/static/app.js", "/images/van.png", "/firebase-messaging-sw.js", "/firebase-messaging-worker.js"]) {
      const response = await proxy(new NextRequest(new URL(path, "https://example.test")));
      expect(response.status).toBe(200);
      expect(response.headers.get("Retry-After")).toBeNull();
    }
  });

  it("preserves session handling before the warning, during the warning and after the window", async () => {
    duringWindow();
    const request = new NextRequest("https://example.test/dashboard");
    for (const now of [window.warnAt - 1, window.warnAt, window.until]) {
      vi.setSystemTime(now);
      await proxy(request);
    }
    expect(refreshSession).toHaveBeenCalledTimes(3);
    expect(refreshSession).toHaveBeenCalledWith(request);
  });
});
