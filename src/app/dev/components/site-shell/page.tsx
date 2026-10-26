// /dev/components/site-shell: the public site header, phone menu and footer (#83) for each kind of visitor, with
// fake viewers. `?viewer=customer|tradie|office|long` signs a pretend person in (signed out by default);
// `?hero=off` shows a page without a hero (solid header from the top). Development only: in a production build
// this page is a 404, so the fake viewers never reach a real page. Names are examples.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BoltMark } from "@/components/BoltMark";
import { SiteShellView } from "@/components/site/SiteShell";
import type { SiteViewer } from "@/components/site/site-links";
import { modeForRole } from "@/lib/mode";

import styles from "./site-shell.module.css";

export const metadata: Metadata = {
  title: "Site header and footer (dev)",
  robots: { index: false, follow: false },
};

const VIEWERS = {
  "signed-out": { name: "Signed out", viewer: null },
  customer: { name: "Customer", viewer: { firstName: "Aroha", role: "CUSTOMER" } },
  tradie: { name: "Tradie", viewer: { firstName: "Wiremu", role: "TRADIE" } },
  office: { name: "Office", viewer: { firstName: "Matt", role: "ADMIN" } },
  long: {
    name: "Long name",
    viewer: { firstName: "Te Rangi-Hēnare-Fitzgerald-MacPherson Wolfeschlegelsteinhausen", role: "CUSTOMER" },
  },
} as const satisfies Record<string, { name: string; viewer: SiteViewer | null }>;

type ViewerKey = keyof typeof VIEWERS;

function isViewerKey(value: unknown): value is ViewerKey {
  return typeof value === "string" && Object.hasOwn(VIEWERS, value);
}

function href(viewer: ViewerKey, hero: boolean) {
  const query = new URLSearchParams();
  if (viewer !== "signed-out") query.set("viewer", viewer);
  if (!hero) query.set("hero", "off");
  const q = query.toString();
  return `/dev/components/site-shell${q ? `?${q}` : ""}`;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SiteShellPreview({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const key: ViewerKey = isViewerKey(params.viewer) ? params.viewer : "signed-out";
  const hero = params.hero !== "off";
  const { viewer } = VIEWERS[key];

  const intro = (
    <>
      <p className={styles.eyebrow}>Dev only · not in production builds</p>
      <h1 className={styles.title}>Site header and footer</h1>
      <p className={styles.lede}>
        The public site shell (#83) as each kind of visitor sees it. On a real page the server reads who is signed
        in; these are pretend people. Signed-in tradies and the office keep their own colours elsewhere, but the
        public site is always green: this preview paints the page around it in their mode to show that.
      </p>
      <nav aria-label="Visitor" className={styles.pickNav}>
        {(Object.keys(VIEWERS) as ViewerKey[]).map((k) => (
          <Link key={k} href={href(k, hero)} aria-current={k === key ? "page" : undefined} className={styles.pick}>
            {VIEWERS[k].name}
          </Link>
        ))}
      </nav>
      <nav aria-label="Page" className={styles.pickNav}>
        <Link href={href(key, true)} aria-current={hero ? "page" : undefined} className={styles.pick}>
          With a hero
        </Link>
        <Link href={href(key, false)} aria-current={hero ? undefined : "page"} className={styles.pick}>
          No hero
        </Link>
      </nav>
    </>
  );

  return (
    <div data-mode={modeForRole(viewer?.role)}>
      <SiteShellView viewer={viewer}>
        {hero ? (
          <section className={styles.hero} data-site-hero>
            <BoltMark variant="hero" className={styles.heroBolt} />
            <div className={styles.wrap}>{intro}</div>
          </section>
        ) : (
          <div className={`${styles.wrap} ${styles.plainTop}`}>{intro}</div>
        )}
        <div className={styles.wrap}>
          <h2 className={styles.heading}>Things to try</h2>
          <ul className={styles.list}>
            <li>Scroll down: over the hero the header is see-through, and turns solid Forest once the hero has gone (M06).</li>
            <li>Narrow the window below 1024px: the links move into the menu. Open it with Enter or Space; Esc closes it and puts focus back on the button.</li>
            <li>Press Tab first thing on the page: “Skip to content” jumps past the header.</li>
            <li>Zoom to 200%: nothing spills sideways, and long names end in “…”.</li>
          </ul>
          {Array.from({ length: 6 }, (_, i) => (
            <p key={i} className={styles.filler}>
              Example page content so there is something to scroll past. Post any job free, accept one fair fixed
              price, and someone local sorts it.
            </p>
          ))}
        </div>
      </SiteShellView>
    </div>
  );
}
