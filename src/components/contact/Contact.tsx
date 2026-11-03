"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { SelectField, TextAreaField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_MESSAGE_MAX,
  CONTACT_TOPICS,
  DEFAULT_CONTACT_TOPIC,
  contactErrorField,
  contactInput,
  type ContactField,
  type ContactResult,
  type ContactState,
} from "@/lib/contact";
import { HELP_TOPICS, helpTopicSlug } from "@/lib/help";
import { tryAgainText } from "@/lib/rate-limit";

import styles from "./contact.module.css";

/** The hidden field bots fill in. Must match CONTACT_HONEYPOT in src/server/contact.ts. */
const HONEYPOT = "website";

type Props = {
  submit: (form: FormData) => Promise<ContactResult>;
  /** Signed-in people: their address is filled in and "the job page" links to where their app starts. */
  email?: string;
  jobsHref?: string;
  /** Board handoff: a canonical local return path checked by the server page. */
  boardReturnHref?: string;
  /** Guarded local preview only. Public query flags cannot invent a sent message. */
  initialState?: ContactState;
  initialMessage?: string;
};

const FIELD_ERRORS: Record<ContactField, string> = {
  topic: "Choose what it’s about.",
  email: "Enter your email.",
  message: "Enter your message.",
};

export function Contact({ submit, email: knownEmail = "", jobsHref, boardReturnHref, initialState = "empty", initialMessage = "" }: Props) {
  const [state, setState] = useState<ContactState>(initialState);
  const [topic, setTopic] = useState<string>(DEFAULT_CONTACT_TOPIC);
  const [email, setEmail] = useState(knownEmail || (initialState === "empty" ? "" : "sarah@email.co.nz"));
  const [message, setMessage] = useState(initialMessage);
  const [field, setField] = useState<ContactField>();
  const [wait, setWait] = useState<number>();
  const pending = useRef(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLSelectElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const online = useOnlineStatus();
  const offline = !online || initialState === "offline";
  const sending = state === "sending";

  // Typing again clears the last result, so a "Message sent." never sits above a new, unsent message.
  function edit() {
    if (!sending && state !== "empty") { setState("empty"); setField(undefined); setWait(undefined); }
  }

  function fail(next?: ContactField, retryAfter?: number) {
    setField(next); setWait(retryAfter); setState("error");
    if (next) ({ topic: topicRef, email: emailRef, message: messageRef })[next].current?.focus();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || sending || offline) return;
    const parsed = contactInput.safeParse({ topic, email, message });
    if (!parsed.success) return fail(contactErrorField(parsed.error) ?? "message");
    pending.current = true;
    setField(undefined); setWait(undefined); setState("sending");
    const form = new FormData();
    form.set("topic", parsed.data.topic); form.set("email", parsed.data.email); form.set("message", parsed.data.message);
    form.set(HONEYPOT, honeypot.current?.value ?? "");
    try {
      const result = await submit(form);
      if (result.status === "sent") { setMessage(""); setState("sent"); } else fail(result.field, result.retryAfter);
    } catch { fail(); } finally { pending.current = false; }
  }

  return <section className={`${styles.page} tm-anim-rise`}>
    <div className={styles.wrap}>
      <h1 className={styles.title}>Get in touch</h1>
      <form className={styles.card} aria-label="Contact" method="post" onSubmit={send} noValidate>
        <div className={styles.fields}>
          <SelectField ref={topicRef} label="What’s it about?" name="topic" value={topic} disabled={sending}
            error={field === "topic" ? FIELD_ERRORS.topic : undefined}
            onChange={(event) => { setTopic(event.target.value); edit(); }}>
            {CONTACT_TOPICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </SelectField>
          <TextField ref={emailRef} label="Your email" name="email" type="email" autoComplete="email" required maxLength={CONTACT_EMAIL_MAX}
            placeholder="you@email.co.nz" value={email} readOnly={sending} error={field === "email" ? FIELD_ERRORS.email : undefined}
            onChange={(event) => { setEmail(event.target.value); edit(); }} />
          <TextAreaField ref={messageRef} label="Message" name="message" required maxLength={CONTACT_MESSAGE_MAX} rows={6}
            placeholder="Hi, I wanted to ask about…" value={message} readOnly={sending} error={field === "message" ? FIELD_ERRORS.message : undefined}
            onChange={(event) => { setMessage(event.target.value); edit(); }} />
          {/* Honeypot: people never see or reach it; a bot that fills it in is quietly ignored. */}
          <div className={styles.trap} aria-hidden="true">
            <label>Website<input ref={honeypot} type="text" name={HONEYPOT} tabIndex={-1} autoComplete="off" defaultValue="" /></label>
          </div>
          <Button type="submit" loading={sending} disabled={offline ? "You’re offline" : undefined}>Send message</Button>
          {offline && <Banner tone="alert" title="You’re offline." live>Your message is saved here until you’re back.</Banner>}
          {state === "error" && !field && !offline && (wait
            ? <Banner tone="alert" title="Too many tries." live>{tryAgainText(wait)}</Banner>
            : <Banner tone="alert" title="Couldn’t send your message." live>It’s still here. Try again.</Banner>)}
          {state === "sent" && <Banner className="tm-anim-rise" tone="good" title="Message sent." live />}
          <p className={styles.caption}>
            We reply within one working day. Already have a job with us? Message us from {jobsHref ? <TextLink inline href={jobsHref}>the job page</TextLink> : "the job page"} instead.
          </p>
        </div>
      </form>
      <nav aria-labelledby="contact-help" className={styles.help}>
        {boardReturnHref && <TextLink href={boardReturnHref}>Back to jobs</TextLink>}
        <h2 id="contact-help" className={styles.helpTitle}>Help centre</h2>
        <ul className={styles.helpList}>
          {HELP_TOPICS.map((name) => <li key={name}>
            <Link className={styles.helpLink} href={`/help?topic=${helpTopicSlug(name)}`}>
              <span>{name}</span><Icon name="chevron_right" size="sm" decorative />
            </Link>
          </li>)}
        </ul>
      </nav>
    </div>
  </section>;
}
