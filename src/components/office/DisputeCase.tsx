"use client";
// One case (#172, F06, /admin/disputes/[jobId]): both sides (the customer's reason or problem report with its
// photos; the tradie's updates, evidence and messages), the money (payments, refunds so far, the tradie's payout),
// and the decision. Each decision opens a confirm dialog with a required note that goes on the timeline. No
// mockup: it follows the job admin view (F05) and the sign-off review (F07). The server reads the case
// (src/server/office/disputes.ts) and decides it (dispute-decisions.ts); this only shows it and sends what the
// office types. Every state: /dev/components/office-disputes.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Button } from "@/components/Button";
import { ErrorState, LiveMessage, OfflineBanner, useOnlineStatus } from "@/components/feedback";
import { CheckboxField, MoneyField, RadioGroup, SelectField, TextAreaField, TextField } from "@/components/forms";
import { Icon } from "@/components/Icon";
import { Banner, ConfirmDialog } from "@/components/overlays";
import { Pill } from "@/components/status/Pill";
import { StatusPill } from "@/components/status/StatusPill";
import { TextLink } from "@/components/TextLink";
import { statusPill } from "@/lib/job-status";
import {
  CANCEL_DECISION_LABELS,
  type CancelDecision,
  caseResolved,
  type DisputeCaseView,
  type DisputePhoto,
  type DisputeProblem,
  type DisputeResult,
  DISPUTES_PATH,
  parseDisputeDecision,
  partPayoutMinutes,
} from "@/lib/office-disputes";
import { money, parseMoneyToCents } from "@/lib/office-job";
import { decideDisputeAction } from "@/server/office/dispute-actions";

import styles from "./disputes.module.css";

/** Sends one decision to the server. The page passes the real one; the preview passes a pretend one. */
export type SubmitDecision = (input: unknown) => Promise<DisputeResult | { ok: false; error: "session-expired" | "forbidden" }>;

/** A cancellation decision, or resolving one problem report (`resolve:<report id>`). */
export type DecisionDialog = CancelDecision | `resolve:${string}`;

export type DisputeFields = {
  note: string;
  mode: "full" | "partial" | "none";
  paymentId: string;
  amount: string;
  payTradie: boolean;
  hours: string;
  requestId: string;
};

export type DisputeCaseProps = {
  /** The case, or null when it couldn't be read ("Can't load this case"). */
  view: DisputeCaseView | null;
  submit?: SubmitDecision;
  /** Previews: start with this dialog open, with these values, showing this error. */
  initialDialog?: DecisionDialog | null;
  initialValues?: Partial<DisputeFields>;
  initialError?: string | null;
  /** Previews: show the offline state. */
  offline?: boolean;
  /** Previews: don't reload from the server when a decision worked. */
  onChanged?: () => void;
  /** Where the breadcrumb goes back to. */
  base?: string;
};

