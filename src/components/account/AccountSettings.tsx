"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import type { AppRole } from "@/components/app/app-links";

import styles from "./account.module.css";

export function AccountSettings({ role, children, active = "/profile/security" }: { role: AppRole; children: ReactNode; active?: string }) {
  const links = [
    ["Profile", "/profile", "person"],
    ["Security", "/profile/security", "lock"],
    ["Notifications", "/profile/notifications", "notifications"],
    ...(role === "CUSTOMER" ? [["Addresses", "/profile/addresses", "home"], ["Payments", "/profile/payments", "credit_card"]] : [["Trades & licences", "/profile/trades", "verified"], ["Work area", "/profile/area", "near_me"], ["Bank & tax", "/profile/payroll", "account_balance"]]),
    ["Delete account", "/profile/delete", "delete"],
  ];
  return <div className={styles.page}>
    <div className={styles.layout}>
      <details className={styles.mobileNav} onClick={event => {
        if (!(event.target as HTMLElement).closest("a")) return;
        event.currentTarget.open = false;
        if (event.detail === 0) event.currentTarget.querySelector("summary")?.focus();
      }}>
        <summary>Account settings <Icon name="expand_more" size="sm" decorative /></summary>
        <nav aria-label="Account settings" className={styles.nav}>
          {links.map(([label, href, icon]) => <Link href={href} key={href} aria-current={href === active ? "page" : undefined}>
            <Icon name={icon} size="sm" decorative />{label}
          </Link>)}
        </nav>
      </details>
      <nav aria-label="Account settings" className={`${styles.nav} ${styles.desktopNav}`}>
        {links.map(([label, href, icon]) => <Link href={href} key={href} aria-current={href === active ? "page" : undefined}>
          <Icon name={icon} size="sm" decorative />{label}
        </Link>)}
      </nav>
      <div className={`${styles.content} tm-anim-rise`}>{children}</div>
    </div>
  </div>;
}
