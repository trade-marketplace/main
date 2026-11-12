import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { SIGNOFF_STATES, type SignoffState } from "@/lib/office/signoff";
import { guardDevPage } from "@/server/dev-pages";
import { Gallery, Preview } from "./Preview";
export const metadata: Metadata = { title: "Office sign-off (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string; sent?: string }> }) {
  guardDevPage();
  const query = await searchParams;
  const state = SIGNOFF_STATES.includes(query.state as SignoffState) ? query.state as SignoffState : "list";
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ queues: 2, tradies: 0, support: 0 }} testMode preview={{ at: "/admin/signoff", base: "/dev/components/office-signoff" }}>{query.state === "gallery" ? <Gallery /> : <Preview state={state} sent={query.sent === "1"} />}</OfficeShellView>;
}