export function DisputeCase({ view, submit = decideDisputeAction, initialDialog = null, initialValues, initialError = null, offline = false, onChanged, base = DISPUTES_PATH }: DisputeCaseProps) {
  const router = useRouter();
  const online = useOnlineStatus() && !offline;
  const [retrying, startRetry] = useTransition();
  const [, startRefresh] = useTransition();
  const [dialog, setDialog] = useState<DecisionDialog | null>(initialDialog);
  const [done, setDone] = useState<string | null>(null);

  if (!view) {
    return (
      <div className={styles.page}>
        <Crumbs base={base} label="Case" />
        <ErrorState title="Can’t load this case" message="Check your connection and try again." onRetry={() => startRetry(() => router.refresh())} retrying={retrying} headingLevel={1} />
      </div>
    );
  }

  const resolved = caseResolved(view);
  const finished = (message: string) => {
    setDialog(null);
    setDone(message);
    if (onChanged) onChanged();
    else startRefresh(() => router.refresh());
  };
  const customerProblems = view.problems.filter((problem) => problem.reporter === "customer");
  const tradieProblems = view.problems.filter((problem) => problem.reporter === "tradie");

  return (
    <div className={styles.page}>
      <Crumbs base={base} label={view.number} />
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>
            {view.title}
            <StatusPill status={view.status} audience="office" announce className={styles.pill} />
          </h1>
          <p className={styles.sub}>
            {view.number} · {view.customer.name} → {view.tradie?.name ?? "No tradie yet"} · {view.trade} · {view.suburb}
          </p>
        </div>
        <Button href={view.jobHref} variant="secondary" size="sm" width="auto">
          Open job
        </Button>
      </header>

      <OfflineBanner online={offline ? false : undefined} onRetry={() => router.refresh()} sticky={false} />
      {done && (
        <Banner tone="good" live onDismiss={() => setDone(null)}>
          {done}
        </Banner>
      )}
      <LiveMessage message={done} />
      {resolved && !done && (
        <Banner tone="good" title="Resolved">
          Nothing on this case is waiting on the office.
        </Banner>
      )}
      {view.filesUnavailable && <Banner tone="alert">Some photos aren’t available right now. Reload the page to try again.</Banner>}

      <div className={styles.grid}>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby="case-customer">
            <h2 id="case-customer" className={styles.cardTitle}>
              Customer’s side
            </h2>
            {view.cancellation && (
              <div className={styles.block}>
                <div className={styles.blockHead}>
                  <h3 className={styles.blockTitle}>Asked to cancel</h3>
                  <Pill kind={view.cancellation.open ? "waiting" : "good"}>{view.cancellation.open ? "Open" : "Decided"}</Pill>
                </div>
                <p className={styles.quote}>{view.cancellation.reason ? `“${view.cancellation.reason}”` : "No reason given."}</p>
                <p className={styles.caption}>
                  {view.cancellation.by === "system" ? "System" : (view.cancellation.byName ?? view.customer.name)} ·{" "}
                  <time dateTime={view.cancellation.at}>{view.cancellation.when}</time>
                </p>
              </div>
            )}
            {customerProblems.map((problem) => (
              <ProblemBlock key={problem.id} problem={problem} />
            ))}
            {!view.cancellation && !customerProblems.length && <p className={styles.empty}>Nothing from the customer.</p>}
          </section>

          <section className={styles.card} aria-labelledby="case-tradie">
            <h2 id="case-tradie" className={styles.cardTitle}>
              Tradie’s side
            </h2>
            {!view.tradie ? (
              <p className={styles.empty}>No tradie on this job yet.</p>
            ) : (
              <>
                <div className={styles.block}>
                  <h3 className={styles.blockTitle}>Updates</h3>
                  {view.tradieSide.updates.length ? (
                    <ol className={styles.updates}>
                      {view.tradieSide.updates.map((update) => (
                        <li key={update.id}>
                          <p className={styles.updateTitle}>{update.title}</p>
                          {update.detail && <p className={styles.quote}>“{update.detail}”</p>}
                          <p className={styles.caption}>
                            <time dateTime={update.at}>{update.when}</time>
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.empty}>No updates yet.</p>
                  )}
                </div>
                <div className={styles.block}>
                  <h3 className={styles.blockTitle}>Evidence</h3>
                  {view.tradieSide.evidence?.sentAt ? (
                    <>
                      <p className={styles.caption}>
                        Sent <time dateTime={view.tradieSide.evidence.sentAt}>{view.tradieSide.evidence.sentWhen}</time>
                      </p>
                      {view.tradieSide.evidence.cocNumber && (
                        <dl className={styles.lines}>
                          <div>
                            <dt>CoC number</dt>
                            <dd>{view.tradieSide.evidence.cocNumber}</dd>
                          </div>
                        </dl>
                      )}
                      {view.tradieSide.evidence.notes && <p className={styles.quote}>“{view.tradieSide.evidence.notes}”</p>}
                      <Photos photos={view.tradieSide.evidence.photos} label="Finished work photo" />
                    </>
                  ) : (
                    <p className={styles.empty}>Not sent yet.</p>
                  )}
                </div>
                {tradieProblems.map((problem) => (
                  <ProblemBlock key={problem.id} problem={problem} />
                ))}
              </>
            )}
            <p className={styles.links}>
              <TextLink href={view.messagesHref}>Read messages</TextLink>
            </p>
          </section>
        </div>

        <div className={styles.column}>
          <DecisionCard view={view} online={online} onOpen={setDialog} />
          <MoneyCard view={view} />
        </div>
      </div>

      {dialog && (
        <DecisionDialogView
          key={dialog}
          name={dialog}
          view={view}
          submit={submit}
          online={online}
          initialValues={initialValues}
          presetError={initialError}
          onClose={() => setDialog(null)}
          onDone={finished}
        />
      )}
    </div>
  );
}

function Crumbs({ base, label }: { base: string; label: string }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href={base}>Cancellations &amp; disputes</Link>
      <Icon name="chevron_right" size="sm" decorative />
      <span aria-current="page">{label}</span>
    </nav>
  );
}

function Photos({ photos, label }: { photos: DisputePhoto[]; label: string }) {
  if (!photos.length) return <p className={styles.empty}>No photos added.</p>;
  return (
    <div className={styles.photos}>
      {photos.map((photo, index) =>
        photo.url ? (
          // Private signed photos, renewed when the office reloads the case.
          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`${label} ${index + 1}`} />
          </a>
        ) : (
          <span key={photo.id} className={styles.photoMissing}>
            Photo unavailable
          </span>
        ),
      )}
    </div>
  );
}

