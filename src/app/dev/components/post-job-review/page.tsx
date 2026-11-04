import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { ReviewDemo } from "./ReviewDemo";
export const metadata: Metadata = { title: "Check and post (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  return <ReviewDemo state={typeof params.state === "string" ? params.state : "ready"} />;
}
