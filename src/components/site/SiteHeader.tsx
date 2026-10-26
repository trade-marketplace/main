"use client";
// The public site header (#83): mockup w-landing in docs/design/pages.html (.w-sitenav) and the phone landing in
// screens.html. Logo, How it works / For tradies (Amber) / Help, then Log in + Sign up, or the signed-in visitor's
// app and account. Below 1024px the links move into a menu that drops down under the header.
//
// M06 nav fill: over a page's hero (an element with `data-site-hero`) the header is transparent, and turns solid
// Forest with a shadow once the hero has scrolled up under it (.tm-navfill + useScrolledPast()). Pages without a
// hero get the solid header from the first paint (site.module.css), with no script needed.
//
// It gets the visitor from <SiteShell>, which reads them on the server; nothing here decides who is signed in.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button, IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { useScrolledPast } from "@/lib/motion/hooks";

import { headerActions, isCurrent, SITE_NAV, FOR_TRADIES_PATH, type SiteViewer } from "./site-links";
import styles from "./site.module.css";

/** Where the full nav replaces the menu button (tokens.css breakpoints: lg ≥ 1024). */
export const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

/** Watches the page for its `data-site-hero` element; it changes when the page does (the header stays mounted). */
function subscribeToPage(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
const findHero = () => document.querySelector<HTMLElement>("[data-site-hero]");
/** On the server (and while hydrating) the page hasn't been looked at yet: undefined. */
const notLookedYet = () => undefined;

function useHero() {
  const element = useSyncExternalStore<HTMLElement | null | undefined>(subscribeToPage, findHero, notLookedYet);
  // A new ref object per hero, so useScrolledPast() starts watching the new page's one.
  const heroRef = useMemo(() => ({ current: element ?? null }), [element]);
  return { heroRef, hasHero: element === undefined ? null : element !== null };
}

export function SiteHeader({ viewer }: { viewer: SiteViewer | null }) {
  const pathname = usePathname();
  const actions = headerActions(viewer);
  const headerRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  const { heroRef, hasHero } = useHero();
  const pastHero = useScrolledPast(heroRef, { offset: headerHeight });

  // The header is 64px on phones and 76px from 1024px up (and taller when text is zoomed): measure it, so the
  // fill starts exactly when the hero's bottom edge reaches it.
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Close the menu on a page change, and when the window grows wide enough for the full nav.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    const wide = window.matchMedia(DESKTOP_NAV_QUERY);
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // Opening moves focus to the first link in the menu.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  function close({ returnFocus }: { returnFocus: boolean }) {
    setOpen(false);
    if (returnFocus) headerRef.current?.querySelector<HTMLElement>(`[aria-controls="${panelId}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close({ returnFocus: true });
    }
  }

  // Tabbing (or clicking) out of the header closes the menu, so it never hides the page behind it.
  function onBlur(event: FocusEvent<HTMLElement>) {
    if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }

  // null until the page has been checked: then the CSS decides (solid unless there is a hero), so there's no flash.
  const solid = hasHero === null ? undefined : open || !hasHero || pastHero ? "true" : "false";

  const navLinks = (place: "bar" | "menu") =>
    SITE_NAV.map((link) => (
      <li key={link.href}>
        <Link
          href={link.href}
          aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
          className={[place === "bar" ? styles.navLink : styles.menuLink, link.href === FOR_TRADIES_PATH && styles.tradies]
            .filter(Boolean)
            .join(" ")}
          onClick={place === "menu" ? () => close({ returnFocus: false }) : undefined}
        >
          {place === "menu" && link.href === FOR_TRADIES_PATH ? (
            <span className={styles.menuLinkText}>
              {link.label}
              <span className={styles.menuCaption}>Are you a tradie? Join Trade Marketplace</span>
            </span>
          ) : (
            link.label
          )}
        </Link>
      </li>
    ));

  const account = actions.account && (
    <Link
      href={actions.account.href}
      className={styles.account}
      aria-current={isCurrent(pathname, actions.account.href) ? "page" : undefined}
    >
      <Icon name="account_circle" decorative />
      <span className={styles.visuallyHidden}>Your account: </span>
      <span className={styles.accountName}>{actions.account.name}</span>
    </Link>
  );

  return (
    <header
      ref={headerRef}
      className={`${styles.header} tm-navfill`}
      data-solid={solid}
      data-menu-open={open || undefined}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className={styles.bar}>
        <Link href="/" className={styles.logo} aria-label="Trade Marketplace home">
          <Wordmark label={null} className={styles.logoMark} />
        </Link>

        <nav aria-label="Main" className={styles.barNav}>
          <ul className={styles.navList}>{navLinks("bar")}</ul>
        </nav>

        <div className={styles.barActions}>
          {actions.guest && (
            <>
              <Link
                href={actions.guest.logIn.href}
                className={styles.navLink}
                aria-current={isCurrent(pathname, actions.guest.logIn.href) ? "page" : undefined}
              >
                {actions.guest.logIn.label}
              </Link>
              <span className={styles.desktopOnly}>
                <Button href={actions.guest.signUp.href} size="sm" width="auto">
                  {actions.guest.signUp.label}
                </Button>
              </span>
            </>
          )}
          {viewer && (
            <span className={styles.desktopOnly}>
              {account}
              {actions.app && (
                <Button href={actions.app.href} size="sm" width="auto">
                  {actions.app.label}
                </Button>
              )}
            </span>
          )}
          <span className={styles.menuToggle}>
            <IconButton
              icon={open ? "close" : "menu"}
              label="Menu"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            />
          </span>
        </div>
      </div>

      <div ref={panelRef} id={panelId} className={styles.menu} hidden={!open}>
        <nav aria-label="Menu">
          <ul className={styles.menuList}>{navLinks("menu")}</ul>
        </nav>
        <div className={styles.menuActions}>
          {actions.postJob && (
            <Button href={actions.postJob.href} variant="hero" width="full">
              {actions.postJob.label}
            </Button>
          )}
          {actions.guest && (
            <>
              <Button href={actions.guest.signUp.href} variant="secondary" width="full">
                {actions.guest.signUp.label}
              </Button>
              <Button href={actions.guest.logIn.href} variant="secondary" width="full">
                {actions.guest.logIn.label}
              </Button>
            </>
          )}
          {viewer && (
            <>
              {actions.app && (
                <Button href={actions.app.href} variant={actions.postJob ? "secondary" : "primary"} width="full">
                  {actions.app.label}
                </Button>
              )}
              {account}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
