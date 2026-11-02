// Sends a new profile photo from the browser (#112). Browser only. Photos from phones are big, so the picture is
// shrunk to fit AVATAR_EDGE first; a type the browser can't draw (an iPhone HEIC in most browsers) is sent as it is
// and the server converts it, which the upload service already does for every photo.
import { AVATAR_EDGE } from "@/lib/account/profile";
import { checkPhotos } from "@/lib/media";

export type AvatarUpload = (file: File) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;

const FAILED = "We couldn’t save that file. Try again.";

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AVATAR_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file;
  }
}

/** The real upload: POST /api/profile/avatar. Never throws; a message is always something to show. */
export const uploadAvatar: AvatarUpload = async (file) => {
  const problem = checkPhotos([file]).problems[0];
  if (problem) return { ok: false, message: problem };
  try {
    const body = new FormData();
    body.set("photo", await shrink(file), "photo.jpg");
    const response = await fetch("/api/profile/avatar", { method: "POST", body });
    const answer: unknown = await response.json().catch(() => null);
    if (response.ok && answer && typeof answer === "object" && "url" in answer && typeof answer.url === "string") return { ok: true, url: answer.url };
    const message = answer && typeof answer === "object" && "message" in answer && typeof answer.message === "string" ? answer.message : FAILED;
    return { ok: false, message: response.status === 401 || response.status === 403 ? "Log in to save." : message };
  } catch {
    return { ok: false, message: FAILED };
  }
};
