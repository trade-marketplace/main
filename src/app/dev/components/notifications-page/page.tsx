import type { Metadata } from "next";

import { notificationsQuery } from "@/lib/notifications";
import { guardDevPage } from "@/server/dev-pages";

import { NotificationsDemo } from "./NotificationsDemo";

export const metadata: Metadata = { title: "Notifications page (dev)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "default";
  const role = params.mode === "trade" ? "TRADIE" : "CUSTOMER";
  const query = notificationsQuery(params);
  return <NotificationsDemo key={`${role}-${state}`} state={state} role={role} query={query} />;
}
