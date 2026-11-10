import type { OfficeSupportDetail, OfficeSupportPage } from "@/server/office/support";

export const OFFICE_SUPPORT_STATES = ["inbox", "empty", "loading", "error", "offline", "search-empty", "conversation", "closed", "reply-error", "reply-sent", "reply-sending", "history", "owner"] as const;
export type OfficeSupportState = typeof OFFICE_SUPPORT_STATES[number];
const id = "00000000-0000-4000-8000-000000001830", viewerId = "00000000-0000-4000-8000-000000001831";
export const previewInbox: OfficeSupportPage = { page: 1, total: 28, rows: [
  { id, subject: "Help with my account", owner: { name: "Sarah T", email: "sarah@example.test" }, closed: false, kind: "support", job: null, preview: "Can you help me change my account details?", unread: true, updatedAt: "2026-11-05T01:00:00Z", when: "5 Nov, 2:00 pm" },
  { id: "00000000-0000-4000-8000-000000001832", subject: "A question about the door repair and arranging a time that works for everyone", owner: { name: "Jack W", email: "jack.wilson@example.test" }, closed: false, kind: "job", job: { id: "00000000-0000-4000-8000-000000001833", number: "TM-1083", title: "Fix the back door" }, preview: "The latch needs another look before we finish.", unread: false, updatedAt: "2026-11-05T00:00:00Z", when: "5 Nov, 1:00 pm" },
] };
export function previewConversation(state: OfficeSupportState): Extract<OfficeSupportDetail, { kind: "support" }> {
  const message = { id: "00000000-0000-4000-8000-000000001834", author: "Sarah T", office: false, own: false, body: "Can you help me change my account details?", at: "2026-11-05T01:00:00Z", when: "5 Nov, 2:00 pm", photos: [], seen: false };
  return { kind: "support", viewerId, owner: previewInbox.rows[0].owner, job: null, conversation: {
    id, subject: state === "history" ? "Help with my account and an earlier message" : "Help with my account", closed: state === "closed", latestMessageId: "00000000-0000-4000-8000-000000001835",
    olderCursor: state === "history" ? "00000000-0000-4000-8000-000000001834" : null, earlier: state === "history", messages: [message,
      { ...message, id: "00000000-0000-4000-8000-000000001835", author: "Office", office: true, own: true, body: "Of course. Which details would you like to update?", at: "2026-11-05T01:02:00Z", when: "5 Nov, 2:02 pm", seen: state !== "reply-sent", photos: state === "history" ? [{ id: "historical-photo", url: null }] : [] },
    ],
  } };
}
