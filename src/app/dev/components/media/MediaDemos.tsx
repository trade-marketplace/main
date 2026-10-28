"use client";
// The live demos on /dev/components/media (#81). Uploads are pretend: picked files get a preview straight away and
// "upload" over a couple of seconds; every third one fails so Retry can be tried. Dev only.
import { useEffect, useRef, useState } from "react";

import { DropZone, PhotoGallery, PhotoPicker, type PickedPhoto, StarInput } from "@/components/media";
import { ToastProvider, useToast } from "@/components/overlays";
import { checkPhotos, PHOTO_HINT } from "@/lib/media";

const EXAMPLES: PickedPhoto[] = [
  { id: "a", src: "/images/examples/large/wires.jpg", name: "wires.jpg", status: "done" },
  { id: "b", src: "/images/examples/large/outlet.jpg", name: "outlet.jpg", status: "done" },
  { id: "c", src: "/images/examples/large/board.jpg", name: "switchboard.jpg", status: "uploading", progress: 0.45 },
  { id: "d", src: "/images/examples/large/switch.jpg", name: "switch.jpg", status: "failed" },
];

export const GALLERY = [
  { src: "/images/examples/large/wires.jpg", alt: "Old wiring behind the switchboard" },
  { src: "/images/examples/large/outlet.jpg", alt: "Scorched power point" },
  { src: "/images/examples/large/board.jpg", alt: "The switchboard" },
  { src: "/images/examples/large/switch.jpg", alt: "Light switch with the cover off" },
];

function usePretendUploads(initial: PickedPhoto[]) {
  const [photos, setPhotos] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const timers = useRef(new Map<string, number>());
  const added = useRef(0);
  const toast = useToast();

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => window.clearInterval(t));
  }, []);

  function upload(id: string, fail: boolean) {
    let progress = 0;
    const timer = window.setInterval(() => {
      progress += 0.2;
      if (fail && progress >= 0.6) {
        window.clearInterval(timer);
        setPhotos((list) => list.map((p) => (p.id === id ? { ...p, status: "failed", progress: undefined } : p)));
        return;
      }
      if (progress >= 1) {
        window.clearInterval(timer);
        setPhotos((list) => list.map((p) => (p.id === id ? { ...p, status: "done", progress: undefined } : p)));
        return;
      }
      setPhotos((list) => list.map((p) => (p.id === id ? { ...p, progress } : p)));
    }, 400);
    timers.current.set(id, timer);
  }

  return {
    photos,
    problems,
    add(files: File[]) {
      const { accepted, problems: found } = checkPhotos(files, { existing: photos.length });
      setProblems(found);
      const fresh = accepted.map((file) => {
        added.current += 1;
        return { id: `new-${added.current}`, src: URL.createObjectURL(file), name: file.name, status: "uploading" as const, progress: 0 };
      });
      setPhotos((list) => [...list, ...fresh]);
      fresh.forEach((photo, i) => upload(photo.id, (added.current - fresh.length + i + 1) % 3 === 0));
    },
    remove(id: string) {
      const index = photos.findIndex((p) => p.id === id);
      const photo = photos[index];
      if (!photo) return;
      setPhotos((list) => list.filter((p) => p.id !== id));
      toast.show({
        message: "Photo removed.",
        icon: "delete",
        action: { label: "Undo", onAction: () => setPhotos((list) => [...list.slice(0, index), photo, ...list.slice(index)]) },
      });
    },
    retry(id: string) {
      setPhotos((list) => list.map((p) => (p.id === id ? { ...p, status: "uploading", progress: 0 } : p)));
      upload(id, false);
    },
  };
}

function Uploader({ layout }: { layout: "computer" | "phone" }) {
  const picker = usePretendUploads(EXAMPLES);
  return (
    <>
      {layout === "computer" && <DropZone onFiles={picker.add} hint={PHOTO_HINT} disabled={picker.photos.length >= 6 ? "Remove a photo." : undefined} />}
      <PhotoPicker
        photos={picker.photos}
        onAdd={picker.add}
        onRemove={picker.remove}
        onRetry={picker.retry}
        problems={picker.problems}
        addTile={layout === "phone"}
        label={layout === "computer" ? "Your photos" : "Your photos (phone layout)"}
      />
    </>
  );
}

export function UploadDemo({ layout }: { layout: "computer" | "phone" }) {
  return (
    <ToastProvider>
      <Uploader layout={layout} />
    </ToastProvider>
  );
}

export function GalleryDemo() {
  return <PhotoGallery photos={GALLERY} label="Photos of Sub wiring" />;
}

export function StarInputDemo({ error }: { error?: boolean }) {
  const [value, setValue] = useState<number | null>(error ? null : 4);
  return (
    <StarInput
      name={error ? "stars-error" : "stars"}
      value={value}
      onChange={setValue}
      label="How did Jack do?"
      error={error && value === null ? "Choose how many stars." : undefined}
    />
  );
}

/** The drop zone when it's full (a pretend handler: it can't take files). */
export function FullDropZoneDemo() {
  return <DropZone onFiles={() => {}} hint="JPG, PNG, HEIC up to 10 MB" disabled="Remove a photo." />;
}
