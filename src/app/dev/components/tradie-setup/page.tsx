import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { SetupBanner, TradieSetupHome } from "@/components/jobs/TradieSetup";
import { BROWSE_JOBS_HREF, SETUP_HOME } from "@/lib/tradie-setup";
import { guardDevPage } from "@/server/dev-pages";
import { BoardPreview } from "../job-board/BoardPreview";
import { previewBoard } from "../job-board/preview-data";
import { previewSetup, SETUP_STATES } from "./preview-data";

export const metadata: Metadata = { title: "Tradie setup checklist (dev)", robots: { index: false, follow: false } };
export default async function TradieSetupPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const requested = (await searchParams).state, state = SETUP_STATES.find(value => value === requested) ?? "pending", result = previewSetup(state);
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: state !== "new", counts: { messages: 0, notifications: 0 } }} testMode
    preview={{ at: state === "board" ? BROWSE_JOBS_HREF : SETUP_HOME, base: `/dev/components/tradie-setup?state=${state}` }}>
    {state === "board" && result.ok
      ? <BoardPreview board={previewBoard("ready")} state="ready" notice={<SetupBanner setup={result.setup} href="/dev/components/tradie-setup?state=pending" live={false} />} />
      : <TradieSetupHome firstName="Jack" result={result} preview={{ loading: state === "loading" }} />}
  </AppShellView>;
}
