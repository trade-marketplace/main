"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/components/Button";
import { EmptyState, ErrorState, OfflineBanner, SkeletonText, useOnlineStatus } from "@/components/feedback";
import { SelectField, TextAreaField, TextField } from "@/components/forms";
import { Icon } from "@/components/Icon";
import { Banner } from "@/components/overlays";
import { StatusPill } from "@/components/status/StatusPill";
import { MESSAGE_ERRORS, messageDraftKey, type MessageResult, type MessagesData, type MessagesState } from "@/lib/problem-threads";
import { markProblemThreadReadAction, openProblemThreadAction, sendProblemMessageAction } from "@/server/messages/actions";
import styles from "./messages.module.css";

type Input = { text: string; requestKey: string; photoPaths: string[] };
const noSubscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
type Props = {
  data: MessagesData; state?: MessagesState; jobId?: string; preview?: boolean;
  threadHref?: (id: string) => string; listHref?: string;
  send?: (id: string, input: Input) => Promise<MessageResult>;
  open?: (input: Input & { jobId: string; reason: string }) => Promise<MessageResult>;
  upload?: (jobId: string, file: File) => Promise<string>;
};
async function uploadPhoto(jobId: string, file: File) {
  // Vercel's function request limit is 4.5 MB, including multipart framing. Keep margin and resize common
  // camera pictures before sending; #96 still validates and re-encodes every byte on the server.
  if (file.size > 4 * 1024 * 1024 && ["image/jpeg", "image/png"].includes(file.type)) {
    try {
      const image = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (blob) file = new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    } catch { throw new Error("photo-too-large"); }
  }
  if (file.size > 4 * 1024 * 1024) throw new Error("photo-too-large");
  const form = new FormData(); form.set("jobId", jobId); form.set("photo", file);
  const response = await fetch("/api/messages/photos", { method: "POST", body: form });
  if (response.status === 413) throw new Error("photo-too-large");
  if (!response.ok) throw new Error("upload-failed");
  const result = await response.json();
  if (typeof result.path !== "string") throw new Error("upload-failed");
  return result.path;
}

