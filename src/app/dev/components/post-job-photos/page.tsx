import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { PhotosDemo } from "./PhotosDemo";
export const metadata: Metadata = { title: "Post a job photos (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "empty";
  return <PhotosDemo key={state} state={state} />;
}
