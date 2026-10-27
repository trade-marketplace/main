# Sign up: customer or tradie

Issue #103, sitemap B02. Page: `src/app/signup/page.tsx`. Component: `src/components/auth/SignupChoice.tsx`, inside
the log-in page's `AuthLayout` (#102) with the envelope illustration.

- **The question:** "What brings you here?", with two radio cards: "I need a job done" (Post jobs, get a
  price.) and "I'm a tradie" (Get local work.). Never "we do the paperwork" (Matt, #341).
  - The whole card is the hit area.
  - Arrow keys move between them (native radios in a fieldset).
  - Selected: a 2px action-colour border and the tint. Hover: a light fill.
  - Phone: rows with a radio dot (pub-signup-1). Computer: two cards side by side (w-signup).
- **Trade colours:** choosing "I'm a tradie" turns the page to trade colours, fading in 200ms (instant with
  reduced motion). `?as=tradie` starts on the tradie card, for links from For tradies.
- **Next** goes to that side's details: `/signup/customer` (#104) or `/signup/tradie` (#105), keeping `?next=`.
  **Log in** keeps it too.

## Not yet

On a computer, w-signup shows the details form beside the choice. The details forms are #104 and #105. When they
land, they can render in place of Next on a computer. Until then, Next leads to their planned routes.

## Tests

- `tests/unit/signup-choice.test.tsx` covers the HTML (fieldset, radios, the starting choice, mode colours, the
  deep link) and the page's `?as` and `?next`.
- `tests/e2e/signup-choice.spec.ts` covers, on the production build:
  - axe and sideways scroll at every width for both choices;
  - the keyboard: arrows, the colour swap, Next to `/signup/tradie?next=…`;
  - clicking a card;
  - where Log in sits on each size;
  - 200% text.
