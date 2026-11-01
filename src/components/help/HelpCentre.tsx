"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { QuickFilters } from "@/components/data";
import { EmptyState, ErrorState, InlineError, LiveMessage, LoadingRegion, Skeleton, SkeletonText } from "@/components/feedback";
import { TextField } from "@/components/forms";
import { HELP_TOPICS, searchHelp, type HelpArticle, type HelpFeedbackInput, type HelpFeedbackResult, type HelpState } from "@/lib/help";
import { useIsClient } from "@/lib/motion/hooks";
import { MOTION_MS } from "@/lib/motion/timings";
import styles from "./help.module.css";

type Submit = (input: HelpFeedbackInput) => Promise<HelpFeedbackResult>;
type Props = { articles: HelpArticle[]; article?: HelpArticle; query?: string; state?: HelpState; submit: Submit };
const filters = ["All", "Payments", "My job", "Account", "Tradies"].map(value => ({ value, label: value }));
const railSlugs = ["posting-a-job", "how-is-my-price-worked-out", "when-do-i-pay", "extra-work", "cancelling-a-job", "something-is-not-right"];
const railNames: Record<string, string> = { "cancelling-a-job": "Cancelling", "extra-work": "Extra work" };
const relatedNames: Record<string, string> = { "cancelling-a-job": "Cancelling a job", "extra-work": "Extra work" };

