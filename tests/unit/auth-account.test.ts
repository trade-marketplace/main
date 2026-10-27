import { describe, expect, it, vi } from "vitest";

import {
  ensureProfile,
  logIn,
  logOut,
  readLogInForm,
  readSignUpForm,
  signUp,
  type AuthClient,
  type AuthUserLike,
  type NewProfile,
  type ProfileStore,
  type SignUpInput,
} from "@/server/auth/account";
import type { ProfileRow } from "@/server/auth/viewer";

// Fakes for Supabase Auth and the profiles table. No network, no database.

function fakeProfiles(initial: ProfileRow[] = []) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const store = {
    rows,
    find: vi.fn(async (id: string) => rows.get(id) ?? null),
    create: vi.fn(async (profile: NewProfile) => {
      if (rows.has(profile.id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const row: ProfileRow = {
        id: profile.id,
        email: profile.email.trim().toLowerCase(),
        role: profile.role,
        firstName: profile.firstName,
        emailVerifiedAt: profile.emailVerifiedAt,
      };
      rows.set(row.id, row);
      return row;
    }),
    markEmailVerified: vi.fn(async (id: string, at: Date) => {
      const row = { ...rows.get(id)!, emailVerifiedAt: at };
      rows.set(id, row);
      return row;
    }),
  } satisfies ProfileStore & { rows: Map<string, ProfileRow> };
  return store;
}

const user = (overrides: Partial<AuthUserLike> = {}): AuthUserLike => ({
  id: "11111111-1111-4111-8111-111111111111",
  email: "sam@example.nz",
  email_confirmed_at: null,
  user_metadata: {},
  identities: [{ provider: "email" }],
  ...overrides,
});

function fakeAuth(overrides: Partial<AuthClient> = {}) {
  return {
    signUp: vi.fn<AuthClient["signUp"]>(async () => ({ data: { user: user(), session: null }, error: null })),
    signInWithPassword: vi.fn<AuthClient["signInWithPassword"]>(async () => ({
      data: { user: user({ email_confirmed_at: "2026-10-26T01:00:00Z" }), session: {} },
      error: null,
    })),
    signOut: vi.fn<AuthClient["signOut"]>(async () => ({ error: null })),
    ...overrides,
  };
}

const goodSignUp: SignUpInput = {
  email: " Sam@Example.NZ ",
  password: "korimako-gumboot-41",
  firstName: " Sam ",
  lastName: "",
  role: "CUSTOMER",
  phone: "021 555 0192",
  terms: true,
};

describe("signUp", () => {
  it("creates the Supabase user and our profile, then asks them to check their email", async () => {
    const auth = fakeAuth();
    const profiles = fakeProfiles();

    const result = await signUp({ auth, profiles }, goodSignUp);

    expect(result).toEqual({ ok: true, status: "check-email", email: "sam@example.nz" });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "sam@example.nz",
      password: "korimako-gumboot-41",
      options: { data: { first_name: "Sam", last_name: null, role: "CUSTOMER", phone: "+64215550192", terms_accepted: true } },
    });
    expect(profiles.create).toHaveBeenCalledWith({
      id: user().id,
      email: "sam@example.nz",
      role: "CUSTOMER",
      firstName: "Sam",
      lastName: null,
      phone: "+64215550192",
      emailVerifiedAt: null,
    });
  });

  it("signs them straight in, to their home, when Supabase doesn't ask for email confirmation", async () => {
    const auth = fakeAuth({ signUp: vi.fn(async () => ({ data: { user: user(), session: {} }, error: null })) });
    const result = await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, role: "TRADIE" });
    expect(result).toEqual({ ok: true, status: "signed-in", role: "TRADIE", redirectTo: "/jobs" });
  });

  it("goes back to the page they came from after signing up", async () => {
    const auth = fakeAuth({ signUp: vi.fn(async () => ({ data: { user: user(), session: {} }, error: null })) });
    const result = await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, next: "/jobs/new?step=review" });
    expect(result).toMatchObject({ ok: true, redirectTo: "/jobs/new?step=review" });
  });

  it("refuses a password shorter than 10 characters, without calling Supabase", async () => {
    const auth = fakeAuth();
    const result = await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, password: "Kx9!mQ2#v" });
    expect(result).toMatchObject({
      ok: false,
      error: "invalid",
      fieldErrors: { password: "Use at least 10 characters." },
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("refuses a common password, without calling Supabase", async () => {
    const auth = fakeAuth();
    const result = await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, password: "Password123!" });
    expect(result).toMatchObject({ ok: false, error: "invalid", fieldErrors: { password: /too easy to guess/ } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("never lets anyone sign up as office staff", async () => {
    const auth = fakeAuth();
    const result = await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, role: "ADMIN" });
    expect(result).toMatchObject({ ok: false, error: "invalid", fieldErrors: { role: expect.any(String) } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("lists every wrong field at once and keeps what they typed, except the password", async () => {
    const result = await signUp(
      { auth: fakeAuth(), profiles: fakeProfiles() },
      { email: "not-an-email", password: "short", firstName: " ", lastName: "Taylor", role: "CUSTOMER", phone: "021 555 0192", terms: true },
    );
    expect(result).toEqual({
      ok: false,
      error: "invalid",
      fieldErrors: {
        email: "Enter a valid email address, like name@example.com.",
        firstName: "Enter your first name.",
        password: "Use at least 10 characters.",
      },
      values: { email: "not-an-email", firstName: " ", lastName: "Taylor", role: "CUSTOMER", phone: "021 555 0192", terms: "on" },
    });
  });

  it("says the email is taken when Supabase returns an error for it", async () => {
    const auth = fakeAuth({
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: "User already registered", code: "user_already_exists", status: 422 },
      })),
    });
    const profiles = fakeProfiles();
    expect(await signUp({ auth, profiles }, goodSignUp)).toMatchObject({ ok: false, error: "email-taken" });
    expect(profiles.create).not.toHaveBeenCalled();
  });

  it("says the email is taken when Supabase hides it behind a user with no identities", async () => {
    const auth = fakeAuth({
      signUp: vi.fn(async () => ({ data: { user: user({ identities: [] }), session: null }, error: null })),
    });
    const profiles = fakeProfiles();
    expect(await signUp({ auth, profiles }, goodSignUp)).toMatchObject({ ok: false, error: "email-taken" });
    expect(profiles.create).not.toHaveBeenCalled();
  });

  it("asks them to try later when Supabase rate-limits sign-ups", async () => {
    const auth = fakeAuth({
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: "Too many", code: "over_email_send_rate_limit", status: 429 },
      })),
    });
    expect(await signUp({ auth, profiles: fakeProfiles() }, goodSignUp)).toMatchObject({ error: "try-later" });
  });

  it("reports unavailable when saving the profile fails (log-in creates it later)", async () => {
    const profiles = fakeProfiles();
    profiles.create.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await signUp({ auth: fakeAuth(), profiles }, goodSignUp)).toMatchObject({
      ok: false,
      error: "unavailable",
    });
  });
});

