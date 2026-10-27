# Overlays: dialogs, drawers, sheets, menus, toasts and banners

Issue #78. Code: `src/components/overlays` (import from `@/components/overlays`). Every variant and state, live:
`/dev/components/overlays` (dev only), with `?mode=trade|office` and `?open=<id>` to open one on load.

| You need | Use | Spec |
|---|---|---|
| A decision: confirm, money, sign-up gate | `<Dialog>` / `<ConfirmDialog>` | web.css `.w-dialog`, M13, WEBAPP_SPEC "Dialogs" |
| A side task with the page still in view: estimate, extra work, crew | `<Drawer>` | web.css `.w-drawer`, M12 |
| A phone-first task: filters | `<Sheet>` (and every `<Dialog>` on a phone) | components.css `.tm-sheet`, FRONTEND_SPEC "Sheet" |
| A list of actions under a button: avatar, ⋯ on a card, office actions | `<Menu>` | web.css `.w-menu`, M08 |
| A short confirmation that goes by itself: “Saved.”, with Undo | `useToast()` | web.css `.w-toast`, M14 |
| A message that stays while it's true: offline, test mode, a private note | `<Banner>` | components.css `.tm-banner` |

Rule 8 of the web spec: **drawers for side tasks, dialogs for decisions.** One dialog at a time. Errors are banners,
never toasts (they mustn't disappear by themselves).

## Dialog

```tsx
import { Button } from "@/components/Button";
import { Dialog } from "@/components/overlays";

const [open, setOpen] = useState(false);

<Button onClick={() => setOpen(true)}>Review extra work</Button>
<Dialog
  open={open}
  onClose={() => setOpen(false)}
  size="lg"
  eyebrow={<Pill kind="action">Needs your OK</Pill>}
  title="Jack found extra work"
  footer={
    <>
      <Button variant="secondary" onClick={decline}>Decline</Button>
      <Button onClick={approve}>Approve & pay $148.00</Button>
    </>
  }
>
  <p>The switchboard’s second circuit is overloaded…</p>
</Dialog>
```

| Prop | What it does |
|---|---|
| `open` | Show it. The parent owns it: set it to `false` in `onClose`. It animates out (150ms) before it unmounts. |
| `onClose(reason)` | Asked to close: `"escape"`, `"scrim"`, `"close-button"` or `"swipe"`. Never called when not dismissible. |
| `title` | The heading. Names the dialog for screen readers and takes focus when it opens. |
| `eyebrow` | A small line or a status pill above the title. |
| `description` | One sentence under the title; screen readers read it as the dialog's description. |
| `children` | The body. |
| `footer` | The buttons, in reading order: the other choice first, the main action last. On a phone they stack full width with the main action on top. |
| `size` | `"sm"` 460px, `"md"` 520px (default), `"lg"` 620px. Never wider than the screen less 16px each side. |
| `phoneLayout` | Below 600px: `"sheet"` (default) slides up from the bottom; `"dialog"` stays a centred box. |
| `dismissible` | Default `true`. `false`: no ×; Esc, the scrim and swiping do nothing. The only way out is a footer button. `"close-button"`: only the × closes it. |
| `initialFocusRef` | Focus this instead of the title when it opens (e.g. the first field). |
| `closeLabel` | The ×'s name. Default “Close”. |
| `role` | `"alertdialog"` for decisions that interrupt. `<ConfirmDialog>` sets it. |

What it does for you (WEBAPP_SPEC "Dialogs", AGENTS.md §3):

- It is a native `<dialog>` opened with `showModal()`: the rest of the page is **inert** (can't be clicked, tabbed
  to or read by a screen reader) and it sits above everything.
- **Focus** moves to the title when it opens (so Enter can't press a button by accident; WEBAPP_SPEC C13), Tab and
  Shift+Tab **wrap inside** it, and focus **goes back** to whatever opened it when it closes.
- **Esc**, a click on the **scrim**, the **×** and (on a phone) a **swipe down** ask to close. A control inside that
  uses Esc itself (an open menu, a tooltip) keeps it.
- The page behind **doesn't scroll** while it's open.
- **Motion:** M13 in (200ms) and out (150ms); on a phone the sheet rises (320ms) and drops (200ms). With
  `prefers-reduced-motion` both are instant.
- Taller than the screen (long text, 200% zoom): it scrolls inside. Long words break.

### ConfirmDialog

```tsx
<ConfirmDialog
  open={open}
  tone="destructive"
  title="Cancel this job?"
  confirmLabel="Cancel job"
  cancelLabel="Keep job"
  onCancel={() => setOpen(false)}
  onConfirm={async () => {
    await cancelJob();      // the button spins meanwhile; the dialog can't be closed
    setOpen(false);
    toast.show({ message: "Job cancelled.", action: { label: "Undo", onAction: restore } });
  }}
  error={error}             // shown as an alert banner (read out at once); the dialog stays open
>
  <p>It hasn’t been paid for yet, so cancelling is free.</p>
</ConfirmDialog>
```

- `confirmLabel` names the action (“Cancel job”, “Send price”), never “OK” or “Yes”. `cancelLabel` defaults to
  “Not now”.
- `tone="destructive"` makes the main button the red outline.
- If `onConfirm` returns a promise, the main button shows a spinner and the dialog can't be closed until it settles.
  Close it yourself when it worked. If it throws, it stays open; pass what went wrong as `error`.

### Session expired (B07, #108)

It's built: `useSessionExpired()` from `src/components/auth/SessionExpired.tsx` (docs/components/session-expired.md).
It uses `<Dialog dismissible="close-button">`: the × closes it, Esc and the scrim don't.

## Drawer

```tsx
<Drawer
  open={open}
  onClose={() => setOpen(false)}
  eyebrow="Sub wiring · TM-1005"
  title="Your estimate"
  footer={<Button width="full" onClick={send}>Send estimate</Button>}
>
  <Banner tone="brand" icon="visibility_off" title="Private.">Nobody else sees your numbers.</Banner>
  <TextField label="Hours on site" … />
</Drawer>
```

Same props and behaviour as a dialog (no `size` or `phoneLayout`). 480px from the right edge, the whole width on a
phone. The header and footer stay put and the body scrolls. M12: in 320ms, out 200ms. To keep unsent values when
it's closed and opened again (WEBAPP_SPEC D05), keep the form state in the parent, not inside the drawer.

## Sheet

```tsx
<Sheet open={open} onClose={() => setOpen(false)} title="Filter" footer={<Button width="full">Show 24 jobs</Button>}>
  <ChipGroup label="Type of work" multiple options={…} />
</Sheet>
```

Same props and behaviour as a dialog. From the bottom edge, 22px top corners, a grab handle. Drag the handle or the
header down to close (a quarter of its height, at most 120px, or a quick flick); a small drag springs back.

## Menu

```tsx
<Menu
  trigger={(props) => <IconButton icon="account_circle" label="Account menu" {...props} />}
  header={<><b>Sarah Thompson</b><span>sarah@email.co.nz</span></>}
>
  <MenuItem icon="person" href="/account">Account</MenuItem>
  <MenuItem icon="help" onSelect={openHelp}>Help</MenuItem>
  <MenuSeparator />
  <MenuItem icon="logout" tone="danger" onSelect={() => setConfirmLogOut(true)}>Log out</MenuItem>
</Menu>
```

| Prop | What it does |
|---|---|
| `trigger(props)` | Render any kit button and spread `props` on it (id, `aria-haspopup`, `aria-expanded`, `aria-controls`, click and key handlers). |
| `header` | Who or what it's about, above the items. Screen readers read it as the menu's description. |
| `align` | `"end"` (default): lines up with the trigger's right edge. `"start"`: the left edge. |
| `label` | The menu's name. Default: the trigger's name. |
| `defaultOpen` | Start open (previews). |
| `MenuItem` | `href` (a link) or `onSelect` (an action). `icon`, `tone="danger"`, `disabled` (still read out; arrows skip it; say why in the label). |

Keyboard (the WAI-ARIA menu button): Enter, Space or ArrowDown opens it on the first item, ArrowUp on the last;
arrows move and wrap, Home/End jump, typing a letter moves to the next item starting with it; Enter picks; Esc closes
and returns to the trigger; Tab or a click outside just closes. M08 fades it in. It is never wider than the screen
and slides back inside it near an edge; near the bottom of the screen it opens upwards.

`onSelect` runs after the menu has closed and focus is back on the trigger, so an item can open a dialog and the
dialog returns focus to the trigger when it closes.

## Toasts

```tsx
// Once, around the page or the app shell (it draws the toast area at the end):
<ToastProvider>{children}</ToastProvider>

// Anywhere inside:
const toast = useToast();
toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: restore } });
```

- `message` (required), `icon` (Material Symbols name, default `check_circle`), `action` (one, nearly always Undo).
  `show` returns an id; `toast.dismiss(id)` hides it early.
- M14: rises in at the bottom right (360px; the full width on a phone), stays **4 seconds** while a signature
  hairline shrinks, **pauses while the pointer is over it or focus is in it**, then goes. Reduced motion: no
  movement and no hairline; it still waits 4 seconds.
- One at a time: a new toast replaces the one on screen.
- Screen readers hear it from a `role="status"` region that is always on the page.
- A page with a bottom nav lifts toasts clear of it: set `--tm-toast-offset: calc(var(--trade-nav-height) + 12px)`
  on an element around the `<ToastProvider>`.
- **Never make a toast the only way to do something.** It goes after 4 seconds, and a keyboard user may not reach
  it in time. Undo should also be possible from the page (add the photo again, re-open the job).
- A toast can't be pressed while a dialog is open (the page behind a dialog is inert). Show it after the dialog
  closes, as `<ConfirmDialog>`'s example does.

## Banner

```tsx
<Banner tone="test" title="Test mode.">No real money moves.</Banner>
<Banner tone="alert" icon="wifi_off" title="You’re offline." live>We’ll keep trying.</Banner>
<Banner tone="alert" icon="link_off" title="That link has expired." action={<TextLink href="/recovery" inline>Send a new one</TextLink>}>
  Links last 1 hour.
</Banner>
<Banner tone="info" onDismiss={hide}>Running late? Use “I’m on my way” on the job.</Banner>
```

| Prop | What it does |
|---|---|
| `tone` | `info` (blue), `good` (green), `alert` (red), `brand` (the mode tint), `test` (gold, payments in test mode). |
| `title` | A short bold lead-in. |
| `icon` | A Material Symbols name; each tone has a default (`info`, `check_circle`, `error`, `bolt`, `science`). `null` for none. |
| `action` | A link or button after the text. |
| `onDismiss` | Shows a × (“Dismiss”). Not for banners that must stay (offline, test mode). |
| `live` | It appeared because something happened: alert tone interrupts (`role="alert"`), the others wait (`role="status"`). Leave it off for banners that are there when the page loads. |

## Tests

- Unit: `tests/unit/overlays.test.tsx` (focus-trap, menu-key, type-ahead and swipe rules; the HTML and roles of
  each component; the CSS that keeps long text and small screens safe; the preview page).
- End-to-end: `tests/e2e/dev-overlays.spec.ts`, against `npm run dev`
  (`E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-overlays.spec.ts`): axe with every
  overlay open at 320 / 390 / 768 / 1024 / 1440 and in each mode, focus in, trapped and back, Esc, scrim, swipe,
  menu keyboard, toast timing and Undo, reduced motion, and 200% zoom.

## Notes for review

- The kit's test-mode banner colours (`#fff4d6` on `#6b4b00`) have no token. Here it is the gold token mixed 22%
  with white, with Forest text (13:1). If the brown text matters, it needs a token in `tokens.css` (Matt).
- The bottom sheet's motion (FRONTEND_SPEC "Sheet in / Sheet out") is `.tm-anim-sheet` / `.tm-anim-sheet-out` in
  `src/styles/motion.css`, next to M12 and M13, and turned off by reduced motion like the rest.
