"use client";
// /dev/components/overlays: every dialog, drawer, sheet, menu, toast and banner, live. Each overlay opens from a
// button; `?open=<id>` opens one on load (for screenshots and reviewers: the ids are OPEN_IDS in preview-data.ts). Nothing is
// saved; waits are pretend. Names, prices and suburbs are examples.
import { type ReactNode, useState } from "react";

import { Button, IconButton } from "@/components/Button";
import { CheckboxField, ChipGroup, MoneyField, TextAreaField, TextField } from "@/components/forms";
import { Banner, ConfirmDialog, Dialog, Drawer, Menu, MenuItem, MenuSeparator, Sheet, ToastProvider, useToast } from "@/components/overlays";
import { Pill } from "@/components/status/Pill";
import { TextLink } from "@/components/TextLink";

import styles from "./overlays.module.css";
import { LONG_NAME, LONG_WORD, type OpenId } from "./preview-data";

const LONG_JOB = `Switchboard upgrade, three new power points and a heat pump circuit at 14 ${LONG_WORD} Road, Papatoetoe`;

const PRETEND_WAIT_MS = 1500;
const wait = () => new Promise((resolve) => setTimeout(resolve, PRETEND_WAIT_MS));

/** The page's toasts. `?open=toast` / `?open=long-toast` shows one on load. */
export function PreviewToasts({ initial, children }: { initial: OpenId | null; children: ReactNode }) {
  const toast =
    initial === "toast"
      ? { message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => {} } }
      : initial === "long-toast"
        ? { message: `Receipt sent to ${LONG_WORD}@email.co.nz for ${LONG_NAME}.`, icon: "mail" }
        : undefined;
  return <ToastProvider initial={toast}>{children}</ToastProvider>;
}

