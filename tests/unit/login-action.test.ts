import { beforeEach, describe, expect, it, vi } from "vitest";

// logInAction with every outside piece faked: which Supabase client it asks for, and what it remembers.
const supabase = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { fake: true } })),
  rememberSessionChoice: vi.fn(async () => {}),
}));
const account = vi.hoisted(() => ({ logIn: vi.fn(), logOut: vi.fn() }));
vi.mock("@/server/supabase", () => supabase);
vi.mock("@/server/auth/profiles", () => ({ prismaProfiles: () => ({}) }));
vi.mock("@/server/auth/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/account")>()),
  logIn: account.logIn,
  logOut: account.logOut,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));

const { logInAction, logOutAction } = await import("@/server/auth/actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  account.logIn.mockResolvedValue({ ok: true, role: "CUSTOMER", redirectTo: "/dashboard" });
});

describe("logInAction and Keep me logged in", () => {
  it("ticked: a 30-day session, and the browser-session marker removed", async () => {
    await expect(logInAction(null, form({ email: "a@b.nz", password: "x", remember: "on" }))).rejects.toMatchObject({ to: "/dashboard" });
    expect(supabase.createSupabaseServerClient).toHaveBeenCalledWith({ sessionOnly: false });
    expect(supabase.rememberSessionChoice).toHaveBeenCalledWith(false);
  });

  it("not ticked: a browser session, remembered for later refreshes", async () => {
    await expect(logInAction(null, form({ email: "a@b.nz", password: "x" }))).rejects.toMatchObject({ to: "/dashboard" });
    expect(supabase.createSupabaseServerClient).toHaveBeenCalledWith({ sessionOnly: true });
    expect(supabase.rememberSessionChoice).toHaveBeenCalledWith(true);
  });

  it("a failed try changes nothing and answers with the problem", async () => {
    account.logIn.mockResolvedValue({ ok: false, error: "wrong-credentials", values: { email: "a@b.nz" } });
    expect(await logInAction(null, form({ email: "a@b.nz", password: "x", remember: "on" }))).toMatchObject({ error: "wrong-credentials" });
    expect(supabase.rememberSessionChoice).not.toHaveBeenCalled();
  });

  it("logging out forgets the choice too", async () => {
    await expect(logOutAction()).rejects.toMatchObject({ to: "/" });
    expect(supabase.rememberSessionChoice).toHaveBeenCalledWith(false);
  });
});
