import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { officeProblemId, type OfficeProblemReportView } from "@/lib/office-problem";
import { whenLabel } from "@/lib/office-job";
import type { Viewer } from "@/server/auth/viewer";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";

/** The selected report is independent of the job's bounded recent-message window. Authorize before signing. */
export async function loadOfficeProblemReport(db: Pick<PrismaClient, "profile" | "problemReport">, viewer: Pick<Viewer, "userId" | "role">, jobId: string, reportId: string, now = new Date(), signPhoto = (path: string) => createSupabaseFileStore().signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS)): Promise<OfficeProblemReportView | null> {
  if (!officeProblemId(jobId) || !officeProblemId(reportId) || viewer.role !== "ADMIN") return null;
  if ((await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role !== "ADMIN") return null;
  const report = await db.problemReport.findFirst({ where: { id: reportId, jobId }, select: { id: true, topic: true, details: true, urgent: true, status: true, createdAt: true, photos: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, path: true } } } });
  if (!report) return null;
  return { id: report.id, topic: report.topic, details: report.details, urgent: report.urgent, status: report.status, createdAt: report.createdAt.toISOString(), when: whenLabel(report.createdAt, now),
    photos: await Promise.all(report.photos.map(async photo => { try { return { id: photo.id, url: await signPhoto(photo.path) }; } catch { return { id: photo.id, url: null }; } })) };
}
