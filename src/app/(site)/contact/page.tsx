import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { Contact } from "@/components/contact/Contact";
import { headerActions } from "@/components/site/site-links";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { problemContactHref } from "@/server/messages/contact";
import { boardReturn } from "@/lib/job-board";

import { sendContactMessage } from "./actions";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Trade Marketplace. We reply within one working day.",
  alternates: { canonical: "/contact" },
};

/** Signed-in people get their address filled in and a pointer to their app (the job page). Only those two go to the browser. */
async function signedIn(jobId?: string) {
  try {
    const viewer = await getViewer();
    if (!viewer) return {};
    if (viewer.role === "ADMIN") return { email: viewer.email, jobsHref: headerActions({ firstName: viewer.firstName, role: viewer.role }).app?.href };
    let jobsHref = "/messages";
    if (process.env.DATABASE_URL?.trim()) {
      try { jobsHref = await problemContactHref(getDb(), viewer, jobId); }
      catch { /* Keep the signed-in address and the protected Messages destination during a data outage. */ }
    }
    return { email: viewer.email, jobsHref };
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

export default async function ContactPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  return <Contact submit={sendContactMessage} boardReturnHref={next?.startsWith("/jobs") ? boardReturn(next) : undefined} {...await signedIn(typeof params.job === "string" ? params.job : undefined)} />;
}
