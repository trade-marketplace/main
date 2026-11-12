import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SupportStart } from "@/components/messages/SupportStart";
import { privateMetadata } from "@/lib/metadata";
import { supportReturn } from "@/lib/support-return";
import { requireUser } from "@/server/auth/guard";
export const metadata: Metadata = { ...privateMetadata, title: "Message us" };
export default async function Page({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo: raw } = await searchParams, returnTo = supportReturn(raw);
  const viewer = await requireUser({ next: raw ? `/support/new?returnTo=${encodeURIComponent(returnTo)}` : "/support/new" });
  if (viewer.role === "ADMIN") redirect("/admin/support");
  return <SupportStart role={viewer.role} returnTo={returnTo} />;
}
