import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestMaintenance } from "./request-state";
import { MaintenancePage } from "./view";

export const metadata: Metadata = { title: "Maintenance", robots: { index: false, follow: false } };

export default async function Page() {
  const { window, phase } = await requestMaintenance();
  if (!window || phase !== "page") notFound();
  return <MaintenancePage window={window} />;
}
