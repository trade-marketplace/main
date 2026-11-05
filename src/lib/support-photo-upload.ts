export async function uploadSupportPhotoClient(jobId: string, file: File) {
  // Vercel's function request limit is 4.5 MB, including multipart framing. Keep margin and resize common
  // camera pictures before sending; #96 still validates and re-encodes every byte on the server.
  if (file.size > 4 * 1024 * 1024 && ["image/jpeg", "image/png"].includes(file.type)) {
    try {
      const image = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (blob) file = new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    } catch { throw new Error("photo-too-large"); }
  }
  if (file.size > 4 * 1024 * 1024) throw new Error("photo-too-large");
  const form = new FormData(); form.set("jobId", jobId); form.set("photo", file);
  const response = await fetch("/api/messages/photos", { method: "POST", body: form });
  if (response.status === 413) throw new Error("photo-too-large");
  if (!response.ok) throw new Error("upload-failed");
  const result = await response.json();
  if (typeof result.path !== "string") throw new Error("upload-failed");
  return result.path;
}
