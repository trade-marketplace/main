import type { Metadata } from "next";

import { guardDevPage } from "@/server/dev-pages";

import { NotificationDemo } from "./NotificationDemo";

export const metadata: Metadata = { title: "Notification bell (dev)", robots: { index: false, follow: false } };

export default async function NotificationsPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "unread";
  const role = params.mode === "trade" ? "TRADIE" : "CUSTOMER";
  return <NotificationDemo key={`${state}-${role}`} state={state} role={role} controls={params.controls === "1"} />;
}
