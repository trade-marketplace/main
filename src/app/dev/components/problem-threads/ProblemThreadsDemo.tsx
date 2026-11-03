"use client";

import { useState } from "react";
import { ProblemThreads } from "@/components/messages/ProblemThreads";
import type { MessagesData, MessagesState } from "@/lib/problem-threads";

const firstId = "10000000-0000-4000-8000-000000000001", secondId = "10000000-0000-4000-8000-000000000002";
const jobId = "20000000-0000-4000-8000-000000000001";
export function demoMessages(state: string, second = false, trade = false): MessagesData {
  const current = second ? secondId : firstId;
  return {
    role: trade ? "TRADIE" : "CUSTOMER", viewerId: trade ? "demo-worker" : "demo-customer",
    threads: state === "empty" ? [] : [
      { id: firstId, subject: "Job support", title: "Sub wiring", jobNumber: "TM-1005", preview: "Thanks, we’ll check the photos.", when: "9:14 am", unread: true },
      { id: secondId, subject: "Payment question", title: "Kitchen tap leaking", jobNumber: "TM-1011", preview: "Your payment is confirmed.", when: "Yesterday", unread: false },
    ],
    jobs: [{ id: jobId, number: "TM-1005", title: "Sub wiring" }],
    selected: ["empty", "list", "loading"].includes(state) ? null : {
      id: current, subject: second ? "Payment question" : "Job support", closed: false,
      latestMessageId: "message-2", olderCursor: null, earlier: false,
      job: { id: jobId, number: second ? "TM-1011" : "TM-1005", title: second ? "Kitchen tap leaking" : "Sub wiring", suburb: "Windsor", status: "ASSIGNED", worker: "Jack W" },
      messages: [
        { id: "message-1", author: "Sarah T", office: false, own: !trade, body: "Hi, I need help with this job. I’ve added a photo of the problem.", at: "2026-11-03T20:00:00Z", when: "9:00 am", photos: [{ id: "photo-1", url: "/images/van.png" }], seen: true },
        { id: "message-2", author: "Trade Marketplace", office: true, own: false, body: "Thanks, we’ll check the photos.", at: "2026-11-03T20:14:00Z", when: "9:14 am", photos: [], seen: false },
      ],
      events: [{ id: "event-1", label: "Job booked", at: "2026-11-03T19:55:00Z" }, { id: "event-2", label: "Extra work requested", at: "2026-11-03T20:10:00Z" }],
    },
  };
}
export function ProblemThreadsDemo({ state, second, trade, earlier = false, oldest = false }: { state: string; second: boolean; trade: boolean; earlier?: boolean; oldest?: boolean }) {
  const [data, setData] = useState(() => {
    const result = demoMessages(state, second, trade);
    if (state === "long-thread" && result.selected) {
      const samples = result.selected.messages;
      const offset = earlier ? oldest ? 0 : 50 : 100;
      result.selected.messages = Array.from({ length: 50 }, (_, index) => ({ ...samples[index % 2], id: `long-${index + offset}`, at: new Date(Date.UTC(2026, 10, 3, 20, index + offset)).toISOString(), photos: [] }));
      result.selected.latestMessageId = "long-149"; result.selected.olderCursor = oldest ? null : earlier ? "oldest" : "older"; result.selected.earlier = earlier;
    }
    return result;
  });
  const valid: MessagesState = ["empty", "offline", "error", "loading"].includes(state) ? state as MessagesState : "thread";
  return <ProblemThreads data={data} state={valid} preview
    listHref={`/dev/components/problem-threads?state=list${trade ? "&mode=trade" : ""}`}
    threadHref={id => `/dev/components/problem-threads?state=${state === "long-thread" ? "long-thread" : "thread"}${id === secondId ? "&thread=second" : ""}${trade ? "&mode=trade" : ""}`}
    upload={async (_jobId, file) => { if (file.name.includes("fail")) throw new Error("test upload failure"); return `demo/${file.name}`; }}
    open={async () => ({ ok: true, threadId: firstId })}
    send={async (id, input) => {
      if (state === "error" || input.text.includes("fail")) return { ok: false, error: "unavailable" };
      setData(previous => ({ ...previous, selected: previous.selected ? { ...previous.selected, latestMessageId: input.requestKey, messages: [...previous.selected.messages, { id: input.requestKey, author: "You", own: true, office: false, body: input.text, at: "2026-11-04T01:00:00Z", when: "Now", photos: input.photoPaths.map((_, i) => ({ id: `${input.requestKey}-${i}`, url: "/images/van.png" })), seen: false }] } : null }));
      return { ok: true, threadId: id };
    }} />;
}
