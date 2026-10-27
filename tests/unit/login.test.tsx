import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";
import { LoginForm } from "@/components/auth/LoginForm";
import { LOGIN_MESSAGES, logInMessages } from "@/components/auth/login-messages";

// ---- The server pieces are swapped for fakes: no Supabase, no database. ----
const captured: { setAll?: (cookies: { name: string; value: string; options: Record<string, unknown> }[], headers: Record<string, string>) => void } = {};
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: typeof captured }) => {
    captured.setAll = options.cookies.setAll;
    return { auth: {} };
  }),
}));

const EMAIL = { email: "sarah@email.co.nz" };
const text = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

afterEach(() => vi.unstubAllEnvs());

describe("sessionCookieOptions (Keep me logged in)", () => {
  it("keeps the session as long as browsers allow (400 days) when ticked, and only for the browser session when not", async () => {
    const { REMEMBER_ME_MAX_AGE, sessionCookieOptions } = await import("@/server/supabase");
    const cookie = { name: "sb-x-auth-token", value: "abc", options: { path: "/", maxAge: 400 * 86400, expires: new Date(0) } };
    expect(REMEMBER_ME_MAX_AGE).toBe(400 * 24 * 60 * 60);
    expect(sessionCookieOptions(cookie, false)).toMatchObject({ path: "/", maxAge: REMEMBER_ME_MAX_AGE });
    const browserOnly = sessionCookieOptions(cookie, true);
    expect(browserOnly).toEqual({ path: "/" });
  });

  it("leaves deletions alone, so logging out still clears the cookies", async () => {
    const { sessionCookieOptions } = await import("@/server/supabase");
    expect(sessionCookieOptions({ name: "a", value: "", options: { maxAge: 0 } }, true)).toEqual({ maxAge: 0 });
    expect(sessionCookieOptions({ name: "a", value: "x", options: { maxAge: 0 } }, false)).toEqual({ maxAge: 0 });
  });

  it("honours the visitor's choice (the marker cookie) on every refresh, unless told otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { createSupabaseClientWithCookies, SESSION_ONLY_COOKIE } = await import("@/server/supabase");
    const written: { options: Record<string, unknown> }[] = [];
    const jar = (marker: boolean) => ({
      getAll: () => (marker ? [{ name: SESSION_ONLY_COOKIE, value: "1" }] : []),
      setAll: (cookies: { options: Record<string, unknown> }[]) => written.push(...cookies),
    });
    const refresh = [{ name: "sb-x-auth-token", value: "new", options: { path: "/", maxAge: 34560000 } }];

    createSupabaseClientWithCookies(jar(true));
    captured.setAll!(refresh, {});
    expect(written.pop()!.options.maxAge).toBeUndefined();

    createSupabaseClientWithCookies(jar(false));
    captured.setAll!(refresh, {});
    expect(written.pop()!.options.maxAge).toBe(400 * 24 * 60 * 60);

    createSupabaseClientWithCookies(jar(true), { sessionOnly: false });
    captured.setAll!(refresh, {});
    expect(written.pop()!.options.maxAge).toBe(400 * 24 * 60 * 60);
  });
});

describe("logInMessages", () => {
  it("says nothing before the first try", () => {
    expect(logInMessages(null)).toEqual({});
  });

  it("puts field problems under their fields", () => {
    expect(
      logInMessages({ ok: false, error: "invalid", fieldErrors: { email: "Enter your email address." }, values: EMAIL }),
    ).toEqual({ email: "Enter your email address.", password: undefined });
  });

  it("gives one message for a wrong email or password, under the password (never 'no such account')", () => {
    const messages = logInMessages({ ok: false, error: "wrong-credentials", values: EMAIL });
    expect(messages).toEqual({ password: LOGIN_MESSAGES.wrongCredentials });
    expect(messages.password).not.toMatch(/no account|not found|exist/i);
  });

  it("shows too many tries, unconfirmed email and an outage as a banner", () => {
    expect(logInMessages({ ok: false, error: "try-later", values: EMAIL }).banner).toMatchObject({ tone: "alert", title: "Too many tries." });
    expect(logInMessages({ ok: false, error: "email-not-verified", values: EMAIL }).banner).toMatchObject({ tone: "info" });
    expect(logInMessages({ ok: false, error: "unavailable", values: EMAIL }).banner).toMatchObject({ tone: "alert" });
  });
});