export function ProblemThreads({ data, state = "thread", jobId, preview = false, threadHref = id => `/messages/${id}`, listHref = "/messages", send = sendProblemMessageAction, open = openProblemThreadAction, upload = uploadPhoto }: Props) {
  const router = useRouter(); const browserOnline = useOnlineStatus(); const online = state !== "offline" && browserOnline;
  const [search, setSearch] = useState(""); const [opening, setOpening] = useState(!!jobId);
  const [selectedJob, setSelectedJob] = useState(jobId ?? data.jobs[0]?.id ?? "");
  const [reason, setReason] = useState(""); const [context, setContext] = useState(false);
  const [error, setError] = useState(state === "error" ? MESSAGE_ERRORS.unavailable : "");
  const selected = opening ? null : data.selected;
  const thread = selected;
  const lastMessage = thread?.messages.at(-1);
  const currentThreadId = thread?.id, lastMessageId = lastMessage?.id;
  const scroll = useRef<HTMLDivElement>(null); const atBottom = useRef(true);
  useEffect(() => {
    if (preview) return;
    const refresh = () => { if (navigator.onLine && document.visibilityState === "visible") router.refresh(); };
    window.addEventListener("focus", refresh); const timer = window.setInterval(refresh, 10_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [preview, router]);
  useEffect(() => {
    if (preview || !currentThreadId || !lastMessageId) return;
    void markProblemThreadReadAction(currentThreadId, lastMessageId).then(result => { if (result.ok) router.refresh(); }).catch(() => {});
  }, [preview, currentThreadId, lastMessageId, router]); // A new public message advances the read receipt once.
  useEffect(() => { if (atBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [thread?.id, lastMessage?.id]);
  const filtered = data.threads.filter(row => `${row.subject} ${row.title} ${row.jobNumber}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.page} aria-label="Messages" data-mode={data.role === "TRADIE" ? "trade" : "customer"}>
    <header className={styles.heading}><h1>Messages</h1><Button variant="secondary" size="sm" onClick={() => { setOpening(true); setError(""); }}>Ask about a job</Button></header>
    {state === "offline" ? <OfflineBanner online={false} sticky={false} /> : <OfflineBanner sticky={false} />}
    <div className={styles.layout} data-conversation={!!thread || opening}>
      <aside className={styles.threads} aria-label="Your job threads">
        <TextField label="Search messages" type="search" value={search} onChange={event => setSearch(event.target.value)} />
        <nav aria-label="Job conversations" className={styles.threadList}>
          {filtered.map(row => <Link key={row.id} href={threadHref(row.id)} aria-current={row.id === thread?.id ? "page" : undefined} className={styles.thread}>
            <span className={styles.avatar}><Icon name="chat_bubble" decorative /></span>
            <span className={styles.threadWords}><b>{row.subject}</b><span>{row.title} · {row.jobNumber}</span><span className={styles.preview}>{row.preview}</span><time>{row.when}</time></span>
            {row.unread && <span className={`${styles.unread} tm-anim-badge`} aria-label="Unread" />}
          </Link>)}
        </nav>
        {!filtered.length && !!search && <p>No messages match that.</p>}
      </aside>
      <div className={styles.conversation}>
        {state === "loading" ? <div role="status" aria-label="Loading messages" className={styles.loading}><SkeletonText lines={4} /></div>
          : opening ? <div className={styles.openForm}>
            <Link className={styles.back} href={listHref} onClick={() => setOpening(false)}><Icon name="arrow_back" decorative />Back</Link>
            <h2>Ask about a job</h2>
            {data.jobs.length ? <>
              <SelectField label="Job" value={selectedJob} onChange={event => setSelectedJob(event.target.value)}>{data.jobs.map(job => <option key={job.id} value={job.id}>{job.title} · {job.number}</option>)}</SelectField>
              <TextField label="Subject" value={reason} onChange={event => setReason(event.target.value)} maxLength={160} />
              <p className={styles.help}>For a problem or support request. Your customer or worker and Trade Marketplace can see this thread.</p>
              <Composer key={`new-${selectedJob}`} viewerId={data.viewerId} draftId={`new-${selectedJob}`} jobId={selectedJob} online={online} error={error} setError={setError} upload={upload}
                onSend={async input => { const result = await open({ ...input, jobId: selectedJob, reason }); if (result.ok) { setOpening(false); router.push(threadHref(result.threadId)); router.refresh(); } return result; }} submitLabel="Send request" disabled={!reason.trim()} />
            </> : <EmptyState icon="chat_bubble" title="No jobs yet." message="Threads are for problems or support requests on a job." action={<Button href="/contact" variant="secondary">Contact us</Button>} />}
          </div>
          : thread ? <>
            <header className={styles.conversationHeader}><Link href={listHref} className={styles.back}><Icon name="arrow_back" decorative />Back</Link><span className={styles.avatar}><Icon name="bolt" decorative /></span><div><h2>{thread.subject}</h2><p>{thread.job.title} · {thread.job.number}</p></div><span className={styles.info}><IconButton icon="info" label="Job context" pressed={context} onClick={() => setContext(!context)} /></span></header>
            {context && <div className={styles.mobileContext}><JobContext data={data} /></div>}
            <div ref={scroll} tabIndex={0} className={styles.bubbles} aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions" onScroll={() => { const el = scroll.current; atBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
              {[...thread.messages.map(message => ({ type: "message" as const, at: message.at, message })), ...thread.events.map(event => ({ type: "event" as const, at: event.at, event }))].sort((a, b) => a.at.localeCompare(b.at)).map(item => item.type === "event"
                ? <p className={styles.event} key={`event-${item.event.id}`}><Icon name="bolt" size="sm" decorative />{item.event.label}</p>
                : <article className={`${styles.message} tm-anim-bubble`} data-own={item.message.own} key={item.message.id} aria-label={`${item.message.author}, ${item.message.when}`}>
                  <div className={styles.sender}>{item.message.office && <Icon name="bolt" size="sm" decorative />}<b>{item.message.own ? "You" : item.message.author}</b><time dateTime={item.message.at}>{item.message.when}</time></div>
                  <p>{item.message.body}</p>
                  {!!item.message.photos.length && <div className={styles.photos}>{item.message.photos.map((photo, i) => photo.url
                    // Signed storage URLs expire and are renewed with the thread's refresh.
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Message photo ${i + 1}`} /></a>
                    : <span key={photo.id}>Photo unavailable</span>)}</div>}
                  {item.message.id === lastMessage?.id && item.message.own && <span className={styles.receipt}>{item.message.seen ? "Read" : "Sent"}</span>}
                </article>)}
            </div>
            {thread.closed ? <p className={styles.help}>This thread is closed.</p> : <Composer key={thread.id} viewerId={data.viewerId} draftId={thread.id} jobId={thread.job.id} online={online} error={error} setError={setError} upload={upload}
              onSend={async input => { const result = await send(thread.id, input); if (result.ok) router.refresh(); return result; }} />}
          </>
          : state === "error" ? <ErrorState title="Can’t load messages." message="Check your connection and try again." onRetry={() => router.refresh()} />
          : <EmptyState title="No threads yet." icon="chat_bubble" message="Threads open when you need help with a job." action={<Button onClick={() => setOpening(true)}>Ask about a job</Button>} />}
      </div>
      {thread && <aside className={styles.context} aria-label="Job context"><JobContext data={data} /></aside>}
    </div>
  </section>;
}

