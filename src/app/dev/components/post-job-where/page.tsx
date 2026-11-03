import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { WhereDemo } from "./WhereDemo";
export const metadata: Metadata = { title: "Where and when (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "empty";
  return <WhereDemo key={state} state={state} />;
}
