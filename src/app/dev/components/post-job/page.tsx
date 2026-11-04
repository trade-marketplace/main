import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { PostJobLoading } from "@/components/jobs/PostJobWizard";
import { PostJobDemo } from "./PostJobDemo";
export const metadata: Metadata = { title: "Post a job (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "describe";
  return state === "loading" ? <PostJobLoading /> : <PostJobDemo key={state} state={state} />;
}
