// /dev/tokens: every design token on one page, for checking against the guidelines.
// Development only. In a production build (`next build` / `next start`, Vercel) this page is a 404.
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Icon } from "@/components/Icon";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";

import { FontStatus } from "./FontStatus";
import { parseTokens, type Token, type TokenSection } from "./parse-tokens";
import styles from "./tokens.module.css";

export const metadata: Metadata = {
  title: "Design tokens (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readTokensCss(): string {
  return readFileSync(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");
}

export default async function TokensPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const iconsOff = params.icons === "off";
  const { sections, modes } = parseTokens(readTokensCss());
  const modeSection = sections.find((s) => s.title.toLowerCase().startsWith("mode"));

  const href = (next: { mode?: Mode; icons?: "off" | null }) => {
    const q = new URLSearchParams();
    const m = next.mode ?? mode;
    if (m !== DEFAULT_MODE) q.set("mode", m);
    const off = next.icons === undefined ? iconsOff : next.icons === "off";
    if (off) q.set("icons", "off");
    const s = q.toString();
    return s ? `/dev/tokens?${s}` : "/dev/tokens";
  };

  return (
    // `mode` is set on each part of the page except "Modes side by side". tokens.css only defines the customer
    // values on :root, so a data-mode="customer" column nested inside a trade or office area would inherit the
    // outer mode's colours; keeping that section outside any mode wrapper shows each column truly.
    <div className={styles.page} data-page-mode={mode}>
      <header data-mode={mode} className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Design tokens</h1>
          <p className={styles.lede}>
            Every token in <code>src/styles/tokens.css</code>, read from the file itself. Pick a mode to see the whole
            page in that palette.
          </p>
          <nav aria-label="Mode" className={styles.modeNav}>
            {MODES.map((m) => (
              <Link key={m} href={href({ mode: m })} aria-current={m === mode ? "page" : undefined} className={styles.modeLink}>
                {MODE_NAMES[m]}
              </Link>
            ))}
          </nav>
          <FontStatus />
        </div>
      </header>

      <main className={styles.wrap}>
        <nav aria-label="Sections" data-mode={mode} className={styles.toc}>
          {modeSection && <a href="#modes">Modes side by side</a>}
          {sections.map((s) => (
            <a key={s.number} href={`#section-${s.number}`}>
              {s.number}. {shortTitle(s.title)}
            </a>
          ))}
          <a href="#icons">Icons</a>
        </nav>

        {modeSection && (
          <section id="modes" className={styles.section} aria-labelledby="modes-title">
            <h2 id="modes-title" className={styles.h2}>
              Modes side by side
            </h2>
            <p className={styles.hint}>
              Set with <code>data-mode</code> on <code>&lt;html&gt;</code>. Labels on coloured fills use the on-action /
              on-signature tokens.
            </p>
            <div className={styles.modeGrid}>
              {MODES.map((m) => (
                <div key={m} data-mode={m} className={styles.modeCol}>
                  <h3 className={styles.h3}>
                    {MODE_NAMES[m]} <code>data-mode=&quot;{m}&quot;</code>
                  </h3>
                  <div className={styles.buttons}>
                    <span className={styles.btnPrimary}>Primary</span>
                    <span className={styles.btnHero}>Hero</span>
                  </div>
                  <ul className={styles.swatchList}>
                    {modeSection.tokens.map((t) => (
                      // An override brings its own note (its contrast in that mode); never show the customer note for it.
                      <Swatch key={t.name} token={modes[m]?.[t.name] ?? t} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <div data-mode={mode}>
          {sections.map((s) => (
            <Section key={s.number} section={s} />
          ))}

          <section id="icons" className={styles.section} aria-labelledby="icons-title">
            <h2 id="icons-title" className={styles.h2}>
              Icons · Material Symbols Rounded
            </h2>
            <p className={styles.hint}>
              Every icon has an aria-label or sits next to text that says the same thing, so nothing loses its meaning if
              the icon font fails.{" "}
              <Link href={href({ icons: iconsOff ? null : "off" })}>
                {iconsOff ? "Turn the icon font back on" : "Simulate the icon font failing"}
              </Link>
            </p>
            <div className={iconsOff ? `${styles.icons} ${styles.iconsOff}` : styles.icons} data-icon-font={iconsOff ? "off" : "on"}>
              <ul className={styles.iconGrid}>
                {["search", "near_me", "bolt", "home", "work", "payments", "notifications", "person"].map((name) => (
                  <li key={name} className={styles.iconCell}>
                    <Icon name={name} label={name.replace("_", " ")} />
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
              <div className={styles.iconRow}>
                <span className={styles.iconText}>
                  <Icon name="check_circle" fill decorative className={styles.iconAction} /> Free to post
                </span>
                <span className={styles.iconText}>
                  <Icon name="verified" fill decorative className={styles.iconAction} /> Licence-checked tradies
                </span>
                <span className={styles.iconText}>
                  <Icon name="lock" fill decorative className={styles.iconAction} /> One fixed price
                </span>
              </div>
              <div className={styles.iconRow}>
                <Icon name="bookmark" size="sm" label="Save (small)" />
                <Icon name="bookmark" label="Save (default)" />
                <Icon name="bookmark" size="lg" label="Save (large)" />
                <Icon name="bookmark" size="lg" fill label="Saved (large, filled)" className={styles.iconAction} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function shortTitle(title: string) {
  return title.split(/[.(—]/)[0].trim();
}

function Section({ section }: { section: TokenSection }) {
  const id = `section-${section.number}`;
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.h2}>
        {section.number}. {section.title}
      </h2>
      <SectionBody section={section} />
    </section>
  );
}

function SectionBody({ section }: { section: TokenSection }) {
  const { tokens, kind } = section;
  switch (kind) {
    case "colour":
      return (
        <ul className={styles.swatchGrid}>
          {tokens.map((t) => (
            <Swatch key={t.name} token={t} />
          ))}
        </ul>
      );
    case "type":
      return <TypeScale tokens={tokens} />;
    case "space":
    case "size": {
      // Sizes go up to 1200px, so they're drawn at half size to stay comparable inside the page.
      const half = kind === "size";
      return (
        <>
          {half && <p className={styles.hint}>Bars drawn at half size.</p>}
          <ul className={styles.rows}>
            {tokens.map((t) => (
              <li key={t.name} className={styles.row}>
                <TokenName token={t} />
                <span className={styles.barTrack}>
                  <span className={styles.bar} style={{ width: half ? `calc(var(${t.name}) / 2)` : `var(${t.name})` }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      );
    }
    case "radius":
      return (
        <ul className={styles.tileGrid}>
          {tokens.map((t) => (
            <li key={t.name} className={styles.tileCell}>
              <span className={styles.radiusTile} style={{ borderRadius: `var(${t.name})` }} />
              <TokenName token={t} />
            </li>
          ))}
        </ul>
      );
    case "shadow":
      return (
        <ul className={styles.tileGrid}>
          {tokens.map((t) => (
            <li key={t.name} className={styles.tileCell}>
              <span className={styles.shadowTile} style={{ boxShadow: `var(${t.name})` }} />
              <TokenName token={t} />
            </li>
          ))}
        </ul>
      );
    case "motion":
      return (
        <>
          <p className={styles.hint}>Hover or focus a row to play it. Reduced motion makes every one instant.</p>
          <ul className={styles.rows}>
            {tokens.map((t) => {
              const isEase = t.name.includes("ease");
              const style = (
                isEase
                  ? { transitionDuration: "var(--trade-dur-slow)", transitionTimingFunction: `var(${t.name})` }
                  : { transitionDuration: `var(${t.name})`, transitionTimingFunction: "var(--trade-ease-out)" }
              ) as CSSProperties;
              return (
                <li key={t.name}>
                  <button type="button" className={`${styles.row} ${styles.motionRow}`}>
                    <TokenName token={t} />
                    <span className={styles.motionTrack}>
                      <span className={styles.motionDot} style={style} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      );
    default:
      return (
        <ul className={styles.rows}>
          {tokens.map((t) => (
            <li key={t.name} className={styles.row}>
              <TokenName token={t} />
            </li>
          ))}
        </ul>
      );
  }
}

function TokenName({ token }: { token: Token }) {
  return (
    <span className={styles.tokenName}>
      <code className={styles.name}>{token.name}</code>
      <code className={styles.value}>{token.value}</code>
      {token.note && <span className={styles.note}>{token.note}</span>}
    </span>
  );
}

function Swatch({ token }: { token: Token }) {
  return (
    <li className={styles.swatch}>
      <span className={styles.chip} style={{ background: `var(${token.name})` }} />
      <TokenName token={token} />
    </li>
  );
}

function TypeScale({ tokens }: { tokens: Token[] }) {
  const sizes = tokens.filter((t) => t.name.startsWith("--trade-fs-"));
  const others = tokens.filter((t) => !t.name.startsWith("--trade-fs-") && !t.name.startsWith("--trade-lh-"));
  const lineHeight = (fs: Token) => tokens.find((t) => t.name === fs.name.replace("-fs-", "-lh-"));

  return (
    <>
      <ul className={styles.rows}>
        {others.map((t) => (
          <li key={t.name} className={styles.row}>
            <TokenName token={t} />
          </li>
        ))}
      </ul>
      <div className={styles.families}>
        <div>
          <h3 className={styles.h3}>Trade Display · wght 900 · wdth 151 · opsz 28</h3>
          <p className={styles.sampleDisplay}>Sorted in a flash. $372.00</p>
        </div>
        <div>
          <h3 className={styles.h3}>Trade UI · wdth 100 · opsz 14</h3>
          <p className={styles.sampleUi}>Post any job free. Accept the price. Someone local sorts it.</p>
          <p className={styles.sampleUiBold}>Bold 700: Get a price · Accept &amp; pay</p>
        </div>
      </div>
      <ul className={styles.scale}>
        {sizes.map((fs) => {
          const lh = lineHeight(fs);
          const size = { fontSize: `var(${fs.name})`, lineHeight: lh ? `var(${lh.name})` : undefined };
          return (
            <li key={fs.name} className={styles.scaleRow}>
              <span className={styles.tokenName}>
                <code className={styles.name}>{fs.name}</code>
                <code className={styles.value}>
                  {fs.value}
                  {lh ? ` / ${lh.value}` : ""}
                </code>
                {(lh?.note ?? fs.note) && <span className={styles.note}>{lh?.note ?? fs.note}</span>}
              </span>
              <span className={styles.scaleSamples}>
                <span className={styles.sampleDisplay} style={size}>
                  Sorted in a flash
                </span>
                <span className={styles.sampleUi} style={size}>
                  Someone local sorts it
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
