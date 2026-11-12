import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookWindow, BookWindowLoadError } from "@/components/jobs/worker/BookWindow";
import { privateMetadata } from "@/lib/metadata";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { loadBooking } from "@/server/jobs/worker-booking";
export const metadata: Metadata = { ...privateMetadata, title: "Pick a time" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, viewer = await getViewer();
  if (viewer?.role !== "TRADIE") notFound();
  let initial;
  try { initial = await loadBooking(getDb(), viewer, id); }
  catch { return <BookWindowLoadError backHref={`/jobs/${id}`} />; }
  if (!initial) notFound();
  return <BookWindow initial={initial} />;
}
