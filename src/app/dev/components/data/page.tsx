// /dev/components/data: every table, tab, segmented control, pagination and filter state (#80), live, for
// checking against docs/design/web.css, components.css and the office mockups (pages.html w-o-jobs, w-o-queues,
// w-o-tradies; screens.html cus-myjobs, tr-mywork, tr-all). Office mode by default, since the tables are the
// office's; `?mode=customer` / `?mode=trade` shows the other palettes. `?open=<id>` opens a menu on load (ids:
// OPEN_IDS in preview-data.ts). The big example keeps its filters, sort and page in the URL.
// Development only: in a production build this page is a 404. Names, prices and suburbs are examples.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { isMode, MODES, type Mode } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import {
  EmptyTable,
  ErrorTable,
  FilterStates,
  JobsTableDemo,
  LinkPagerDemo,
  LoadingTable,
  LongSegmented,
  LongTextTable,
  ManyTabs,
  PagerDemo,
  PhoneTable,
  QueuesDemo,
  QuickFilterDemo,
  Row,
  SegmentedDemos,
  SelectedTable,
  TradieTabs,
} from "./DataDemos";
import styles from "./data.module.css";
import { OPEN_IDS, type OpenId } from "./preview-data";
import { USAGE_SOURCE } from "./usage-source";

export const metadata: Metadata = {
  title: "Tables, tabs, pagination and filters (dev)",
  robots: { index: false, follow: false },
};

const PAGE_MODE: Mode = "office";
const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

const SECTIONS = [
  ["tables", "Tables"],
  ["states", "Table states"],
  ["tabs", "Tabs"],
  ["segmented", "Segmented"],
  ["pagination", "Pagination"],
  ["filters", "Filters"],
  ["usage", "Usage"],
] as const;

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

const isOpenId = (value: unknown): value is OpenId => typeof value === "string" && (OPEN_IDS as readonly string[]).includes(value);

export default async function DataPage({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : PAGE_MODE;
  const open = isOpenId(params.open) ? params.open : null;
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  ).toString();
  const href = (m: Mode) => (m === PAGE_MODE ? "/dev/components/data" : `/dev/components/data?mode=${m}`);

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Tables, tabs, pagination and filters</h1>
          <p className={styles.lede}>
            From <code>src/components/data</code>. Sort by a column, tick rows, open the ⋯ menu, filter, page through,
            and switch tabs with the arrow keys. Narrow the window to see the tables turn into cards.
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

        <Section
          id="tables"
          title="Tables"
          intro="The office “All jobs” page: search, filter chips, saved filters, sortable columns, tick boxes with a bulk bar, a ⋯ menu per row, and 25 per page. Click a row to open it (it stays tinted). Filters, sort and page are in the URL."
        >
          <JobsTableDemo query={query} open={open} />
          <h3 className={styles.subTitle}>Queue with tabs</h3>
          <p className={styles.intro}>The office queues (w-o-queues): tabs with counts over a table, one action per row. The underline slides (M16).</p>
          <QueuesDemo />
        </Section>

        <Section id="states" title="Table states" intro="Every state a table can be in. The table never sorts or fetches by itself; it shows what it’s given.">
          <Row name="Loading" note="Skeleton rows the shape of the real ones, after 300ms (M15). Screen readers hear “Loading jobs”.">
            <div className={styles.grow}>
              <LoadingTable />
            </div>
          </Row>
          <Row name="Empty" note="An empty state from the kit in place of the rows. The headers stay so the page doesn’t jump.">
            <div className={styles.grow}>
              <EmptyTable />
            </div>
          </Row>
          <Row name="Couldn’t load" note="An error state with Try again, in place of the rows.">
            <div className={styles.grow}>
              <ErrorTable />
            </div>
          </Row>
          <Row name="Ticked and open" note="Two rows ticked (bulk bar on top), the open one tinted, sorted by price, highest first.">
            <div className={styles.grow}>
              <SelectedTable />
            </div>
          </Row>
          <Row name="Long text" note="Titles wrap; Customer and Tradie stay on one line with “…” and the whole name in a tooltip.">
            <div className={styles.grow}>
              <LongTextTable />
            </div>
          </Row>
          <Row name="On a phone" note="Below 640px wide each row is a card, the column names beside the values. Sort moves into a menu.">
            <PhoneTable />
          </Row>
        </Section>

        <Section id="tabs" title="Tabs" intro="Underlined tabs: office queues, tradie checks. Arrow keys move and switch; the underline slides (M16).">
          <Row name="Tabs with counts" note="w-o-tradies. The count is part of the name: “To check (3)”.">
            <TradieTabs />
          </Row>
          <Row name="Many tabs, narrow" note="More tabs than fit: the bar scrolls sideways and the chosen one comes into view.">
            <ManyTabs />
          </Row>
        </Section>

        <Section id="segmented" title="Segmented" intro="Two or three views of one list. The white thumb slides to the chosen one (M16).">
          <Row name="Views" note="cus-myjobs (Active / Done), tr-mywork (On now / Estimates / Done, trade colours) and the Grid / Map toggle.">
            <div className={styles.stack}>
              <SegmentedDemos />
            </div>
          </Row>
          <Row name="Long labels" note="Labels wrap inside their half; the thumb keeps up.">
            <LongSegmented />
          </Row>
        </Section>

        <Section id="pagination" title="Pagination" intro="“Showing 1–25 of 128” and Previous / Next. At either end the button is greyed out, not gone.">
          <Row name="First page">
            <PagerDemo page={1} total={128} label="Pages, first" />
          </Row>
          <Row name="A middle page">
            <PagerDemo page={3} total={128} label="Pages, middle" />
          </Row>
          <Row name="Last page">
            <PagerDemo page={6} total={128} label="Pages, last" />
          </Row>
          <Row name="Links" note="getHref: each button is a link, so the page is in the URL. Thousands get a comma.">
            <LinkPagerDemo />
          </Row>
          <Row name="One page, and none" note="No buttons when everything fits; “No results” when nothing does.">
            <div className={styles.stack}>
              <PagerDemo page={1} total={7} label="Pages, all on one" />
              <PagerDemo page={1} total={0} label="Pages, none" />
            </div>
          </Row>
        </Section>

        <Section id="filters" title="Filters" intro="Chips with dropdowns: filled when they filter. Clear filters shows once anything does.">
          <Row name="Nothing filtered" note="Every chip on its default (outlined).">
            <FilterStates preset={{}} label="Filters, nothing on" />
          </Row>
          <Row name="Two filters on" note="Filled chips, Clear filters, and a saved filter ticked when the set matches one.">
            <FilterStates preset={{ status: "price" }} label="Filters, two on" />
          </Row>
          <Row name="On a phone" note="The search takes the width; chips wrap under it.">
            <FilterStates preset={{ status: "active", region: "invercargill" }} label="Filters on a phone" narrow />
          </Row>
          <Row name="Quick filters" note="tr-all: one-tap chips with counts, scrolling sideways on a phone. Bounties are gold.">
            <div className={styles.stack}>
              <QuickFilterDemo />
              <QuickFilterDemo wrap />
            </div>
          </Row>
        </Section>

        <Section id="usage" title="Usage" intro="The queue above, from the kit, and the code that makes it.">
          <pre className={styles.code} tabIndex={0} aria-label="Usage example code">
            <code>{USAGE_SOURCE}</code>
          </pre>
        </Section>
      </main>
    </div>
  );
}
