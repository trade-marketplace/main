import { beforeEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMITS } from "@/lib/rate-limit";

// The public actions with their limits switched on: a fake request address, everything else faked.
const request = vi.hoisted(() => ({ ip: "198.51.100.1" }));
const deps = vi.hoisted(() => ({
  logIn: vi.fn(),
  sendContact: vi.fn(async () => ({ status: "sent" })),
  saveWaitlist: vi.fn(async () => ({ status: "joined" })),
  saveServiceWaitlist: vi.fn(async () => ({ status: "joined" })),
  recordHelpFeedback: vi.fn(async () => ({ status: "saved" })),
  sendRecovery: vi.fn(async () => ({ ok: true, email: "a@b.nz", retryAt: 0 })),
  startVerification: vi.fn(async () => ({ ok: true, email: "a@b.nz", retryAt: 0 })),
}));
vi.hoisted(() => { process.env.DATABASE_URL = ""; });
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": request.ip }),
  cookies: async () => ({ get: () => ({ value: "11111111-1111-1111-1111-111111111111" }), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }) }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: {} }), rememberSessionChoice: async () => {}, authCookieOptions: () => ({}) }));
vi.mock("@/server/auth/profiles", () => ({ prismaProfiles: () => ({}) }));
vi.mock("@/server/auth/account", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/auth/account")>()), logIn: deps.logIn }));
vi.mock("@/server/contact", () => ({ CONTACT_HONEYPOT: "website", sendContact: deps.sendContact }));
vi.mock("@/server/waitlist", () => ({ saveWaitlist: deps.saveWaitlist }));
vi.mock("@/server/services", () => ({ saveServiceWaitlist: deps.saveServiceWaitlist }));
vi.mock("@/server/help/feedback", () => ({ recordHelpFeedback: deps.recordHelpFeedback }));
vi.mock("@/server/help/articles", () => ({ loadHelpArticles: async () => [{ slug: "a" }] }));
vi.mock("@/server/auth/password-recovery", () => ({ sendRecovery: deps.sendRecovery, saveRecoveryPassword: vi.fn(), finishRecovery: vi.fn() }));
vi.mock("@/server/auth/recovery", () => ({ pendingRecovery: async () => null, recoveryEmailUrl: () => "", clearRecovery: vi.fn(), recoveryClient: vi.fn(), RECOVERY_PENDING_COOKIE: "p", RECOVERY_SAVED_COOKIE: "s" }));
vi.mock("@/server/auth/verification", () => ({ verificationAuth: () => ({}), pendingVerification: async () => null, startVerification: deps.startVerification, VERIFICATION_COMPLETE_COOKIE: "c", VERIFICATION_PENDING_COOKIE: "p" }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => null }));

const { logInAction } = await import("@/server/auth/actions");
const { requestRecoveryAction } = await import("@/server/auth/recovery-actions");
const { resendVerificationAction } = await import("@/server/auth/verification-actions");
const { joinWaitlist } = await import("@/app/(site)/coming-soon/actions");
const { joinServiceWaitlist } = await import("@/app/(site)/services/[trade]/actions");
const { saveHelpFeedback } = await import("@/app/(site)/help/actions");
const { sendContactMessage } = await import("@/app/(site)/contact/actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  request.ip = `203.0.113.${++n}`; // a fresh visitor for each test
});