/** One overlay's open/closed state, open at first when `?open=` names it. */
function useOpen(id: OpenId, initial: OpenId | null) {
  const [open, setOpen] = useState(initial === id);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

/** One example: its name and what to notice, then the live thing. */
function row(name: string, note: string, body: ReactNode) {
  return (
    <div key={name} className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        <p className={styles.note}>{note}</p>
      </div>
      <div className={styles.stage}>{body}</div>
    </div>
  );
}

function Result({ children }: { children: ReactNode }) {
  return (
    <p className={styles.note} role="status">
      {children}
    </p>
  );
}

// ---- Dialogs ------------------------------------------------------------------------------------------------

export function DialogDemos({ initial }: { initial: OpenId | null }) {
  const toast = useToast();
  const extra = useOpen("dialog", initial);
  const confirm = useOpen("confirm", initial);
  const destructive = useOpen("destructive", initial);
  const failing = useOpen("confirm-error", initial);
  const session = useOpen("session-expired", initial);
  const phoneDialog = useOpen("dialog-on-phone", initial);
  const long = useOpen("long-dialog", initial);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {row(
        "Dialog",
        "A decision with its context. 16px radius, 50% scrim, M13. Focus starts on the title. On a phone it is a bottom sheet.",
        <>
          <Button width="auto" onClick={extra.show}>
            Review extra work
          </Button>
          <Dialog
            open={extra.open}
            onClose={extra.hide}
            size="lg"
            eyebrow={<Pill kind="action">Needs your OK</Pill>}
            title="Jack found extra work"
            footer={
              <>
                <Button variant="secondary" onClick={() => (extra.hide(), setResult("Declined."))}>
                  Decline
                </Button>
                <Button onClick={() => (extra.hide(), setResult("Approved."))}>Approve & pay $148.00</Button>
              </>
            }
          >
            <p>The switchboard’s second circuit is overloaded and needs a new breaker. It’s not safe to leave.</p>
            <dl className={styles.lines}>
              <div>
                <dt>Extra cost · fixed · incl. GST</dt>
                <dd className={styles.price}>+$148.00</dd>
              </div>
            </dl>
            <p className={styles.caption}>If you decline, Jack finishes the original job only.</p>
          </Dialog>
        </>,
      )}
      {row(
        "Confirm",
        "<ConfirmDialog>: role alertdialog, the main button names the action. Cancel, Esc, the scrim or × say no.",
        <>
          <Button width="auto" variant="hero" onClick={confirm.show}>
            Claim job
          </Button>
          <ConfirmDialog
            open={confirm.open}
            title="Take this job?"
            confirmLabel="Yes, it’s mine"
            onCancel={confirm.hide}
            onConfirm={() => (confirm.hide(), setResult("Claimed."))}
          >
            <p>Sub wiring in Windsor. Earn $96.00, and Sarah’s free weekdays after 5pm.</p>
          </ConfirmDialog>
        </>,
      )}
      {row(
        "Destructive confirm",
        "tone=\"destructive\": the red outline. The main action waits (spinner, can’t be closed meanwhile), then a toast with Undo.",
        <>
          <Button width="auto" variant="destructive" onClick={destructive.show}>
            Cancel job
          </Button>
          <ConfirmDialog
            open={destructive.open}
            tone="destructive"
            title="Cancel this job?"
            confirmLabel="Cancel job"
            cancelLabel="Keep job"
            onCancel={destructive.hide}
            onConfirm={async () => {
              await wait();
              destructive.hide();
              toast.show({ message: "Job cancelled.", icon: "delete", action: { label: "Undo", onAction: () => setResult("Job restored.") } });
            }}
          >
            <p>It hasn’t been paid for yet, so cancelling is free.</p>
          </ConfirmDialog>
        </>,
      )}
      {row(
        "Confirm · error",
        "When the action fails the dialog stays open with an alert banner (read out at once), and the button can be pressed again.",
        <>
          <Button width="auto" onClick={() => (setError(null), failing.show())}>
            Send price to customer
          </Button>
          <ConfirmDialog
            open={failing.open}
            title="Send this price to Sarah?"
            confirmLabel="Send price"
            onCancel={failing.hide}
            error={error}
            onConfirm={async () => {
              await wait();
              setError("We couldn’t send it. Check your connection and try again.");
              throw new Error("pretend failure");
            }}
          >
            <p>She’ll see $372.00, fixed, including GST. Nothing else.</p>
          </ConfirmDialog>
        </>,
      )}
      {row(
        "Not dismissible (session expired, B07)",
        "dismissible={false}: no ×; Esc, the scrim and swiping do nothing. The only way out is the button.",
        <>
          <Button width="auto" variant="secondary" onClick={session.show}>
            Pretend the session expired
          </Button>
          <Dialog
            open={session.open}
            dismissible={false}
            size="sm"
            phoneLayout="dialog"
            title="You’ve been logged out"
            description="It’s been a while. Log in again to carry on: this page and anything you’ve typed are kept."
            footer={<Button onClick={() => (session.hide(), setResult("Logged in again."))}>Log in again</Button>}
          />
        </>,
      )}
      {row(
        "Stays a dialog on a phone",
        "phoneLayout=\"dialog\": a centred box at every width, for very short questions.",
        <>
          <Button width="auto" variant="secondary" onClick={phoneDialog.show}>
            Discard draft
          </Button>
          <ConfirmDialog
            open={phoneDialog.open}
            phoneLayout="dialog"
            tone="destructive"
            title="Discard this draft?"
            confirmLabel="Discard"
            cancelLabel="Keep it"
            onCancel={phoneDialog.hide}
            onConfirm={() => (phoneDialog.hide(), setResult("Draft discarded."))}
          />
        </>,
      )}
      {row(
        "Long text",
        "Names and words of any length wrap; a dialog taller than the screen scrolls inside.",
        <>
          <Button width="auto" variant="secondary" onClick={long.show}>
            Open a long dialog
          </Button>
          <Dialog
            open={long.open}
            onClose={long.hide}
            eyebrow={LONG_JOB}
            title={`Book ${LONG_NAME}?`}
            description={LONG_WORD}
            footer={
              <>
                <Button variant="secondary" onClick={long.hide}>
                  Not now
                </Button>
                <Button onClick={long.hide}>{`Book ${LONG_NAME}`}</Button>
              </>
            }
          >
            {Array.from({ length: 6 }, (_, i) => (
              <p key={i}>
                {LONG_NAME} has done {12 + i} jobs like this nearby. Every job is checked by our office before you pay,
                and you only pay the fixed price you accepted.
              </p>
            ))}
          </Dialog>
        </>,
      )}
      <Result>{result}</Result>
    </>
  );
}

// ---- Drawers --------------------------------------------------------------------------------------------------

