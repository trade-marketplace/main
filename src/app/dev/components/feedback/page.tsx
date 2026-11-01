// /dev/components/feedback: every loading, empty, error and offline state, for checking against
// docs/design/components.css, the "404 · 500 · maintenance · offline" page in pages.html and the phone system-state
// screens in screens.html. `?mode=trade` / `?mode=office` shows them in the other palettes; `?state=` picks the
// usage example's state (loading, empty, error, jobs). Dev only: the shared guard makes it a 404 in production
// (and on every Vercel deployment). All copy is from the spec; jobs and references are examples.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import {
  EmptyState,
  InlineError,
  JobRowSkeleton,
  OfflineBanner,
  ProgressBar,
  Skeleton,
  SkeletonText,
  Spinner,
  TileSkeleton,
} from "@/components/feedback";
import { TextLink } from "@/components/TextLink";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import {
  ErrorPreview,
  InlineErrorPreview,
  InlineRetryDemo,
  LoadingDemo,
  OfflineDemo,
  OfflinePreview,
  PageOfflineBanner,
  RetryDemo,
  UploadDemo,
  UsageExample,
} from "./FeedbackDemos";
import { isUsageState, type UsageState } from "./demo-data";
import { USAGE_SOURCE } from "./usage-source";
import styles from "./feedback.module.css";

