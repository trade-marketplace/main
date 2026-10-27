# 404 and 500 pages

Issue #109. Code: `src/components/errors` (`NotFoundView`, `ServerErrorView`), wired up by Next.js's special
files. Preview: `/dev/components/error-pages` (dev only; `?page=500`, `?ref=off`). The real 404 is any missing
address, for example `/this-page-is-missing`.

| Page | Where it shows | Mockup |
|---|---|---|
| 404, "Can't find that page." | `src/app/not-found.tsx`: any missing address, inside the public site's header and footer. `(app)/not-found.tsx` and `admin/not-found.tsx`: `notFound()` on a page in those groups, inside their own shell. | pages.html w-errors, "404 · not found" |
| 500, "Something broke on our end." | `error.tsx` in `(site)`, `(app)` and `admin`: a page threw, so it shows inside that group's shell and the nav still works. `src/app/error.tsx`: anything else. `global-error.tsx`: the root layout itself threw (it brings its own `<html>` and styles). | pages.html w-errors, "500 · something broke"; screens.html sys-error |

## Rules

- **404 for things they can't see.** A page that finds a job or record the visitor isn't allowed to see calls
  `notFound()`, the same as when it doesn't exist. The page never hints that it exists (WEBAPP_SPEC G01).
- **The 500 owns the problem.** It shows the error reference: the Next.js digest, grouped in fours
  ("7F3A-91C2"). Next.js logs the full error on the server with the same digest, so support can find it. The
  error's own message is never shown. Errors that happened in the browser have no digest, so they show no
  reference and are logged to the console.
- **Try again** calls Next.js's `reset()`, which renders the page again. **Contact us** goes to `/contact`.

## Tests

- `tests/unit/error-pages.test.tsx` covers:
  - the reference format;
  - the HTML of both views: one h1, the links, no error message leaked, no mention of whether a job exists;
  - every route file.
- `tests/e2e/error-pages.spec.ts` covers:
  - the real 404 on the production build: status 404, title, axe and sideways scroll at every width, keyboard
    and the skip link;
  - the 500 on the dev preview: axe at every width, the reference, Try again by keyboard, 200% text.

## Notes for review (Matt)

- **404 wording:** the mockup says "It might have moved. Try searching.", but there's no search box yet (global
  search is #243). So it says "It might have moved, or the link might be wrong."
- **"404" colour:** the mockup's code paints it in the signature colour (Lime), matching the spec note, though
  the rendered mockup looks white. It's Lime here.
- **500 Try again button:** it uses the kit's page-error layout (#79), so it's wider than in the mockup and has
  the refresh icon, the same as the phone screen.
- **Page background:** both cards sit on the mockup's soft grey page.
