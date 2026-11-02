"use client";

import { Contact } from "@/components/contact/Contact";
import type { ContactResult, ContactState } from "@/lib/contact";

/** Local stand-in for the server action: "fail" in the message fails, "rate" is rate limited, anything else sends. Nothing is emailed. */
export function ContactDemo({ state, signedIn }: { state: ContactState; signedIn: boolean }) {
  return <Contact
    initialState={state}
    initialMessage={state === "empty" ? "" : "Hi, I wanted to ask about…"}
    email={signedIn ? "sarah@email.co.nz" : undefined}
    jobsHref={signedIn ? "/dashboard" : undefined}
    submit={async (form): Promise<ContactResult> => {
      const text = String(form.get("message"));
      if (state === "sending") return new Promise<ContactResult>(() => {});
      if (text.includes("rate")) return { status: "error", retryAfter: 600 };
      if (state === "error" || text.includes("fail")) return { status: "error" };
      return { status: "sent" };
    }} />;
}
