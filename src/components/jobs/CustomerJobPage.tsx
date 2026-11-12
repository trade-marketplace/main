import "server-only";

import { Suspense } from "react";
import type { CustomerJobView, JobViewer } from "@/server/views";
import { loadCustomerJobPhotos } from "@/server/jobs/customer-page";
import { loadCustomerWorkerCard } from "@/server/jobs/customer-worker-card";
import { getDb } from "@/server/db";
import { firebaseWebConfig } from "@/server/notifications/push-config";
import { CustomerJob, CustomerJobLoading } from "./CustomerJob";
import { PostedJob } from "./PostedJob";

export function CustomerJobPage({ job, viewer, posted, back, canEditWindows }: { job: CustomerJobView; viewer: JobViewer & { emailVerified: boolean }; posted: boolean; back: string; canEditWindows: boolean }) {
  return posted ? <PostedJob job={job} ownerId={viewer.userId} push={viewer.emailVerified ? firebaseWebConfig() : null} /> :
    <Suspense fallback={<CustomerJobLoading />}><CustomerJobPhotos job={job} viewer={viewer} back={back} canEditWindows={canEditWindows} /></Suspense>;
}

async function CustomerJobPhotos({ job, viewer, back, canEditWindows }: { job: CustomerJobView; viewer: JobViewer; back: string; canEditWindows: boolean }) {
  const [photos, workerCard] = await Promise.all([
    loadCustomerJobPhotos(job, viewer),
    // Bind the second read to the worker in this detail response; a concurrent reassignment
    // must not pair one person's signed photo/licence with another person's name and phone.
    (async () => { try { return job.worker ? await loadCustomerWorkerCard(getDb(), viewer, job.id, undefined, undefined, job.worker.id) : null; } catch { return null; } })(),
  ]);
  return <CustomerJob job={job} {...photos} back={back} canEditWindows={canEditWindows} workerCard={workerCard} />;
}
