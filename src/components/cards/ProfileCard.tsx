// The profile card (#76): a tradie's public face (screens.html sh-tradie-public on a phone, pages.html
// w-profile-public on a computer). Avatar (photo, or initials on Forest), name, trade and town, what the office has
// checked, and three figures.
//
//   <ProfileCard name="Jack W." meta="Electrician · Invercargill" variant="card"
//     badges={<Pill kind="good">Licence checked</Pill>}
//     stats={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]} />
//
// Public pages show the first name and initial only, no phone, email or exact location (WEBAPP_SPEC A12): pass
// what may be shown. Badge wording must match what the office actually checked ("Licence checked", never
// "Certified"). On a computer (320px wide and up) the avatar and name are bigger.
import type { ReactNode } from "react";

import { initials } from "@/lib/cards";

import styles from "./cards.module.css";
import { StatStrip, type StatStripProps } from "./StatCards";

export type ProfileCardProps = {
  name: string;
  /** "Electrician · Invercargill". */
  meta?: string;
  /** A photo URL. Without one: their initials. Decorative (the name is right under it). */
  photo?: string | null;
  /** Kit pills for what's been checked. */
  badges?: ReactNode;
  stats?: StatStripProps["items"];
  /** card: white with the card shadow (desktop sidebar). plain (default): straight on the page (phone). */
  variant?: "plain" | "card";
  /** The name's heading level. Default 1: the profile is usually the page. */
  headingLevel?: 1 | 2 | 3;
  className?: string;
};

export function ProfileCard({ name, meta, photo, badges, stats, variant = "plain", headingLevel = 1, className }: ProfileCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={[styles.profile, className].filter(Boolean).join(" ")} data-variant={variant} aria-label={name}>
      <span className={styles.avatar} aria-hidden="true">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- profile photos come from storage at avatar size
          <img src={photo} alt="" loading="lazy" decoding="async" />
        ) : (
          initials(name)
        )}
      </span>
      <Heading className={styles.profileName}>{name}</Heading>
      {meta && <p className={styles.profileMeta}>{meta}</p>}
      {badges && <div className={styles.profileBadges}>{badges}</div>}
      {stats && stats.length > 0 && <StatStrip items={stats} />}
    </section>
  );
}
