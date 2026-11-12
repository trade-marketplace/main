import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { SignoffList } from "@/components/office/SignoffList";
import type { SignoffListData } from "@/lib/office/signoff";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadSignoffList } from "@/server/office/signoff";
export const metadata: Metadata = { title: "Sign-off / CoC review" };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; sent?: string }> }) {
  const viewer = await requireRole(["ADMIN"], { next: "/admin/signoff" }), query = await searchParams;
  let data: SignoffListData | null = null;
  try { data = await loadSignoffList(getDb(), viewer, query.page); if (!data) notFound(); }
  catch (error) { unstable_rethrow(error); }
  return <SignoffList data={data} toast={query.sent ? `Sent back to ${query.sent.slice(0, 160)}.` : undefined} />;
}
