"use client";
// The office's job admin view (#171, F05, pages.html w-o-job): everything about one job: money, messages, the full
// timeline (who did what, when), and the actions (reassign, refund, edit price, force a status, cancel), each
// behind a confirm dialog with a required note that is stored on the timeline. The server reads the job
// (src/server/office/job.ts) and does the changes (job-mutations.ts); this only shows it and sends what the
// office types. Docs: docs/components/office-job.md. Every state: /dev/components/office-job.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Button } from "@/components/Button";
import { ErrorState, LiveMessage } from "@/components/feedback";
import { MoneyField, RadioGroup, SelectField, TextAreaField, TextField } from "@/components/forms";
import { Icon } from "@/components/Icon";
import { Banner, ConfirmDialog, Menu, MenuItem, MenuSeparator } from "@/components/overlays";
import { Pill } from "@/components/status/Pill";
import { StatusPill } from "@/components/status/StatusPill";
import {
  ACTOR_LABELS,
  actionBlocked,
  forceStatusOptions,
  JOB_ACTION_LABELS,
  type JobActionName,
  type JobActionResult,
  money,
  type OfficeJobView,
  parseHoursToMinutes,
  parseJobAction,
  parseMoneyToCents,
} from "@/lib/office-job";
import { OFFICE_JOBS_PATH } from "@/lib/office-jobs";

import styles from "./job-admin.module.css";

/** Sends one action to the server. The page passes the real one; the preview passes a pretend one. */
export type SubmitJobAction = (input: unknown) => Promise<JobActionResult | { ok: false; error: "session-expired" | "forbidden" }>;

export type DialogName = JobActionName | "message";

export type JobAdminProps = {
  /** The job, or null when it couldn't be read ("Can't load this job"). */
  job: OfficeJobView | null;
  submit: SubmitJobAction;
  /** Previews and screenshots: start with this dialog (or the Actions menu) open. */
  initialDialog?: DialogName | null;
  initialMenuOpen?: boolean;
  /** Previews: show this error inside the first dialog that opens. */
  initialError?: string | null;
  /** Previews: don't reload from the server when something worked. */
  onChanged?: () => void;
};

const DONE: Record<DialogName, string> = {
  reassign: "Tradie reassigned.",
  refund: "Refund recorded.",
  price: "Price saved.",
  status: "Status changed.",
  cancel: "Job cancelled.",
  message: "Message sent.",
};

export function JobAdmin({ job, submit, initialDialog = null, initialMenuOpen = false, initialError = null, onChanged }: JobAdminProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [retrying, startRetry] = useTransition();
  const [dialog, setDialog] = useState<DialogName | null>(initialDialog);
  const [done, setDone] = useState<string | null>(null);

  if (!job) {
    return (
      <div className={styles.page}>
        <Crumbs label="Job" />
        <ErrorState
          title="Can’t load this job"
          message="Check your connection and try again."
          onRetry={() => startRetry(() => router.refresh())}
          retrying={retrying}
          headingLevel={1}
        />
      </div>
    );
  }

  const finished = (name: DialogName) => {
    setDialog(null);
    setDone(DONE[name]);
    if (onChanged) onChanged();
    else startTransition(() => router.refresh());
  };

  return (
    <div className={styles.page}>
      <Crumbs label={job.number} />
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>
            {job.title}
            <StatusPill status={job.status} audience="office" announce className={styles.pill} />
          </h1>
          <p className={styles.sub}>
            {job.customer.name} → {job.tradie?.name ?? "No tradie yet"} · {job.trade} · {job.suburb}
          </p>
        </div>
        <Menu
          defaultOpen={initialMenuOpen}
          trigger={(props) => (
            <Button variant="secondary" size="sm" width="auto" iconEnd="expand_more" {...props}>
              Actions
            </Button>
          )}
        >
          {(["reassign", "refund", "price", "status"] as const).map((name) => (
            <ActionItem key={name} job={job} name={name} onSelect={() => setDialog(name)} />
          ))}
          <MenuSeparator />
          <ActionItem job={job} name="cancel" onSelect={() => setDialog("cancel")} />
        </Menu>
      </div>

      {done && (
        <Banner tone="good" live onDismiss={() => setDone(null)}>
          {done}
        </Banner>
      )}
      <LiveMessage message={done} />

      <div className={styles.grid}>
        <div className={styles.left}>
          <MoneyCard job={job} />
          <MessagesCard job={job} onMessage={() => setDialog("message")} />
        </div>
        <TimelineCard job={job} />
      </div>

      {dialog && (
        <ActionDialog
          key={dialog}
          name={dialog}
          job={job}
          submit={submit}
          presetError={initialError}
          onClose={() => setDialog(null)}
          onDone={() => finished(dialog)}
        />
      )}
    </div>
  );
}

