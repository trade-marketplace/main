// The session-expired dialog (B07, #108): what it says for each log-in answer, where it goes after logging in, and
// the HTML each step renders. Focus, Esc, the scrim and the whole send → log in → resend round trip are checked in
// the browser: tests/e2e/dev-session-expired.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  afterLogInAgain,
  LOG_IN_AGAIN_MESSAGES,
  logInAgainMessages,
  resendThenRefresh,
  SESSION_EXPIRED_COPY,
  SessionExpiredDialog,
  type SessionExpiredDialogProps,
  SessionExpiredProvider,
  useSessionExpired,
} from "@/components/auth/SessionExpired";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Vitest hashes CSS module class names ("_dialog_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const renderToString = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
/** The opening tag of the <input> with this name. */
const input = (html: string, name: string) => html.match(new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
/** The text a person sees, without tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const EMAIL = "sarah@email.co.nz";
const logIn = vi.fn(async () => null);

function dialog(props: Partial<SessionExpiredDialogProps> = {}) {
  return renderToString(<SessionExpiredDialog open logIn={logIn} onLoggedIn={() => {}} email={EMAIL} {...props} />);
}

describe("logInAgainMessages: what the form says for each answer", () => {
  const values = { email: EMAIL };

  it("says nothing before the first try, or once logged in", () => {
    expect(logInAgainMessages(null)).toEqual({});
    expect(logInAgainMessages({ ok: true, role: "CUSTOMER", redirectTo: "/" })).toEqual({});
  });

  it("puts a wrong email or password under the password, without saying which was wrong", () => {
    expect(logInAgainMessages({ ok: false, error: "wrong-credentials", values })).toEqual({
      password: LOG_IN_AGAIN_MESSAGES.wrongCredentials,
    });
    expect(LOG_IN_AGAIN_MESSAGES.wrongCredentials).toBe("That email and password don’t match. Try again.");
  });

  it("shows the field checks under their fields", () => {
    expect(
      logInAgainMessages({ ok: false, error: "invalid", fieldErrors: { password: "Enter your password." }, values }),
    ).toEqual({ email: undefined, password: "Enter your password." });
  });

  it("puts problems that aren't about one field in a banner", () => {
    expect(logInAgainMessages({ ok: false, error: "try-later", values }).banner).toEqual({
      tone: "alert",
      title: "Too many tries.",
      text: "Wait a few minutes, then try again.",
    });
    expect(logInAgainMessages({ ok: false, error: "email-not-verified", values }).banner?.tone).toBe("info");
    expect(logInAgainMessages({ ok: false, error: "unavailable", values }).banner).toEqual({
      tone: "alert",
      title: "We can’t log you in right now.",
      text: "Try again in a minute.",
    });
  });
});

describe("afterLogInAgain: stay, or go somewhere else", () => {
  it("stays on the page (and sends the draft) when the same kind of account logs in", () => {
    expect(afterLogInAgain("CUSTOMER", "CUSTOMER")).toEqual({ stay: true });
    expect(afterLogInAgain("TRADIE", undefined)).toEqual({ stay: true });
  });

  it("what if a tradie logs in over a customer's page? Their own home, and the draft isn't sent", () => {
    expect(afterLogInAgain("TRADIE", "CUSTOMER")).toEqual({ stay: false, goTo: "/jobs" });
    expect(afterLogInAgain("ADMIN", "CUSTOMER")).toEqual({ stay: false, goTo: "/admin" });
    expect(afterLogInAgain("CUSTOMER", "TRADIE")).toEqual({ stay: false, goTo: "/" });
  });
});

describe("resendThenRefresh: the page refreshes after the form is sent again", () => {
  it("waits for a resend that takes time, then refreshes", async () => {
    const order: string[] = [];
    let finish = () => {};
    const resend = () => new Promise<void>((resolve) => (finish = () => (order.push("saved"), resolve())));
    const done = resendThenRefresh(resend, () => order.push("refresh"));
    await Promise.resolve();
    expect(order).toEqual([]);
    finish();
    await done;
    expect(order).toEqual(["saved", "refresh"]);
  });

  it("still refreshes when the resend fails, or when there's nothing to resend", async () => {
    const refresh = vi.fn();
    await expect(resendThenRefresh(() => Promise.reject(new Error("offline")), refresh)).rejects.toThrow("offline");
    await resendThenRefresh(undefined, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("<SessionExpiredDialog>", () => {
  it("renders nothing while closed", () => {
    expect(dialog({ open: false })).toBe("");
  });

  it("first step: the mockup's icon, words and one button, and no way to close it", () => {
    const html = dialog();
    expect(html).toMatch(/<dialog\b/);
    expect(html).toContain("lock_clock");
    expect(html).toContain(`${SESSION_EXPIRED_COPY.title}</h2>`);
    expect(text(html)).toContain(
      "You’ve been logged out For your security. Log in again and you’ll be right back here. Your draft is saved. Log in again",
    );
    expect(html).not.toContain('aria-label="Close"');
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/paperwork/i);
  });

  it("leaves out “Your draft is saved.” when there's no draft", () => {
    expect(text(dialog({ draft: false }))).not.toContain("draft");
  });

  it("second step: only the password when the email is known, with a way out for someone else", () => {
    const html = dialog({ initialStep: "form" });
    expect(html).toContain("<form");
    expect(text(html)).toContain(`Logging in as ${EMAIL}`);
    const email = input(html, "email");
    for (const part of ['type="email"', 'autoComplete="username"', `value="${EMAIL}"`, 'readOnly=""', 'hidden=""'])
      expect(email).toContain(part);
    expect(input(html, "password")).toContain('type="password"');
    expect(input(html, "password")).toContain('autoComplete="current-password"');
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Not you\? Log in as someone else<\/a>/);
    // The submit button is in the footer, tied to the form by its id.
    const formId = html.match(/<form[^>]*id="([^"]+)"/)?.[1];
    const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toContain(`form="${formId}"`);
    expect(text(html)).toContain("Log in");
  });

  it("asks for the email too when it isn't known, and keeps what was typed after a wrong try", () => {
    const html = dialog({
      email: undefined,
      initialStep: "form",
      initialState: { ok: false, error: "wrong-credentials", values: { email: "sam@example.com" } },
    });
    const email = input(html, "email");
    for (const part of ['type="email"', 'autoComplete="username"', 'value="sam@example.com"']) expect(email).toContain(part);
    expect(email).not.toContain("hidden");
    expect(html).toMatch(/<label[^>]*>Email</);
    expect(html).not.toContain("Not you?");
  });

  it("marks a wrong password on the password field", () => {
    const html = dialog({ initialStep: "form", initialState: { ok: false, error: "wrong-credentials", values: { email: EMAIL } } });
    expect(input(html, "password")).toContain('aria-invalid="true"');
    expect(text(html)).toContain("That email and password don’t match. Try again.");
  });

  it("puts “too many tries” in a banner that's read out", () => {
    const html = dialog({ initialStep: "form", initialState: { ok: false, error: "try-later", values: { email: EMAIL } } });
    expect(html).toMatch(/role="alert"/);
    expect(text(html)).toContain("Too many tries. Wait a few minutes, then try again.");
  });
});

describe("<SessionExpiredProvider>", () => {
  it("shows the page and no dialog until something needs it", () => {
    expect(renderToString(<SessionExpiredProvider logIn={logIn}>the page</SessionExpiredProvider>)).toBe("the page");
  });

  it("check() ignores anything that isn't session-expired", () => {
    const answers: boolean[] = [];
    function Page() {
      const sessionExpired = useSessionExpired();
      answers.push(sessionExpired.check({ ok: true }), sessionExpired.check({ ok: false, error: "forbidden" }), sessionExpired.check(null));
      return null;
    }
    renderToString(
      <SessionExpiredProvider logIn={logIn}>
        <Page />
      </SessionExpiredProvider>,
    );
    expect(answers).toEqual([false, false, false]);
  });

  it("useSessionExpired() needs the provider", () => {
    function Lonely() {
      useSessionExpired();
      return null;
    }
    expect(() => renderToString(<Lonely />)).toThrow(/needs a <SessionExpiredProvider>/);
  });

  it("every signed-in shell has one, logging in with logInAgainAction", () => {
    for (const file of ["src/components/app/AppShell.tsx", "src/components/office/OfficeShell.tsx"]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(source, file).toMatch(/<SessionExpiredProvider logIn=\{logInAgainAction\} email=\{viewer\.email\} role=\{viewer\.role\}>/);
    }
  });
});

describe("session-expired.module.css", () => {
  const css = readFileSync(new URL("../../src/components/auth/session-expired.module.css", import.meta.url), "utf8");

  it("draws the mockup's 56px tile in the waiting colour, with a 16px radius", () => {
    expect(css).toMatch(/\.tile \{[^}]*width: 56px;[^}]*height: 56px;[^}]*border-radius: 16px;[^}]*background: var\(--trade-waiting-bg\)/);
  });

  it("keeps the dialog narrow like the mockup, but never wider than the screen", () => {
    expect(css).toMatch(/dialog\.dialog \{ width: min\(400px, calc\(100% - 2 \* var\(--trade-inset-browse\)\)\); \}/);
  });
});
