"use client";
// The app shell's two navs (#84).
//
// AppHeader, from 1024px: web.css .w-appnav (mockups w-c-home, w-t-board). Forest, 68px, sticky. Logo, the
// "Tradie" flag in trade mode, the section links with icons, then "Post a job" (customers), the bell with its
// unread count and the avatar menu. The current link has a bar in the signature colour that slides to the new one
// (M16). Global search (#243) will sit before "Post a job".
//
// BottomNav, under 1024px: components.css .tm-nav (screens.html cus-home, tr-home). Five icons, names for screen
// readers only, 64px plus the phone's safe area. The current one is filled with a 3px action-colour bar on top that
// slides too. A spacer of the same height ends the page, so nothing is ever hidden behind it. Full-screen flows
// (post a job, pay…) hide it.
//
// Counts (M20): the badge pops when the number goes up, never when it goes down. Screen readers hear the count as
// part of the link's name ("Messages, 3 unread"), not the badge.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useRef } from "react";

import { Button, IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { Menu, MenuItem, MenuSeparator } from "@/components/overlays/Menu";
import { initials } from "@/lib/cards";
import { useTabIndicator } from "@/lib/motion/hooks";
import { logOutAction } from "@/server/auth/actions";

import { NotificationBell } from "@/components/notifications/NotificationInbox";

import { NavCount } from "./NavCount";
export { NavCount } from "./NavCount";
export { NotificationBell } from "@/components/notifications/NotificationInbox";

import type { ShellViewer } from "./AppShellView";
import {
  accountMenuItems,
  type AppLink,
  BOTTOM_NAV,
  countLabel,
  countText,
  currentLink,
  fullName,
  isFullScreenFlow,
  linkHref,
  NOTIFICATIONS_PATH,
  POST_JOB_PATH,
  TOP_NAV,
} from "./app-links";
import styles from "./app.module.css";

/**
 * Dev previews: `at` is the page the nav treats as current ("/jobs?view=all"); every nav link goes to `base` with
 * `at` set to where it would have gone, so clicking moves the bar without leaving the preview.
 */
export type NavPreview = { at: string; base: string; menuOpen?: boolean; notificationsOpen?: boolean };

type Location = { pathname: string | null; view: string | null };

function previewLocation(preview: NavPreview): Location {
  const url = new URL(preview.at, "http://preview.invalid");
  return { pathname: url.pathname, view: url.searchParams.get("view") };
}

function previewHref(preview: NavPreview | undefined, href: string): string {
  if (!preview) return href;
  const url = new URL(preview.base, "http://preview.invalid");
  url.searchParams.set("at", href);
  return `${url.pathname}${url.search}`;
}

type NavProps = { viewer: ShellViewer; preview?: NavPreview };

/**
 * Reads where we are. `?view=` needs useSearchParams, which must sit in a Suspense boundary for pages that are
 * built ahead of time; until it's read (never, on the per-request app pages) the path alone decides.
 */
function WithLocation({ preview, render }: { preview?: NavPreview; render: (location: Location) => ReactNode }) {
  if (preview) return render(previewLocation(preview));
  return (
    <Suspense fallback={<PathOnly render={render} />}>
      <PathAndView render={render} />
    </Suspense>
  );
}
function PathOnly({ render }: { render: (location: Location) => ReactNode }) {
  return render({ pathname: usePathname(), view: null });
}
function PathAndView({ render }: { render: (location: Location) => ReactNode }) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  return render({ pathname, view });
}

