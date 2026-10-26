// /dev/components/overlays: every dialog, drawer, bottom sheet, menu, toast and banner (#78), live, for checking
// against docs/design/web.css, components.css and the mockups. `?mode=trade` / `?mode=office` shows them in the
// other palettes; `?open=<id>` opens one on load (ids: OPEN_IDS in preview-data.ts), for screenshots.
// Development only: in a production build this page is a 404. Names, prices and suburbs are examples.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Banner, type BannerTone } from "@/components/overlays";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";

import {
  ActionBannerDemo,
  DialogDemos,
  DismissibleBannerDemo,
  DrawerDemos,
  LiveBannerDemo,
  MenuDemos,
  PreviewToasts,
  SheetDemos,
  ToastDemos,
  UsageExample,
} from "./OverlayDemos";
import styles from "./overlays.module.css";
import { LONG_NAME, LONG_WORD, OPEN_IDS, type OpenId } from "./preview-data";
import { USAGE_SOURCE } from "./usage-source";

export const metadata: Metadata = {
  title: "Dialogs, drawers, sheets, menus and toasts (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

const SECTIONS = [
  ["dialogs", "Dialogs"],
  ["drawers", "Drawers"],
  ["sheets", "Bottom sheets"],
  ["menus", "Menus"],
  ["toasts", "Toasts"],
  ["banners", "Banners"],
  ["usage", "Usage"],
] as const;

const BANNERS: { tone: BannerTone; name: string; title: string; text: string; what: string }[] = [
  { tone: "info", name: "Info", title: "", text: "Running late? Use “I’m on my way” on the job.", what: "Blue: neutral facts and tips." },
  { tone: "good", name: "Good", title: "Check your inbox.", text: "The link works for 1 hour.", what: "Green: it worked." },
  { tone: "alert", name: "Alert", title: "Card declined.", text: "Try another card. Nothing was charged.", what: "Red: something is wrong." },
  { tone: "brand", name: "Brand", title: "Private.", text: "Nobody else sees your numbers.", what: "The mode tint: our own notes." },
  { tone: "test", name: "Test mode", title: "Test mode.", text: "No real money moves. Use card 4242 4242 4242 4242.", what: "Gold: payments are in test mode (checkout, office)." },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {intro && <p className={styles.intro}>{intro}</p>}
      {children}
    </section>
  );
}

function Row({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <div className={styles.stage}>{children}</div>
    </div>
  );
}

const isOpenId = (value: unknown): value is OpenId => typeof value === "string" && (OPEN_IDS as readonly string[]).includes(value);

export default async function OverlaysPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const open = isOpenId(params.open) ? params.open : null;
  const href = (m: Mode) => (m === DEFAULT_MODE ? "/dev/components/overlays" : `/dev/components/overlays?mode=${m}`);

  return (
    <div className={styles.page} data-mode={mode}>
      <PreviewToasts initial={open}>
        <header className={styles.band}>
          <BoltMark variant="hero" className={styles.bandBolt} />
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>Dev only · not in production builds</p>
            <h1 className={styles.title}>Dialogs, drawers, sheets, menus and toasts</h1>
            <p className={styles.lede}>
              From <code>src/components/overlays</code>. Open each one: focus moves in and is kept there, Esc closes,
              the page behind can’t be used, and focus comes back to the button. Pick a mode to see them in that
              palette.
            </p>
            <nav aria-label="Mode" className={styles.modeNav}>
              {MODES.map((m) => (
                <Link key={m} href={href(m)} aria-current={m === mode ? "page" : undefined} className={styles.modeLink}>
                  {MODE_NAMES[m]}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className={styles.wrap}>
          <nav aria-label="Sections" className={styles.toc}>
            {SECTIONS.map(([id, title]) => (
              <a key={id} href={`#${id}`}>
                {title}
              </a>
            ))}
          </nav>

          <Section id="dialogs" title="Dialogs" intro="For decisions: confirms, money, sign-up. One at a time.">
            <DialogDemos initial={open} />
          </Section>

          <Section id="drawers" title="Drawers" intro="For side tasks that need the page in view: estimate, extra work, crew.">
            <DrawerDemos initial={open} />
          </Section>

          <Section id="sheets" title="Bottom sheets" intro="The phone’s overlay. Every dialog above is one of these below 600px.">
            <SheetDemos initial={open} />
          </Section>

          <Section id="menus" title="Menus" intro="A list of actions under a button: avatar, ⋯ on a job card, office actions. M08.">
            <MenuDemos initial={open} />
          </Section>

          <Section id="toasts" title="Toasts" intro="Short confirmations that go by themselves (M14). Errors are banners instead.">
            <ToastDemos />
          </Section>

          <Section id="banners" title="Banners" intro="In the page, for as long as it’s true: offline, test mode, a private note.">
            {BANNERS.map((b) => (
              <Row key={b.tone} name={b.name} note={b.what}>
                <div className={styles.stack}>
                  <Banner tone={b.tone} title={b.title || undefined}>
                    {b.text}
                  </Banner>
                </div>
              </Row>
            ))}
            <Row name="With an action" note="A link after the text, in the banner’s colour and underlined.">
              <div className={styles.stack}>
                <ActionBannerDemo />
              </div>
            </Row>
            <Row name="Dismissible" note="onDismiss shows a ×. Not for banners that must stay (offline, test mode).">
              <div className={styles.stack}>
                <DismissibleBannerDemo />
              </div>
            </Row>
            <Row name="Appears live" note="live: read out when it appears (alert interrupts, the rest wait their turn).">
              <LiveBannerDemo />
            </Row>
            <Row name="Long text" note="Wraps; never spills.">
              <div className={styles.stack}>
                <Banner tone="brand" title={LONG_NAME}>
                  {LONG_WORD} is outside the area we cover for now. We’ll email you when we get there.
                </Banner>
              </div>
            </Row>
          </Section>

          <Section id="usage" title="Usage" intro="A destructive confirm and an Undo toast built from the kit, and the code that makes it.">
            <UsageExample />
            <pre className={styles.code} tabIndex={0} aria-label="Usage example code">
              <code>{USAGE_SOURCE}</code>
            </pre>
          </Section>
        </main>
      </PreviewToasts>
    </div>
  );
}
