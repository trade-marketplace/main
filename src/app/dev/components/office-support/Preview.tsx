"use client";
import { OfficeSupportConversation, OfficeSupportInbox, type OfficeReplyActions } from "@/components/office/OfficeSupport";
import { SupportConversationView } from "@/components/messages/SupportConversation";
import type { OfficeSupportQuery } from "@/lib/office-support";
import { previewConversation, previewInbox, type OfficeSupportState } from "./preview-data";

const actions: OfficeReplyActions = { send: async id => ({ ok: true, threadId: id }), read: async () => ({ ok: true }) };
export function SupportPreview({ state }: { state: OfficeSupportState }) {
  const query: OfficeSupportQuery = { status: "open", q: state === "search-empty" ? "No matching thread" : "", page: 1 };
  const list = ["inbox", "empty", "loading", "error", "offline", "search-empty"].includes(state);
  const gallery = ["empty", "loading", "error", "offline"].includes(state);
  const preview = state === "offline" ? "offline" : state === "reply-error" ? "send-error" : state === "reply-sent" ? "sent" : state === "reply-sending" ? "sending" : undefined;
  return <div style={{ display: "grid", gap: "var(--trade-space-8)" }}>
    {list && <OfficeSupportInbox query={query} data={state === "loading" || state === "error" ? null : ["empty", "search-empty"].includes(state) ? { rows: [], total: 0, page: 1 } : previewInbox} loading={state === "loading"} previewOffline={state === "offline"} />}
    {(!list || gallery) && <OfficeSupportConversation query={query} data={state === "loading" || state === "error" ? null : state === "empty" ? { ...previewConversation(state), conversation: { ...previewConversation(state).conversation, messages: [], latestMessageId: null } } : previewConversation(state)} loading={state === "loading"} preview={preview} actions={actions} />}
    {state === "reply-sent" && <OfficeSupportConversation query={query} data={previewConversation("reply-sending")} preview="sending" actions={actions} />}
    {state === "conversation" && <OfficeSupportConversation query={query} data={previewConversation("history")} actions={actions} />}
  </div>;
}

export function OwnerPreview() {
  const data = previewConversation("conversation");
  const thread = { ...data.conversation, messages: data.conversation.messages.map(message => ({ ...message, own: !message.office })) };
  return <div style={{ display: "grid", gap: "var(--trade-space-8)" }}>{(["replied", "loading", "empty", "error", "offline", "closed"] as const).map(state => <div key={state}>
    <p><b>{state}</b></p><SupportConversationView viewerId="00000000-0000-4000-8000-000000001839" thread={state === "loading" || state === "error" ? null : { ...thread, closed: state === "closed", ...(state === "empty" ? { messages: [], latestMessageId: null } : {}) }} state={state} preview send={async id => ({ ok: true, threadId: id })} />
  </div>)}</div>;
}