function ProblemBlock({ problem }: { problem: DisputeProblem }) {
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>Problem report</h3>
        <Pill kind={problem.status === "OPEN" ? "waiting" : "good"}>{problem.status === "OPEN" ? "Open" : "Resolved"}</Pill>
      </div>
      {problem.urgent && <Banner tone="alert" title="Urgent / safety" />}
      <dl className={styles.facts}>
        <div>
          <dt>Topic</dt>
          <dd>{problem.topic}</dd>
        </div>
        <div>
          <dt>Details</dt>
          <dd className={styles.prewrap}>{problem.details}</dd>
        </div>
      </dl>
      <Photos photos={problem.photos} label="Report photo" />
      <p className={styles.caption}>
        {problem.reporterName} · <time dateTime={problem.at}>{problem.when}</time>
      </p>
      {problem.status === "RESOLVED" && (
        <p className={styles.resolution}>
          Resolved{problem.resolvedBy ? ` by ${problem.resolvedBy}` : ""}
          {problem.resolvedWhen ? `, ${problem.resolvedWhen}` : ""}: {problem.resolution}
        </p>
      )}
      {problem.threadHref && (
        <p className={styles.links}>
          <TextLink href={problem.threadHref}>Open conversation</TextLink>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Decision

function DecisionCard({ view, online, onOpen }: { view: DisputeCaseView; online: boolean; onOpen: (name: DecisionDialog) => void }) {
  const open = view.problems.filter((problem) => problem.status === "OPEN");
  const cancelling = view.cancellation?.open ?? false;
  const offline = online ? undefined : "You’re offline";
  const nothingLeft = view.money.payments.every((payment) => payment.refundableCents < 1);
  return (
    <section className={styles.card} aria-labelledby="case-decision">
      <h2 id="case-decision" className={styles.cardTitle}>
        Decision
      </h2>
      {cancelling && (
        <div className={styles.block}>
          <p className={styles.text}>The customer asked to cancel. Pick what happens: they and the tradie are told.</p>
          <div className={styles.actions}>
            <Button width="full" disabled={offline ?? (nothingLeft ? "Nothing to refund" : undefined)} onClick={() => onOpen("refund")}>
              {CANCEL_DECISION_LABELS.refund}
            </Button>
            <Button width="full" variant="secondary" disabled={offline} onClick={() => onOpen("no-refund")}>
              {CANCEL_DECISION_LABELS["no-refund"]}
            </Button>
            <Button width="full" variant="secondary" disabled={offline} onClick={() => onOpen("keep")}>
              {CANCEL_DECISION_LABELS.keep}
            </Button>
          </div>
        </div>
      )}
      {open.map((problem, index) => (
        <div key={problem.id} className={styles.block}>
          <p className={styles.text}>
            Problem reported: <strong>{problem.topic}</strong>. Resolving it lets the sign-off timer carry on.
          </p>
          <Button
            width="full"
            variant={cancelling || index > 0 ? "secondary" : "primary"}
            disabled={offline}
            aria-label={open.length > 1 ? `Resolve: ${problem.topic}` : undefined}
            onClick={() => onOpen(`resolve:${problem.id}`)}
          >
            Resolve
          </Button>
        </div>
      ))}
      {!cancelling && !open.length && !view.decisions.length && <p className={styles.empty}>Nothing to decide.</p>}
      {view.decisions.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Decided</h3>
          <ol className={styles.updates}>
            {view.decisions.map((decision) => (
              <li key={decision.id}>
                <p className={styles.updateTitle}>{decision.title}</p>
                {decision.note && <p className={styles.quote}>“{decision.note}”</p>}
                <p className={styles.caption}>
                  {decision.by ? `${decision.by} · ` : ""}
                  <time dateTime={decision.at}>{decision.when}</time>
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function MoneyCard({ view }: { view: DisputeCaseView }) {
  const m = view.money;
  return (
    <section className={styles.card} aria-labelledby="case-money">
      <h2 id="case-money" className={styles.cardTitle}>
        Money
      </h2>
      <dl className={styles.lines}>
        {m.payments.length === 0 && (
          <div>
            <dt>Customer paid</dt>
            <dd>Not paid yet</dd>
          </div>
        )}
        {m.payments.map((payment) => (
          <div key={payment.id}>
            <dt>{payment.label}</dt>
            <dd>
              {money(payment.amountCents)}
              {payment.refundedCents > 0 && <span className={styles.muted}> · {money(payment.refundedCents)} back</span>}
            </dd>
          </div>
        ))}
        <div>
          <dt>Refunded so far</dt>
          <dd>{money(m.refundedCents)}</dd>
        </div>
        <div>
          <dt>Tradie earns</dt>
          <dd>{m.tradieEarnsCents === null ? "Not priced yet" : `${money(m.tradieEarnsCents)} for the job`}</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd className={styles.payout}>
            <Pill kind={m.payroll.kind}>{m.payroll.label}</Pill>
            {m.payoutCents !== null && (
              <span>
                {money(m.payoutCents)}
                {m.payoutMinutes !== null ? ` · ${hours(m.payoutMinutes)} h` : ""}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100}`;

// ---------------------------------------------------------------- Dialogs

type DialogProps = {
  name: DecisionDialog;
  view: DisputeCaseView;
  submit: SubmitDecision;
  online: boolean;
  initialValues?: Partial<DisputeFields>;
  presetError: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
};

const TITLES: Record<CancelDecision, string> = {
  refund: "Cancel and refund",
  "no-refund": "Cancel without a refund",
  keep: "Keep the job going",
};

function DecisionDialogView({ name, view, submit, online, initialValues, presetError, onClose, onDone }: DialogProps) {
  const sessionExpired = useOptionalSessionExpired();
  const problem = name.startsWith("resolve:") ? (view.problems.find((row) => `resolve:${row.id}` === name) ?? null) : null;
  const decision = problem ? null : (name as CancelDecision);
  const refundable = view.money.payments.filter((payment) => payment.refundableCents > 0);
  // One id for as long as this dialog is open, sent with every try, so trying again can't refund or pay twice.
  const [values, setValues] = useState<DisputeFields>(() => ({
    note: "",
    mode: problem ? "none" : "full",
    paymentId: refundable[0]?.id ?? "",
    amount: "",
    payTradie: false,
    hours: "",
    requestId: crypto.randomUUID(),
    ...initialValues,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(presetError);
  const set = <K extends keyof DisputeFields>(key: K) => (value: DisputeFields[K]) => setValues((current) => ({ ...current, [key]: value }));

  /** Under its field when the dialog shows that field; otherwise above the buttons, so nothing fails silently. */
  const show = (field: string | undefined, message: string) => {
    const shown = ["note", "mode", "amount", "hours", ...(refundable.length > 1 ? ["paymentId"] : [])];
    if (field && shown.includes(field)) setErrors({ [field]: message });
    else setFailure(message);
  };

  const payload = () => {
    const partial = values.mode === "partial" ? { mode: "partial", paymentId: values.paymentId, amountCents: parseMoneyToCents(values.amount) } : null;
    if (problem) {
      return { kind: "problem", jobId: view.id, reportId: problem.id, seenStatus: view.status, note: values.note, requestId: values.requestId, refund: partial };
    }
    return {
      kind: "cancellation",
      jobId: view.id,
      decision,
      note: values.note,
      requestId: values.requestId,
      refund: decision === "refund" ? (values.mode === "full" ? { mode: "full" } : partial) : null,
      // A ticked box with no hours is sent as -1, so the server refuses it too rather than paying nothing.
      partPayoutMinutes: decision !== "keep" && values.payTradie ? (partPayoutMinutes(values.hours) ?? -1) : null,
    };
  };

  const send = async (): Promise<void> => {
    setFailure(null);
    if (!online) {
      setFailure("You’re offline. Nothing was changed. Try again when you’re back online.");
      return;
    }
    const body = payload();
    const checked = parseDisputeDecision(body);
    if (!checked.ok) {
      show(checked.field, checked.message);
      return;
    }
    setErrors({});
    let result: Awaited<ReturnType<SubmitDecision>>;
    try {
      result = await submit(body);
    } catch {
      setFailure("Couldn’t save that. Nothing was changed. Try again.");
      return;
    }
    if (sessionExpired?.check(result, { resend: send })) return;
    if (result.ok) return onDone(result.message);
    if (!("message" in result)) setFailure("You’re not able to do that. Log in again, or ask for office access.");
    else show(result.field, result.message);
  };

  const chosen = refundable.find((payment) => payment.id === values.paymentId) ?? refundable[0];
  const totalLeft = refundable.reduce((sum, payment) => sum + payment.refundableCents, 0);
  const people = [view.customer.name, view.tradie?.name].filter(Boolean).join(" and ");
  const told = `${people} ${view.tradie ? "are" : "is"} told.`;
  const canPayTradie = Boolean(view.tradie) && view.money.rateCents !== null && view.money.maxPartMinutes > 0 && !view.hasPayout;

  const note = <TextAreaField label="Note" required rows={3} maxLength={500} value={values.note} error={errors.note} onChange={(event) => set("note")(event.target.value)} />;
  const partRefund = values.mode === "partial" && (
    <>
      {refundable.length > 1 && (
        <SelectField label="Payment" required value={values.paymentId} error={errors.paymentId} onChange={(event) => set("paymentId")(event.target.value)}>
          {refundable.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {payment.label} · {money(payment.refundableCents)} left
            </option>
          ))}
        </SelectField>
      )}
      <MoneyField
        label="Amount to refund"
        required
        value={values.amount}
        error={errors.amount}
        hint={chosen ? `Up to ${money(chosen.refundableCents)}` : undefined}
        onChange={(event) => set("amount")(event.target.value)}
      />
    </>
  );
  const testMode = (
    <Banner tone="test" title="Test mode.">
      Sent to Stripe as a test refund. No real money moves until real payments are on.
    </Banner>
  );
  const partPayout = canPayTradie && decision !== "keep" && (
    <>
      <CheckboxField label={`Pay ${view.tradie?.name.split(" ")[0]} for work done`} checked={values.payTradie} onChange={(event) => set("payTradie")(event.target.checked)} />
      {values.payTradie && (
        <TextField
          label="Hours to pay"
          required
          inputMode="decimal"
          value={values.hours}
          error={errors.hours}
          hint={`At ${money(view.money.rateCents ?? 0)}/h plus holiday pay. Up to ${hours(view.money.maxPartMinutes)} h.`}
          onChange={(event) => set("hours")(event.target.value)}
        />
      )}
    </>
  );
  const common = { open: true, onCancel: onClose, onConfirm: send, error: failure, size: "md" as const };

  if (problem) {
    return (
      <ConfirmDialog {...common} title="Resolve problem" confirmLabel="Resolve">
        <p className={styles.dialogText}>
          “{problem.topic}” is closed and the sign-off timer carries on. {told}
        </p>
        <RadioGroup
          name="resolve-refund"
          label="Refund"
          required
          value={values.mode}
          error={errors.mode}
          onChange={(value) => set("mode")(value as DisputeFields["mode"])}
          options={[
            { value: "none", label: "No refund" },
            { value: "partial", label: "Part refund", disabled: refundable.length === 0, hint: refundable.length === 0 ? "Nothing to refund" : undefined },
          ]}
        />
        {values.mode === "partial" && testMode}
        {partRefund}
        {note}
      </ConfirmDialog>
    );
  }

  switch (decision) {
    case "refund":
      return (
        <ConfirmDialog {...common} title={TITLES.refund} confirmLabel="Cancel and refund">
          <p className={styles.dialogText}>
            {view.number} is cancelled and {told}
          </p>
          {testMode}
          <RadioGroup
            name="cancel-refund"
            label="How much"
            required
            value={values.mode}
            error={errors.mode}
            onChange={(value) => set("mode")(value as DisputeFields["mode"])}
            options={[
              { value: "full", label: "Full refund", hint: money(totalLeft) },
              { value: "partial", label: "Part refund" },
            ]}
          />
          {partRefund}
          {partPayout}
          {note}
        </ConfirmDialog>
      );
    case "no-refund":
      return (
        <ConfirmDialog {...common} title={TITLES["no-refund"]} confirmLabel="Cancel job">
          <p className={styles.dialogText}>
            {view.number} is cancelled and nothing is refunded. {told}
          </p>
          {partPayout}
          {note}
        </ConfirmDialog>
      );
    default: {
      const back = view.cancellation?.backTo ? (statusPill(view.cancellation.backTo, "office")?.label ?? view.cancellation.backTo) : null;
      return (
        <ConfirmDialog {...common} title={TITLES.keep} confirmLabel="Keep the job going">
          <p className={styles.dialogText}>
            {view.number} goes back to {back ? `“${back}”` : "where it was"}. Nothing is refunded. {told}
          </p>
          {note}
        </ConfirmDialog>
      );
    }
  }
}
