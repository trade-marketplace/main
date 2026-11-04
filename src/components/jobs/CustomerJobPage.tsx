import "server-only";

import { Suspense } from "react";
import type { CustomerJobView, JobViewer } from "@/server/views";
import { loadCustomerJobPhotos } from "@/server/jobs/customer-page";
import { firebaseWebConfig } from "@/server/notifications/push-config";
import { CustomerJob, CustomerJobLoading } from "./CustomerJob";
import { PostedJob } from "./PostedJob";

export function CustomerJobPage({ job, viewer, posted, back, canEditWindows }: { job: CustomerJobView; viewer: JobViewer & { emailVerified: boolean }; posted: boolean; back: string; canEditWindows: boolean }) {
  return posted ? <PostedJob job={job} ownerId={viewer.userId} push={viewer.emailVerified ? firebaseWebConfig() : null} /> :
    <Suspense fallback={<CustomerJobLoading />}><CustomerJobPhotos job={job} viewer={viewer} back={back} canEditWindows={canEditWindows} /></Suspense>;
}

async function CustomerJobPhotos({ job, viewer, back, canEditWindows }: { job: CustomerJobView; viewer: JobViewer; back: string; canEditWindows: boolean }) {
  const photos = await loadCustomerJobPhotos(job, viewer);
  return <CustomerJob job={job} {...photos} back={back} canEditWindows={canEditWindows} />;
}