export function DrawerDemos({ initial }: { initial: OpenId | null }) {
  const estimate = useOpen("drawer", initial);
  const long = useOpen("long-drawer", initial);
  const toast = useToast();
  const [sending, setSending] = useState(false);
  return (
    <>
      {row(
        "Drawer",
        "A side task that keeps the page in view: slides in from the right (M12), 480px; the whole width on a phone. Values stay if it’s closed and opened again.",
        <>
          <Button width="auto" icon="edit_square" onClick={estimate.show}>
            Estimate now
          </Button>
          <Drawer
            open={estimate.open}
            onClose={estimate.hide}
            eyebrow="Sub wiring · TM-1005"
            title="Your estimate"
            footer={
              <Button
                width="full"
                loading={sending}
                onClick={async () => {
                  setSending(true);
                  await wait();
                  setSending(false);
                  estimate.hide();
                  toast.show({ message: "Sent. We’ll price it and tell you.", icon: "bolt" });
                }}
              >
                Send estimate
              </Button>
            }
          >
            <Banner tone="brand" icon="visibility_off" title="Private.">
              Nobody else sees your numbers. Price it like you’d do it.
            </Banner>
            <TextField label="Hours on site" inputMode="decimal" defaultValue="3.5" hint="Half-hour steps. On site only, not travel." />
            <MoneyField label="Materials (your cost, excl. GST)" defaultValue="85.00" />
            <TextAreaField label="Note for the office" maxLength={300} />
            <CheckboxField label="I’d need to see it first (site visit)" />
          </Drawer>
        </>,
      )}
      {row(
        "Long drawer",
        "The header and footer stay put; the body scrolls (and can be scrolled by keyboard).",
        <>
          <Button width="auto" variant="secondary" onClick={long.show}>
            Open a long drawer
          </Button>
          <Drawer
            open={long.open}
            onClose={long.hide}
            eyebrow={LONG_JOB}
            title={`Add ${LONG_NAME} to your crew`}
            footer={
              <>
                <Button variant="secondary" onClick={long.hide}>
                  Cancel
                </Button>
                <Button onClick={long.hide}>Send invite</Button>
              </>
            }
          >
            {Array.from({ length: 10 }, (_, i) => (
              <p key={i}>
                {LONG_WORD.slice(0, 20 + i * 6)} · Plumbing · verified · 4.{9 - (i % 4)} ★. Part of the job: the bathroom
                rough-in, share 25%.
              </p>
            ))}
          </Drawer>
        </>,
      )}
    </>
  );
}

// ---- Sheets ---------------------------------------------------------------------------------------------------

export function SheetDemos({ initial }: { initial: OpenId | null }) {
  const filter = useOpen("sheet", initial);
  const [count, setCount] = useState(24);
  return row(
    "Bottom sheet",
    "Phone-first tasks: rises from the bottom (320ms), 22px corners, grab handle. Drag it down, press Esc or tap the scrim to close.",
    <>
      <Button width="auto" icon="tune" variant="secondary" onClick={filter.show}>
        Filter
      </Button>
      <Sheet
        open={filter.open}
        onClose={filter.hide}
        title="Filter"
        footer={
          <Button width="full" onClick={filter.hide}>
            {`Show ${count} jobs`}
          </Button>
        }
      >
        <ChipGroup
          label="Type of work"
          multiple
          defaultValue={["electrical", "other"]}
          onChange={(values) => setCount(8 + values.length * 8)}
          options={[
            { value: "electrical", label: "Electrical" },
            { value: "other", label: "Other" },
            { value: "plumbing", label: "Plumbing · not verified", disabled: true },
          ]}
        />
        <CheckboxField label="Quote bounties only" />
        <CheckboxField label="Jobs I can claim now" defaultChecked />
      </Sheet>
    </>,
  );
}

// ---- Menus ----------------------------------------------------------------------------------------------------

export function MenuDemos({ initial }: { initial: OpenId | null }) {
  const [result, setResult] = useState("");
  const logOut = useOpen("destructive", null);
  return (
    <>
      {row(
        "Avatar menu",
        "Header (who), items with icons, dividers, a danger item. Arrows, Home/End and the first letter move; Esc returns to the button.",
        <>
          <Menu
            defaultOpen={initial === "menu"}
            trigger={(props) => <IconButton icon="account_circle" label="Account menu" {...props} />}
            header={
              <>
                <b>Sarah Thompson</b>
                <span>sarah@email.co.nz</span>
              </>
            }
          >
            <MenuItem icon="person" href="/dev/components/overlays#menus">
              Account
            </MenuItem>
            <MenuItem icon="credit_card" onSelect={() => setResult("Payments.")}>
              Payments
            </MenuItem>
            <MenuItem icon="notifications" onSelect={() => setResult("Notification settings.")}>
              Notification settings
            </MenuItem>
            <MenuItem icon="help" onSelect={() => setResult("Help.")}>
              Help
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon="logout" tone="danger" onSelect={logOut.show}>
              Log out
            </MenuItem>
          </Menu>
          <ConfirmDialog
            open={logOut.open}
            tone="destructive"
            title="Log out?"
            confirmLabel="Log out"
            onCancel={logOut.hide}
            onConfirm={() => (logOut.hide(), setResult("Logged out."))}
          >
            <p>Anything you’ve typed stays on this device.</p>
          </ConfirmDialog>
        </>,
      )}
      {row(
        "Actions menu",
        "A text button as the trigger, lined up with its left edge. A disabled item stays readable but can’t be picked; arrows skip it.",
        <Menu align="start" trigger={(props) => <Button variant="secondary" size="sm" width="auto" iconEnd="expand_more" {...props}>Actions</Button>}>
          <MenuItem icon="cancel" onSelect={() => setResult("Request to cancel.")}>
            Request to cancel
          </MenuItem>
          <MenuItem icon="report" onSelect={() => setResult("Report a problem.")}>
            Report a problem
          </MenuItem>
          <MenuItem icon="receipt_long" disabled onSelect={() => setResult("Receipt.")}>
            Download receipt (after payment)
          </MenuItem>
        </Menu>,
      )}
      {row(
        "Long labels",
        "Items wrap inside a menu that is never wider than the screen.",
        <Menu
          defaultOpen={initial === "long-menu"}
          trigger={(props) => <IconButton icon="more_vert" label="More options" {...props} />}
          header={
            <>
              <b>{LONG_NAME}</b>
              <span>{LONG_WORD}@email.co.nz</span>
            </>
          }
        >
          <MenuItem icon="chat_bubble" onSelect={() => setResult("Message.")}>
            {`Message ${LONG_NAME}`}
          </MenuItem>
          <MenuItem icon="location_on" onSelect={() => setResult("Directions.")}>
            {LONG_JOB}
          </MenuItem>
        </Menu>,
      )}
      <Result>{result}</Result>
    </>
  );
}

