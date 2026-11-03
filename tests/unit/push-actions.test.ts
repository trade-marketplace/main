import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
vi.mock("@/server/notifications/push-config", () => ({ firebaseWebConfig: vi.fn(() => ({})) }));
vi.mock("@/server/notifications/browser-push", async original => ({ ...await original<typeof import("@/server/notifications/browser-push")>(), registerBrowserPush: vi.fn() }));
import { getViewer } from "@/server/auth/viewer";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { registerBrowserPush, PUSH_DEVICE_COOKIE } from "@/server/notifications/browser-push";
import { prepareBrowserPushAction, registerBrowserPushAction } from "@/server/notifications/push-actions";
const owner = randomUUID(); let proof: string | undefined;
const jar = { get: vi.fn(() => proof ? { value: proof } : undefined), set: vi.fn((_name: string, value: string) => { proof = value; }) };
beforeEach(() => {
  vi.clearAllMocks(); proof = undefined;
  vi.mocked(getViewer).mockResolvedValue({ userId: owner, role: "CUSTOMER", firstName: "Customer", email: "test@example.test", emailVerified: true });
  vi.mocked(cookies).mockResolvedValue(jar as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(getDb).mockReturnValue({} as ReturnType<typeof getDb>);
  vi.mocked(registerBrowserPush).mockResolvedValue({ status: "enabled" });
});
describe("acknowledged browser device preflight", () => {
  it("cannot bind before the browser has acknowledged its separate proof response", async () => {
    expect(await registerBrowserPushAction(owner, "token")).toEqual({ status: "unprepared" });
    expect(registerBrowserPush).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
    expect(await prepareBrowserPushAction(owner)).toEqual({ status: "ready" });
    expect(jar.set).toHaveBeenCalledWith(PUSH_DEVICE_COOKIE, expect.stringMatching(/^[a-f0-9]{64}$/), expect.objectContaining({ httpOnly: true }));
    expect(registerBrowserPush).not.toHaveBeenCalled();
  });
  it("retries an unknown binding response with the same acknowledged proof and token", async () => {
    await prepareBrowserPushAction(owner); const acknowledged = proof;
    await registerBrowserPushAction(owner, "same-fcm-token"); // the committed response is lost
    await prepareBrowserPushAction(owner);
    expect(proof).toBe(acknowledged);
    expect(await registerBrowserPushAction(owner, "same-fcm-token")).toEqual({ status: "enabled" });
    expect(registerBrowserPush).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ userId: owner }), acknowledged, "same-fcm-token");
    expect(registerBrowserPush).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ userId: owner }), acknowledged, "same-fcm-token");
  });
  it("never binds a token when setting the preflight cookie fails", async () => {
    jar.set.mockImplementationOnce(() => { throw new Error("Cookie unavailable"); });
    expect(await prepareBrowserPushAction(owner)).toEqual({ status: "error" });
    expect(await registerBrowserPushAction(owner, "token")).toEqual({ status: "unprepared" });
    expect(registerBrowserPush).not.toHaveBeenCalled();
  });
});
