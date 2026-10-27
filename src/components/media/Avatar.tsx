// The avatar (#81): components.css .tm-avatar. A round photo, or the person's initials in the signature colour on
// Forest when there is no photo. Sizes from the kit: 32, 44 (default) and 72.
//
//   <Avatar name="Jack Wilson" />                       "JW"
//   <Avatar name="Jack Wilson" src={url} size="lg" />   their photo
import { initials } from "@/lib/cards";

import styles from "./media.module.css";

export type AvatarProps = {
  /** The person's name: the initials, and the photo's alt text. */
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  /** Hide it from screen readers when the name is written right next to it. */
  decorative?: boolean;
  className?: string;
};

export function Avatar({ name, src, size = "md", decorative = false, className }: AvatarProps) {
  const classes = [styles.avatar, className].filter(Boolean).join(" ");
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": name };
  if (src) {
    return (
      <span className={classes} data-size={size} {...a11y}>
        {/* eslint-disable-next-line @next/next/no-img-element -- avatars come from storage at their size */}
        <img src={src} alt="" className={styles.avatarImg} loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className={classes} data-size={size} {...a11y}>
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}
