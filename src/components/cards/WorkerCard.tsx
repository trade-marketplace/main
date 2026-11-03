import Link from "next/link";
import { Avatar } from "@/components/media/Avatar";
import { VerifiedBadge, type VerifiedBadgeProps } from "@/components/status/VerifiedBadge";
import styles from "./worker-card.module.css";

export type WorkerCardProps = {
  name: string;
  meta?: string;
  photo?: string | null;
  href?: string;
  verification: VerifiedBadgeProps;
};

/** Public worker tile / booked-worker summary. Pass only public presentation data and a computed badge. */
export function WorkerCard({ name, meta, photo, href, verification }: WorkerCardProps) {
  return <article className={styles.card} aria-label={name}><Avatar name={name} src={photo} decorative /><div className={styles.content}>
    <h3>{href ? <Link href={href}>{name}</Link> : name}</h3>
    {meta && <p>{meta}</p>}
    <VerifiedBadge {...verification} />
  </div></article>;
}