describe("logIn", () => {
  const goodLogIn = { email: "SAM@example.nz", password: "korimako-gumboot-41" };

  it("signs in and goes to the role's home, read from our profile (not from Supabase metadata)", async () => {
    const profiles = fakeProfiles([
      { id: user().id, email: "sam@example.nz", role: "TRADIE", firstName: "Sam", emailVerifiedAt: new Date() },
    ]);
    const auth = fakeAuth({
      signInWithPassword: vi.fn(async () => ({
        data: { user: user({ user_metadata: { role: "ADMIN" } }), session: {} },
        error: null,
      })),
    });

    expect(await logIn({ auth, profiles }, goodLogIn)).toEqual({ ok: true, role: "TRADIE", redirectTo: "/jobs" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "sam@example.nz", password: goodLogIn.password });
  });

  it("returns to a deep link after log-in when the role may open it", async () => {
    const profiles = fakeProfiles([
      { id: user().id, email: "sam@example.nz", role: "CUSTOMER", firstName: "Sam", emailVerifiedAt: new Date() },
    ]);
    const result = await logIn({ auth: fakeAuth(), profiles }, { ...goodLogIn, next: "/jobs/j1?tab=photos" });
    expect(result).toMatchObject({ ok: true, redirectTo: "/jobs/j1?tab=photos" });
  });

  it("copies the email confirmation from Supabase to the profile", async () => {
    const profiles = fakeProfiles([
      { id: user().id, email: "sam@example.nz", role: "CUSTOMER", firstName: "Sam", emailVerifiedAt: null },
    ]);
    await logIn({ auth: fakeAuth(), profiles }, goodLogIn);
    expect(profiles.rows.get(user().id)?.emailVerifiedAt).toEqual(new Date("2026-10-26T01:00:00Z"));
  });

  it("gives one message for a wrong email or password and keeps the email", async () => {
    const auth = fakeAuth({
      signInWithPassword: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 },
      })),
    });
    expect(await logIn({ auth, profiles: fakeProfiles() }, goodLogIn)).toEqual({
      ok: false,
      error: "wrong-credentials",
      values: { email: "SAM@example.nz" },
    });
  });

  it("says when Supabase wants the email confirmed first", async () => {
    const auth = fakeAuth({
      signInWithPassword: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: "Email not confirmed", code: "email_not_confirmed", status: 400 },
      })),
    });
    expect(await logIn({ auth, profiles: fakeProfiles() }, goodLogIn)).toMatchObject({ error: "email-not-verified" });
  });

  it("checks the fields before calling Supabase", async () => {
    const auth = fakeAuth();
    expect(await logIn({ auth, profiles: fakeProfiles() }, { email: "", password: "" })).toMatchObject({
      ok: false,
      error: "invalid",
      fieldErrors: { email: "Enter your email address.", password: "Enter your password." },
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs back out if the profile can't be read, so no half-working session is left", async () => {
    const profiles = fakeProfiles();
    profiles.find.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const auth = fakeAuth();
    expect(await logIn({ auth, profiles }, goodLogIn)).toMatchObject({ ok: false, error: "unavailable" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("ensureProfile", () => {
  it("rebuilds a missing profile from what they chose at sign-up", async () => {
    const profiles = fakeProfiles();
    const row = await ensureProfile(
      profiles,
      user({ user_metadata: { first_name: "Aroha", last_name: "Ngata", role: "TRADIE" } }),
    );
    expect(row).toMatchObject({ role: "TRADIE", firstName: "Aroha" });
  });

  it("never rebuilds one as office staff, whatever the metadata says", async () => {
    const row = await ensureProfile(fakeProfiles(), user({ user_metadata: { first_name: "Eve", role: "ADMIN" } }));
    expect(row.role).toBe("CUSTOMER");
  });

  it("keeps an existing profile's role", async () => {
    const profiles = fakeProfiles([
      { id: user().id, email: "sam@example.nz", role: "ADMIN", firstName: "Sam", emailVerifiedAt: new Date() },
    ]);
    expect((await ensureProfile(profiles, user({ user_metadata: { role: "CUSTOMER" } }))).role).toBe("ADMIN");
    expect(profiles.create).not.toHaveBeenCalled();
  });

  it("uses the profile another request created at the same moment", async () => {
    const profiles = fakeProfiles();
    const raced: ProfileRow = { id: user().id, email: "sam@example.nz", role: "CUSTOMER", firstName: "Sam", emailVerifiedAt: null };
    profiles.find.mockResolvedValueOnce(null);
    profiles.create.mockImplementationOnce(async () => {
      profiles.rows.set(raced.id, raced);
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    expect(await ensureProfile(profiles, user())).toEqual(raced);
  });
});

describe("logOut", () => {
  it("ends this browser's session only", async () => {
    const auth = fakeAuth();
    await logOut(auth);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("doesn't fail when the session had already gone", async () => {
    const auth = fakeAuth({ signOut: vi.fn(async () => ({ error: { message: "Auth session missing!" } })) });
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});
    await expect(logOut(auth)).resolves.toBeUndefined();
  });
});

describe("reading the forms", () => {
  it("reads the sign-up fields, defaulting to a customer", () => {
    const form = new FormData();
    form.set("email", "sam@example.nz");
    form.set("password", "korimako-gumboot-41");
    form.set("firstName", "Sam");
    expect(readSignUpForm(form)).toEqual({
      email: "sam@example.nz",
      password: "korimako-gumboot-41",
      firstName: "Sam",
      lastName: "",
      role: "CUSTOMER",
      phone: "",
      terms: false,
      next: "",
    });
  });

  it("reads the log-in fields, ignoring files", () => {
    const form = new FormData();
    form.set("email", new Blob(["x"]));
    form.set("password", "pw");
    form.set("next", "/dashboard");
    expect(readLogInForm(form)).toEqual({ email: "", password: "pw", next: "/dashboard" });
  });
});

describe("customer details (#104)", () => {
  it("requires terms on the server, before Supabase can create an account", async () => {
    const auth = fakeAuth();
    expect(await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, terms: false })).toMatchObject({ ok: false, error: "invalid", fieldErrors: { terms: expect.any(String) } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects a malformed mobile and keeps all non-secret fields when the email is taken", async () => {
    const auth = fakeAuth({ signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: { message: "Registered", code: "email_exists" } })) });
    expect(await signUp({ auth, profiles: fakeProfiles() }, { ...goodSignUp, phone: "123" })).toMatchObject({ error: "invalid", fieldErrors: { phone: expect.any(String) } });
    expect(auth.signUp).not.toHaveBeenCalled();
    const result = await signUp({ auth, profiles: fakeProfiles() }, goodSignUp);
    expect(result).toMatchObject({ error: "email-taken", values: { firstName: " Sam ", phone: "021 555 0192", email: "Sam@Example.NZ", terms: "on" } });
    expect(result).not.toHaveProperty("values.password");
  });

  it("handles a network failure without losing account details", async () => {
    const auth = fakeAuth({ signUp: vi.fn(async () => { throw new TypeError("network down"); }) });
    expect(await signUp({ auth, profiles: fakeProfiles() }, goodSignUp)).toMatchObject({ error: "unavailable", values: { firstName: " Sam ", phone: "021 555 0192" } });
  });

  it("repairs a missing profile with the same normalized mobile", async () => {
    const profiles = fakeProfiles();
    await ensureProfile(profiles, user({ user_metadata: { first_name: "Aroha", phone: "021 555 0192" } }));
    expect(profiles.create).toHaveBeenCalledWith(expect.objectContaining({ phone: "+64215550192" }));
  });

  it("reads a full name, mobile and explicit consent without losing the wizard return path", () => {
    const data = new FormData();
    data.set("name", "  Aroha   Te Rangi ");
    data.set("phone", "021 555 0192");
    data.set("terms", "on");
    data.set("next", "/jobs/new?step=review&draft=demo");
    expect(readSignUpForm(data)).toMatchObject({ firstName: "Aroha", lastName: "Te Rangi", phone: "021 555 0192", terms: true, next: "/jobs/new?step=review&draft=demo" });
  });
});
