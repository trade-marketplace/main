import { uploadSignedPhoto } from "./draft-photo-browser";

export class DraftPhotoUploadError extends Error {
  constructor(readonly result: { error?: string; message?: string; retryAfter?: number }) { super(result.message ?? "We couldn't save that file. Try again."); }
}

export async function uploadDraftPhotoFile(ownerId: string, postKey: string, file: File, signal: AbortSignal, progress: (fraction: number) => void): Promise<string> {
  const request = async (input: Record<string, unknown>, abortable = true) => {
    const response = await fetch("/api/jobs/draft-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId, postKey, ...input }), signal: abortable ? signal : undefined });
    const result = await response.json();
    if (!response.ok) throw new DraftPhotoUploadError(result);
    return result;
  };
  const stage = await request({ operation: "begin", size: file.size });
  try {
    await uploadSignedPhoto(stage.url, file, signal, amount => progress(amount * 0.9));
    const finalized = await request({ operation: "finalize", path: stage.path });
    progress(1); return finalized.path;
  } catch (error) {
    // An abandoned, unclaimed grant needn't hold a pending slot. Its raw record still survives token expiry.
    void request({ operation: "cancel", path: stage.path }, false).catch(() => {});
    throw error;
  }
}