// ---- Toasts ---------------------------------------------------------------------------------------------------

export function ToastDemos() {
  const toast = useToast();
  const [saved, setSaved] = useState(true);
  return (
    <>
      {row(
        "With Undo",
        "Bottom right on a computer, the full width on a phone. 4s while the hairline shrinks; pauses on hover or focus. role=status.",
        <>
          <Button
            width="auto"
            onClick={() => {
              setSaved(false);
              toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => setSaved(true) } });
            }}
          >
            Remove photo
          </Button>
          <p className={styles.note}>{saved ? "The photo is there." : "The photo is gone."}</p>
        </>,
      )}
      {row(
        "Plain",
        "No action: “Saved.”, “Link copied.” A new toast replaces the one on screen.",
        <>
          <Button width="auto" variant="secondary" onClick={() => toast.show({ message: "Saved." })}>
            Save
          </Button>
          <Button width="auto" variant="secondary" onClick={() => toast.show({ message: "Link copied.", icon: "content_copy" })}>
            Copy link
          </Button>
        </>,
      )}
      {row(
        "Long text",
        "Wraps; the toast grows taller, never wider.",
        <Button
          width="auto"
          variant="secondary"
          onClick={() =>
            toast.show({ message: `Receipt sent to ${LONG_WORD}@email.co.nz for ${LONG_NAME}.`, icon: "mail", action: { label: "Undo", onAction: () => {} } })
          }
        >
          Send receipt
        </Button>,
      )}
    </>
  );
}

// ---- Banners --------------------------------------------------------------------------------------------------

export function LiveBannerDemo() {
  const [offline, setOffline] = useState(false);
  return (
    <div className={styles.stack}>
      <Button width="auto" variant="secondary" onClick={() => setOffline((o) => !o)}>
        {offline ? "Go back online" : "Pretend to go offline"}
      </Button>
      {offline && (
        <Banner tone="alert" icon="wifi_off" title="You’re offline." live>
          We’ll keep trying. Anything you’ve typed is saved.
        </Banner>
      )}
    </div>
  );
}

export function DismissibleBannerDemo() {
  const [shown, setShown] = useState(true);
  return shown ? (
    <Banner tone="info" onDismiss={() => setShown(false)}>
      Running late? Use “I’m on my way” and “Running late” on the job. No texting needed.
    </Banner>
  ) : (
    <Button width="auto" variant="secondary" onClick={() => setShown(true)}>
      Show the tip again
    </Button>
  );
}

export function ActionBannerDemo() {
  return (
    <Banner tone="alert" icon="link_off" title="That link has expired." action={<TextLink href="/dev/components/overlays#banners" inline>Send a new one</TextLink>}>
      Links last 1 hour.
    </Banner>
  );
}

// ---- Usage: the code in usage-source.ts, running ---------------------------------------------------------------

export function UsageExample() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState(3);

  const remove = () => {
    setOpen(false);
    setPhotos((n) => n - 1);
    toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => setPhotos((n) => n + 1) } });
  };

  return (
    <div className={styles.stage}>
      <p className={styles.para}>
        {photos} {photos === 1 ? "photo" : "photos"}
      </p>
      <Button variant="destructive" width="auto" disabled={photos === 0 ? "No photos left to remove" : false} onClick={() => setOpen(true)}>
        Remove a photo
      </Button>
      <ConfirmDialog
        open={open}
        tone="destructive"
        title="Remove this photo?"
        confirmLabel="Remove photo"
        cancelLabel="Keep it"
        onCancel={() => setOpen(false)}
        onConfirm={remove}
      >
        <p>Tradies price from your photos, so keep the clearest ones.</p>
      </ConfirmDialog>
    </div>
  );
}
