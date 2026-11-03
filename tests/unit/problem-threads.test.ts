import { describe, expect, it } from "vitest";
import { HIDDEN_CONTACT, messageDraftKey, messageSchema, redactContactDetails } from "@/lib/problem-threads";
import { ownsSupportPhoto } from "@/server/messages/service";
import { inboxItem } from "@/server/notifications/inbox";

describe("problem thread privacy and input", () => {
  it("hides email and New Zealand phone formats until claim and keeps ordinary text", () => {
    for (const value of ["a+b@example.nz", "021 123 4567", "+64 (21) 123-4567", "0800 123 456", "0271234567", "+61 412 345 678", "+1 (415) 555-0123", "0061 412 345 678"]) expect(redactContactDetails(value, false)).toBe(HIDDEN_CONTACT);
    expect(redactContactDetails("A door needs fixing, job TM-1005.", false)).toBe("A door needs fixing, job TM-1005.");
    for (const value of ["TM-1000000001", "TM-0211234567", "ref_0211234567", "2026-11-03", "03-11-2026", "03.11.2026", "03/11/2026"]) expect(redactContactDetails(value, false)).toBe(value);
    expect(redactContactDetails("0211234567 test@example.nz", true)).toBe("0211234567 test@example.nz");
  });
  it("scopes drafts to their viewer and thread, validates body size and caps photos", () => {
    expect(messageDraftKey("a", "t")).not.toBe(messageDraftKey("b", "t"));
    expect(messageDraftKey("a", "t")).not.toBe(messageDraftKey("a", "u"));
    const input = { text: "Hello", requestKey: "10000000-0000-4000-8000-000000000001" };
    expect(messageSchema.safeParse(input).success).toBe(true);
    expect(messageSchema.safeParse({ ...input, text: " " }).success).toBe(false);
    expect(messageSchema.safeParse({ ...input, text: "a".repeat(4001) }).success).toBe(false);
    expect(messageSchema.safeParse({ ...input, photoPaths: Array(7).fill("a") }).success).toBe(false);
    expect(ownsSupportPhoto("person", "job", `support/job/person/${"a".repeat(32)}.webp`)).toBe(true);
    expect(ownsSupportPhoto("person", "job", `support/job/somebody-else/${"a".repeat(32)}.webp`)).toBe(false);
    expect(ownsSupportPhoto("person", "job", "support/job/person/../other.webp")).toBe(false);
  });
  it("notifications route each participant to their actual thread or office job", () => {
    const row = { id: "n", userId: "u", type: "message.received", payload: { jobId: "j", threadId: "t" }, readAt: null, createdAt: new Date(), channelsSent: [] };
    expect(inboxItem(row).href).toBe("/messages/t");
    expect(inboxItem({ ...row, payload: { ...row.payload, officeJobId: "j" } }).href).toBe("/admin/jobs/j");
  });
});
