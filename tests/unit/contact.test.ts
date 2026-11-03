import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTACT_MESSAGE_MAX, CONTACT_TOPICS, contactInput, contactTopicLabel } from "@/lib/contact";
import { CONTACT_SENDER, contactEmail, resendMailer, sendContact, type ContactMailer } from "@/server/contact";

const viewer = vi.hoisted(() => ({ current: null as null | { email: string; firstName: string; role: string } }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => viewer.current }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const valid = { topic: "job", email: "  Sarah@Email.co.nz ", message: "  Hi, I wanted to ask about my job.  " };
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => { vi.restoreAllMocks(); viewer.current = null; });

describe("contact input", () => {
  it("trims, lower-cases the email and accepts every topic", () => {
    expect(contactInput.parse(valid)).toEqual({ topic: "job", email: "sarah@email.co.nz", message: "Hi, I wanted to ask about my job." });
    for (const { value } of CONTACT_TOPICS) expect(contactInput.safeParse({ ...valid, topic: value }).success).toBe(true);
  });
  it("rejects a missing or unknown topic, a bad email, an empty, huge or control-character message", () => {
    for (const bad of [{ topic: "nope" }, { topic: undefined }, { email: "not-an-email" }, { email: "a@b.nz\r\nBcc: x@y.nz" }, { email: "" },
      { message: "   " }, { message: "x".repeat(CONTACT_MESSAGE_MAX + 1) }, { message: "hi\u0000there" }]) {
      expect(contactInput.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(contactInput.safeParse({ ...valid, message: "x".repeat(CONTACT_MESSAGE_MAX) }).success).toBe(true);
    expect(contactInput.safeParse({ ...valid, message: "two\nlines\r\nand a tab\t" }).success).toBe(true);
  });
});

describe("sendContact", () => {
  const deps = (mailer: ContactMailer | null) => ({ mailer, inbox: "office@example.test", newKey: () => "key-1" });

  it("emails the office with the person's address as Reply-To and a subject made only of the topic", async () => {
    const mailer = vi.fn<ContactMailer>(async () => true);
    expect(await sendContact(valid, "", deps(mailer))).toEqual({ status: "sent" });
    expect(mailer).toHaveBeenCalledOnce();
    expect(mailer).toHaveBeenCalledWith({
      from: CONTACT_SENDER, to: "office@example.test", replyTo: "sarah@email.co.nz",
      subject: "Contact form: A job I posted",
      text: "Topic: A job I posted\nFrom: sarah@email.co.nz\n\nHi, I wanted to ask about my job.\n",
    }, "key-1");
    expect(contactTopicLabel("other")).toBe("Something else");
  });

  it("What if it's spam? A filled honeypot looks sent but sends nothing", async () => {
    const mailer = vi.fn<ContactMailer>(async () => true);
    expect(await sendContact(valid, "http://spam.example", deps(mailer))).toEqual({ status: "sent" });
    expect(mailer).not.toHaveBeenCalled();
  });

  it("names the first bad field and sends nothing", async () => {
    const mailer = vi.fn<ContactMailer>(async () => true);
    expect(await sendContact({ ...valid, email: "x" }, "", deps(mailer))).toEqual({ status: "error", field: "email" });
    expect(await sendContact({ ...valid, message: " " }, "", deps(mailer))).toEqual({ status: "error", field: "message" });
    expect(await sendContact({ ...valid, topic: "zzz" }, "", deps(mailer))).toEqual({ status: "error", field: "topic" });
    expect(await sendContact(null, "", deps(mailer))).toEqual({ status: "error" });
    expect(mailer).not.toHaveBeenCalled();
  });

  it("fails (and says so) when email isn't configured, when the provider refuses or when it throws, logging no personal details", async () => {
    const log = quiet();
    expect(await sendContact(valid, "", deps(null))).toEqual({ status: "error" });
    expect(await sendContact(valid, "", { mailer: async () => true, inbox: "  " })).toEqual({ status: "error" });
    expect(await sendContact(valid, "", deps(async () => false))).toEqual({ status: "error" });
    expect(await sendContact(valid, "", deps(async () => { throw new Error("sarah@email.co.nz Hi, I wanted"); }))).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sarah|wanted/);
  });
});

describe("Resend mailer", () => {
  it("is off without a key", () => {
    expect(resendMailer({}, vi.fn())).toBeNull();
    expect(resendMailer({ RESEND_API_KEY: "  " }, vi.fn())).toBeNull();
  });
  it("posts one plain-text email with the key and an idempotency key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const mailer = resendMailer({ RESEND_API_KEY: "re_test" }, fetcher as unknown as typeof fetch)!;
    const email = contactEmail(contactInput.parse(valid), "office@example.test");
    expect(await mailer(email, "abc")).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Idempotency-Key": "abc" });
    expect(JSON.parse(String(init.body))).toEqual({ from: CONTACT_SENDER, to: ["office@example.test"], reply_to: "sarah@email.co.nz", subject: "Contact form: A job I posted", text: email.text });
  });
  it("reports a refusal", async () => {
    const mailer = resendMailer({ RESEND_API_KEY: "re_test" }, (async () => new Response("no", { status: 422 })) as unknown as typeof fetch)!;
    expect(await mailer(contactEmail(contactInput.parse(valid), "o@e.test"), "k")).toBe(false);
  });
});

describe("Contact page", () => {
  const render = async () => {
    const { default: Page, metadata } = await import("@/app/(site)/contact/page");
    return { html: renderToString(await Page()), metadata };
  };

  it("renders the form, the response time and the help centre links, signed out", async () => {
    const { html, metadata } = await render();
    for (const text of ["Get in touch", "What’s it about?", "A job I posted", "Your email", "Message", "Send message", "We reply within one working day.", "Help centre", "Payments"]) expect(html).toContain(text);
    expect(html).toContain('href="/help?topic=payments"');
    expect(html).toContain('name="website"');
    expect(html).toMatch(/aria-hidden="true"[^>]*><label>Website/);
    expect(html).not.toMatch(/NZBN|0800|\+64/i);
    expect(html).not.toContain("sarah@");
    expect(metadata.alternates).toEqual({ canonical: "/contact" });
  });

  it("points a signed-in person to job support threads and fills in their address", async () => {
    viewer.current = { email: "sarah@email.co.nz", firstName: "Sarah", role: "CUSTOMER" };
    const { html } = await render();
    expect(html).toContain('value="sarah@email.co.nz"');
    expect(html).toMatch(/<a[^>]*href="\/messages"[^>]*>the job page<\/a>/);
  });
});
