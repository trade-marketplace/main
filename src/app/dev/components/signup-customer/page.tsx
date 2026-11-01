// Isolated, guarded previews of every customer sign-up answer. These never create demo accounts.
import type { Metadata } from "next";

import { CustomerSignup } from "@/components/auth/CustomerSignup";
import type { SignUpState } from "@/server/auth/actions";
import { guardDevPage } from "@/server/dev-pages";

export const metadata: Metadata = { title: "Customer sign up (dev)", robots: { index: false, follow: false } };

const values = { firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test", phone: "021 555 0192", role: "CUSTOMER", terms: "on" };
const STATES: Record<string, SignUpState> = {
  "email-taken": { ok: false, error: "email-taken", values },
  "weak-password": { ok: false, error: "invalid", fieldErrors: { password: "That password is too easy to guess. Try a few unrelated words together." }, values },
  invalid: { ok: false, error: "invalid", fieldErrors: { firstName: "Enter your first name.", email: "Enter a valid email address, like name@example.com.", phone: "Enter a New Zealand mobile number, like 021 555 0192.", terms: "Accept the terms and privacy policy to create an account." }, values: { ...values, firstName: "", lastName: "", email: "sarah@", phone: "", terms: "" } },
  unavailable: { ok: false, error: "unavailable", values },
  "try-later": { ok: false, error: "try-later", values },
  success: { ok: true, status: "check-email", email: "sarah@example.test" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CustomerSignupPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();
  const { state } = await searchParams;
  const key = typeof state === "string" ? state : "";
  return <CustomerSignup initialState={Object.hasOwn(STATES, key) ? STATES[key] : null} previewPending={key === "loading"} previewOffline={key === "offline"} next={key === "draft" ? "/jobs/new?step=review" : undefined} key={key} />;
}
