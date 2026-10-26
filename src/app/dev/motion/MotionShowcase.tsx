"use client";
// /dev/motion demos: one card per named animation, each with a "Play Mxx · Name" button. Every demo uses the
// shared classes (src/styles/motion.css) and hooks (src/lib/motion/hooks.ts), never its own animation, so what
// plays here is exactly what the app plays. Prices, names and counts are examples.
import {
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { BoltMark } from "@/components/BoltMark";
import { Icon } from "@/components/Icon";
import { BoltFlash } from "@/components/motion/BoltFlash";
import { CountUp, formatNzd } from "@/components/motion/CountUp";
import type { MotionEntry } from "@/lib/motion/catalogue";
import { becameTrue, formatCountdown, isUrgent, morphName, ringFraction, staggerStyle, wentUp } from "@/lib/motion/helpers";
import {
  startViewTransition,
  useBump,
  useCountdown,
  useDebouncedValue,
  useDropZone,
  useHoverOrFocus,
  useOncePerEvent,
  useParallax,
  usePrefersReducedMotion,
  usePresence,
  useScrolledPast,
  useStickToBottom,
  useSwap,
  useTabIndicator,
  useToastTimer,
} from "@/lib/motion/hooks";
import { EXIT_MS, MOTION_MS } from "@/lib/motion/timings";

import styles from "./motion.module.css";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type DemoProps = { entry: MotionEntry };

/** Shows whether the visitor's system asks for reduced motion (the hooks read the same setting). */
export function ReducedMotionStatus() {
  const reduced = usePrefersReducedMotion();
  return (
    <p className={styles.reduced} data-reduced={reduced ? "on" : "off"}>
      Reduced motion: <b>{reduced ? "on, every animation is an instant change" : "off"}</b>
    </p>
  );
}

export function MotionShowcase({ entries }: { entries: readonly MotionEntry[] }) {
  return (
    <div className={styles.grid}>
      {entries.map((entry) => {
        const Demo = DEMOS[entry.id];
        return (
          <Card key={entry.id} entry={entry}>
            {Demo ? <Demo entry={entry} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

function Card({ entry, children }: { entry: MotionEntry; children: ReactNode }) {
  const id = entry.id.toLowerCase();
  return (
    <article id={id} className={styles.card} aria-labelledby={`${id}-title`}>
      <header className={styles.cardHead}>
        <span className={styles.mid}>{entry.id}</span>
        <h2 id={`${id}-title`} className={styles.cardTitle}>
          {entry.name}
        </h2>
      </header>
      <p className={styles.what}>{entry.what}</p>
      <dl className={styles.meta}>
        <div>
          <dt>Timing</dt>
          <dd>{entry.timing}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{entry.where}</dd>
        </div>
      </dl>
      {children}
      <p className={styles.uses}>
        <span>Use</span>
        {entry.uses.map((use) => (
          <code key={use}>{use}</code>
        ))}
      </p>
    </article>
  );
}

function Stage({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <div className={cx(styles.stage, center && styles.center)}>{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

function Play({ entry, onClick }: { entry: MotionEntry; onClick: () => void }) {
  return (
    <button type="button" className={styles.play} onClick={onClick}>
      <Icon name="play_arrow" fill decorative size="sm" />
      Play {entry.id} · {entry.name}
    </button>
  );
}

function Extra({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.extra} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Turns a state on for `ms`, for demos of hover-type states. */
function useFlash(ms: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const trigger = () => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  };
  return [on, trigger] as const;
}

/** A replay counter: 0 = never played (no animation class on first paint). */
function useRuns() {
  const [run, setRun] = useState(0);
  return [run, () => setRun((r) => r + 1)] as const;
}

// ---- M01 Page enter -----------------------------------------------------------------------
function M01({ entry }: DemoProps) {
  const [run, replay] = useRuns();
  return (
    <>
      <Stage>
        <div key={run} className={styles.miniPage}>
          <div className={cx(styles.miniHead, run > 0 && "tm-anim-rise")} />
          <div className={cx(styles.miniGrid, run > 0 && "tm-stagger")}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.miniCard} />
            ))}
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={replay} />
      </Actions>
    </>
  );
}

// ---- M02 Route transition -----------------------------------------------------------------
function M02({ entry }: DemoProps) {
  const [open, setOpen] = useState(false);
  const name = morphName("job-photo", "demo");
  return (
    <>
      <Stage>
        {open ? (
          <div className={styles.jobPage}>
            <div className={cx(styles.photo, styles.jobHeader)} style={{ viewTransitionName: name }}>
              <span>Fix a leaking tap</span>
            </div>
            <div className={styles.lines}>
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : (
          <div className={styles.tileRow}>
            <div className={styles.photo} style={{ viewTransitionName: name }} />
            <div className={cx(styles.photo, styles.photoAlt)} />
            <div className={styles.photo} />
          </div>
        )}
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => startViewTransition(() => setOpen((o) => !o))} />
        <span className={styles.note}>Now showing: {open ? "job page" : "list"}</span>
      </Actions>
    </>
  );
}

// ---- M03 Hover lift -----------------------------------------------------------------------
function M03({ entry }: DemoProps) {
  const [hover, trigger] = useFlash(1400);
  return (
    <>
      <Stage center>
        <div className={cx("tm-lift", styles.liftCard, hover && "is-hover")}>
          <div className={cx("tm-zoom", styles.liftPhoto)}>
            <div className={cx("tm-zoom__img", styles.photoFill)} />
          </div>
          <div className={styles.liftBody}>
            <b>New power point</b>
            <span>Post it → get your price</span>
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={trigger} />
        <span className={styles.note}>Or hover the card</span>
      </Actions>
    </>
  );
}

// ---- M04 Button press ---------------------------------------------------------------------
function M04({ entry }: DemoProps) {
  const [state, setState] = useState<"rest" | "hover" | "press">("rest");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const play = () => {
    timers.current.forEach(clearTimeout);
    setState("hover");
    timers.current = [setTimeout(() => setState("press"), 700), setTimeout(() => setState("rest"), 1000)];
  };
  const forced = state === "hover" ? "is-hover" : state === "press" ? "is-press" : null;
  return (
    <>
      <Stage center>
        <div className={styles.buttonRow}>
          <button type="button" className={cx("tm-press tm-press--primary", styles.btnPrimary, forced)}>
            Primary
          </button>
          <button type="button" className={cx("tm-press tm-press--secondary", styles.btnSecondary, forced)}>
            Secondary
          </button>
          <button type="button" className={cx("tm-press tm-press--hero", styles.btnHero, forced)}>
            Accept &amp; pay
          </button>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={play} />
        <span className={styles.note}>Plays hover, then press. Or try them.</span>
      </Actions>
    </>
  );
}

// ---- M05 Focus ring -----------------------------------------------------------------------
function M05({ entry }: DemoProps) {
  const [on, trigger] = useFlash(1600);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Stage center>
        <button ref={ref} type="button" className={cx(styles.btnSecondary, on && styles.forcedFocus)}>
          Tab to me
        </button>
      </Stage>
      <Actions>
        <Play
          entry={entry}
          onClick={() => {
            trigger();
            ref.current?.focus();
          }}
        />
        <span className={styles.note}>Appears instantly, no transition</span>
      </Actions>
    </>
  );
}

// ---- M06 Hero bolt parallax + nav fill --------------------------------------------------------
function M06({ entry }: DemoProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const bolt = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  useParallax(bolt, { scrollContainer: scroller });
  const solid = useScrolledPast(hero, { offset: 40, scrollContainer: scroller });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const play = () => {
    const el = scroller.current;
    if (!el) return;
    const behavior = reduced ? "auto" : "smooth";
    clearTimeout(timer.current);
    el.scrollTo({ top: el.scrollHeight, behavior });
    timer.current = setTimeout(() => el.scrollTo({ top: 0, behavior }), 1400);
  };
  return (
    <>
      <Stage>
        <div ref={scroller} className={styles.scroller} tabIndex={0} role="region" aria-label="M06 demo page, scroll it">
          <div className={cx("tm-navfill", styles.demoNav)} data-solid={solid ? "true" : "false"}>
            <b>Trade Marketplace</b>
            <span className={styles.navTradies}>For tradies</span>
          </div>
          <div ref={hero} className={styles.hero}>
            <span ref={bolt} className={cx("tm-parallax", styles.heroBoltWrap)}>
              <BoltMark variant="hero" className={styles.heroBolt} />
            </span>
            <p className={styles.heroText}>Post any job free.</p>
          </div>
          <div className={styles.lines}>
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={play} />
        <span className={styles.note}>Scrolls the mini page down and back</span>
      </Actions>
    </>
  );
}

// ---- M07 Headline reveal ------------------------------------------------------------------
function M07({ entry }: DemoProps) {
  const [run, replay] = useRuns();
  const anim = run > 0 ? "tm-anim-reveal" : undefined;
  return (
    <>
      <Stage>
        <div key={run} className={styles.revealBand}>
          <p className={styles.revealHead}>
            <span className={anim} style={staggerStyle(0)}>
              Post any job.
            </span>
            <span className={anim} style={staggerStyle(1)}>
              Get one fair price.
            </span>
          </p>
          <p className={cx(styles.revealSub, anim)} style={staggerStyle(2)}>
            Someone local sorts it.
          </p>
          <div className={cx(styles.revealSearch, anim)} style={staggerStyle(3)}>
            <Icon name="search" decorative size="sm" />
            What needs doing?
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={replay} />
        <span className={styles.note}>In the app: once per visit</span>
      </Actions>
    </>
  );
}

// ---- M08 Search suggestions ---------------------------------------------------------------
const SUGGESTIONS = [
  "Power point not working",
  "New power point",
  "Leaking tap",
  "Hot water cylinder",
  "Heat pump circuit",
  "Fence repair",
  "Lawn mowing",
];

function M08({ entry }: DemoProps) {
  const [query, setQuery] = useState("");
  const settled = useDebouncedValue(query).trim().toLowerCase();
  const results = settled ? SUGGESTIONS.filter((s) => s.toLowerCase().includes(settled)) : [];
  return (
    <>
      <Stage>
        <div className={styles.searchWrap}>
          <label htmlFor="m08-query" className={styles.label}>
            Search jobs
          </label>
          <input
            id="m08-query"
            className={styles.input}
            value={query}
            autoComplete="off"
            aria-describedby="m08-hint"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span id="m08-hint" className={styles.hiddenText}>
            Suggestions appear below as you type
          </span>
          {results.length > 0 && (
            <ul className={cx("tm-anim-suggest", styles.suggest)} aria-label="Suggestions">
              {results.map((r) => (
                <li key={r}>
                  <Icon name="search" decorative size="sm" />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setQuery((q) => (q ? "" : "po"))} />
        <span className={styles.note}>Or type: updates 150ms after you stop</span>
      </Actions>
    </>
  );
}

// ---- M09 Price reveal ---------------------------------------------------------------------
const TICKS = ["Labour, parts and call-out included", "Fixed: it won’t go up", "Saying no is free"];

function PriceReveal({ eventId }: { eventId: string | null }) {
  const first = useOncePerEvent(eventId);
  const reduced = usePrefersReducedMotion();
  const play = first && !reduced;
  const anim = (cls: string) => (play ? cls : undefined);
  const status = !eventId
    ? "Not played yet"
    : first
      ? reduced
        ? "New event, shown straight away (reduced motion)"
        : "New event: plays once"
      : "Seen before: shown straight away";
  return (
    <div className={styles.priceWrap}>
      <div className={cx(styles.pricebox, anim("tm-anim-wipe"))}>
        <BoltMark variant="hero" className={styles.priceBolt} />
        <span className={styles.priceCap}>Your price</span>
        <CountUp
          value={372}
          format={formatNzd}
          run={play}
          runKey={eventId ?? ""}
          duration={MOTION_MS.m09Count}
          delay={MOTION_MS.m09Wipe}
          className={styles.price}
        />
        <span className={styles.priceCap}>Fixed price · incl. GST</span>
        <span className={cx(styles.underline, anim("tm-anim-underline"))} />
      </div>
      <ul className={styles.ticks}>
        {TICKS.map((t, i) => (
          <li key={t} className={anim("tm-anim-tick")} style={staggerStyle(i)}>
            <Icon name="check_circle" fill decorative size="sm" className={styles.tickIcon} />
            {t}
          </li>
        ))}
      </ul>
      <p className={styles.eventNote}>{status}</p>
    </div>
  );
}

function M09({ entry }: DemoProps) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  return (
    <>
      <Stage>
        <PriceReveal key={`${eventId}-${visit}`} eventId={eventId} />
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setEventId(`demo-price-ready:${Date.now()}`)} />
        <Extra disabled={!eventId} onClick={() => setVisit((v) => v + 1)}>
          Revisit the same job
        </Extra>
      </Actions>
    </>
  );
}

// ---- M10 Bolt flash -------------------------------------------------------------------------
function M10({ entry }: DemoProps) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  const [mark, setMark] = useState<"check" | "bolt">("check");
  return (
    <>
      <Stage center>
        <div className={styles.flashWrap}>
          <BoltFlash key={`${eventId}-${visit}`} eventId={eventId} mark={mark} />
          <p className={styles.flashTitle}>{mark === "bolt" ? "It’s yours." : "Posted."}</p>
        </div>
      </Stage>
      <Actions>
        <Play
          entry={entry}
          onClick={() => {
            setVisit(0);
            setEventId(`demo-posted:${Date.now()}`);
          }}
        />
        <Extra disabled={!eventId} onClick={() => setVisit((v) => v + 1)}>
          Revisit the same event
        </Extra>
        <Extra onClick={() => setMark((m) => (m === "check" ? "bolt" : "check"))}>
          {mark === "check" ? "Use the bolt" : "Use the tick"}
        </Extra>
      </Actions>
    </>
  );
}

// ---- M11 Tracker progress ----------------------------------------------------------------
const STEPS = ["Posted", "Getting your price", "Accept & pay", "Tradie on the way", "Sorted"];

function M11({ entry }: DemoProps) {
  const [now, setNow] = useState(1);
  const [run, setRun] = useState(0);
  const advance = () => {
    setNow((n) => (n >= STEPS.length - 1 ? 1 : n + 1));
    setRun((r) => r + 1);
  };
  return (
    <>
      <Stage>
        <ol className={styles.track}>
          {STEPS.map((label, i) => {
            const state = i < now ? "done" : i === now ? "now" : "todo";
            const fresh = run > 0 && i === now;
            const freshLine = run > 0 && i === now - 1;
            return (
              <li key={label} className={styles.step} data-state={state}>
                {i < STEPS.length - 1 && (
                  <span className={styles.line}>
                    {i < now && <span key={freshLine ? run : 0} className={cx(styles.lineFill, freshLine && "tm-anim-fill")} />}
                  </span>
                )}
                <span key={fresh ? run : 0} className={cx(styles.dot, fresh && "tm-anim-step-dot")}>
                  {state === "done" && <Icon name="check" decorative className={styles.dotIcon} />}
                </span>
                <span key={fresh ? `l${run}` : "l"} className={cx(styles.stepLabel, fresh && "tm-anim-step-label")}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={advance} />
      </Actions>
    </>
  );
}

// ---- M12 Drawer and M13 Dialog: native <dialog> (focus trap, Esc), animated in and out -----------
function Modal({
  open,
  onClose,
  kind,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kind: "drawer" | "dialog";
  labelledBy: string;
  children: ReactNode;
}) {
  const { mounted, exiting } = usePresence(open, kind === "drawer" ? EXIT_MS.drawer : EXIT_MS.dialog);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!mounted || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => opener?.focus();
  }, [mounted]);

  if (!mounted) return null;
  const anim =
    kind === "drawer"
      ? exiting
        ? "tm-anim-drawer-out"
        : "tm-anim-drawer"
      : exiting
        ? "tm-anim-dialog-out"
        : "tm-anim-dialog";
  return (
    <dialog
      ref={ref}
      className={cx(kind === "drawer" ? styles.drawer : styles.dialog, anim)}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function M12({ entry }: DemoProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Stage center>
        <p className={styles.note}>Opens over the whole window from the right.</p>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setOpen(true)} />
      </Actions>
      <Modal open={open} onClose={close} kind="drawer" labelledBy="m12-title">
        <div className={styles.drawerHead}>
          <div>
            <p className={styles.caption}>Sub wiring · TM-1005</p>
            <h2 id="m12-title" tabIndex={-1} data-autofocus className={styles.overlayTitle}>
              Your estimate
            </h2>
          </div>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={close}>
            <Icon name="close" decorative />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <p>
            <b>Private.</b> Nobody else sees your numbers. Price it like you’d do it.
          </p>
          <p className={styles.caption}>Esc or Close slides it back out (200ms) and focus returns to the button.</p>
        </div>
        <div className={styles.drawerFoot}>
          <button type="button" className={styles.btnPrimary} onClick={close}>
            Done
          </button>
        </div>
      </Modal>
    </>
  );
}

function M13({ entry }: DemoProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Stage center>
        <p className={styles.note}>Opens in the middle of the window.</p>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setOpen(true)} />
      </Actions>
      <Modal open={open} onClose={close} kind="dialog" labelledBy="m13-title">
        <h2 id="m13-title" tabIndex={-1} data-autofocus className={styles.overlayTitle}>
          Say no to this price?
        </h2>
        <p className={styles.dialogText}>We’ll let the tradies know. You can post it again any time.</p>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            Go back
          </button>
          <button type="button" className={styles.btnPrimary} onClick={close}>
            No thanks
          </button>
        </div>
        <p className={styles.caption}>Saying no is free.</p>
      </Modal>
    </>
  );
}

// ---- M14 Toast ------------------------------------------------------------------------------
function M14({ entry }: DemoProps) {
  const [open, setOpen] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const { mounted, exiting } = usePresence(open, EXIT_MS.toast);
  const hoverFocus = useHoverOrFocus();
  useToastTimer(() => setOpen(false), { active: open, paused: hoverFocus.active, runKey: toastKey });
  return (
    <>
      <Stage center>
        <p className={styles.note}>Appears at the bottom right of the window. Hover or focus it to pause.</p>
      </Stage>
      <Actions>
        <Play
          entry={entry}
          onClick={() => {
            setOpen(true);
            setToastKey((k) => k + 1);
          }}
        />
      </Actions>
      <div role="status" className={styles.toastRegion}>
        {mounted && (
          <div
            key={toastKey}
            className={cx(styles.toast, exiting ? "tm-anim-toast-out" : "tm-anim-toast")}
            data-paused={hoverFocus.active ? "true" : "false"}
            {...hoverFocus.handlers}
          >
            <Icon name="bookmark" fill decorative className={styles.toastIcon} />
            <span className={styles.toastText}>Saved. Find it in My jobs.</span>
            <button type="button" className={styles.toastUndo} onClick={() => setOpen(false)}>
              Undo
            </button>
            <span className="tm-toast-timer" aria-hidden="true" />
          </div>
        )}
      </div>
    </>
  );
}

// ---- M15 Skeleton -> content -------------------------------------------------------------------
const JOBS = [
  { title: "New power point", meta: "Electrical · 5 km" },
  { title: "Leaking tap", meta: "Plumbing · 2 km" },
];

function M15({ entry }: DemoProps) {
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const load = (ms: number | null) => {
    clearTimeout(timer.current);
    setLoading(true);
    if (ms === null) return;
    timer.current = setTimeout(() => {
      setLoading(false);
      setRound((r) => r + 1);
    }, ms);
  };
  return (
    <>
      <Stage>
        <ul className={styles.rows} aria-busy={loading} aria-label="Jobs">
          {loading
            ? JOBS.map((job) => (
                <li key={`skel-${job.title}`} className={styles.jobRow}>
                  <span className={cx("tm-skel", styles.skelImg)} />
                  <span className={styles.skelLines}>
                    <span className={cx("tm-skel", styles.skelShort)} />
                    <span className={cx("tm-skel", styles.skelLong)} />
                  </span>
                </li>
              ))
            : JOBS.map((job) => (
                <li key={`${job.title}-${round}`} className={cx(styles.jobRow, round > 0 && "tm-anim-swap")}>
                  <span className={cx(styles.photo, styles.rowImg)} />
                  <span className={styles.rowText}>
                    <span className={styles.caption}>{job.meta}</span>
                    <b>{job.title}</b>
                  </span>
                </li>
              ))}
        </ul>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => load(1800)} />
        <Extra onClick={() => (loading ? load(0) : load(null))}>{loading ? "Finish loading" : "Keep loading"}</Extra>
      </Actions>
    </>
  );
}

// ---- M16 Tab underline ------------------------------------------------------------------
const TABS = ["Home", "My jobs", "Messages"];

function M16({ entry }: DemoProps) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useTabIndicator(list, active);
  const select = (i: number, focus = false) => {
    const next = (i + TABS.length) % TABS.length;
    setActive(next);
    if (focus) document.getElementById(`m16-tab-${next}`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") select(active + 1, true);
    if (e.key === "ArrowLeft") select(active - 1, true);
  };
  return (
    <>
      <Stage>
        <div className={styles.tabsDemo}>
          <div ref={list} className={styles.tabsWrap}>
            <div role="tablist" aria-label="Sections" className={styles.tabs} onKeyDown={onKeyDown}>
              {TABS.map((tab, i) => (
                <button
                  key={tab}
                  id={`m16-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-controls="m16-panel"
                  tabIndex={i === active ? 0 : -1}
                  className={styles.tab}
                  onClick={() => select(i)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className={cx("tm-tab-indicator", styles.tabBar)} data-tab-indicator aria-hidden="true" />
          </div>
          <div id="m16-panel" role="tabpanel" aria-labelledby={`m16-tab-${active}`} className={styles.tabPanel}>
            {TABS[active]}
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => select(active + 1)} />
      </Actions>
    </>
  );
}

// ---- M17 Number ticker ------------------------------------------------------------------
const KPIS: { label: string; value: number; format?: (v: number) => string }[] = [
  { label: "Earned this month", value: 1284.5, format: formatNzd },
  { label: "Jobs done", value: 37 },
  { label: "Average rating", value: 4.9, format: (v) => v.toFixed(1) },
];

function M17({ entry }: DemoProps) {
  const [runKey, replay] = useRuns();
  return (
    <>
      <Stage>
        <dl className={styles.kpis}>
          {KPIS.map((kpi) => (
            <div key={kpi.label} className={styles.kpi}>
              <dt>{kpi.label}</dt>
              <dd>
                <CountUp value={kpi.value} format={kpi.format} startOnView runKey={runKey} className={styles.kpiN} />
              </dd>
            </div>
          ))}
        </dl>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={replay} />
        <span className={styles.note}>Also counts the first time it scrolls into view</span>
      </Actions>
    </>
  );
}

// ---- M18 Upload --------------------------------------------------------------------------
type Upload = { id: number; progress: number; status: "uploading" | "done" | "failed" };

function M18({ entry }: DemoProps) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  const start = (fail: boolean) => {
    clearInterval(timer.current);
    const id = Date.now();
    setUpload({ id, progress: 0, status: "uploading" });
    let progress = 0;
    timer.current = setInterval(() => {
      progress += 10;
      if (fail && progress >= 60) {
        clearInterval(timer.current);
        setUpload({ id, progress: 60, status: "failed" });
      } else if (progress >= 100) {
        clearInterval(timer.current);
        setUpload({ id, progress: 100, status: "done" });
      } else {
        setUpload({ id, progress, status: "uploading" });
      }
    }, 120);
  };
  const words = !upload
    ? "No upload yet"
    : upload.status === "done"
      ? "Photo uploaded"
      : upload.status === "failed"
        ? "Upload failed"
        : `Uploading ${upload.progress}%`;
  return (
    <>
      <Stage>
        <div className={styles.upload}>
          <div className={cx(styles.thumb, styles.photo)} />
          {upload && (
            <div key={upload.id} className={cx(styles.thumb, styles.photoAlt, "tm-anim-thumb")}>
              <span
                className={styles.ring}
                data-status={upload.status}
                style={{ "--p": `${upload.progress}%` } as CSSProperties}
                role="progressbar"
                aria-label="Photo upload"
                aria-valuenow={upload.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span className={styles.ringInner}>
                  {upload.status === "done" ? (
                    <Icon name="check" decorative className={cx(styles.ringIcon, "tm-anim-tick-pop")} />
                  ) : upload.status === "failed" ? (
                    <Icon name="priority_high" decorative className={styles.ringIcon} />
                  ) : null}
                </span>
              </span>
              {upload.status === "failed" && (
                <button type="button" className={styles.retry} onClick={() => start(false)}>
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
        <p className={styles.eventNote} role="status">
          {words}
        </p>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => start(false)} />
        <Extra onClick={() => start(true)}>Show a failed upload</Extra>
      </Actions>
    </>
  );
}

// ---- M19 Live message ------------------------------------------------------------------
const REPLIES = ["On my way, about 10 minutes.", "Thanks, see you then!", "Running a few minutes late.", "All done."];

function M19({ entry }: DemoProps) {
  const [messages, setMessages] = useState([
    { id: 1, me: false, text: "Hi, can you come Thursday?" },
    { id: 2, me: true, text: "Thursday 4pm works." },
  ]);
  const [typing, setTyping] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  useStickToBottom(thread, `${messages.length}-${typing}`);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const play = () => {
    clearTimeout(timer.current);
    setTyping(true);
    timer.current = setTimeout(() => {
      setTyping(false);
      setMessages((list) => [
        ...list,
        { id: list.length + 1, me: list.length % 2 === 1, text: REPLIES[list.length % REPLIES.length] },
      ]);
    }, 900);
  };
  return (
    <>
      <Stage>
        <div ref={thread} className={styles.thread} role="log" aria-label="Messages" tabIndex={0}>
          {messages.map((m) => (
            <p key={m.id} className={cx(styles.bubble, m.me ? styles.bubbleMe : styles.bubbleThem, m.id > 2 && "tm-anim-bubble")}>
              {m.text}
            </p>
          ))}
          {typing && (
            <p className={cx(styles.bubble, styles.bubbleThem)}>
              <span className="tm-typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className={styles.hiddenText}>Typing…</span>
            </p>
          )}
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={play} />
        <span className={styles.note}>Scroll up first: it won’t pull you down</span>
      </Actions>
    </>
  );
}

// ---- M20 Badge pop ------------------------------------------------------------------------
function M20({ entry }: DemoProps) {
  const [count, setCount] = useState(2);
  const bump = useBump(count, wentUp);
  return (
    <>
      <Stage center>
        <span className={styles.bell}>
          <Icon name="notifications" fill label={`Notifications: ${count} new`} />
          {count > 0 && (
            <span key={bump} className={cx(styles.count, bump > 0 && "tm-anim-badge")} aria-hidden="true">
              {count}
            </span>
          )}
        </span>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setCount((c) => c + 1)} />
        <Extra onClick={() => setCount((c) => Math.max(0, c - 1))}>One fewer (no pop)</Extra>
      </Actions>
    </>
  );
}

// ---- M21 Map pins ------------------------------------------------------------------------
const PINS = [
  { id: "a", label: "$259", x: 24, y: 42, kind: "claim", row: "Sub wiring" },
  { id: "b", label: "$96", x: 60, y: 30, kind: "claim", row: "New power point" },
  { id: "c", label: "$410", x: 42, y: 80, kind: "claim" },
  { id: "d", label: "Estimate", x: 78, y: 66, kind: "est" },
  { id: "e", label: "$30 · 17h", x: 82, y: 32, kind: "bounty" },
] as const;

function M21({ entry }: DemoProps) {
  const [run, replay] = useRuns();
  const [hot, setHot] = useState<string | null>(null);
  return (
    <>
      <Stage>
        <div className={styles.mapDemo}>
          <div key={run} className={styles.map}>
            {PINS.map((pin, i) => (
              <span
                key={pin.id}
                className={cx(
                  "tm-pin",
                  styles.pin,
                  pin.kind === "est" && styles.pinEst,
                  pin.kind === "bounty" && cx(styles.pinBounty, "tm-glint"),
                  run > 0 && "tm-anim-pin",
                  hot === pin.id && "is-hot",
                )}
                style={{ left: `${pin.x}%`, top: `${pin.y}%`, ...staggerStyle(i) }}
                onMouseEnter={() => setHot(pin.id)}
                onMouseLeave={() => setHot(null)}
              >
                {pin.label}
              </span>
            ))}
          </div>
          <div className={styles.mapRows}>
            {PINS.filter((p) => "row" in p).map((pin) => (
              <button
                key={pin.id}
                type="button"
                className={cx(styles.mapRow, hot === pin.id && styles.mapRowHot)}
                onMouseEnter={() => setHot(pin.id)}
                onMouseLeave={() => setHot(null)}
                onFocus={() => setHot(pin.id)}
                onBlur={() => setHot(null)}
              >
                <span>{"row" in pin ? pin.row : ""}</span>
                <b>{pin.label}</b>
              </button>
            ))}
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={replay} />
        <span className={styles.note}>Hover or focus a row to grow its pin</span>
      </Actions>
    </>
  );
}

// ---- M22 Claim lost ---------------------------------------------------------------------
function M22({ entry }: DemoProps) {
  const [lost, setLost] = useState(false);
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const play = () => {
    clearTimeout(timer.current);
    setLost(false);
    setRound((r) => r + 1);
    timer.current = setTimeout(() => setLost(true), 60);
  };
  return (
    <>
      <Stage>
        <div key={round} className={styles.claimWrap}>
          <div role="status">
            {lost && <p className={cx(styles.banner, "tm-anim-slide-down")}>Too slow. Someone else got this one.</p>}
          </div>
          <div className={cx("tm-claim-lost", styles.claimCard)} data-lost={lost ? "true" : "false"}>
            <span className={cx(styles.photo, styles.rowImg)} />
            <span className={styles.rowText}>
              <span className={styles.caption}>5 km · Glengarry</span>
              <b>New power point</b>
              <span className={styles.caption}>You earn {formatNzd(96)}</span>
            </span>
            <button type="button" className={cx(styles.btnPrimary, styles.btnSmall)} disabled={lost}>
              Claim
            </button>
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={play} />
      </Actions>
    </>
  );
}

// ---- M23 Save ---------------------------------------------------------------------------
function M23({ entry }: DemoProps) {
  const [saved, setSaved] = useState(false);
  const bump = useBump(saved, becameTrue);
  return (
    <>
      <Stage center>
        <button
          type="button"
          className={styles.save}
          aria-pressed={saved}
          aria-label="Save job"
          onClick={() => setSaved((s) => !s)}
        >
          <span key={bump} className={cx(styles.saveIcon, saved && bump > 0 && "tm-anim-save")}>
            <Icon name="bookmark" fill={saved} decorative size="lg" />
          </span>
        </button>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setSaved((s) => !s)} />
        <span className={styles.note}>{saved ? "Saved (un-saving doesn’t pop)" : "Not saved"}</span>
      </Actions>
    </>
  );
}

// ---- M24 Accordion -------------------------------------------------------------------------
const FAQ = [
  { q: "Is posting a job free?", a: "Yes. Posting is free, and saying no to the price is free too." },
  { q: "When do I pay?", a: "Only when you accept the price. It’s fixed, so it won’t go up." },
];

function M24({ entry }: DemoProps) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <Stage>
        <div className={styles.faq}>
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className={styles.faqItem}>
                <h3 className={styles.faqQ}>
                  <button
                    type="button"
                    id={`m24-q-${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`m24-a-${i}`}
                    className={styles.faqBtn}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    {item.q}
                    <Icon name="expand_more" decorative className="tm-chevron" />
                  </button>
                </h3>
                <div
                  id={`m24-a-${i}`}
                  role="region"
                  aria-labelledby={`m24-q-${i}`}
                  className="tm-accordion"
                  data-open={isOpen ? "true" : "false"}
                  inert={!isOpen}
                >
                  <div>
                    <p className={styles.faqA}>{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setOpen((o) => (o === 0 ? null : 0))} />
      </Actions>
    </>
  );
}

// ---- M25 Status change --------------------------------------------------------------------
const STATUSES = [
  { label: "Getting your price", kind: "waiting" },
  { label: "Price ready", kind: "action" },
  { label: "Booked", kind: "good" },
  { label: "Sorted", kind: "done" },
] as const;

function Pill({ index, className, hidden }: { index: number; className?: string; hidden?: boolean }) {
  const status = STATUSES[index];
  return (
    <span className={cx(styles.pill, styles[`pill_${status.kind}`], className)} aria-hidden={hidden || undefined}>
      {status.label}
    </span>
  );
}

function M25({ entry }: DemoProps) {
  const [index, setIndex] = useState(0);
  const { current, previous, swapKey } = useSwap(index);
  return (
    <>
      <Stage center>
        <span className="tm-swap" role="status">
          {previous !== null && <Pill index={previous} className="tm-anim-status-out" hidden />}
          <Pill key={swapKey} index={current} className={swapKey > 0 ? "tm-anim-status" : undefined} />
        </span>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={() => setIndex((i) => (i + 1) % STATUSES.length)} />
      </Actions>
    </>
  );
}

// ---- M26 Drop zone ----------------------------------------------------------------------
function M26({ entry }: DemoProps) {
  const [forced, trigger] = useFlash(1400);
  const zone = useDropZone();
  return (
    <>
      <Stage>
        <div className={cx("tm-dropzone", styles.drop)} {...zone.props} data-over={forced || zone.over ? "true" : "false"}>
          <Icon name="add_photo_alternate" decorative size="lg" className={styles.dropIcon} />
          <b>Drag photos here</b>
          <span className={styles.caption}>Try dragging a file over it</span>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={trigger} />
      </Actions>
    </>
  );
}

// ---- M27 Bounty shimmer + countdown ----------------------------------------------------------
const HOUR = 60 * 60 * 1000;

function Ring({ endsAt, totalMs, initialMs }: { endsAt: number; totalMs: number; initialMs: number }) {
  const left = useCountdown(endsAt) ?? initialMs;
  const label = formatCountdown(left);
  return (
    <span
      className={cx(styles.goldRing, isUrgent(left) && "tm-ring-urgent")}
      style={{ "--p": `${ringFraction(left, totalMs) * 100}%` } as CSSProperties}
      role="img"
      aria-label={`${label} left`}
    >
      <span>{label}</span>
    </span>
  );
}

function M27({ entry }: DemoProps) {
  const [mountedAt] = useState(() => Date.now());
  const [run, replay] = useRuns();
  // Replaying jumps the glint loop to just before its peak, so it shows now instead of in 3.5s.
  const glint = { "--tm-glint-delay": run > 0 ? `${-0.8 * MOTION_MS.m27Loop}ms` : "0s" } as CSSProperties;
  return (
    <>
      <Stage>
        <div className={styles.bounties}>
          <div key={run} className={cx("tm-glint", styles.bountyCard)} style={glint}>
            <span className={styles.rowText}>
              <span className={styles.bountyPill}>
                <Icon name="paid" fill decorative size="sm" />
                Quote bounty
              </span>
              <b>Hot water cylinder</b>
              <span className={styles.caption}>6 km · Waikiwi</span>
            </span>
            <Ring endsAt={mountedAt + 17 * HOUR + 42 * 60_000} totalMs={24 * HOUR} initialMs={17 * HOUR + 42 * 60_000} />
          </div>
          <div className={styles.bountyCard}>
            <span className={styles.rowText}>
              <span className={styles.bountyPill}>
                <Icon name="paid" fill decorative size="sm" />
                Quote bounty
              </span>
              <b>Deck repair</b>
              <span className={styles.caption}>Under 2h left: the ring pulses</span>
            </span>
            <Ring endsAt={mountedAt + HOUR + 12 * 60_000} totalMs={24 * HOUR} initialMs={HOUR + 12 * 60_000} />
          </div>
        </div>
      </Stage>
      <Actions>
        <Play entry={entry} onClick={replay} />
        <span className={styles.note}>Glints by itself every 4s</span>
      </Actions>
    </>
  );
}

const DEMOS: Record<string, ComponentType<DemoProps>> = {
  M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14,
  M15, M16, M17, M18, M19, M20, M21, M22, M23, M24, M25, M26, M27,
};