describe("LoginForm", () => {
  it("has the fields, Keep me logged in (ticked), Forgot password and Create an account", () => {
    const html = renderToString(<LoginForm />);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"|<input[^>]*name="email"[^>]*type="email"/);
    expect(html).toMatch(/name="password"/);
    expect(html).toMatch(/autoComplete="current-password"|autocomplete="current-password"/);
    expect(html).toMatch(/<input[^>]*name="remember"[^>]*checked/);
    expect(html).toContain('href="/recovery"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Log in/);
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('name="next"');
  });

  it("matches the mockup: placeholders, labels only for screen readers, and Sign up on a phone (Matt, #340)", () => {
    // Vitest hashes CSS module class names ("_field_4f0108"); read them back as the names in the CSS file.
    const html = renderToString(<LoginForm />).replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
    expect(html).toMatch(/<input[^>]*placeholder="Email"/);
    expect(html).toMatch(/<input[^>]*placeholder="Password"/);
    expect(html.match(/class="[^"]*\bfield quietLabel\b/g)).toHaveLength(2);
    expect(html).toMatch(/<label[^>]*>Email<\/label>/);
    expect(html).toMatch(/<span class="wideOnly">Create an account<\/span><span class="narrowOnly">Sign up<\/span>/);
  });

  it("sends the deep link back with the form, and keeps it on the way to sign-up", () => {
    const html = renderToString(<LoginForm next="/jobs/TM-1005?tab=price" />);
    expect(html).toMatch(/<input type="hidden" name="next" value="\/jobs\/TM-1005\?tab=price"/);
    expect(html).toContain('href="/signup?next=%2Fjobs%2FTM-1005%3Ftab%3Dprice"');
  });

  it("after a wrong password: keeps the email, empties the password and says so under it", () => {
    const html = renderToString(<LoginForm initialState={{ ok: false, error: "wrong-credentials", values: EMAIL }} />);
    expect(html).toMatch(/name="email"[^>]*value="sarah@email.co.nz"|value="sarah@email.co.nz"[^>]*name="email"/);
    expect(html).not.toMatch(/name="password"[^>]*value=/);
    expect(text(html)).toContain(LOGIN_MESSAGES.wrongCredentials);
    expect(html).toMatch(/name="password"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*name="password"/);
  });

  it("after too many tries: a banner the form is described by", () => {
    const html = renderToString(<LoginForm initialState={{ ok: false, error: "try-later", values: EMAIL }} />);
    expect(text(html)).toContain("Too many tries. Wait a few minutes, or reset your password.");
    expect(html).toContain('aria-describedby="login-banner"');
  });

  it("with an unconfirmed email: says to open the link", () => {
    const html = renderToString(<LoginForm initialState={{ ok: false, error: "email-not-verified", values: EMAIL }} />);
    expect(text(html)).toContain("Confirm your email first.");
  });
});

describe("/login", () => {
  beforeEach(() => vi.resetModules());

  async function page(next?: string | string[]) {
    return renderToString(await LoginPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) }));
  }

  it("is the split layout: skip link, brand panel, then one h1 in main", async () => {
    const html = await page();
    expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("<header"));
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf('<main id="main"'));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text(html)).toContain("Welcome back");
    expect(text(html)).toContain("New here? Sign up");
    expect(html).toMatch(/<img[^>]*alt=""/);
  });

  it("passes on a deep link, but only one of our own paths", async () => {
    expect(await page("/dashboard")).toContain('name="next" value="/dashboard"');
    expect(await page("https://evil.example/")).not.toContain('name="next"');
    expect(await page(["/a", "/b"])).not.toContain('name="next"');
  });
});
