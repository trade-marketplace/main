import { notFound } from "next/navigation";
import { WorkAreaLoadingPage } from "@/components/account/WorkArea";
import { requireUser } from "@/server/auth/guard";
export default async function Loading() {
  const viewer = await requireUser({ next: "/profile/area" });
  if (viewer.role !== "TRADIE") notFound();
  // Loading boundaries have no searchParams. Keep this temporary navigation inert until
  // the page can supply its validated return destination.
  return <WorkAreaLoadingPage />;
}
