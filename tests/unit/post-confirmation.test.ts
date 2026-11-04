import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONTACT_SENDER } from "@/server/contact";
import { tokenColour } from "@/server/brand-colours";
import { frozenPostConfirmationMessage, postConfirmationEmail } from "@/server/notifications/post-confirmation-template";

const input = () => ({ jobId: randomUUID(), customerId: randomUUID(), recipientEmail: "customer@example.test", jobNumber: 1005, title: "Check the lounge wiring" });

describe("posted confirmation email", () => {
  it("uses C06 wording, an owned job link, and G05's single customer card with plain text", () => {
    const value = input(); const email = postConfirmationEmail(value);
    expect(email.from).toBe(CONTACT_SENDER); expect(email.to).toBe(value.recipientEmail);
    expect(email.subject).toBe("Posted. · TM-1005");
    for (const copy of ["Posted.", "We’re on it. We’ll let you know when your price is ready.", value.title, "View my job", "Notification settings"]) {
      expect(email.html).toContain(copy); expect(email.text).toContain(copy);
    }
    expect(email.html).toContain(`href="https://trademarketplace.nz/jobs/${value.jobId}"`);
    expect(email.html).toContain('href="https://trademarketplace.nz/profile/notifications"');
    expect(email.html).toContain('role="presentation"'); expect(email.html).toContain("prefers-color-scheme:dark");
    expect(email.html).toContain(`bgcolor="${tokenColour("lime")}"`);
    expect(email.html).toContain(`background:${tokenColour("forest")}`);
    expect(email.html).toContain("Trade Display"); expect(email.html).toContain("Trade UI");
    expect(frozenPostConfirmationMessage.parse(email)).toEqual(email);
  });

  it("escapes customer-controlled text without turning it into HTML, links or email headers", () => {
    const title = '<img src=x onerror="alert(1)"> & \'quoted\'';
    const email = postConfirmationEmail({ ...input(), title });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;");
    expect(email.text).toContain(title); expect(email.subject).toBe("Posted. · TM-1005");
  });

  it("rejects malformed recipient/job data instead of rendering another destination", () => {
    for (const changed of [{ recipientEmail: "a@example.test\r\nBcc: b@example.test" }, { jobId: "../../other" }, { jobNumber: -1 }]) {
      expect(() => postConfirmationEmail({ ...input(), ...changed })).toThrow();
    }
    expect(frozenPostConfirmationMessage.safeParse({ ...postConfirmationEmail(input()), subject: "Posted\r\nBcc: other@example.test" }).success).toBe(false);
  });
});
