# Loading, empty and error states

Issue #79. Code: `src/components/feedback/` (import from `@/components/feedback`). Every variant and state, live:
`/dev/components/feedback` on `npm run dev` (`?mode=trade` / `?mode=office` for the other palettes,
`?state=loading|empty|error|jobs` for the usage example). The page is a 404 in production builds.

Design sources: `.tm-skel`, `.tm-empty`, `.tm-banner` and `.tm-jobrow` in `docs/design/components.css`; the
"404 · 500 · maintenance · offline" page in `docs/design/pages.html`; the "Empty state", "Offline / error" and
"Loading" screens in `docs/design/screens.html`; FRONTEND_SPEC "System states" and the copy table; M15 in the
WEBAPP_SPEC motion table.

## The rules (from the spec)

- **Loading** shows skeletons that match the real layout, never a full-page spinner. Skeletons appear only after
  300 ms (most loads finish first). Buttons use their own spinner: `<Button loading>`.
- **Empty**: illustration (optional) + short heading + one line + one action. Friendly, not sorry: "Nothing on yet."
  not "No data found". Search with no results: "No jobs match that. Try fewer filters." + Reset filters.
- **Errors** come in three sizes: the offline banner (top, persistent), a page or section error (centre, with
  Try again) and toasts (not part of this set). Copy says what happened and what to do. Never show a raw error code:
  log it, and show a support reference.
- **Offline**: persistent top banner, skeletons stay, actions that need the network disable with a reason
  (`<Button disabled="You’re offline">`). Retries by itself with backoff.

## Components

| Component | Use it for |
|---|---|
| `<Skeleton>` | One grey block: `width`, `height` (numbers are px), `shape` `line` / `circle` / `pill`. |
| `<SkeletonText lines>` | A paragraph; the last line is shorter. |
| `<JobRowSkeleton count>` | Rows shaped like `.tm-jobrow` (My jobs, the job board). |
| `<TileSkeleton count>` | Category tiles shaped like `.tm-cat` (customer home). |
| `<LoadingRegion loading label skeleton>` | Swaps skeleton → content (M15) and tells screen readers what's loading. |
| `<Spinner label>` | A small wait inside a page ("Loading more jobs"). `hideLabel`, `size` sm / md / lg. |
| `<ProgressBar label value>` | Uploads. `value` 0–1; leave it out when you can't tell (the bar slides). |
| `<EmptyState>` | An empty list. `illustration="van"` or `icon`, `title`, `message`, `action`, `secondaryAction`. |
| `<ErrorState>` | A section that failed to load (`size="section"`, default) or the whole page (`size="page"`, 500). |
| `<InlineError>` | A small red banner inside a card or above a form, with an optional Try again. |
| `<OfflineBanner>` + `useOnlineStatus()` | The offline banner (G04) and the hook behind it. |
| `<LiveMessage message>` | A polite screen-reader announcement, for your own changes that have nothing to focus. |

Actions are always kit components: pass a `<Button>` or `<TextLink>` as `action` / `secondaryAction`. Try again
inside `ErrorState` and `InlineError` is a kit `<Button>` (primary in an error state, tertiary in a banner).

## Usage

```tsx
import { Button } from "@/components/Button";
import { EmptyState, ErrorState, JobRowSkeleton, LoadingRegion } from "@/components/feedback";

<LoadingRegion loading={loading} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
  {error ? (
    <ErrorState
      title="Can’t load your jobs"
      message="Check your connection and try again. If it keeps happening, let us know."
      onRetry={reload}
    />
  ) : jobs.length === 0 ? (
    <EmptyState
      illustration="van"
      title="Nothing on yet."
      message="Got something that needs doing? Post it free and we’ll get you a price."
      action={<Button href="/jobs/new">Post a job</Button>}
    />
  ) : (
    <JobList jobs={jobs} />
  )}
</LoadingRegion>
```

**Retrying.** `onRetry` can return a promise: Try again then shows the button's spinner until it settles and can't
be pressed twice. A failed retry is yours to show (usually the same error again). If the retry runs somewhere else,
pass `retrying` instead.

