"use client";
import { JobWindows } from "@/components/jobs/JobWindows";
import type { JobWindowsSnapshot } from "@/lib/job-windows";

export function ConfirmedWindowsDemo({ now }: { now: string }) {
  const initial: JobWindowsSnapshot = { id: "12700000-0000-4000-8000-000000000001", jobNumber: 1005, title: "Sub wiring", editable: true, revision: "preview", schedule: { asap: false, anyTime: true, timeWindows: [] } };
  return <JobWindows initial={initial} initialNow={now} preview="static" backHref="/dev/components/customer-confirmed?state=asked-for-times" save={async (_id, schedule) => ({ status: "saved", snapshot: { ...initial, schedule } })} />;
}
