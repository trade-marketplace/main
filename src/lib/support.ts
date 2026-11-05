import { z } from "zod";
import { messageSchema, type ThreadMessage } from "./problem-threads";
import type { Role } from "./mode";

// Help's composer is text-only. Existing public attachments still appear in authorized thread history.
export const supportMessageSchema = messageSchema.extend({ photoPaths: z.array(z.string()).max(0).default([]) }).strict();
export const supportRequestSchema = supportMessageSchema.extend({ subject: z.string().trim().min(1).max(160) });
export type SupportMessageInput = z.input<typeof supportMessageSchema>;
export type SupportRequestInput = z.input<typeof supportRequestSchema>;
export type SupportConversation = {
  id: string; subject: string; closed: boolean; latestMessageId: string | null;
  olderCursor: string | null; earlier: boolean; messages: ThreadMessage[];
};
export type SupportSummary = { id: string; subject: string; closed: boolean; preview: string; when: string; unread: boolean };
export type SupportInbox = { role: Role; viewerId: string; threads: SupportSummary[]; page: number; pages: number; total: number };
export const SUPPORT_PAGE_SIZE = 20;
export const SUPPORT_ERRORS: Readonly<Record<string, string>> = {
  invalid: "Check your message and try again.", unavailable: "Your message wasn’t sent. Try again.",
  closed: "This thread is closed.", "try-later": "Too many messages. Try again in a few minutes.",
  forbidden: "Your message wasn’t sent. Try again.", "session-expired": "Please log in again to send your message.",
};
