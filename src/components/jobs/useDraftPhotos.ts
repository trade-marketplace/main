"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { loadPhotoDraft, prepareDraftPhoto, savePhotoDraft } from "@/lib/jobs/draft-photo-browser";
import { DraftPhotoManager } from "@/lib/jobs/draft-photo-manager";
import { DraftPhotoUploadError, uploadDraftPhotoFile } from "@/lib/jobs/draft-photo-upload";
import { draftPhotoUrlAction, saveDraftPhotosAction } from "@/server/jobs/actions";

export function useDraftPhotos({ ownerId, postKey, serverPaths, preview, authoritative }: { ownerId: string | null; postKey?: string; serverPaths: readonly string[]; preview?: boolean; authoritative?: boolean }) {
  const session = useOptionalSessionExpired(); const serverPathsRef = useRef(serverPaths);
  useEffect(() => { serverPathsRef.current = serverPaths; });
  const manager = useMemo(() => {
    const check = (result: unknown) => session?.check(result, { resend: () => {
      for (const photo of instance.getSnapshot().photos) if (photo.status === "failed") instance.retry(photo.id);
    } });
    const instance: DraftPhotoManager = new DraftPhotoManager({ ownerId, postKey: postKey ?? "" }, {
      read: preview ? async () => null : loadPhotoDraft,
      write: preview ? async () => {} : savePhotoDraft,
      prepare: prepareDraftPhoto,
      online: () => navigator.onLine,
      createUrl: file => URL.createObjectURL(file), revokeUrl: url => URL.revokeObjectURL(url),
      ...(ownerId && postKey && !preview ? {
        async upload(file: File, signal: AbortSignal, progress: (fraction: number) => void) {
          try { return await uploadDraftPhotoFile(ownerId, postKey, file, signal, progress); }
          catch (error) {
            if (error instanceof DraftPhotoUploadError && error.result.error === "session-expired") check({ ok: false, error: "session-expired", values: {} });
            throw error;
          }
        },
        async preview(path: string) {
          const result = await draftPhotoUrlAction(postKey, path);
          if (check(result) || !("url" in result)) throw new Error("We couldn't save that file. Try again.");
          return result.url;
        },
        async saveServer(paths: string[], expectedPaths: string[]) {
          const result = await saveDraftPhotosAction(ownerId, postKey, paths, expectedPaths);
          if (check(result) || !("status" in result) || result.status !== "saved" && result.status !== "photos-changed") throw new Error("We couldn't save that file. Try again.");
          return result;
        },
      } : {}),
    });
    return instance;
  }, [ownerId, postKey, preview, session]);
  useEffect(() => {
    if (!postKey) return;
    void manager.start(serverPathsRef.current);
    return () => manager.dispose();
  }, [manager, postKey]);
  const serverOrder = JSON.stringify(serverPaths);
  useEffect(() => {
    if (authoritative && postKey && !preview) manager.reconcile(JSON.parse(serverOrder) as string[]);
  }, [manager, postKey, authoritative, preview, serverOrder]);
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  return { manager, state, active: Boolean(postKey) };
}
