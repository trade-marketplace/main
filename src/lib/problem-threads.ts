import { z } from "zod";
import type { JobStatus } from "@/lib/job-status";
import type { Role } from "@/lib/mode";

export const HIDDEN_CONTACT = "hidden until the job is booked";
export function redactContactDetails(text: string, claimed: boolean): string {
  if (claimed) return text;
  return text.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, HIDDEN_CONTACT)
    .replace(/(?<![\p{L}\p{N}_-])(?:(?:\+|00)\d(?:[\s().-]*\d){6,14}|0(?:[\s().-]*\d){7,10})(?![\p{L}\p{N}])/gu,
      phone => /^(?:0?[1-9]|[12]\d|3[01])[-./](?:0?[1-9]|1[0-2])[-./](?:19|20)\d{2}$/.test(phone) ? phone : HIDDEN_CONTACT);
}
export const messageSchema = z.object({
  text: z.string().trim().min(1, "Write a message.").max(4000, "Keep your message under 4,000 characters."),
  photoPaths: z.array(z.string().max(240)).max(6).default([]),
  requestKey: z.uuid(),
});
export const problemSchema = messageSchema.extend({ jobId: z.uuid(), reason: z.string().trim().min(1).max(160) });
export type ThreadSummary = { id: string; subject: string; jobNumber: string; title: string; preview: string; when: string; unread: boolean };
export type ThreadMessage = { id: string; author: string; office: boolean; own: boolean; body: string; at: string; when: string; photos: { url: string | null; id: string }[]; seen: boolean };
export type ThreadView = {
  id: string; subject: string; closed: boolean;
  latestMessageId: string | null; olderCursor: string | null; earlier: boolean;
  job: { id: string; number: string; title: string; suburb: string; status: JobStatus; worker: string | null };
  messages: ThreadMessage[];
  events: { id: string; label: string; at: string }[];
};
export type ProblemJob = { id: string; number: string; title: string };
export type MessagesData = { role: Role; viewerId: string; threads: ThreadSummary[]; selected: ThreadView | null; jobs: ProblemJob[] };
export type MessageResult = { ok: true; threadId: string } | { ok: false; error: string; retryAfter?: number };
export type MessagesState = "thread" | "empty" | "offline" | "error" | "loading";
export const MESSAGE_ERRORS: Record<string, string> = {
  invalid: "Check your message and try again.", forbidden: "You can only message about your own jobs.",
  unavailable: "Your message wasn’t sent. Try again.", "photos-pending": "Your photos are still uploading. Try again when they’re ready.",
  closed: "This thread is closed.", "try-later": "Too many messages. Try again in a few minutes.",
  "session-expired": "Please log in again to send your message.",
};
export function messageDraftKey(viewerId: string, threadId: string) { return `trade.problem-draft.${viewerId}.${threadId}`; }
