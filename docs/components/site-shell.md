# Public site header and footer (#83)

The frame around every public page (sitemap A01–A16): a skip link, the header with its phone menu, `<main>`, and the
footer. Built from mockup `w-landing` in `docs/design/pages.html` (desktop, `.w-sitenav` / `.w-footer` in
`web.css`) and the phone landing in `screens.html`.

Preview: `/dev/components/site-shell` (under `npm run dev` only; a 404 in production builds).

| Query | Shows |
|---|---|
| *(none)* | Signed out, page with a hero |
| `?viewer=customer` / `tradie` / `office` | A pretend signed-in person of that role |
| `?viewer=long` | A customer with a very long first name |
| `&hero=off` | A page without a hero (solid header from the top) |

## Using it

Every page in the `src/app/(site)/` route group gets the shell from `src/app/(site)/layout.tsx`. To add a public
page, put it in that folder (route groups don't change the URL: `(site)/help/page.tsx` is `/help`). The page renders
only its own content: no `<main>`, header or footer of its own, because the shell already has them.

```tsx
// src/app/(site)/how-it-works/page.tsx
export default function HowItWorks() {
  return (
    <section className={styles.hero} data-site-hero>
      <h1>How it works</h1>
    </section>
  );
}
```

Outside the route group, use the components directly:

```tsx
import { SiteShell, SiteShellView } from "@/components/site/SiteShell";

<SiteShell>{children}</SiteShell>                        // reads who is signed in on the server
<SiteShellView viewer={viewer}>{children}</SiteShellView> // same frame, for a viewer you already have
```

## Signed in or out

`SiteShell` reads the visitor on the server with `getViewer()` (#101: the verified Supabase session and the
`profiles` row) and passes only their first name and role to the header, never the email or user id. Nothing in the
browser decides who is signed in. If the profile can't be read, the header shows the signed-out links rather than
breaking the page.

| Visitor | Header | Phone menu adds |
|---|---|---|
| Signed out | How it works · For tradies · Help · Log in · **Sign up** | Post a job (hero), Sign up, Log in |
| Customer | Nav · their first name (→ `/profile`) · **My jobs** (→ `/dashboard`) | Post a job (hero), My jobs, account |
| Tradie | Nav · their first name (→ `/profile`) · **Find work** (→ `/jobs`) | Find work, account |
| Office | Nav · **Office** (→ `/admin`) | Office |

Tradies and the office can't post jobs, so they don't get "Post a job". A long first name is cut off with "…" (the
whole name stays in the link for screen readers). The links and who sees what live in
`src/components/site/site-links.ts`.

## Hero and nav fill (M06)

Mark a page's hero with `data-site-hero`. The header then sits over it, see-through, and turns solid Forest with a
shadow once the hero has scrolled up under it (`.tm-navfill` + `useScrolledPast()`, 200ms; instant with reduced
motion). Give the hero enough top padding for the header (64px on phones, 76px from 1024px). Pages without a hero get
the solid header from the first paint, with no script.

## Colours

The public site is always customer (green) mode, even for a signed-in tradie or office user whose `<html>` is in
their own mode: `.shell` in `site.module.css` resets the mode tokens to the customer values (from the same brand
tokens; `tests/unit/site-shell.test.tsx` fails if they drift from `:root`). A page that needs another palette (For
tradies, A03) sets `data-mode="trade"` on its own content. "For tradies" is always Amber.

## Phone menu

Below 1024px the nav moves into a menu that drops down under the header (Forest, scrolls inside itself if it's
taller than the screen).

- The **Menu** button has `aria-expanded` and `aria-controls`; Enter or Space opens it.
- Opening moves focus to the first link. **Esc** closes it and puts focus back on the button.
- Tabbing out of the header, following a link, or widening the window past 1024px closes it.

## Accessibility

- "Skip to content" is the first thing Tab reaches; it jumps to `<main id="main">`.
- Landmarks: `banner` (header), `navigation` "Main" / "Menu" / "Footer", `main`, `contentinfo` (footer).
- The logo link is named "Trade Marketplace home"; the current page's nav link has `aria-current="page"`.
- Header links are at least 44px tall (its buttons 40px, the small button from #74); footer links at least 24px.
- Works at 320–1440px and at 200% zoom with no sideways scroll (the menu takes over).

## Footer

Four columns from the mockup (Customers, Tradies, Company, Legal), linking every public and legal page at its
planned route, then "© year Trade Marketplace · Made in New Zealand". The mockup's "Careers" and "Press" (no page in the
sitemap), NZBN and social links (no real values yet) are left out until there is something real to link to.

## Tests

- `tests/unit/site-shell.test.tsx`: who sees which links, landmarks and skip link, the server read (only name and
  role reach the browser; a failed read shows signed out), footer links against the sitemap, the customer colour
  reset, the wordmark paths.
- `tests/e2e/site-shell.spec.ts`: on `/` at every width with axe: landmarks, skip link, M06 fill, the full nav or
  the keyboard menu, closing on resize, 200% zoom. The signed-in states run against `npm run dev`:
  `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/site-shell.spec.ts`.
