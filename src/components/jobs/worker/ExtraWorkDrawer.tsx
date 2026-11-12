"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { TextAreaField, TextField } from "@/components/forms/TextFields";
import { PhotoPicker, type PickedPhoto } from "@/components/media/PhotoPicker";
import { Banner } from "@/components/overlays/Banner";
import { Drawer } from "@/components/overlays/Drawer";
import { checkPhotos } from "@/lib/media";
import { extraErrors, extraRequest, type ExtraWorkState } from "@/lib/worker-extras";
import { beginVariationPhotoUploadAction, finishVariationPhotoUploadAction, requestVariationAction } from "@/server/variations/actions";
import styles from "./extra-work.module.css";

type Request = ReturnType<typeof extraRequest>;
type Result = Awaited<ReturnType<typeof requestVariationAction>>;
type Photo = PickedPhoto & { path?: string; file?: File };
export type ExtraWorkServices = {
  request?: (input: Request) => Promise<Result>;
  upload?: (jobId: string, key: string, file: File, progress: (value: number) => void) => Promise<string>;
};
export async function uploadExtraPhoto(jobId: string, key: string, file: File, progress: (value: number) => void) {
  const stage = await beginVariationPhotoUploadAction(jobId, key, file.size);
  if (!stage.ok) throw Object.assign(Error(stage.error), { result: stage });
  // The server grants this one non-overwriting raw path. No secret key reaches the browser.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("PUT", stage.url); xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total * .9); };
    xhr.onerror = () => reject(Error("upload-failed")); xhr.ontimeout = () => reject(Error("upload-failed")); xhr.timeout = 120_000;
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Error("upload-failed"));
    const body = new FormData(); body.append("cacheControl", "3600"); body.append("", file); xhr.send(body);
  });
  const result = await finishVariationPhotoUploadAction(stage.stageId);
  if (!result.ok) throw Object.assign(Error(result.error), { result });
  progress(1); return result.path;
}
export function ExtraWorkDrawer({ jobId, requestKey, open, onClose, onSent, preview, request = requestVariationAction, upload = uploadExtraPhoto }: {
  jobId: string; requestKey: string; open: boolean; onClose: () => void; onSent: (id: string, input: Request) => void; preview?: ExtraWorkState;
} & ExtraWorkServices) {
  const session = useOptionalSessionExpired(), online = useOnlineStatus(), pending = useRef(false), submitted = useRef<Request | null>(null), urls = useRef(new Set<string>());
  const validExample = preview && !["open", "closed", "empty", "field-errors"].includes(preview);
  const [fields, setFields] = useState({ description: validExample ? "Replace the second cracked switch." : "", hours: validExample ? "0.5" : "" });
  const [photos, setPhotos] = useState<Photo[]>(() => validExample ? [{ id: "example", name: "Extra work photo", src: "/images/examples/switch.jpg", path: "preview-photo", status: preview === "uploading" ? "uploading" : preview === "upload-error" ? "failed" : "done", progress: .45 }] : []);
  const [problems, setProblems] = useState<string[]>([]), [busy, setBusy] = useState(false), [frozen, setFrozen] = useState(false), [error, setError] = useState(preview === "error"), [wait, setWait] = useState(preview === "try-later");
  const [errors, setErrors] = useState<ReturnType<typeof extraErrors>>(() => preview === "field-errors" ? extraErrors({ description: "", hours: "" }, 0) : {});
  const offline = !online || preview === "offline", sending = busy || preview === "sending", locked = sending || frozen;
  const uploading = photos.some(photo => photo.status === "uploading"), failed = photos.some(photo => photo.status === "failed");
  const validation = extraErrors(fields, photos.filter(photo => photo.status === "done" && photo.path).length), invalid = Object.keys(validation).length > 0;
  useEffect(() => { const local = urls.current; return () => { for (const url of local) URL.revokeObjectURL(url); }; }, []);
  async function put(photo: Photo) {
    if (!photo.file || offline || locked) return;
    setWait(false); setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, status: "uploading", progress: 0 } : item));
    try {
      const path = await upload(jobId, requestKey, photo.file, progress => setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, progress } : item)));
      setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, path, status: "done", progress: 1 } : item)); setProblems([]); setErrors(previous => ({ ...previous, photos: undefined }));
    } catch (error) { if (error && typeof error === "object" && "result" in error) { session?.check(error.result); if (error.result && typeof error.result === "object" && "error" in error.result && error.result.error === "photos-pending") setWait(true); } setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, status: "failed" } : item)); setProblems(["Couldn’t upload this photo. Try again."]); }
  }
  function add(files: File[]) {
    if (offline || locked) return;
    // This endpoint accepts JPEG/PNG/HEIC; the generic kit also accepts WebP elsewhere.
    const checked = checkPhotos(files.filter(file => file.type !== "image/webp" && !/\.webp$/i.test(file.name)), { existing: photos.length, max: 6 });
    setProblems([...checked.problems, ...(checked.accepted.length !== files.length && files.some(file => file.type === "image/webp" || /\.webp$/i.test(file.name)) ? ["Use JPG, PNG or HEIC for extra work photos."] : [])]);
    for (const file of checked.accepted) {
      const photo: Photo = { id: crypto.randomUUID(), name: file.name, src: URL.createObjectURL(file), file, status: "uploading" };
      urls.current.add(photo.src); setPhotos(previous => [...previous, photo]); void put(photo);
    }
  }
  async function send() {
    if (pending.current || offline || sending || uploading || failed || invalid) return;
    const checked = extraErrors(fields, photos.filter(photo => photo.path).length); setErrors(checked); if (Object.keys(checked).length) return;
    pending.current = true; setBusy(true); setFrozen(true); setError(false); setWait(false);
    const input = submitted.current ?? extraRequest(jobId, requestKey, fields, photos.map(photo => photo.path!)); submitted.current = input;
    try {
      const result = await request(input);
      if (session?.check(result)) return;
      if (result.ok) { onSent(result.variationId, input); return; }
      if (result.error === "photos-pending") setWait(true); else setError(true);
      // A structured refusal confirms no successful row was returned. Keep the payload for a safe retry.
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  function retry() { const failedPhotos = photos.filter(photo => photo.status === "failed" && photo.file); if (failedPhotos.length) for (const photo of failedPhotos) void put(photo); else void send(); }
  return <Drawer open={open} onClose={onClose} title="Extra work" className={styles.drawer} dismissible={!sending}
    description="Found something more? Send it for pricing. The customer says yes before you start it."
    footer={<><Button variant="secondary" disabled={sending} onClick={onClose}>Cancel</Button><Button onClick={() => void send()} loading={sending} disabled={offline || sending || uploading || failed ? true : invalid ? Object.values(validation)[0] : false}>Send for pricing</Button></>}>
    <div className={styles.fields}><OfflineBanner online={offline ? false : undefined} sticky={false} />
      {error && <Banner tone="alert" live action={<Button variant="tertiary" onClick={retry} disabled={offline || sending}>Try again</Button>}>Couldn’t send the extra work. Try again.</Banner>}
      {wait && <Banner tone="alert" live action={<Button variant="tertiary" onClick={retry} disabled={offline || sending}>Try again</Button>}>Try again later.</Banner>}
      <TextAreaField label="What needs doing?" required value={fields.description} maxLength={2000} error={errors.description} disabled={locked} onBlur={() => setErrors(previous => ({ ...previous, description: validation.description }))} onChange={event => { setFields(previous => ({ ...previous, description: event.target.value })); setErrors(previous => ({ ...previous, description: undefined })); }} />
      <fieldset className={styles.photos} disabled={offline || locked}><legend>Photos (required)</legend><PhotoPicker photos={photos} max={6} accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" problems={[...problems, ...(errors.photos ? [errors.photos] : [])]} onAdd={add} onRemove={id => { if (!offline && !locked) setPhotos(previous => previous.filter(item => item.id !== id)); }} onRetry={id => { const photo = photos.find(item => item.id === id); if (photo?.file) void put(photo); else if (preview) setPhotos(previous => previous.map(item => item.id === id ? { ...item, status: "done" } : item)); }} retryDisabled={offline || locked} /></fieldset>
      <TextField label="Extra hours" type="number" min="0" max="100" step="0.25" required value={fields.hours} error={errors.hours} disabled={locked} onBlur={() => setErrors(previous => ({ ...previous, hours: validation.hours }))} onChange={event => { setFields(previous => ({ ...previous, hours: event.target.value })); setErrors(previous => ({ ...previous, hours: undefined })); }} />
    </div>
  </Drawer>;
}