describe("signed-out actions are rate limited (#111)", () => {
  it("area waitlist", async () => {
    for (let i = 0; i < RATE_LIMITS.areaWaitlist.limit; i++) expect(await joinWaitlist(form({ email: "a@b.nz", suburb: "Wellington" }))).toEqual({ status: "joined" });
    const limited = await joinWaitlist(form({ email: "a@b.nz", suburb: "Wellington" }));
    expect(limited).toMatchObject({ status: "error", retryAfter: expect.any(Number) });
    expect(deps.saveWaitlist).toHaveBeenCalledTimes(RATE_LIMITS.areaWaitlist.limit);
  });

  it("service waitlist", async () => {
    for (let i = 0; i < RATE_LIMITS.serviceWaitlist.limit; i++) await joinServiceWaitlist(form({ email: "a@b.nz", suburb: "Wellington", trade: "plumbing" }));
    expect(await joinServiceWaitlist(form({ email: "a@b.nz", suburb: "Wellington", trade: "plumbing" }))).toMatchObject({ status: "error", retryAfter: expect.any(Number) });
    expect(deps.saveServiceWaitlist).toHaveBeenCalledTimes(RATE_LIMITS.serviceWaitlist.limit);
  });

  it("help feedback", async () => {
    for (let i = 0; i < RATE_LIMITS.helpFeedback.limit; i++) await saveHelpFeedback({ slug: "a", helpful: true, lookingFor: "" });
    expect(await saveHelpFeedback({ slug: "a", helpful: true, lookingFor: "" })).toMatchObject({ status: "error", retryAfter: expect.any(Number) });
    expect(deps.recordHelpFeedback).toHaveBeenCalledTimes(RATE_LIMITS.helpFeedback.limit);
  });

  it("password reset and verification emails say when to try again", async () => {
    for (let i = 0; i < RATE_LIMITS.passwordReset.limit; i++) await requestRecoveryAction("a@b.nz");
    const reset = await requestRecoveryAction("a@b.nz");
    expect(reset).toMatchObject({ ok: false, error: "try-later" });
    expect((reset as { retryAt: number }).retryAt).toBeGreaterThan(Date.now());
    expect(deps.sendRecovery).toHaveBeenCalledTimes(RATE_LIMITS.passwordReset.limit);

    for (let i = 0; i < RATE_LIMITS.verificationEmail.limit; i++) await resendVerificationAction("a@b.nz");
    expect(await resendVerificationAction("a@b.nz")).toMatchObject({ ok: false, error: "try-later" });
    expect(deps.startVerification).toHaveBeenCalledTimes(RATE_LIMITS.verificationEmail.limit);
  });

  it("contact form", async () => {
    const message = () => sendContactMessage(form({ topic: "job", email: "a@b.nz", message: "Hi" }));
    for (let i = 0; i < RATE_LIMITS.contact.limit; i++) expect(await message()).toEqual({ status: "sent" });
    expect(await message()).toMatchObject({ status: "error", retryAfter: expect.any(Number) });
    expect(deps.sendContact).toHaveBeenCalledTimes(RATE_LIMITS.contact.limit);
  });

  it("someone else's address is unaffected", async () => {
    for (let i = 0; i <= RATE_LIMITS.areaWaitlist.limit; i++) await joinWaitlist(form({ email: "a@b.nz", suburb: "Wellington" }));
    request.ip = "192.0.2.200";
    expect(await joinWaitlist(form({ email: "a@b.nz", suburb: "Wellington" }))).toEqual({ status: "joined" });
  });
});

describe("log-in limit never locks an account (#111, DECISIONS.md)", () => {
  const wrong = { ok: false, error: "wrong-credentials", values: { email: "victim@b.nz" } };
  const attempt = (email = "victim@b.nz") => logInAction(null, form({ email, password: "x" }));

  it("slows a connection down after many wrong passwords, with the time to wait, and stops asking Supabase", async () => {
    deps.logIn.mockResolvedValue(wrong);
    for (let i = 0; i < RATE_LIMITS.logInFailures.limit; i++) expect(await attempt()).toMatchObject({ error: "wrong-credentials" });
    const blocked = await attempt();
    expect(blocked).toMatchObject({ ok: false, error: "try-later", values: { email: "victim@b.nz" }, retryAfter: expect.any(Number) });
    expect(deps.logIn).toHaveBeenCalledTimes(RATE_LIMITS.logInFailures.limit);
  });

  it("the account itself is never locked: the same email still logs in from another connection", async () => {
    deps.logIn.mockResolvedValue(wrong);
    for (let i = 0; i <= RATE_LIMITS.logInFailures.limit; i++) await attempt();
    request.ip = "192.0.2.201";
    deps.logIn.mockResolvedValue({ ok: true, role: "CUSTOMER", redirectTo: "/home" });
    await expect(attempt()).rejects.toMatchObject({ to: "/home" });
  });

  it("a bot cycling through emails is slowed, but a right password never counts against anyone", async () => {
    deps.logIn.mockResolvedValue({ ok: true, role: "CUSTOMER", redirectTo: "/home" });
    for (let i = 0; i < RATE_LIMITS.logInFailures.limit * 2; i++) await expect(attempt(`p${i}@b.nz`)).rejects.toMatchObject({ to: "/home" });
    deps.logIn.mockResolvedValue(wrong);
    for (let i = 0; i < RATE_LIMITS.logInFailures.limit; i++) await attempt(`bot${i}@b.nz`);
    expect(await attempt("someone-new@b.nz")).toMatchObject({ error: "try-later" });
  });
});