function SupportCard() {
  // The support inbox is a separate planned screen (#186). The approved public email works for guests too.
  return <div className={styles.supportCard}><Icon name="support_agent" decorative /><div><b>Still stuck?</b><p>We reply within one working day.</p></div><Button href="mailto:hello@trademarketplace.nz" size="sm" width="auto">Message us</Button></div>;
}
function ArticleBody({ article }: { article: HelpArticle }) {
  return <div className={styles.prose}>{article.blocks.map((block, index) => block.type === "heading" ? <h2 key={index}>{block.text}</h2> : <p key={index}>{block.text}</p>)}</div>;
}
function Feedback({ article, submit, state }: { article: HelpArticle; submit: Submit; state: HelpState }) {
  const [vote, setVote] = useState<boolean | null>(state === "not-helpful" ? false : null);
  const [saved, setSaved] = useState(state === "helpful-voted");
  const [error, setError] = useState(state === "feedback-error");
  const [pending, setPending] = useState(false);
  const [lookingFor, setLookingFor] = useState("");
  const note = useRef<HTMLInputElement>(null);
  async function save(helpful: boolean, finish = true) {
    if (pending) return;
    setPending(true); setError(false);
    try {
      const result = await submit({ slug: article.slug, helpful, lookingFor });
      if (result.status === "saved") { if (finish) setSaved(true); } else setError(true);
    } catch { setError(true); }
    finally { setPending(false); }
  }
  const no = () => { setVote(false); void save(false, false); requestAnimationFrame(() => note.current?.focus()); };
  return <div className={styles.feedback} aria-label="Article feedback">
    {saved ? <p role="status"><Icon name="check_circle" decorative /> Thanks for your feedback.</p> : <>
      <div className={styles.vote}><b>Was this helpful?</b><Button size="sm" width="auto" variant="secondary" icon="thumb_up" loading={pending && vote !== false} disabled={pending} onClick={() => { setVote(true); void save(true); }}>Yes</Button><Button size="sm" width="auto" variant="secondary" icon="thumb_down" disabled={pending} aria-pressed={vote === false} onClick={no}>No</Button></div>
      {vote === false && <form className={styles.note} onSubmit={(event) => { event.preventDefault(); void save(false); }}><TextField ref={note} label="What were you looking for?" value={lookingFor} maxLength={300} onChange={event => setLookingFor(event.target.value)} /><Button type="submit" size="sm" width="auto" loading={pending}>Send feedback</Button></form>}
      {error && <InlineError message="Couldn’t save your feedback. Try again." onRetry={() => save(vote ?? true)} />}
    </>}
  </div>;
}
const compactQuery = "(max-width: 1023.98px)";
function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const isCompact = () => window.matchMedia(compactQuery).matches;
const serverCompact = () => false;
function Search({ articles, value, resultQuery, onChange }: { articles: HelpArticle[]; value: string; resultQuery: string; onChange: (value: string) => void }) {
  const compact = useSyncExternalStore(subscribeCompact, isCompact, serverCompact);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const id = useId();
  const router = useRouter();
  const results = searchHelp(articles, resultQuery).slice(0, 6);
  const shown = open && value.trim().length > 0;
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (event.key === "/" && !(target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable))) { event.preventDefault(); ref.current?.focus(); }
    };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("keydown", shortcut); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", shortcut); document.removeEventListener("pointerdown", outside); };
  }, []);
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setActive(index => results.length === 0 ? -1 : event.key === "ArrowDown" ? (index + 1) % results.length : index <= 0 ? results.length - 1 : index - 1);
    }
    if (event.key === "Enter" && shown && active >= 0 && results[active]) { event.preventDefault(); setOpen(false); router.push(`/help/${results[active].slug}`); }
  }
  return <div className={styles.searchHost} ref={host} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <form role="search" onSubmit={(event: FormEvent) => { event.preventDefault(); setOpen(false); router.push(`/help?q=${encodeURIComponent(value)}`); }}>
      <TextField ref={ref} type="search" label="Search help articles" labelHidden icon="search" className={styles.searchField} placeholder={compact ? "How can we help?" : "Search help articles"} value={value} maxLength={200} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={shown ? id : undefined} aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined} onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setActive(-1); setOpen(true); }} onKeyDown={key} />
    </form>
    {shown && <div className={`${styles.suggestions} tm-anim-suggest`}><ul role="listbox" id={id} aria-label="Suggested help articles">
      {results.map((article, index) => <li role="option" id={`${id}-${index}`} aria-selected={active === index} key={article.slug} onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => { setOpen(false); router.push(`/help/${article.slug}`); }}>{article.title}</li>)}
    </ul>{results.length === 0 && <div className={styles.noSuggestion}>No articles found. <TextLink href="mailto:hello@trademarketplace.nz">Message us</TextLink></div>}</div>}
  </div>;
}
export function HelpLoading() {
  return <div className={styles.page}><div className={styles.loading}><LoadingRegion loading label="Loading help articles" skeleton={<><Skeleton width="65%" height={38} /><SkeletonText lines={4} /><SkeletonText lines={3} /></>} /></div></div>;
}
export function HelpCentre({ articles, article, query = "", state = "default", submit }: Props) {
  const ready = useIsClient();
  const [search, setSearch] = useState(state === "search-results" ? "pay" : state === "no-results" ? "unmatched search" : query);
  const [debounced, setDebounced] = useState(search);
  const [topic, setTopic] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => { const timer = setTimeout(() => setDebounced(search), MOTION_MS.m08Debounce); return () => clearTimeout(timer); }, [search]);
  const results = searchHelp(articles, debounced, topic);
  const searching = debounced.trim().length > 0;
  const showingArticle = article && !searching;
  const navigationArticles = article?.topic === "Customers" ? railSlugs.map(slug => articles.find(item => item.slug === slug)).filter((item): item is HelpArticle => Boolean(item)) : articles.filter(item => item.topic === article?.topic || item.group === article?.topic);
  const HeroHeading = showingArticle ? "h2" : "h1";
  const PhoneHeading = showingArticle ? "h2" : "h1";
  return <div className={styles.page} data-help-ready={ready || undefined}>
    <div className={styles.phoneBar}><TextLink href={article ? "/help" : "/"} aria-label={article ? "Back to help" : "Go home"}><Icon name="arrow_back" decorative /></TextLink><PhoneHeading>Help & support</PhoneHeading></div>
    <section className={styles.hero} data-site-hero><div className={styles.boltClip}><BoltMark variant="hero" className={styles.bolt} /></div><div className={styles.heroInner}><HeroHeading>How can we help?</HeroHeading><Search articles={articles} value={search} resultQuery={debounced} onChange={setSearch} /></div></section>
    <div className={`${styles.wrap} ${showingArticle ? styles.articleLayout : styles.homeLayout}`}>
      {state === "loading" ? <div className={styles.loading}><h1 className={styles.srOnly}>Loading help articles</h1><LoadingRegion loading label="Loading help articles" skeleton={<><Skeleton width="65%" height={38} /><SkeletonText lines={4} /></>} /></div> : state === "error" ? <ErrorState title="Can’t load help articles" headingLevel={article ? 1 : 2} onRetry={() => router.push(article ? `/help/${article.slug}` : "/help")} /> : <>
        {showingArticle && <nav aria-label="Customer help articles" className={styles.topicNav}><h2>{article.topic}</h2>{navigationArticles.map(item => <Link key={item.slug} href={`/help/${item.slug}`} aria-current={article.slug === item.slug ? "page" : undefined}>{railNames[item.slug] ?? item.title}</Link>)}</nav>}
        {showingArticle ? <article className={styles.article}><nav aria-label="Breadcrumb" className={styles.crumbs}><Link href="/help">Help</Link><Icon name="chevron_right" size="sm" decorative /><Link href={`/help?q=${encodeURIComponent(article.topic)}`}>{article.topic}</Link><Icon name="chevron_right" size="sm" decorative /><span>{article.group}</span></nav><h1>{article.title}</h1><p className={styles.meta}>Updated {new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(article.updated))} · {article.minutes} min read</p><ArticleBody article={article} /><Feedback key={article.slug} article={article} state={state} submit={submit} /></article> : <section className={styles.home} aria-label="Help articles">
          <div className={styles.topics}>{HELP_TOPICS.map(value => <button key={value} aria-pressed={topic === value} onClick={() => setTopic(topic === value ? "All" : value)}><Icon name={value === "Payments" ? "payments" : value === "Tradies" ? "construction" : value === "Account" ? "account_circle" : "home_repair_service"} decorative /><span>{value}</span><Icon name="chevron_right" decorative /></button>)}</div>
          <div className={styles.filters}><QuickFilters label="Help topics" items={filters} value={topic} onChange={setTopic} /></div>
          <h2 className={styles.listTitle}>{searching ? "Search results" : topic === "All" ? "Popular articles" : topic}</h2>
          {results.length === 0 ? <EmptyState icon="search_off" title="No articles found" action={<Button href="mailto:hello@trademarketplace.nz" width="auto">Message us</Button>} /> : <div className={styles.articleList}>{results.map((item, index) => <div key={item.slug} className={styles.faqRow} data-secondary={index >= 4 && topic === "All" && !searching || undefined}>
            <Link href={`/help/${item.slug}`} className={styles.desktopArticle}>{item.title}<Icon name="chevron_right" decorative /></Link>
            <div className={styles.phoneArticle}><button aria-expanded={expanded === item.slug} aria-controls={`answer-${item.slug}`} onClick={() => setExpanded(expanded === item.slug ? null : item.slug)}><span className={styles.helpIcon}><Icon name="help" size="sm" decorative /></span><span>{item.title}</span><Icon name="expand_more" decorative /></button><div className="tm-accordion" data-open={expanded === item.slug}><div id={`answer-${item.slug}`} inert={expanded !== item.slug}><ArticleBody article={item} /><TextLink href={`/help/${item.slug}`}>Read article</TextLink></div></div></div>
          </div>)}</div>}
          <LiveMessage message={searching ? `${results.length} articles found` : null} />
        </section>}
        <aside className={styles.support}><SupportCard />{showingArticle && <div className={styles.related}><h2>Related</h2>{article.related.map(slug => articles.find(item => item.slug === slug)).filter((item): item is HelpArticle => Boolean(item)).map(item => <TextLink key={item.slug} href={`/help/${item.slug}`}>{relatedNames[item.slug] ?? item.title}</TextLink>)}</div>}</aside>
      </>}
    </div>
  </div>;
}
