// /dev/components/media: upload, photos, avatars and ratings (#81), live, for checking against components.css
// (.tm-upload, .tm-avatar, .tm-stars), pages.html w-c-post2 and screens.html cus-post-2. Dev only: a 404 in
// production. Names, photos and ratings are examples.
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Avatar, ProgressRing, StarRating } from "@/components/media";
import { guardDevPage } from "@/server/dev-pages";

import { FullDropZoneDemo, GalleryDemo, StarInputDemo, UploadDemo } from "./MediaDemos";
import styles from "./media.module.css";

export const metadata: Metadata = { title: "Upload, photos and avatars (dev)", robots: { index: false, follow: false } };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function MediaPreview() {
  guardDevPage();
  return (
    <main id="main" className={styles.page}>
      <p className={styles.eyebrow}>Dev only · not in production builds</p>
      <h1 className={styles.title}>Upload, photos and avatars</h1>
      <p className={styles.lede}>
        The kit for photos (#81): drop zone, photo picker with upload progress and retry, the photo viewer, avatars and
        star ratings. Uploads here are pretend: pick files and every third one fails, so Retry can be tried.
      </p>

      <Section id="upload" title="Drop zone and photo picker (computer: w-c-post2)">
        <div className={styles.narrow}>
          <UploadDemo layout="computer" />
        </div>
      </Section>

      <Section id="upload-phone" title="Photo picker with Add photo (phone: cus-post-2)">
        <div className={styles.phone}>
          <UploadDemo layout="phone" />
        </div>
      </Section>

      <Section id="states" title="States">
        <div className={styles.row}>
          <figure className={styles.figure}>
            <FullDropZoneDemo />
            <figcaption>Drop zone, full (disabled with the reason)</figcaption>
          </figure>
          <figure className={styles.figure}>
            <div className={styles.rings}>
              <ProgressRing status="uploading" label="kitchen.jpg" />
              <ProgressRing status="uploading" progress={0.3} label="kitchen.jpg" />
              <ProgressRing status="uploading" progress={0.8} label="kitchen.jpg" />
              <ProgressRing status="done" label="kitchen.jpg" />
              <ProgressRing status="failed" label="kitchen.jpg" />
            </div>
            <figcaption>Progress ring (M18): starting, 30%, 80%, done, failed</figcaption>
          </figure>
        </div>
      </Section>

      <Section id="viewer" title="Photo gallery and viewer (click a photo; ← → move, Esc closes)">
        <div className={styles.narrow}>
          <GalleryDemo />
        </div>
      </Section>

      <Section id="avatars" title="Avatars">
        <div className={styles.row}>
          <Avatar name="Jack Wilson" size="sm" />
          <Avatar name="Jack Wilson" />
          <Avatar name="Jack Wilson" size="lg" />
          <Avatar name="Aroha" />
          <Avatar name="Te Rangi-Hēnare Fitzgerald-MacPherson" size="lg" />
          <Avatar name="Sarah Thompson" src="/images/examples/large/outlet.jpg" />
          <Avatar name="Sarah Thompson" src="/images/examples/large/outlet.jpg" size="lg" />
        </div>
      </Section>

      <Section id="stars" title="Star ratings">
        <div className={styles.stack}>
          <StarRating value={4.6} count={32} />
          <StarRating value={3} count={1} />
          <StarRating value={0} count={0} size="sm" />
          <StarInputDemo />
          <StarInputDemo error />
        </div>
      </Section>
    </main>
  );
}
