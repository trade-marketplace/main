// /dev/components/office-job: the office job admin view (#171, F05, pages.html w-o-job) in every state, with a
// pretend server. Flags: ?state=default|unpaid|no-tradie|cancelled|long-text|loading|error
// · ?dialog=reassign|refund|price|status|cancel|message · ?menu=open · ?failure=1 (the dialog shows an error).
// · ?problem=ready|loading|error|offline|photo-error|empty|resolved shows the selected report independently.
// Development only: in a production build this page is a 404. Names, prices and times are examples.
import type { Metadata, Viewport } from "next";

import type { DialogName } from "@/components/office/JobAdmin";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { JOB_ACTIONS } from "@/lib/office-job";
import { guardDevPage } from "@/server/dev-pages";

import { OfficeJobDemo } from "./OfficeJobDemo";
import { isPreviewState, previewJob } from "./preview-data";

export const metadata: Metadata = { title: "Office job admin (dev)", robots: { index: false, follow: false } };
export const viewport: Viewport = { viewportFit: "cover" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function OfficeJobPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const query = await searchParams;
  const stateParam = one(query.state);
  const state = isPreviewState(stateParam) ? stateParam : "default";
  const dialogParam = one(query.dialog);
  const dialog: DialogName | null = dialogParam === "message" ? "message" : (JOB_ACTIONS.find((name) => name === dialogParam) ?? null);
  return (
    <OfficeShellView
      viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }}
      counts={{ queues: 9, tradies: 3, support: 2 }}
      testMode
    >
      <OfficeJobDemo
        job={state === "error" ? null : previewJob(state)}
        loading={state === "loading"}
        dialog={dialog}
        menuOpen={one(query.menu) === "open"}
        failure={one(query.failure) === "1" ? "Couldn’t save that. Nothing was changed. Try again." : null}
        problem={one(query.problem)}
      />
    </OfficeShellView>
  );
}