function JobContext({ data }: { data: MessagesData }) {
  const job = data.selected!.job;
  return <div className={styles.contextCard}><h2>{job.title}</h2><StatusPill status={job.status} audience={data.role === "TRADIE" ? "tradie" : "customer"} /><dl><dt>Job</dt><dd>{job.number}</dd><dt>Where</dt><dd>{job.suburb}</dd>{job.worker && <><dt>Tradie</dt><dd>{job.worker}</dd></>}</dl></div>;
}

function Composer({ viewerId, draftId, jobId, online, error, setError, onSend, upload, submitLabel = "Send", disabled = false }: {
  viewerId: string; draftId: string; jobId: string; online: boolean; error: string; setError: (error: string) => void;
  onSend: (input: Input) => Promise<MessageResult>; upload: (jobId: string, file: File) => Promise<string>; submitLabel?: string; disabled?: boolean;
}) {
  const key = messageDraftKey(viewerId, draftId); const form = useRef<HTMLFormElement>(null); const area = useRef<HTMLTextAreaElement>(null);
  const ready = useSyncExternalStore(noSubscribe, clientReady, serverReady);
  const [text, setText] = useState(""); const [sending, setSending] = useState(false); const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<{ path: string; name: string }[]>([]); const requestKey = useRef<string | null>(null);
  useEffect(() => {
    try { const draft = window.localStorage.getItem(key); if (draft && area.current) { area.current.value = draft; queueMicrotask(() => setText(draft)); } } catch { /* Storage can be disabled. The form still works. */ }
  }, [key]);
  function edit(value: string) {
    setText(value); requestKey.current = null;
    try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* Keep the in-memory draft. */ }
  }
  async function files(selected: FileList | File[]) {
    if (!online || uploading || sending) return;
    if (selected.length + photos.length > 6) { setError("Add up to 6 photos."); return; }
    setUploading(true); setError("");
    try {
      for (const file of Array.from(selected)) { const path = await upload(jobId, file); requestKey.current = null; setPhotos(previous => previous.some(photo => photo.path === path) ? previous : [...previous, { path, name: file.name }]); }
    } catch (error) { setError(error instanceof Error && error.message === "photo-too-large" ? "That photo is too large to send. Choose one under 4 MB." : "Your photo wasn’t uploaded. Try again."); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!online || sending || uploading || disabled || !text.trim()) return;
    setSending(true); setError(""); requestKey.current ??= crypto.randomUUID();
    try {
      const result = await onSend({ text, requestKey: requestKey.current, photoPaths: photos.map(photo => photo.path) });
      if (result.ok) { edit(""); setPhotos([]); requestKey.current = null; area.current?.focus(); }
      else setError(MESSAGE_ERRORS[result.error] ?? MESSAGE_ERRORS.unavailable);
    } catch { setError(MESSAGE_ERRORS.unavailable); }
    finally { setSending(false); }
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); form.current?.requestSubmit(); }
  }
  return <form ref={form} className={styles.composer} onSubmit={submit} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void files(event.dataTransfer.files); }}>
    {!!error && <Banner tone="alert" live>{error}</Banner>}
    <TextAreaField ref={area} label="Message" value={text} maxLength={4000} rows={3} onChange={event => edit(event.target.value)} onKeyDown={keyboard} disabled={!ready || sending} hint="Enter to send, Shift+Enter for a new line" />
    <p className={styles.help}>Enter to send, Shift+Enter for a new line</p>
    {!!photos.length && <ul className={styles.attachments}>{photos.map((photo, i) => <li key={`${photo.path}-${i}`}><Icon name="photo" decorative size="sm" />{photo.name}<button type="button" disabled={sending || uploading} onClick={() => { requestKey.current = null; setPhotos(current => current.filter((_, index) => index !== i)); }} aria-label={`Remove ${photo.name}`}><Icon name="close" decorative size="sm" /></button></li>)}</ul>}
    <div className={styles.composerActions}><label className={styles.upload}><Icon name="add_photo_alternate" decorative />Add photo<input aria-label="Add photo" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple disabled={!ready || !online || uploading || sending} onChange={event => { if (event.target.files) void files(event.target.files); event.target.value = ""; }} /></label>
      <Button type="submit" width="auto" loading={sending || uploading} disabled={!online ? "You’re offline." : !ready || disabled || !text.trim()} iconEnd="arrow_upward">{uploading ? "Uploading…" : submitLabel}</Button>
    </div>
  </form>;
}
