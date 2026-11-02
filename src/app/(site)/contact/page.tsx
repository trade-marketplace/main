import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { Contact } from "@/components/contact/Contact";
import { headerActions } from "@/components/site/site-links";
import { getViewer } from "@/server/auth/viewer";

import { sendContactMessage } from "./actions";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Trade Marketplace. We reply within one working day.",
  alternates: { canonical: "/contact" },
};

/** Signed-in people get their address filled in and a pointer to their app (the job page). Only those two go to the browser. */
async function signedIn() {
  try {
    const viewer = await getViewer();
    if (!viewer) return {};
    return { email: viewer.email, jobsHref: headerActions({ firstName: viewer.firstName, role: viewer.role }).app?.href };
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

export default async function ContactPage() {
  return <Contact submit={sendContactMessage} {...await signedIn()} />;
}
