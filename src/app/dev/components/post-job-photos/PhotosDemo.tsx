"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { DraftPhotos } from "@/components/jobs/DraftPhotos";
import { WizardFrame } from "@/components/jobs/PostJobWizard";
import { ToastProvider } from "@/components/overlays/Toast";
import { checkPhotos } from "@/lib/media";
import type { DraftPhoto } from "@/lib/jobs/draft-photo-manager";
import { initialWizardDraft } from "@/lib/post-job-wizard";
import styles from "@/components/jobs/post-job.module.css";

const examples = ["wires", "outlet", "switch", "board", "pipes", "furniture"];
function sample(count: number): DraftPhoto[] { return examples.slice(0, count).map((name, index) => ({ id: `sample-${name}`, name: `${name}.jpg`, src: `/images/examples/${name}.jpg`, status: "done", prepared: true, generation: index })); }
export function PhotosDemo({ state }: { state: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState(() => {
    const photos = sample(["empty", "picking", "loading"].includes(state) ? 0 : state === "full" ? 6 : state === "uploading" ? 4 : state === "failed" ? 3 : state === "removed" ? 1 : 2);
    if (state === "uploading") { photos[1] = { ...photos[1], status: "uploading", progress: 0.3 }; photos[2] = { ...photos[2], status: "uploading", progress: 0.75 }; }
    if (state === "failed") photos[2] = { ...photos[2], status: "failed" };
    if (state === "heic") photos[0] = { ...photos[0], src: "", name: "IMG_1001.HEIC" };
    if (state === "conflict") return [...sample(6).map((photo, index) => ({ ...photo, path: `preview-saved-${index}` })), ...sample(6).map((photo, index) => ({ ...photo, id: `pending-${index}`, name: `camera-${index + 1}.jpg`, status: "failed" as const }))];
    return photos;
  });
  const [problems, setProblems] = useState(() => state === "invalid" ? checkPhotos([
    { name: "big.jpg", type: "image/jpeg", size: 12 * 1024 * 1024 }, { name: "notes.pdf", type: "application/pdf", size: 100 }, { name: "extra.jpg", type: "image/jpeg", size: 100 },
  ], { existing: 6 }).problems : state === "conflict" ? checkPhotos(Array.from({ length: 6 }, (_, index) => ({ name: `camera-${index + 1}.jpg`, type: "image/jpeg", size: 100 })), { existing: 6 }).problems : []);
  const [storageError, setStorageError] = useState(state === "save-error");
  const [atWhere, setAtWhere] = useState(state === "where-when");
  const urls = useRef<string[]>([]); const removed = useRef<DraftPhoto | undefined>(undefined);
  useEffect(() => { const current = urls.current; return () => current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const draft = initialWizardDraft({ description: "Lights in the lounge keep flickering and the switch is getting warm.", category: "ELECTRICAL" }, true);
  return <ToastProvider initial={state === "removed" ? { message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => setPhotos(sample(2)) } } : undefined}>
    <WizardFrame step={atWhere ? 2 : 1} saved={state !== "loading" && photos.every(photo => photo.status === "done") && !storageError} summary={draft} photoPreviews={photos} backHref="/dev/components/post-job?state=describe"
      stepHrefs={["/dev/components/post-job?state=describe", "/dev/components/post-job-photos?state=empty"]} saveExit={() => router.push("/")}>
      <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
      <h1 className={styles.title}>{atWhere ? "Where & when" : "Add some photos"}</h1>
      {atWhere ? <Button variant="secondary" onClick={() => setAtWhere(false)}>Back</Button> : <DraftPhotos category="ELECTRICAL" offline={state === "offline"} busy={false} backHref="/dev/components/post-job?state=describe" dragOver={state === "drag-over"}
        state={{ photos, problems, restoring: state === "loading", saving: false, storageError }} onNext={() => setAtWhere(true)} controls={{
          add(files) { const checked = checkPhotos(files, { existing: photos.length }); setProblems(checked.problems); setPhotos(old => [...old, ...checked.accepted.map(file => { const src = URL.createObjectURL(file); urls.current.push(src); return { id: crypto.randomUUID(), name: file.name, file, src, prepared: false, generation: 0, status: "done" as const }; })]); },
          retry(id) { setPhotos(old => old.map(photo => photo.id === id ? { ...photo, status: "done" } : photo)); },
          remove(id) { removed.current = photos.find(photo => photo.id === id); setPhotos(old => old.filter(photo => photo.id !== id)); return true; },
          undo() { if (removed.current) { const photo = removed.current; setPhotos(old => [...old, photo]); removed.current = undefined; } },
          move(id, position) { setPhotos(old => { const next = [...old]; const index = next.findIndex(photo => photo.id === id); const [photo] = next.splice(index, 1); next.splice(position, 0, photo); return next; }); },
          async retryPersistence() { setStorageError(false); },
        }} />}
    </WizardFrame>
  </ToastProvider>;
}
