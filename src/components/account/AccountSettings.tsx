"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import type { AppRole } from "@/components/app/app-links";
import { boardSettingsRoute } from "@/lib/job-board";

import styles from "./account.module.css";

export function AccountSettings({ role, children, active = "/profile/security", next, pendingReturn }: { role: AppRole; children: ReactNode; active?: string; next?: string | null; pendingReturn?: boolean }) {
  const preview = usePathname()?.startsWith("/dev/") === true;
  const links = [
    ["Profile", "/profile", "person"],
    ["Security", "/profile/security", "lock"],
    ["Notifications", "/profile/notifications", "notifications"],
    ...(role === "CUSTOMER" ? [["Addresses", "/profile/addresses", "home"], ["Payments", "/profile/payments", "credit_card"]] : [["Trades & licences", "/profile/trades", "verified"], ["Work area", "/profile/area", "near_me"], ["Bank & tax", "/profile/payroll", "account_balance"]]),
    ["Delete account", "/profile/delete", "delete"],
  ];
  const returnPages = ["/profile/area", "/profile/trades", "/profile/payroll", "/profile/notifications"];
  // Completed profile routes pass null for no return; their loading boundaries cannot safely build links
  // yet. Existing component previews have no unresolved route query, and opt in only when showing loading.
  const returnPending = role === "TRADIE" && returnPages.includes(active) && (pendingReturn ?? (next === undefined && !preview));
  // Only these destinations consume a board return. Every other account link retains its existing route.
  const destination = (path: string) => role === "TRADIE" && returnPages.includes(path) ? boardSettingsRoute(path, next).href : path;
  return <div className={styles.page}>
    <div className={styles.layout}>
      <details className={styles.mobileNav} inert={returnPending} aria-hidden={returnPending || undefined} onClick={event => {
        if (!(event.target as HTMLElement).closest("a")) return;
        event.currentTarget.open = false;
        if (event.detail === 0) event.currentTarget.querySelector("summary")?.focus();
      }}>
        <summary>Account settings <Icon name="expand_more" size="sm" decorative /></summary>
        <nav aria-label="Account settings" className={styles.nav}>
          {links.map(([label, href, icon]) => <Link href={destination(href)} key={href} aria-current={href === active ? "page" : undefined}>
            <Icon name={icon} size="sm" decorative />{label}
          </Link>)}
        </nav>
      </details>
      <nav aria-label="Account settings" className={`${styles.nav} ${styles.desktopNav}`} inert={returnPending} aria-hidden={returnPending || undefined}>
        {links.map(([label, href, icon]) => <Link href={destination(href)} key={href} aria-current={href === active ? "page" : undefined}>
          <Icon name={icon} size="sm" decorative />{label}
        </Link>)}
      </nav>
      <div className={`${styles.content} tm-anim-rise`}>{children}</div>
    </div>
  </div>;
}
