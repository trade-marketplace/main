import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { guardDevPage } from "@/server/dev-pages";
import { tradiesQuery } from "@/lib/office-tradies";
import { OfficeTradiesDemo } from "./OfficeTradiesDemo";
export const metadata: Metadata = { title: "Tradie checks (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const raw = await searchParams, state = typeof raw.state === "string" ? raw.state : "default", query = tradiesQuery({ ...raw, ...(["paused", "unpause"].includes(state) ? { tab: "paused" } : state === "verified" ? { tab: "verified" } : {}) });
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@example.test" }} testMode preview={{ at: "/admin/tradies", base: "/dev/components/office-tradies" }}><OfficeTradiesDemo key={state} query={query} state={state} autoSelect={raw.selected === undefined} /></OfficeShellView>;
}
