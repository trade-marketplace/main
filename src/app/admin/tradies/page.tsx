import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfficeTradies } from "@/components/office/OfficeTradies";
import { tradiesHref, tradiesQuery } from "@/lib/office-tradies";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadOfficeTradies, OfficeTradieError } from "@/server/office/tradies";
export const metadata: Metadata = { ...privateMetadata, title: "Tradies" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = tradiesQuery(await searchParams), viewer = await requireRole(["ADMIN"], { next: tradiesHref(query) });
  let data;
  try { data = await loadOfficeTradies(getDb(), viewer, query); }
  catch (error) { if (error instanceof OfficeTradieError && error.code === "not-found") notFound(); return <OfficeTradies data={null} query={query} state="error" />; }
  return <OfficeTradies data={data} query={{ ...query, page: data.page }} />;
}
