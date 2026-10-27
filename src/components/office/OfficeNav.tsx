"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { NavCount } from "@/components/app/AppNav";
import { countText, fullName, HELP_PATH } from "@/components/app/app-links";
import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Menu, MenuItem, MenuSeparator } from "@/components/overlays/Menu";
import { Wordmark } from "@/components/Wordmark";
import { initials } from "@/lib/cards";
import { useTabIndicator } from "@/lib/motion/hooks";
import { logOutAction } from "@/server/auth/actions";

import type { OfficeShellViewer } from "./OfficeShellView";
import { currentOfficeLink, OFFICE_NAV, officeCountLabel, officeHref, type OfficeCounts, type OfficeNavPreview } from "./office-links";
import styles from "./office.module.css";

type Props = { viewer: OfficeShellViewer; counts: OfficeCounts; preview?: OfficeNavPreview };

function AccountMenu({ viewer, defaultOpen }: { viewer: OfficeShellViewer; defaultOpen?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const name = fullName(viewer.firstName, viewer.lastName);
  return (
    <>
      <Menu
        key={String(defaultOpen)}
        label="Account"
        align="start"
        defaultOpen={defaultOpen}
        className={styles.accountMenu}
        trigger={(props) => (
          <button type="button" {...props} className={styles.accountButton} aria-label={`Account: ${name}`}>
            <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
            <span className={styles.accountLabel}>{viewer.firstName} · Office</span>
          </button>
        )}
        header={<><b className={styles.menuName}>{name}</b><span className={styles.menuEmail}>{viewer.email}</span></>}
      >
        <MenuItem icon="help" href={HELP_PATH}>Help</MenuItem>
        <MenuSeparator />
        <MenuItem icon="logout" tone="danger" onSelect={() => formRef.current?.requestSubmit()}>Log out</MenuItem>
      </Menu>
      <form ref={formRef} action={logOutAction} hidden />
    </>
  );
}

export function OfficeNav({ viewer, counts, preview }: Props) {
  const pathname = usePathname();
  const current = currentOfficeLink(preview?.at ?? pathname);
  const linksRef = useRef<HTMLUListElement>(null);
  useTabIndicator(linksRef, current?.href, '[aria-current="page"]', "y");

  return (
    <>
      <aside className={styles.sidebar} aria-label="Office sidebar">
        <div className={styles.art} aria-hidden="true"><BoltMark variant="hero" className={styles.bolt} /></div>
        <Link href={officeHref(preview, "/admin")} className={styles.logo} aria-label="Trade Marketplace office">
          <Wordmark label={null} className={styles.wordmark} />
        </Link>
        <div className={styles.modeLabel}>Office</div>
        <nav aria-label="Office">
          <ul ref={linksRef} className={styles.links}>
            {OFFICE_NAV.map((link) => {
              const count = link.count ? counts[link.count] : 0;
              return (
                <li key={link.key}>
                  <Link href={officeHref(preview, link.href)} className={styles.link}
                    aria-current={link === current ? "page" : undefined}
                    aria-label={officeCountLabel(link.label, count)}>
                    <Icon name={link.icon} fill={link === current} decorative className={styles.navIcon} />
                    <span className={styles.linkLabel}>{link.label}</span>
                    <NavCount count={count} className={styles.count} />
                  </Link>
                </li>
              );
            })}
            <li aria-hidden="true" className={styles.indicatorHost}>
              <span className={`tm-tab-indicator ${styles.indicator}`} data-tab-indicator data-shown={Boolean(current)} />
            </li>
          </ul>
        </nav>
        <div className={styles.sidebarAccount}><AccountMenu viewer={viewer} defaultOpen={preview?.accountOpen} /></div>
      </aside>
      <header className={styles.mobileHeader}>
        <nav aria-label="Office">
          <Menu key={`${preview?.at ?? pathname}:${preview?.menuOpen}`} label="Office" align="start" defaultOpen={preview?.menuOpen}
            className={styles.mobileMenu}
            trigger={(props) => (
              <Button {...props} variant="tertiary" width="auto" icon="menu" className={styles.menuButton} aria-label="Office menu">
                Office
              </Button>
            )}>
            {OFFICE_NAV.map((link) => {
              const count = link.count ? counts[link.count] : 0;
              return (
                <MenuItem key={link.key} icon={link.icon} href={officeHref(preview, link.href)} aria-current={link === current ? "page" : undefined}>
                  <span className={styles.mobileLink}>
                    <span>{link.label}{countText(count) && <span className={styles.visuallyHidden}>, {countText(count)} waiting</span>}</span>
                    <NavCount count={count} className={styles.count} />
                  </span>
                </MenuItem>
              );
            })}
          </Menu>
        </nav>
        <AccountMenu viewer={viewer} defaultOpen={preview?.accountOpen} />
      </header>
    </>
  );
}
