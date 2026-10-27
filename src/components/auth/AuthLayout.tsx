// The split layout for log-in and sign-up (#102): pages.html w-login, screens.html pub-login.
// From 1024px: a Forest brand panel on the left (logo, the illustration, the bolt, a line) and the form centred in
// the right half, max 440px. Under 1024px: a Forest band at the top with a back arrow, the bolt and the
// illustration, then the form. No site header: the person is on their way in.
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";

import styles from "./auth.module.css";

const ART = { phone: "/images/auth/phone.png", mail: "/images/auth/mail.png" } as const;

export type AuthLayoutProps = {
  /** The page's h1: "Welcome back". */
  title: ReactNode;
  /** A line under the title: "What brings you here?". */
  lede?: ReactNode;
  /** Keep the title on one line on a computer (sign-up); log-in's breaks after the first word. */
  wideTitle?: boolean;
  /** The 3D illustration: the phone (log in) or the envelope (sign up). */
  art?: keyof typeof ART;
  /** Top right on a computer: "New here? Sign up". */
  aside?: ReactNode;
  children: ReactNode;
};

export function AuthLayout({ title, lede, art = "phone", wideTitle, aside, children }: AuthLayoutProps) {
  return (
    <div className={styles.layout}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.brand}>
        <BoltMark variant="hero" className={styles.brandBolt} />
        <Link href="/" className={styles.back} aria-label="Back to home">
          <Icon name="arrow_back" decorative />
        </Link>
        <Link href="/" className={styles.logo} aria-label="Trade Marketplace home">
          <Wordmark label={null} className={styles.wordmark} />
        </Link>
        <BoltMark className={styles.mark} />
        <Image src={ART[art]} alt="" width={500} height={500} priority className={styles.art} sizes="(min-width: 1024px) 320px, 220px" />
        <div className={styles.line}>
          <p className={styles.lineTitle}>
            Sorted in
            <br />a flash.
          </p>
          <p className={styles.lineText}>Post any job free. Accept the price. Someone local sorts it.</p>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {aside && <p className={styles.aside}>{aside}</p>}
        <div className={styles.panel}>
          <h1 className={styles.title} data-wide={wideTitle || undefined}>
            {title}
          </h1>
          {lede && <p className={styles.lede}>{lede}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
