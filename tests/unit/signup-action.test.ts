import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseNotConfiguredError } from "@/lib/supabase/config";

const fake = vi.hoisted(() => ({ client: vi.fn(), signUp: vi.fn(), startVerification: vi.fn(), rememberVerification: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: fake.client, rememberSessionChoice: vi.fn() }));
vi.mock("@/server/auth/profiles", () => ({ prismaProfiles: () => ({}) }));
vi.mock("@/server/auth/account", async (original) => ({ ...(await original<typeof import("@/server/auth/account")>()), signUp: fake.signUp }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }) }));
vi.mock("@/server/auth/verification", () => ({ startVerification: fake.startVerification, rememberVerification: fake.rememberVerification, verificationEmailUrl: () => "https://trademarketplace.nz/verify/confirm?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1" }));

const { signUpAction } = await import("@/server/auth/actions");
function details() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Aroha Te Rangi", email: "aroha@example.test", phone: "021 555 0192", password: "korimako-gumboot-41", terms: "on", role: "CUSTOMER", next: "/jobs/new?step=review&draft=1", signupRole: "customer" })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.client.mockResolvedValue({ auth: {} });
  fake.startVerification.mockResolvedValue({ ok: true, email: "aroha@example.test", retryAt: 60_000 });
});

describe("customer signup action", () => {
  it("passes the full name, mobile and explicit consent to the existing account service", async () => {
    fake.signUp.mockResolvedValue({ ok: true, status: "check-email", email: "aroha@example.test" });
    await expect(signUpAction(null, details())).rejects.toMatchObject({ to: "/verify?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1" });
    expect(fake.signUp).toHaveBeenCalledWith(expect.anything(), { firstName: "Aroha", lastName: "Te Rangi", email: "aroha@example.test", phone: "021 555 0192", password: "korimako-gumboot-41", terms: true, role: "CUSTOMER", next: "/jobs/new?step=review&draft=1" });
    expect(fake.rememberVerification).toHaveBeenCalledWith("aroha@example.test", expect.any(Number));
    expect(fake.startVerification).not.toHaveBeenCalled();
  });

  it("keeps the new session and original wizard path while requesting independent email proof", async () => {
    fake.signUp.mockResolvedValue({ ok: true, status: "signed-in", role: "CUSTOMER", redirectTo: "/jobs/new?step=review&draft=1" });
    await expect(signUpAction(null, details())).rejects.toMatchObject({ to: "/verify?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1" });
    expect(fake.startVerification).toHaveBeenCalledWith("aroha@example.test", "/jobs/new?step=review&draft=1");
  });

  it("retains non-secret fields when Supabase isn't configured", async () => {
    fake.client.mockRejectedValue(new SupabaseNotConfiguredError());
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const result = await signUpAction(null, details());
    expect(result).toMatchObject({ error: "unavailable", values: { firstName: "Aroha", lastName: "Te Rangi", email: "aroha@example.test", phone: "021 555 0192", terms: "on" } });
    expect(result).not.toHaveProperty("values.password");
    expect(fake.signUp).not.toHaveBeenCalled();
  });
});
