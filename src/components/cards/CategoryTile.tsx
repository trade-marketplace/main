// The category tile (#76): components.css .tm-cat, 159 × 162. The 3D art on its category tint, the name and a
// short line under it (screens.html cus-home, tr-home; pages.html w-c-home). On Home a tile starts Post a job with
// that type picked; on the job board it filters to that trade. Hover: M03 (it rises).
//
//   <CategoryRail label="What needs doing?">
//     {CATEGORIES.map((c) => <li key={c}><CategoryTile category={c} href={`/jobs/new?type=${c}`} /></li>)}
//   </CategoryRail>
//   <CategoryTile category="plumbing" disabled="Not verified" />     a trade this tradie can't take yet
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { type Category, CATEGORY_INFO } from "@/lib/cards";

import styles from "./cards.module.css";

export type CategoryTileProps = {
  category: Category;
  /** Where the tile goes. Leave it out with `disabled`. */
  href?: string;
  /**
   * Greyed out and not a link, with the reason as its second line ("Not verified": FRONTEND_SPEC, trades the
   * tradie isn't verified for are shown but greyed).
   */
  disabled?: string;
  /** Overrides the second line ("and related", "anything else"). */
  sub?: string;
  /** The name's heading level, to fit the page's outline. Default 3. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

export function CategoryTile({ category, href, disabled, sub, headingLevel = 3, className }: CategoryTileProps) {
  const info = CATEGORY_INFO[category];
  const Heading = `h${headingLevel}` as const;
  const live = !disabled && href;
  return (
    <article
      className={[styles.cat, live && "tm-lift", className].filter(Boolean).join(" ")}
      data-disabled={disabled ? true : undefined}
      data-category={category}
    >
      <span
        className={styles.catArt}
        style={{ background: info.tint, "--cat-ink": "icon" in info.art ? info.art.ink : undefined } as CSSProperties}
        aria-hidden="true"
      >
        {"image" in info.art ? (
          <Image
            className={styles.catImage}
            src={info.art.image}
            alt=""
            width={info.art.width}
            height={info.art.height}
            data-tall={info.art.height > info.art.width || undefined}
            sizes="118px"
          />
        ) : (
          <Icon name={info.art.icon} fill decorative className={styles.catIcon} />
        )}
      </span>
      <Heading className={styles.catName}>
        {live ? (
          <Link href={href} className={styles.stretched}>
            {info.name}
          </Link>
        ) : (
          info.name
        )}
      </Heading>
      <span className={styles.catSub} title={disabled ?? sub ?? info.sub}>
        {disabled ?? sub ?? info.sub}
      </span>
    </article>
  );
}

/** A list of category tiles: scrolls sideways on a phone (.tm-rail), wraps from 1024px. Children are <li>s. */
export function CategoryRail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={[styles.rail, className].filter(Boolean).join(" ")}>
      {children}
    </ul>
  );
}