function Crumbs({ label }: { label: string }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href={OFFICE_JOBS_PATH}>All jobs</Link>
      <Icon name="chevron_right" size="sm" decorative />
      <span aria-current="page">{label}</span>
    </nav>
  );
}

const ACTION_ICONS: Record<JobActionName, string> = {
  reassign: "swap_horiz",
  refund: "undo",
  price: "edit",
  status: "flag",
  cancel: "cancel",
};

function ActionItem({ job, name, onSelect }: { job: OfficeJobView; name: JobActionName; onSelect: () => void }) {
  const blocked = actionBlocked(name, job);
  return (
    <MenuItem icon={ACTION_ICONS[name]} tone={name === "cancel" ? "danger" : "default"} disabled={blocked !== null} onSelect={onSelect}>
      {JOB_ACTION_LABELS[name]}
      {blocked && <span className={styles.why}> ({blocked})</span>}
    </MenuItem>
  );
}

// ---------------------------------------------------------------- Money

function MoneyCard({ job }: { job: OfficeJobView }) {
  const { money: m } = job;
  return (
    <section className={styles.card} aria-labelledby="job-money">
      <h2 id="job-money" className={styles.cardTitle}>Money</h2>
      <dl className={styles.lines}>
        <div>
          <dt>Customer paid</dt>
          <dd>{m.paidCents > 0 ? money(m.paidCents) : "Not paid yet"}</dd>
        </div>
        {m.extraWorkCents > 0 && (
          <div>
            <dt>Extra work</dt>
            <dd>{money(m.extraWorkCents)} · approved</dd>
          </div>
        )}
        {m.refundedCents > 0 && (
          <div>
            <dt>Refunded</dt>
            <dd>{money(m.refundedCents)}</dd>
          </div>
        )}
        <div>
          <dt>Tradie earns</dt>
          <dd>{m.tradieEarnsCents === null ? "Not priced yet" : `${money(m.tradieEarnsCents)}${m.extraWorkCents > 0 ? " + extra" : ""}`}</dd>
        </div>
        <div>
          <dt>Payroll</dt>
          <dd>
            <Pill kind={m.payroll.kind}>{m.payroll.label}</Pill>
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- Messages

function MessagesCard({ job, onMessage }: { job: OfficeJobView; onMessage: () => void }) {
  return (
    <section className={styles.card} aria-labelledby="job-messages">
      <h2 id="job-messages" className={styles.cardTitle}>Messages</h2>
      {job.messages.length === 0 ? (
        <p className={styles.empty}>No messages yet.</p>
      ) : (
        <ul className={styles.messages}>
          {job.messages.map((message) => (
            <li key={message.id} data-from={message.fromOffice ? "office" : "them"}>
              <p className={styles.bubble}>{message.body}</p>
              {!!message.photos?.length && <div className={styles.messagePhotos}>{message.photos.map((photo, index) => photo.url
                // Private signed photos are renewed when the office reloads the job.
                // eslint-disable-next-line @next/next/no-img-element
                ? <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Message photo ${index + 1}`} /></a>
                : <span key={photo.id}>Photo unavailable</span>)}</div>}
              <p className={styles.caption}>
                {message.from} · <time dateTime={message.at}>{message.when}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" size="sm" width="auto" className={styles.messageButton} onClick={onMessage}>
        Message both
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------- Timeline

function TimelineCard({ job }: { job: OfficeJobView }) {
  return (
    <section className={styles.card} aria-labelledby="job-timeline">
      <h2 id="job-timeline" className={styles.cardTitle}>Timeline</h2>
      <ol className={styles.timeline}>
        {job.timeline.map((entry) => (
          <li key={entry.id}>
            <span className={styles.dot} data-actor={entry.actor} aria-hidden="true" />
            <div>
              <p className={styles.eventTitle}>{entry.title}</p>
              {entry.detail && <p className={styles.note}>“{entry.detail}”</p>}
              <p className={styles.caption}>
                <span className={styles.srOnly}>{ACTOR_LABELS[entry.actor]}: </span>
                {entry.actorName ? `${entry.actorName} · ` : ""}
                <time dateTime={entry.at}>{entry.when}</time>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- Dialogs

type Fields = Record<string, string>;

type DialogProps = {
  name: DialogName;
  job: OfficeJobView;
  submit: SubmitJobAction;
  presetError: string | null;
  onClose: () => void;
  onDone: () => void;
};

/** One dialog per action, each with a required note. They open fresh every time (keyed by name). */
function ActionDialog({ name, job, submit, presetError, onClose, onDone }: DialogProps) {
  const sessionExpired = useOptionalSessionExpired();
  const [values, setValues] = useState<Fields>(() => initialValues(name, job));
  const [errors, setErrors] = useState<Fields>({});
  const [failure, setFailure] = useState<string | null>(presetError);
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const send = async (): Promise<void> => {
    setFailure(null);
    const payload = payloadFor(name, job, values);
    const checked = parseJobAction(payload);
    if (!checked.ok) {
      setErrors({ [checked.field]: checked.message });
      return;
    }
    setErrors({});
    let result: Awaited<ReturnType<SubmitJobAction>>;
    try {
      result = await submit(payload);
    } catch {
      setFailure("Couldn’t save that. Nothing was changed. Try again.");
      return;
    }
    if (sessionExpired?.check(result, { resend: send })) return;
    if (result.ok) return onDone();
    if (!("message" in result)) {
      setFailure("You’re not able to do that. Log in again, or ask for office access.");
    } else if (result.field) {
      setErrors({ [result.field]: result.message });
    } else {
      setFailure(result.message);
    }
  };

  const common = { open: true, onCancel: onClose, onConfirm: send, error: failure, size: "md" as const };
  const note = (
    <TextAreaField
      label="Note"
      required
      rows={3}
      maxLength={500}
      value={values.note}
      error={errors.note}
      onChange={(event) => set("note")(event.target.value)}
    />
  );

  switch (name) {
    case "reassign":
      return (
        <ConfirmDialog {...common} title="Reassign tradie" confirmLabel="Reassign">
          <p className={styles.dialogText}>
            {job.tradie?.name} will be taken off {job.number}. The new tradie takes it over, and both are told.
          </p>
          <SelectField
            label="New tradie"
            required
            value={values.workerId}
            error={errors.workerId}
            onChange={(event) => set("workerId")(event.target.value)}
          >
            <option value="">Choose a tradie</option>
            {job.reassignOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </SelectField>
          {job.reassignOptions.length === 0 && <p className={styles.dialogText}>No other verified tradies for this trade yet.</p>}
          {note}
        </ConfirmDialog>
      );

    case "refund": {
      const chosen = job.payments.find((payment) => payment.id === values.paymentId) ?? job.payments[0];
      return (
        <ConfirmDialog {...common} title="Refund" confirmLabel="Record refund">
          <Banner tone="test" title="Test mode.">
            This is a record only. No real money moves until real payments are on.
          </Banner>
          {job.payments.length > 1 && (
            <SelectField
              label="Payment"
              required
              value={values.paymentId}
              error={errors.paymentId}
              onChange={(event) => set("paymentId")(event.target.value)}
            >
              {job.payments.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.label} · {money(payment.refundableCents)} left
                </option>
              ))}
            </SelectField>
          )}
          <RadioGroup
            name="refund-mode"
            label="How much"
            required
            value={values.mode}
            error={errors.mode}
            onChange={set("mode")}
            options={[
              { value: "full", label: "Full refund", hint: chosen ? money(chosen.refundableCents) : undefined },
              { value: "partial", label: "Part refund" },
            ]}
          />
          {values.mode === "partial" && (
            <MoneyField
              label="Amount to refund"
              required
              value={values.amount}
              error={errors.amount}
              hint={chosen ? `Up to ${money(chosen.refundableCents)}` : undefined}
              onChange={(event) => set("amount")(event.target.value)}
            />
          )}
          {note}
        </ConfirmDialog>
      );
    }

    case "price":
      return (
        <ConfirmDialog {...common} title="Edit price" confirmLabel="Save price">
          <p className={styles.dialogText}>
            {job.priceCents === null ? "Not priced yet." : `Now ${money(job.priceCents)} incl GST.`} The new price is worked out
            from these with the job’s rates.
          </p>
          <TextField
            label="Hours"
            required
            inputMode="decimal"
            value={values.hours}
            error={errors.hours}
            onChange={(event) => set("hours")(event.target.value)}
          />
          <MoneyField
            label="Materials at cost, ex GST"
            required
            value={values.materials}
            error={errors.materials}
            onChange={(event) => set("materials")(event.target.value)}
          />
          {note}
        </ConfirmDialog>
      );

    case "status": {
      const options = forceStatusOptions(job);
      return (
        <ConfirmDialog {...common} title="Force status" confirmLabel="Force status">
          <p className={styles.dialogText}>
            This skips the usual rules, so use it to put right something that went wrong. It’s logged with your note.
          </p>
          <SelectField
            label="New status"
            required
            value={values.to}
            error={errors.to}
            onChange={(event) => set("to")(event.target.value)}
          >
            <option value="">Choose a status</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          {note}
        </ConfirmDialog>
      );
    }

    case "cancel":
      return (
        <ConfirmDialog {...common} title="Cancel this job?" confirmLabel="Cancel job" cancelLabel="Keep job" tone="destructive">
          <p className={styles.dialogText}>
            {job.number} is closed for everyone and they’re told. Cancelling doesn’t refund anything: use Refund for that.
          </p>
          {note}
        </ConfirmDialog>
      );

    case "message":
      return (
        <ConfirmDialog {...common} title="Message both" confirmLabel="Send message">
          <p className={styles.dialogText}>Goes to {[job.customer.name, job.tradie?.name].filter(Boolean).join(" and ")}.</p>
          <TextAreaField
            label="Message"
            required
            rows={4}
            maxLength={2000}
            value={values.body}
            error={errors.body}
            onChange={(event) => set("body")(event.target.value)}
          />
        </ConfirmDialog>
      );
  }
}

function initialValues(name: DialogName, job: OfficeJobView): Fields {
  const base: Fields = { note: "", body: "", workerId: "", to: "", mode: "full", amount: "", paymentId: job.payments[0]?.id ?? "" };
  if (name === "price" && job.pricing) {
    return {
      ...base,
      hours: String(Math.round((job.pricing.minutes / 60) * 100) / 100),
      materials: (job.pricing.materialsCents / 100).toFixed(2),
    };
  }
  return { ...base, hours: "", materials: "" };
}

/** What the server is sent for each dialog. The server checks it all again. */
function payloadFor(name: DialogName, job: OfficeJobView, v: Fields): Record<string, unknown> {
  const base = { action: name, jobId: job.id, seenStatus: job.status, note: v.note };
  switch (name) {
    case "reassign":
      return { ...base, workerId: v.workerId };
    case "status":
      return { ...base, to: v.to };
    case "price":
      return { ...base, minutes: parseHoursToMinutes(v.hours), materialsCents: parseMoneyToCents(v.materials) };
    case "refund":
      return { ...base, paymentId: v.paymentId, mode: v.mode, amountCents: v.mode === "partial" ? parseMoneyToCents(v.amount) : null };
    case "message":
      return { action: "message", jobId: job.id, body: v.body };
    case "cancel":
      return base;
  }
}
