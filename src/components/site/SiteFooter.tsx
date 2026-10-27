// The public site footer (#83): mockup w-landing in docs/design/pages.html (.w-footer). Forest, the wordmark and
// pitch, then the link columns from site-links.ts, then the copyright line. The big bolt sits behind it at 20%.
import Link from "next/link";

import { BoltMark } from "@/components/BoltMark";
import { Wordmark } from "@/components/Wordmark";

import { FOOTER_COLUMNS, FOOTER_PITCH } from "./site-links";
import styles from "./site.module.css";

export function SiteFooter({ year = new Date().getFullYear() }: { year?: number }) {
  return (
    <footer className={styles.footer}>
      <BoltMark variant="hero" className={styles.footerBolt} />
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Wordmark className={styles.footerMark} />
          <p className={styles.footerPitch}>{FOOTER_PITCH}</p>
        </div>
        <nav aria-label="Footer" className={styles.footerNav}>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className={styles.footerTitle}>
                {column.title}
              </h2>
              <ul className={styles.footerList}>
                {column.links.map((link) => (
                  <li key={`${link.label}-${link.href}`}>
                    <Link href={link.href} className={styles.footerLink}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className={styles.footerBase}>{`© ${year} Trade Marketplace · Made in New Zealand`}</p>
    </footer>
  );
}
