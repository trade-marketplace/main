import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PublicEditorLoading } from "@/components/account/PublicProfileEditor";
import { requireUser } from "@/server/auth/guard";

export default async function Loading() {
  const viewer = await requireUser({ next: "/profile/public" });
  if (viewer.role !== "TRADIE") notFound();
  return <AccountSettings role="TRADIE" active="/profile/public"><PublicEditorLoading /></AccountSettings>;
}
