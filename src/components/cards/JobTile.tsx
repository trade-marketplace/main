"use client";
// The photo job tile (#76): components.css .tm-tile, the tradie's job board (screens.html tr-home, tr-all; pages.html
// w-t-board). The photo fills the tile under a dark fade; the distance, suburb and title sit on it in white
// Display type; a tag in the corner says what kind of job it is; Save is a bookmark in the other corner.
//
//   <JobTile href={`/jobs/${job.id}`} title="Sub wiring" photo={job.thumbUrl} meta="4 km · Windsor"
//     tag={{ kind: "earn", text: "Earn $259" }} saved={saved} onSavedChange={setSaved} />
//
// The whole tile opens the job (one link: the title, stretched over the tile). Save is the only other control.
// Hover: M03, the tile rises and the photo zooms. Saving: M23, the bookmark fills and pops once.
// Tradies see what they earn, never the customer's price (AGENTS.md); the tag text comes from the server.
import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import { BoltMark } from "@/components/BoltMark";
import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useBump } from "@/lib/motion/hooks";

import styles from "./cards.module.css";

export type JobTileTag =
  /** What the tradie earns: "Earn $259" (the signature colour). */
  | { kind: "earn"; text: string }
  /** No price yet: "Needs estimate". */
  | { kind: "estimate"; text?: string }
  /** They've already sent an estimate: "Estimated", with the bolt. */
  | { kind: "estimated"; text?: string }
  /** A quote bounty: "Bounty $30 · 17h". Gold (AGENTS.md: quote bounties are gold). */
  | { kind: "bounty"; text: string };

export type JobTileProps = {
  href: string;
  /** "Sub wiring". Up to two lines on the tile; the whole title is its tooltip and its name. */
  title: string;
  /** The small line above the title: "4 km · Windsor" (tileMeta() with formatKm builds it). */
  meta?: string;
  /** The photo URL. Without one: Forest with the bolt. Decorative (the title says what it is). */
  photo?: string | null;
  tag?: JobTileTag;
  /** Shows the Save bookmark. `onSavedChange` turns it on and off. */
  saved?: boolean;
  onSavedChange?: (saved: boolean) => void;
  /** square (default): the phone's 2-column grid. tall: the desktop board (191 × 220). */
  shape?: "square" | "tall";
  /** The title's heading level, to fit the page's outline. Default 3. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

const TAG_TEXT: Record<JobTileTag["kind"], string> = {
  earn: "",
  estimate: "Needs estimate",
  estimated: "Estimated",
  bounty: "Quote bounty",
};

export function JobTile({ href, title, meta, photo, tag, saved, onSavedChange, shape = "square", headingLevel = 3, className }: JobTileProps) {
  const describedBy = useId();
  const bump = useBump(Boolean(saved), (was, now) => !was && now);
  const saveRef = useRef<HTMLSpanElement>(null);
  const Heading = `h${headingLevel}` as const;
  // M23: the bookmark pops once each time it becomes saved. Restart the animation in place (re-mounting the
  // button would drop keyboard focus).
  useEffect(() => {
    const el = saveRef.current;
    if (!el || bump === 0) return;
    el.classList.remove("tm-anim-save");
    void el.offsetWidth;
    el.classList.add("tm-anim-save");
  }, [bump]);
  const tagText = tag ? tag.text?.trim() || TAG_TEXT[tag.kind] : "";

  return (
    <article className={["tm-lift", styles.tileWrap, className].filter(Boolean).join(" ")}>
      <div className={styles.tile} data-shape={shape}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- job photos come from storage at tile size
          <img className={`tm-zoom__img ${styles.tilePhoto}`} src={photo} alt="" loading="lazy" decoding="async" />
        ) : (
          <BoltMark className={styles.tileBolt} />
        )}
        {tag && (
          <span className={styles.tileTag} data-kind={tag.kind} id={describedBy}>
            {tag.kind === "estimated" && <Icon name="bolt" fill size="sm" decorative className={styles.tagIcon} />}
            {tagText}
          </span>
        )}
        <div className={styles.tileText}>
          {meta && <span className={styles.tileMeta}>{meta}</span>}
          <Heading className={styles.tileHeading}>
            <Link
              href={href}
              className={`${styles.tileTitle} ${styles.stretched}`}
              title={title}
              aria-describedby={tag ? describedBy : undefined}
            >
              {title}
            </Link>
          </Heading>
        </div>
      </div>
      {/* Outside the tile's clipping box, so its focus ring and tooltip show in full. */}
      {onSavedChange && (
        <span ref={saveRef} className={styles.tileSave}>
          <IconButton icon="bookmark" label={`Save ${title}`} pressed={Boolean(saved)} onClick={() => onSavedChange(!saved)} />
        </span>
      )}
    </article>
  );
}