/** The avatar and its menu: who's signed in, Account, Payments (customers), Notification settings, Help, Log out. */
export function AccountMenu({ viewer, defaultOpen, compact = false }: { viewer: ShellViewer; defaultOpen?: boolean; compact?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const name = fullName(viewer.firstName, viewer.lastName);
  return (
    <>
      <Menu
        label="Account"
        defaultOpen={defaultOpen}
        trigger={(props) => compact ? <IconButton {...props} icon="menu" label={`Account: ${name}`} className={styles.navBtn} /> : (
          <button type="button" {...props} className={styles.avatarBtn} aria-label={`Account: ${name}`}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(name)}
            </span>
          </button>
        )}
        header={
          <>
            <b className={styles.menuName}>{name}</b>
            <span className={styles.menuEmail}>{viewer.email}</span>
          </>
        }
      >
        {accountMenuItems(viewer.role).map((item) => (
          <MenuItem key={item.href} icon={item.icon} href={item.href}>
            {item.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon="logout" tone="danger" onSelect={() => formRef.current?.requestSubmit()}>
          Log out
        </MenuItem>
      </Menu>
      {/* Log out is a POST (CSRF-safe), never a link. */}
      <form ref={formRef} action={logOutAction} hidden />
    </>
  );
}

function TopLinks({ links, current, viewer, preview }: { links: readonly AppLink[]; current: AppLink | null } & NavProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useTabIndicator(listRef, current ? linkHref(current) : null, '[aria-current="page"] [data-tab-target]');
  return (
    <ul ref={listRef} className={styles.topLinks}>
      {links.map((link) => {
        const active = link === current;
        const count = link.count ? viewer.counts[link.count] : 0;
        const countWords = countText(count);
        return (
          <li key={link.label}>
            <Link href={previewHref(preview, linkHref(link))} className={styles.topLink} aria-current={active ? "page" : undefined}>
              <span className={styles.topLinkInner} data-tab-target>
                <Icon name={link.icon} fill={active} decorative className={styles.topIcon} />
                {link.label}
                {countWords && <span className={styles.visuallyHidden}>, {countWords} unread</span>}
                <NavCount count={count} className={styles.inlineCount} />
              </span>
            </Link>
          </li>
        );
      })}
      <li aria-hidden="true" className={styles.indicatorHost}>
        <span className={`tm-tab-indicator ${styles.topIndicator}`} data-tab-indicator data-shown={current ? "true" : "false"} />
      </li>
    </ul>
  );
}

export function AppHeader({ viewer, preview }: NavProps) {
  const links = TOP_NAV[viewer.role];
  const customer = viewer.role === "CUSTOMER";
  return (
    <>
    <header className={styles.header}>
      <Link href={previewHref(preview, "/")} className={styles.logo} aria-label="Trade Marketplace home">
        <Wordmark label={null} className={styles.logoMark} />
      </Link>
      {viewer.role === "TRADIE" && <span className={styles.modeFlag}>Tradie</span>}
      <nav aria-label="Main" className={styles.topNav}>
        <WithLocation
          preview={preview}
          render={({ pathname, view }) => (
            <TopLinks links={links} current={currentLink(links, pathname, view)} viewer={viewer} preview={preview} />
          )}
        />
      </nav>
      <div className={styles.headerEnd}>
        {customer && (
          <Button href={previewHref(preview, POST_JOB_PATH)} size="sm" width="auto" icon="add" className={styles.postJob}>
            Post a job
          </Button>
        )}
        <NotificationBell count={viewer.counts.notifications} allHref={previewHref(preview, NOTIFICATIONS_PATH)} preview={Boolean(preview)} defaultOpen={preview?.notificationsOpen} />
        <AccountMenu viewer={viewer} defaultOpen={preview?.menuOpen} />
      </div>
    </header>
    <WithLocation preview={preview} render={({ pathname }) => isFullScreenFlow(pathname) ? null : (
      <header className={styles.mobileHeader}>
        <AccountMenu viewer={viewer} compact defaultOpen={preview?.menuOpen} />
        <Link href={previewHref(preview, "/")} className={styles.logo} aria-label="Trade Marketplace home"><Wordmark label={null} className={styles.logoMark} /></Link>
        <NotificationBell count={viewer.counts.notifications} allHref={previewHref(preview, NOTIFICATIONS_PATH)} preview={Boolean(preview)} defaultOpen={preview?.notificationsOpen} />
      </header>
    )} />
    </>
  );
}

function BottomLinks({ links, current, viewer, preview }: { links: readonly AppLink[]; current: AppLink | null } & NavProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useTabIndicator(listRef, current ? linkHref(current) : null, '[aria-current="page"] [data-tab-target]');
  return (
    <ul ref={listRef} className={styles.bottomLinks}>
      {links.map((link) => {
        const active = link === current;
        const count = link.count ? viewer.counts[link.count] : 0;
        return (
          <li key={link.label} className={styles.bottomItem}>
            <Link
              href={previewHref(preview, linkHref(link))}
              className={styles.bottomLink}
              aria-current={active ? "page" : undefined}
              aria-label={countLabel(link.label, count)}
            >
              <span className={styles.bottomTarget} data-tab-target />
              <span className={styles.bottomIcon}>
                <Icon name={link.icon} fill={active} decorative />
                <NavCount count={count} className={styles.bottomCount} />
              </span>
            </Link>
          </li>
        );
      })}
      <li aria-hidden="true" className={styles.indicatorHost}>
        <span className={`tm-tab-indicator ${styles.bottomIndicator}`} data-tab-indicator data-shown={current ? "true" : "false"} />
      </li>
    </ul>
  );
}

export function BottomNav({ viewer, preview }: NavProps) {
  const links = BOTTOM_NAV[viewer.role];
  return (
    <WithLocation
      preview={preview}
      render={({ pathname, view }) =>
        isFullScreenFlow(pathname) ? null : (
          <>
            <div className={styles.bottomSpacer} aria-hidden="true" />
            <nav aria-label="Main" className={styles.bottomNav}>
              <BottomLinks links={links} current={currentLink(links, pathname, view)} viewer={viewer} preview={preview} />
            </nav>
          </>
        )
      }
    />
  );
}