export const metadata: Metadata = {
  title: "Loading, empty and error states (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

const SECTIONS = [
  ["skeletons", "Skeletons"],
  ["loading", "Loading → content"],
  ["progress", "Spinners and progress"],
  ["empty", "Empty states"],
  ["errors", "Errors"],
  ["offline", "Offline"],
  ["long-text", "Long text"],
  ["usage", "Usage"],
] as const;

const LONG_NAME = "Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services";
const LONG_WORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";

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

function Row({ name, note, block, children }: { name: string; note?: ReactNode; block?: boolean; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <div className={block ? `${styles.stage} ${styles.block}` : styles.stage}>{children}</div>
    </div>
  );
}

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const usageState: UsageState = isUsageState(params.state) ? params.state : "loading";
  const href = (m: Mode) => {
    const query = new URLSearchParams();
    if (m !== DEFAULT_MODE) query.set("mode", m);
    if (usageState !== "loading") query.set("state", usageState);
    const q = query.toString();
    return q ? `/dev/components/feedback?${q}` : "/dev/components/feedback";
  };

  return (
    <div className={styles.page} data-mode={mode}>
      <PageOfflineBanner />
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Loading, empty and error states</h1>
          <p className={styles.lede}>
            Skeletons, spinners, empty states, errors with Try again and the offline banner, from{" "}
            <code>src/components/feedback</code>. Pick a mode to see them in that palette.
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
          id="skeletons"
          title="Skeletons"
          intro="M15: grey shapes the size of the real content. They appear after 300ms (most loads finish first) and shimmer on a 1.2s loop; with reduced motion they are static grey. Hidden from screen readers: <LoadingRegion> says what is loading."
        >
          <Row name="Shapes" note="line (6px corners), circle (avatars), pill (status pills, chips).">
            <Skeleton width={200} height={26} />
            <Skeleton width={44} height={44} shape="circle" />
            <Skeleton width={96} height={18} shape="pill" />
          </Row>
          <Row name="Text" block>
            <SkeletonText lines={3} />
          </Row>
          <Row name="Job rows" note=".tm-jobrow: 64px photo, category, title, status pill. My jobs, the job board." block>
            <div className={styles.narrow}>
              <JobRowSkeleton count={2} />
            </div>
          </Row>
          <Row name="Category tiles" note=".tm-cat: 110 × 96 picture and a name. Customer home.">
            <TileSkeleton count={3} />
          </Row>
        </Section>

        <Section
          id="loading"
          title="Loading → content"
          intro="<LoadingRegion>: skeleton while loading, aria-busy on the area, “Loading your jobs” said once, politely, after 300ms. A quick load shows and says nothing. The content cross-fades in (150ms)."
        >
          <Row name="Try it" note="Load quickly: no skeleton flashes. Load slowly: skeleton, then the list." block>
            <LoadingDemo />
          </Row>
        </Section>

        <Section
          id="progress"
          title="Spinners and progress"
          intro="For small waits inside a page and for uploads, never a whole page (that's skeletons). Buttons use their own spinner: <Button loading>."
        >
          <Row name="Spinner" note="sm, md, lg. The label is read out politely; hideLabel keeps it for screen readers only.">
            <Spinner size="sm" label="Checking the address" />
            <Spinner label="Loading more jobs" />
            <Spinner size="lg" label="Sending" hideLabel />
          </Row>
          <Row name="Progress bar" note="role=progressbar with its value. Without a value it slides until done (static with reduced motion)." block>
            <div className={styles.narrow}>
              <ProgressBar label="Uploading kitchen.jpg" value={0} />
            </div>
            <div className={styles.narrow}>
              <ProgressBar label="Uploading hallway.jpg" value={0.4} />
            </div>
            <div className={styles.narrow}>
              <ProgressBar label="Uploaded switchboard.jpg" value={1} />
            </div>
            <div className={styles.narrow}>
              <ProgressBar label="Sending your photos" />
            </div>
          </Row>
          <Row name="Try it" note="The button shows its own spinner while the bar fills." block>
            <UploadDemo />
          </Row>
        </Section>

        <Section
          id="empty"
          title="Empty states"
          intro="Illustration (optional) + short heading + one line + one action. Friendly, not sorry: “Nothing on yet.” not “No data found”."
        >
          <Row name="With the van and an action" note="My jobs, Active tab, for a new customer." block>
            <div className={styles.card}>
              <EmptyState
                illustration="van"
                title="Nothing on yet."
                message="Got something that needs doing? Post it free and we’ll get you a price."
                action={<Button href="/dev/components/feedback#empty">Post a job</Button>}
                headingLevel={4}
              />
            </div>
          </Row>
          <Row name="Search with no results" note="An icon in a tinted square and Reset filters." block>
            <div className={styles.card}>
              <EmptyState
                icon="search_off"
                title="No jobs match that."
                message="Try fewer filters."
                action={
                  <Button variant="secondary" href="/dev/components/feedback#empty">
                    Reset filters
                  </Button>
                }
                headingLevel={4}
              />
            </div>
          </Row>
          <Row name="Nothing to do" note="No action: My jobs, Done tab." block>
            <div className={styles.card}>
              <EmptyState icon="task_alt" title="Nothing finished yet." message="Jobs show up here once they’re sorted." headingLevel={4} />
            </div>
          </Row>
          <Row name="Two actions" note="One main action and a quieter link." block>
            <div className={styles.card}>
              <EmptyState
                icon="chat_bubble"
                title="No messages yet."
                message="They’ll show up here once a tradie takes your job."
                action={<Button href="/dev/components/feedback#empty">See my jobs</Button>}
                secondaryAction={<TextLink href="/dev/components/feedback#empty">How messages work</TextLink>}
                headingLevel={4}
              />
            </div>
          </Row>
        </Section>

        <Section
          id="errors"
          title="Errors"
          intro="What happened + what to do, never a raw error code. Each is said once, politely, when it appears. Try again is a kit <Button>: it shows its spinner while the retry runs and can't be pressed twice."
        >
          <Row name="A part of the page" note="Can’t load your jobs: cloud_off, Try again, Contact support." block>
            <div className={`${styles.card} ${styles.narrow}`}>
              <ErrorPreview
                title="Can’t load your jobs"
                message="Check your connection and try again. If it keeps happening, let us know."
                secondaryAction={<TextLink href="/dev/components/feedback#errors">Contact support</TextLink>}
                headingLevel={4}
                announce={false}
              />
            </div>
          </Row>
          <Row name="Retrying" note="While a retry runs: spinner, same width, more presses do nothing." block>
            <div className={`${styles.card} ${styles.narrow}`}>
              <ErrorPreview title="Can’t load your jobs" message="Check your connection and try again." retrying headingLevel={4} announce={false} />
            </div>
          </Row>
          <Row name="Try it" note="Press Try again: the first try fails, the second loads the list." block>
            <RetryDemo />
          </Row>
          <Row name="The whole page (500)" note="size=page: taller, an h1 on a real page. Our fault, say so; a support reference, never the raw error." block>
            <div className={styles.card}>
              <ErrorPreview
                size="page"
                icon="build"
                title="Something broke on our end."
                message="It’s not you. Try again in a minute. Anything you typed is saved."
                secondaryAction={
                  <Button variant="secondary" size="sm" href="/dev/components/feedback#errors">
                    Contact us
                  </Button>
                }
                reference="7F3A-91"
                headingLevel={4}
                announce={false}
              />
            </div>
          </Row>
          <Row name="Inline" note="A red banner inside a card or above a form. Try again sits at the end." block>
            <InlineErrorPreview message="Couldn’t save your changes. Check your connection and try again." announce={false} />
            <InlineError message="We couldn’t load the photos for this job." announce={false} />
          </Row>
          <Row name="Inline, try it" note="Try again saves after a moment." block>
            <InlineRetryDemo />
          </Row>
        </Section>

        <Section
          id="offline"
          title="Offline"
          intro="A persistent banner across the top of the page. It retries by itself with backoff (2s, 4s, 8s … 30s) and once more when the connection comes back, then says “You’re back online.” for 4 seconds. Skeletons stay. The real one is at the top of this page: switch DevTools › Network to Offline."
        >
          <Row name="Offline, with Retry now" block>
            <div className={styles.frame}>
              <OfflinePreview />
              <div className={styles.frameBody}>
                <JobRowSkeleton count={2} />
              </div>
            </div>
          </Row>
          <Row name="Offline, nothing to retry" note="Without onRetry: the copy-sheet line, no button." block>
            <div className={styles.frame}>
              <OfflineBanner online={false} sticky={false} />
            </div>
          </Row>
          <Row name="Try it" note="Go offline, wait for the automatic retries, then come back online." block>
            <OfflineDemo />
          </Row>
        </Section>

        <Section
          id="long-text"
          title="Long text"
          intro="Names, suburbs and job titles can be any length. Everything wraps; nothing spills out or scrolls sideways, also at 200% zoom."
        >
          <Row name="Empty state" block>
            <div className={`${styles.card} ${styles.narrow}`}>
              <EmptyState
                icon="person_search"
                title={`No jobs from ${LONG_NAME} in Papatoetoe, Ōtāhuhu or Māngere Bridge yet.`}
                message={`We’ll let you know when ${LONG_WORD} has something for you.`}
                action={<Button href="/dev/components/feedback#long-text">{`Find another tradie near Māngere Bridge`}</Button>}
                headingLevel={4}
              />
            </div>
          </Row>
          <Row name="Error" block>
            <div className={`${styles.card} ${styles.narrow}`}>
              <ErrorPreview
                title={`Can’t load the switchboard upgrade for ${LONG_NAME}`}
                message={`Check your connection and try again. ${LONG_WORD}.`}
                retryLabel="Try loading the switchboard upgrade again"
                reference="7F3A-91-ŌTAUTAHI-ELECTRICAL-SERVICES-PAPATOETOE"
                headingLevel={4}
                announce={false}
              />
            </div>
          </Row>
          <Row name="Inline error, spinner, progress" block>
            <div className={styles.narrow}>
              <InlineErrorPreview message={`Couldn’t send your message to ${LONG_NAME}. ${LONG_WORD}.`} announce={false} />
            </div>
            <div className={styles.narrow}>
              <Spinner label={`Loading jobs near ${LONG_WORD}`} />
            </div>
            <div className={styles.narrow}>
              <ProgressBar label={`Uploading ${LONG_WORD}-switchboard-before-photo.jpg`} value={0.65} />
            </div>
          </Row>
        </Section>

        <Section
          id="usage"
          title="Usage"
          intro="A “My jobs” panel in each state, built from the kit, and the code that makes it. ?state=empty (or loading, error, jobs) opens it in that state."
        >
          <UsageExample key={usageState} initial={usageState} />
          <pre className={styles.code} tabIndex={0} aria-label="Usage example code">
            <code>{USAGE_SOURCE}</code>
          </pre>
        </Section>
      </main>
    </div>
  );
}
