"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { EmptyState, ErrorState, InlineError, OfflineBanner, SkeletonText, useOnlineStatus } from "@/components/feedback";
import { TextAreaField } from "@/components/forms";
import { MessageBubble } from "./MessageBubble";
import { messageDraftKey, type MessageResult } from "@/lib/problem-threads";
import { SUPPORT_ERRORS, type SupportConversation, type SupportMessageInput } from "@/lib/support";
import { supportReturn, supportThreadHref } from "@/lib/support-return";
import { markSupportThreadReadAction, sendSupportMessageAction } from "@/server/messages/support-actions";
import messageStyles from "./messages.module.css";
import styles from "@/components/help/support.module.css";

/** Shared private-thread reply form; the command derives owner, office role and notification recipients. */
export function SupportReplyComposer({ viewerId, threadId, online, send = sendSupportMessageAction, onSent, label = "Send", initialError = "" }: {
  viewerId: string; threadId: string; online: boolean; label?: string; initialError?: string;
  send?: (id: string, input: SupportMessageInput) => Promise<MessageResult>; onSent: () => void;
}) {
  const [text, setText] = useState(""), [ready, setReady] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState(initialError);
  const key = messageDraftKey(viewerId, `support-${threadId}`), requestKey = useRef<string | null>(null), form = useRef<HTMLFormElement>(null), area = useRef<HTMLTextAreaElement>(null), session = useOptionalSessionExpired(), focusAfterSend = useRef(false);
  useEffect(() => { if (!sending && focusAfterSend.current) { focusAfterSend.current = false; area.current?.focus(); } }, [sending]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { const saved = JSON.parse(localStorage.getItem(key) ?? "null"); if (saved && typeof saved.text === "string") { setText(saved.text.slice(0, 4000)); requestKey.current = typeof saved.requestKey === "string" ? saved.requestKey : null; } } catch { /* Storage can be disabled. */ }
      setReady(true);
    });
    return () => { active = false; };
  }, [key]);
  function save(value: string, stable: string | null) { requestKey.current = stable; try { localStorage.setItem(key, JSON.stringify({ text: value, requestKey: stable })); } catch { /* Retain the in-memory draft. */ } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!ready || sending || !online || !text.trim()) return;
    setSending(true); setError(""); const stable = requestKey.current ?? crypto.randomUUID(); save(text, stable);
    try {
      const result = await send(threadId, { text, requestKey: stable });
      if (result.ok) { setText(""); requestKey.current = null; try { localStorage.removeItem(key); } catch {} focusAfterSend.current = true; onSent(); }
      else if (!session?.check(result, { resend: () => form.current?.requestSubmit() })) setError(SUPPORT_ERRORS[result.error] ?? SUPPORT_ERRORS.unavailable);
    } catch { setError(SUPPORT_ERRORS.unavailable); }
    finally { setSending(false); }
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); form.current?.requestSubmit(); } }
  return <form ref={form} className={styles.composer} onSubmit={submit} data-offline-queue="off"><TextAreaField ref={area} label="Message" name="message" value={text} maxLength={4000} rows={5} required disabled={!ready || sending} onKeyDown={keyboard} onChange={event => { setText(event.target.value); save(event.target.value, null); }} />{error && <InlineError message={error} />}<div className={styles.actions}><Button type="submit" width="auto" icon="send" loading={sending} disabled={!ready || !online || !text.trim()}>{label}</Button></div></form>;
}

export function SupportConversationView({ viewerId, thread, returnTo = "/help", state = "default", preview = false, send }: {
  viewerId: string; thread: SupportConversation | null; returnTo?: string;
  state?: "default" | "loading" | "empty" | "error" | "offline" | "success" | "replied" | "closed";
  preview?: boolean; send?: (id: string, input: SupportMessageInput) => Promise<MessageResult>;
}) {
  const router = useRouter(), connected = useOnlineStatus(), online = state !== "offline" && connected, scroll = useRef<HTMLDivElement>(null), atBottom = useRef(true);
  const lastId = thread?.messages.at(-1)?.id, threadId = thread?.id, earlier = thread?.earlier;
  const windowKey = `${threadId ?? ""}:${earlier ? thread?.messages[0]?.id ?? "empty" : "latest"}`, previousWindow = useRef(windowKey);
  useEffect(() => { if (preview) return; const refresh = () => { if (navigator.onLine && document.visibilityState === "visible") router.refresh(); }; const timer = window.setInterval(refresh, 10_000); window.addEventListener("focus", refresh); return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); }; }, [preview, router]);
  useEffect(() => {
    if (preview || !online || earlier || !threadId || !lastId) return;
    const acknowledge = () => { if (document.visibilityState === "visible") void markSupportThreadReadAction(threadId, lastId).catch(() => {}); };
    acknowledge(); document.addEventListener("visibilitychange", acknowledge); return () => document.removeEventListener("visibilitychange", acknowledge);
  }, [preview, online, earlier, threadId, lastId]);
  useEffect(() => { const changed = previousWindow.current !== windowKey; if ((atBottom.current || changed) && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; if (changed) atBottom.current = true; previousWindow.current = windowKey; }, [windowKey, lastId]);
  return <section className={styles.page}><Link className={styles.back} href={supportReturn(returnTo)}><Icon name="arrow_back" decorative />Back</Link><header className={styles.heading}><h1>{thread?.subject ?? "Messages"}</h1><p>Trade Marketplace</p></header><OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    <div className={`${styles.card} ${styles.conversation}`}>
      {state === "loading" ? <div className={styles.padded} role="status" aria-label="Loading messages"><SkeletonText lines={5} /></div> : state === "error" ? <div className={styles.padded}><ErrorState title="Can’t load messages." onRetry={() => router.refresh()} /></div> : !thread ? <EmptyState title="No messages yet." icon="chat_bubble" /> : <>
        {(thread.olderCursor || thread.earlier) && <nav className={messageStyles.history} aria-label="Message history">{thread.olderCursor && <Link prefetch={false} href={supportThreadHref(thread.id, returnTo, thread.olderCursor)}>Earlier</Link>}{thread.earlier && <Link prefetch={false} href={supportThreadHref(thread.id, returnTo)}>Latest</Link>}</nav>}
        <div className={messageStyles.bubbles} ref={scroll} role="log" aria-label="Conversation" tabIndex={0} aria-live="polite" aria-relevant="additions" onScroll={() => { const el = scroll.current; atBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>{thread.messages.length ? thread.messages.map(message => <MessageBubble key={message.id} message={message} latest={message.id === thread.latestMessageId} />) : <p>No messages yet.</p>}</div>
        {thread.closed ? <div className={styles.padded}><p>This thread is closed.</p></div> : <SupportReplyComposer key={thread.id} viewerId={viewerId} threadId={thread.id} online={online} send={send} onSent={() => { if (thread.earlier) router.push(supportThreadHref(thread.id, returnTo)); router.refresh(); }} />}
      </>}
    </div>
  </section>;
}
