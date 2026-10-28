import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CustomerSignupPage from "@/app/signup/customer/page";
import { CustomerSignup } from "@/components/auth/CustomerSignup";
import { normaliseMobile, passwordStrength, signupLink } from "@/lib/auth/signup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const values = { firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test", phone: "021 555 0192", role: "CUSTOMER", terms: "on" };

describe("customer sign up", () => {
  it("uses the auth layout, shared choices and kit fields in the designed order", () => {
    const html = renderToString(<CustomerSignup />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("mail.png");
    expect(html).toMatch(/name="name"[\s\S]*name="email"[\s\S]*name="phone"[\s\S]*name="password"[\s\S]*name="terms"/);
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('aria-label="Password strength"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('data-mode="customer"');
    expect(html).toContain('name="signupRole"');
    expect(html).toContain('name="role" value="CUSTOMER"');
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*Create account/);
  });

  it("email taken: offers log in and reset, preserving the other fields and return path", () => {
    const html = renderToString(<CustomerSignup next="/jobs/new?step=review" initialState={{ ok: false, error: "email-taken", values }} />);
    expect(html).toContain("Log in");
    expect(html).toContain('href="/recovery?next=%2Fjobs%2Fnew%3Fstep%3Dreview"');
    expect(html).toContain('value="Sarah Thompson"');
    expect(html).toContain('value="021 555 0192"');
    expect(html).toContain('value="sarah@example.test"');
    expect(html).toContain('name="next" value="/jobs/new?step=review"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('name="password" value="korimako');
  });

  it("success explains confirmation while allowing log in", () => {
    const html = renderToString(<CustomerSignup next="/jobs/new?step=review" initialState={{ ok: true, status: "check-email", email: values.email }} />);
    expect(html).toContain("Confirm your email");
    expect(html).toContain("sarah@example.test");
    expect(html).toContain('href="/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview"');
    expect(html).not.toContain('<form');
  });

  it("only accepts local return paths", async () => {
    const html = renderToString(await CustomerSignupPage({ searchParams: Promise.resolve({ next: "//evil.test" }) }));
    expect(html).not.toContain("evil.test");
    expect(signupLink("/login", "https://evil.test")).toBe("/login");
    expect(signupLink("/login", "/jobs/new?step=review&draft=1")).toBe("/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1");
  });
});

describe("shared sign-up field rules", () => {
  it("normalizes local and international NZ mobiles and rejects incomplete input", () => {
    for (const mobile of ["021 555 0192", "+64 (21) 555-0192", "0064215550192"]) expect(normaliseMobile(mobile)).toBe("+64215550192");
    for (const mobile of ["", "021", "123", "+61215550192", "0215550192abc"]) expect(normaliseMobile(mobile)).toBeNull();
  });

  it("uses the existing 10-character/password rules for a four-segment hint", () => {
    expect(passwordStrength("").segments).toBe(0);
    expect(passwordStrength("Password123!")).toMatchObject({ segments: 1, hint: expect.stringContaining("stronger") });
    expect(passwordStrength("korimako-gumboot-41").segments).toBe(3);
    expect(passwordStrength("korimako-gumboot-tui-41").segments).toBe(4);
  });
});
