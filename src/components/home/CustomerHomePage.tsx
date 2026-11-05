import { CustomerHome } from "@/components/home/CustomerHome";
import type { Viewer } from "@/server/auth/viewer";
import { loadCustomerHome } from "@/server/customer-home";
import { getDb } from "@/server/db";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { unstable_rethrow } from "next/navigation";
import type { CustomerHomeData } from "@/lib/customer-home";

export async function CustomerHomePage({ viewer }: { viewer: Viewer }) {
  let data: CustomerHomeData | null = null;
  try {
    data = await loadCustomerHome(getDb(), viewer, await loadCoverage());
  } catch (error) {
    unstable_rethrow(error);
    console.error("Customer home could not load jobs.");
  }
  return <CustomerHome result={data ? { ok: true, data } : { ok: false }} />;
}
