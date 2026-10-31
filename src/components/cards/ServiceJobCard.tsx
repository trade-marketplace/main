import Link from "next/link";
import type { CSSProperties } from "react";

import { Icon } from "@/components/Icon";
import { CATEGORY_INFO, type Category } from "@/lib/cards";
import type { ServiceJob } from "@/lib/services";

import styles from "./cards.module.css";

/** A04 popular-job card: one stretched link, category tint and M03 hover lift. */
export function ServiceJobCard({ job, category, href, onClick }: { job: ServiceJob; category: Category; href: string; onClick?: React.MouseEventHandler<HTMLAnchorElement> }) {
  return <article className={`${styles.serviceJob} tm-lift`} style={{ "--service-tint": CATEGORY_INFO[category].tint } as CSSProperties}>
    <span className={styles.serviceIcon}><Icon name={job.icon} decorative /></span>
    <h3><Link className={styles.stretched} href={href} onClick={onClick}>{job.name}</Link></h3>
    <p>Post it → get your price</p>
  </article>;
}