**The whole page failed (500).**

```tsx
<ErrorState
  size="page"
  icon="build"
  title="Something broke on our end."
  message="It’s not you. Try again in a minute. Anything you typed is saved."
  onRetry={reset}
  secondaryAction={<Button variant="secondary" size="sm" href="/help">Contact us</Button>}
  reference={errorRef}
/>
```

`size="page"` uses an `h1` and small buttons, as in the mockup (pass a small secondary button to match); a section
uses an `h2` and default-size buttons. Pass `headingLevel` when the page outline needs another level.

**Offline banner.** Put it once, at the top of the layout, outside `<main>`:

```tsx
<OfflineBanner onRetry={() => refetchJobs()} />
```

- While offline it calls `onRetry` after 2 s, 4 s, 8 s, 16 s, then every 30 s, again on Retry now, and once more when
  the connection comes back, then shows "You’re back online." for 4 s.
- `onRetry` must **fetch data again**, not reload or navigate. `router.refresh()` while offline falls back to a full
  page load, which loses what someone has typed.
- Without `onRetry` there is no Retry now and the copy is the copy-sheet line: "You’re offline. Anything you’ve typed
  is saved."
- The banner sticks to the top and is its own labelled region ("Connection"). `sticky={false}` is for previews inside
  a page; `online` overrides the browser's status (previews and tests only).
- `useOnlineStatus()` is `true` on the server and while hydrating, so server HTML never shows the banner. Use it to
  disable actions: `<Button disabled={online ? false : "You’re offline"}>Send</Button>`.

## Accessibility

- **Announcements are polite and never spam.** Each component that announces uses `LiveMessage`: a `role="status"`
  region that is in the page before its text arrives (so screen readers notice it), waits 150 ms so a burst of
  changes reads only the last one, never repeats the same message twice in a row, and clears itself after 7 s so it
  isn't read again when someone reads the page line by line.
- `LoadingRegion` says its label only if loading takes over 300 ms, and only once. The status region sits next to
  the `aria-busy` area, not inside it (screen readers hold back changes inside a busy area).
- `ErrorState` and `InlineError` say what happened once, when they appear. Turn it off with `announce={false}` for an
  error that is already there when the page loads.
- `OfflineBanner` speaks only when the connection changes while it's on the page.
- Skeletons, icons and the van are decorative (`aria-hidden` / `alt=""`); the headings and labels carry the meaning.
- `ProgressBar` is a named `role="progressbar"` with `aria-valuenow` and a percentage `aria-valuetext`; an
  indeterminate bar has no value. Progress changes are not announced.
- All buttons are kit buttons, so keyboard, focus ring, loading and "can't press twice" come from #74.

## Motion

- Skeletons are `.tm-skel` from `src/styles/motion.css` (M15): hidden for 300 ms, then a 1.2 s shimmer. The content
  that replaces them cross-fades in (`.tm-anim-swap`, 150 ms). Nothing here re-makes those animations.
- Under `prefers-reduced-motion` the skeleton is static grey, the spinner ring and the indeterminate progress bar
  stand still, and the bar's fill doesn't animate. The words still say something is happening.

## Long text and zoom

Headings, messages, labels, banner text and support references wrap (`overflow-wrap: anywhere`), so long names,
suburbs, job titles and unbroken words never spill out or cause sideways scroll. Sizes come from the rem-based type
tokens, so the components grow with browser zoom and text size. The main action in an empty or error state is
220 px wide (as in the mockup) and grows for a long label without passing its column.

## Tests

- `tests/unit/feedback-states.test.tsx`: the HTML and roles of every component, the backoff and percentage helpers,
  the CSS rules for wrapping and reduced motion, and the dev page.
- `tests/e2e/dev-feedback.spec.ts`: axe, sideways scroll and spilled text at 320 / 390 / 768 / 1024 / 1440 px, both
  other modes and 200 % zoom; the skeleton delay, shimmer and reduced motion; announcements; Try again from the
  keyboard; the real offline banner with the browser offline and back online; automatic retries. Run it against the
  dev server: `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-feedback.spec.ts`.
