// /dev/components/cards: every card, tile and row (#76), live, for checking against docs/design/components.css,
// web.css and the mockups (screens.html cus-home, tr-home, tr-all, cus-myjobs, tr-mywork, tr-earnings,
// sh-tradie-public, sys-empty; pages.html w-c-home, w-t-board, w-o-queues, w-t-earnings, w-profile-public).
// `?mode=trade` / `?mode=office` shows them in the other palettes (the tradie and office examples set their own).
// Development only: in a production build this page is a 404. Names, prices, distances and suburbs are examples.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { CATEGORIES, CategoryRail, CategoryTile, EmptyCard, JobRow, KpiCard, ProfileCard, StatCard, StatStrip } from "@/components/cards";
import { JobRowSkeleton, TileSkeleton } from "@/components/feedback";
import { formatNzd } from "@/components/motion/CountUp";
import { Pill } from "@/components/status/Pill";
import { StatusPill } from "@/components/status/StatusPill";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import styles from "./cards.module.css";
import { SaveableTile } from "./CardDemos";
import { BOARD_TILES, LONG_NAME, LONG_TITLE, LONG_WORD } from "./preview-data";
import { USAGE_SOURCE } from "./usage-source";

export const metadata: Metadata = {
  title: "Cards, tiles and rows (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

const SECTIONS = [
  ["categories", "Category tiles"],
  ["tiles", "Job tiles"],
  ["rows", "Job rows"],
  ["numbers", "KPI and stat cards"],
  ["profiles", "Profile cards"],
  ["empty", "Empty and loading"],
  ["usage", "Usage"],
] as const;

const photo = (name: string) => `/images/examples/${name}.jpg`;

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

function Row({ name, note, mode, children }: { name: string; note?: string; mode?: Mode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <div className={styles.stage} data-mode={mode}>
        {children}
      </div>
    </div>
  );
}

export default async function CardsPage({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const href = (m: Mode) => (m === DEFAULT_MODE ? "/dev/components/cards" : `/dev/components/cards?mode=${m}`);

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Cards, tiles and rows</h1>
          <p className={styles.lede}>
            From <code>src/components/cards</code>. Each card is one link: click anywhere on it, or Tab to its title.
            Point at one to see it lift (M03). Save on a job tile toggles (M23). Pick a mode to see the palettes.
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

        <Section id="categories" title="Category tiles" intro="159 × 162, the 3D art on its category tint. On Home they start Post a job with that type; on the job board they filter.">
          <Row name="Customer home" note="cus-home, w-c-home. Scrolls sideways on a phone, wraps from 1024px.">
            <CategoryRail label="What needs doing?">
              {CATEGORIES.map((category) => (
                <li key={category}>
                  <CategoryTile category={category} href={`/jobs/new?type=${category}`} />
                </li>
              ))}
            </CategoryRail>
          </Row>
          <Row name="Tradie: not verified" mode="trade" note="tr-home. Trades they aren't verified for are greyed, aren't links, and say why.">
            <CategoryRail label="Browse by trade">
              <li>
                <CategoryTile category="electrical" href="/jobs?trade=electrical" />
              </li>
              <li>
                <CategoryTile category="plumbing" disabled="Not verified" />
              </li>
              <li>
                <CategoryTile category="other" href="/jobs?trade=other" />
              </li>
            </CategoryRail>
          </Row>
          <Row name="Hover" note="M03: rises 2px with a deeper shadow (shown held here).">
            <CategoryRail label="Hover example">
              <li>
                <CategoryTile category="gas" href="/jobs/new?type=gas" className="is-hover" />
              </li>
              <li>
                <CategoryTile category="construction" href="/jobs/new?type=construction" sub={`${LONG_WORD} and more`} />
              </li>
            </CategoryRail>
          </Row>
        </Section>

        <Section id="tiles" title="Job tiles" intro="The tradie's board: the photo with what they earn (or that it needs an estimate, or a bounty), how far, and Save.">
          <Row name="Phone grid" mode="trade" note="tr-all: 2 columns, 6px gaps, square tiles. Save toggles; saved is filled.">
            <ul className={styles.grid2} aria-label="Jobs near you (phone)">
              {BOARD_TILES.slice(0, 4).map(({ id, ...tile }) => (
                <li key={id}>
                  <SaveableTile {...tile} href={`/jobs/${id}`} />
                </li>
              ))}
            </ul>
          </Row>
          <Row name="Desktop board" mode="trade" note="w-t-board: 191 × 220 tiles, 4 across. Hover lifts the tile and zooms the photo (M03).">
            <ul className={styles.grid4} aria-label="Jobs near you">
              {BOARD_TILES.map(({ id, ...tile }, index) => (
                <li key={id}>
                  <SaveableTile {...tile} href={`/jobs/${id}`} shape="tall" className={index === 0 ? "is-hover" : undefined} />
                </li>
              ))}
            </ul>
          </Row>
          <Row name="No photo, long text" mode="trade" note="Forest with the bolt when there's no photo. Two lines of title, then “…”; the whole title is the tooltip.">
            <ul className={styles.grid2} aria-label="Edge cases">
              <li>
                <SaveableTile href="/jobs/x1" title="Hang a door" meta="12 km · Bluff" tag={{ kind: "earn", text: "Earn $64" }} />
              </li>
              <li>
                <SaveableTile href="/jobs/x2" title={LONG_TITLE} meta={`<1 km · ${LONG_WORD}`} photo={photo("board")} tag={{ kind: "bounty", text: "Bounty $30 · 2h" }} />
              </li>
            </ul>
          </Row>
        </Section>

        <Section id="rows" title="Job rows" intro="Lists of your jobs. The title stays on one line; the whole row opens the job; one button for the next step.">
          <Row name="Customer, phone" note="cus-myjobs, cus-home “Your jobs”: the price once it's known.">
            <ul className={`${styles.list} ${styles.phone}`} aria-label="Your jobs">
              <li>
                <JobRow href="/jobs/1005" category="Electrical" title="Sub wiring" meta="Windsor · TM-1005" photo={photo("wires")} price="$372.00" status={<StatusPill status="PRICED" audience="customer" />} />
              </li>
              <li>
                <JobRow href="/jobs/1011" category="Plumbing" title="Kitchen tap leaking" meta="Windsor · TM-1011" photo={photo("sink")} status={<StatusPill status="REVIEW" audience="customer" />} />
              </li>
              <li>
                <JobRow href="/jobs/998" category="Construction" title="Fix fence palings" meta="Glengarry · TM-0998" photo={photo("house")} price="$540.00" status={<StatusPill status="ASSIGNED" audience="customer" />} />
              </li>
            </ul>
          </Row>
          <Row name="Tradie, phone" mode="trade" note="tr-mywork: what they earn, and their next move.">
            <ul className={`${styles.list} ${styles.phone}`} aria-label="My work">
              <li>
                <JobRow href="/jobs/1005" category="Windsor · TM-1005" title="Sub wiring" meta="Claimed today" photo={photo("wires")} price="$259.20" status={<StatusPill status="ASSIGNED" audience="tradie" />} />
              </li>
              <li>
                <JobRow href="/jobs/990" category="Georgetown · TM-0990" title="Control panel" meta="Done Mon" photo={photo("modules")} price="$410.00" status={<StatusPill status="SUBMITTED" audience="tradie" />} />
              </li>
            </ul>
          </Row>
          <Row name="Customer, computer" note="w-c-home “Needs you”: the bigger photo, the pill above the title, the big price and one button.">
            <ul className={styles.list} aria-label="Needs you">
              <li>
                <JobRow
                  href="/jobs/1005"
                  title="Sub wiring"
                  meta="Electrical · Windsor"
                  photo={photo("wires")}
                  price="$372.00"
                  status={<StatusPill status="PRICED" audience="customer" />}
                  action={
                    <Button size="sm" width="auto" href="/jobs/1005#price">
                      See price
                    </Button>
                  }
                  className="is-hover"
                />
              </li>
              <li>
                <JobRow
                  href="/jobs/998"
                  title="Fix fence palings"
                  meta="Mere finished today"
                  photo={photo("house")}
                  status={<StatusPill status="SUBMITTED" audience="customer" />}
                  action={
                    <Button variant="secondary" size="sm" width="auto" href="/jobs/998#check">
                      Check &amp; rate
                    </Button>
                  }
                />
              </li>
            </ul>
          </Row>
          <Row name="Long text, no photo" note="Titles keep to one line with “…”; other lines too. No photo: Forest with the bolt.">
            <ul className={`${styles.list} ${styles.phone}`} aria-label="Long rows">
              <li>
                <JobRow href="/jobs/2001" category="Electrical" title={LONG_TITLE} meta={`${LONG_WORD} · TM-2001`} price="$1,284.60" status={<StatusPill status="COMPLETED" audience="customer" />} />
              </li>
            </ul>
          </Row>
        </Section>

        <Section id="numbers" title="KPI and stat cards" intro="Numbers count up from 0 the first time they're on screen (M17); screen readers hear only the final value.">
          <Row name="Office queues" mode="office" note="w-o-queues: red top edge and red note when something's overdue. Each card opens its queue.">
            <div className={styles.kpis}>
              <KpiCard label="To price" value={4} note="oldest 26h" alert href="/admin?tab=price" />
              <KpiCard label="Extra work" value={2} note="oldest 3h" href="/admin?tab=extra" />
              <KpiCard label="Cancellations" value={1} note="new" alert href="/admin?tab=cancel" />
              <KpiCard label="Sign-off" value={3} note="2 auto-release today" href="/admin?tab=signoff" />
              <KpiCard label="Unclaimed > 48h" value={1} note="Richmond" alert href="/admin?tab=unclaimed" />
            </div>
          </Row>
          <Row name="Earnings" mode="trade" note="w-t-earnings: money, in dollars and cents.">
            <div className={styles.kpis}>
              <KpiCard label="Paid in October" value={3452.8} format={formatNzd} note="14 jobs · holiday pay included" />
              <KpiCard label="Next payroll · Fri 7 Nov" value={410} format={formatNzd} note="1 job signed off" />
              <KpiCard label="Accuracy (last 30)" value="94%" note={`avg 6% from final price, ${LONG_WORD}`} />
            </div>
          </Row>
          <Row name="Stat card, phone" mode="trade" note="tr-earnings: the Forest money card with the bolt.">
            <div className={styles.phone}>
              <StatCard label="Paid in October" value={3452.8} format={formatNzd} note="14 jobs · holiday pay included" />
            </div>
          </Row>
          <Row name="Stats strip" note="Three figures in a row (profiles).">
            <div className={styles.phone}>
              <StatStrip items={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]} />
            </div>
          </Row>
        </Section>

        <Section id="profiles" title="Profile cards" intro="A tradie's public face: first name and initial only, what the office has checked, and three figures.">
          <Row name="Computer and phone" note="w-profile-public (card) and sh-tradie-public (plain, straight on the page).">
            <div className={styles.split}>
              <ProfileCard
                variant="card"
                headingLevel={3}
                name="Jack W."
                meta="Electrician · Invercargill"
                badges={<Pill kind="good">Licence checked</Pill>}
                stats={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]}
              />
              <div className={styles.phone}>
                <ProfileCard
                  headingLevel={3}
                  name="Mere R."
                  meta="Builder · Invercargill"
                  photo={photo("house")}
                  badges={
                    <>
                      <Pill kind="good">Licence checked</Pill>
                      <Pill kind="waiting">Gas fitting: checking</Pill>
                    </>
                  }
                  stats={[{ label: "rating", value: "4.8" }, { label: "jobs", value: "11" }, { label: "joined", value: "2025" }]}
                />
              </div>
            </div>
          </Row>
          <Row name="Long name, no stats" note="Names wrap; initials are the first and last name.">
            <div className={styles.phone}>
              <ProfileCard variant="card" headingLevel={3} name={LONG_NAME} meta={`Handyman · ${LONG_WORD}`} />
            </div>
          </Row>
        </Section>

        <Section id="empty" title="Empty and loading" intro="A section with nothing in it keeps its place; while loading, skeletons the shape of the cards (M15).">
          <Row name="Empty card" note="sys-empty: an empty state in a flat card. Friendly, not sorry.">
            <div className={styles.phone}>
              <EmptyCard
                illustration="van"
                title="Nothing on yet."

                action={
                  <Button href="/jobs/new" width="auto">
                    Post a job
                  </Button>
                }
              />
            </div>
          </Row>
          <Row name="Empty, small" mode="trade" note="With an icon instead of the van, for a section on a busy page.">
            <div className={styles.phone}>
              <EmptyCard icon="search_off" title="Nothing available."  />
            </div>
          </Row>
          <Row name="Loading" note="The kit's skeletons (#79): rows and tiles.">
            <div className={styles.stack}>
              <div className={styles.phone}>
                <JobRowSkeleton count={2} />
              </div>
              <TileSkeleton count={3} />
            </div>
          </Row>
        </Section>

        <Section id="usage" title="Usage" intro="Customer home's “Your jobs”, from the kit.">
          <pre className={styles.code} tabIndex={0} aria-label="Usage example code">
            <code>{USAGE_SOURCE}</code>
          </pre>
        </Section>
      </main>
    </div>
  );
}
