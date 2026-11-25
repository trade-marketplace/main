import { notificationsQuery } from "@/lib/notifications";
import { guardDevPage } from "@/server/dev-pages";
import { OfficeInboxPreview } from "./preview";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "ready";
  return <OfficeInboxPreview key={state} state={state} query={notificationsQuery(params)} />;
}
