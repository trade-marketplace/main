"use client";
// The Materials card on the office job admin (#512): the budget, the tradie's spend and receipt, their reason for going
// over, and what payroll repays. An over-budget spend holds the tradie's payout until the office uses "Approve spend"
// (repay the whole spend) or "Change amount" (repay a set amount up to the spend). Both need a note, stored on the
// timeline. The server reads the card (src/server/office/materials.ts) and checks every decision again.
import { useState } from "react";

import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Button } from "@/components/Button";
import { MoneyField, TextAreaField } from "@/components/forms";
import { Banner, ConfirmDialog } from "@/components/overlays";
import { Pill } from "@/components/status/Pill";
import { TextLink } from "@/components/TextLink";
import { amountToCents, parseMaterialsDecision, repaidLabel, type MaterialsDecisionResult, type OfficeMaterialsView } from "@/lib/office/materials";
import { money, NOTE_MAX } from "@/lib/office-job";

import styles from "./job-admin.module.css";

export type MaterialsDialog = "approve" | "change";

/** Sends one decision to the server. The page passes the real one; the preview passes a pretend one. */
export type SubmitMaterialsDecision = (input: unknown) => Promise<MaterialsDecisionResult | { ok: false; error: "session-expired" | "forbidden" }>;

type Props = {
  jobId: string;
  materials: OfficeMaterialsView;
  /** "Jack Wilson": who is repaid. */
  tradie: string | null;
  decide: SubmitMaterialsDecision;
  /** Called with what to tell the office once a decision is saved. */
  onDone: (message: string) => void;
  /** Previews: start with this dialog open, with this error in it. */
  initialDialog?: MaterialsDialog | null;
  initialError?: string | null;
};

export function JobMaterialsCard({ jobId, materials: m, tradie, decide, onDone, initialDialog = null, initialError = null }: Props) {
  const [dialog, setDialog] = useState<MaterialsDialog | null>(m.canDecide ? initialDialog : null);
  const over = m.spentCents !== null && m.spentCents > m.budgetCents ? m.spentCents - m.budgetCents : 0;
  return (
    <section className={styles.card} aria-labelledby="job-materials">
      <h2 id="job-materials" className={styles.cardTitle}>Materials</h2>
      <dl className={styles.lines}>
        <div>
          <dt>Budget</dt>
          <dd>{money(m.budgetCents)}</dd>
        </div>
        <div>
          <dt>Spend</dt>
          <dd>{m.spentCents === null ? "Not reported yet" : money(m.spentCents)}</dd>
        </div>
        {over > 0 && (
          <div>
            <dt>Over budget</dt>
            <dd>{money(over)}</dd>
          </div>
        )}
        {m.spentCents !== null && (
          <div>
            <dt>Receipt</dt>
            <dd>
              {m.receipt === null ? "None added" : m.receipt.url ? <TextLink href={m.receipt.url} external>Open receipt</TextLink> : "Couldn’t load the receipt"}
            </dd>
          </div>
        )}
        <div>
          <dt>Repaid</dt>
          <dd>{repaidLabel(m)}</dd>
        </div>
        {m.sent && (
          <div>
            <dt>Payroll</dt>
            <dd><Pill kind="info">Sent to payroll</Pill></dd>
          </div>
        )}
      </dl>

      {m.reason && (
        <div className={styles.materialsBlock}>
          <p className={styles.caption}>Why it was over</p>
          <p className={styles.note}>“{m.reason}”</p>
        </div>
      )}
      {m.state === "to-check" && (
        <Banner tone="alert" className={styles.materialsBanner}>
          {m.sent ? "Sent to payroll before it was checked. Nothing was repaid." : "The payout is held until you check the receipt."}
        </Banner>
      )}
      {m.decision && (
        <div className={styles.materialsBlock}>
          <p className={styles.caption}>
            {m.decision.kind === "changed" ? "Amount changed" : "Approved"}
            {m.decision.by ? ` by ${m.decision.by}` : ""} · <time dateTime={m.decision.at}>{m.decision.when}</time>
          </p>
          {m.decision.note && <p className={styles.note}>“{m.decision.note}”</p>}
        </div>
      )}
      {m.canDecide && (
        <div className={styles.materialsActions}>
          <Button size="sm" width="auto" onClick={() => setDialog("approve")}>Approve spend</Button>
          <Button variant="secondary" size="sm" width="auto" onClick={() => setDialog("change")}>Change amount</Button>
        </div>
      )}

      {dialog && m.spentCents !== null && (
        <DecisionDialog
          key={dialog}
          name={dialog}
          jobId={jobId}
          spentCents={m.spentCents}
          tradie={tradie}
          decide={decide}
          presetError={initialError}
          onClose={() => setDialog(null)}
          onDone={(repaid) => {
            setDialog(null);
            onDone(dialog === "approve" ? `Spend approved. ${money(repaid)} goes to payroll.` : `Amount saved. ${money(repaid)} goes to payroll.`);
          }}
        />
      )}
    </section>
  );
}

type DialogProps = {
  name: MaterialsDialog;
  jobId: string;
  spentCents: number;
  tradie: string | null;
  decide: SubmitMaterialsDecision;
  presetError: string | null;
  onClose: () => void;
  onDone: (repaidCents: number) => void;
};

function DecisionDialog({ name, jobId, spentCents, tradie, decide, presetError, onClose, onDone }: DialogProps) {
  const sessionExpired = useOptionalSessionExpired();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({});
  const [failure, setFailure] = useState<string | null>(presetError);
  const who = tradie ?? "The tradie";

  const send = async (): Promise<void> => {
    setFailure(null);
    const cents = name === "change" ? amountToCents(amount) : null;
    const payload = { jobId, kind: name, seenSpentCents: spentCents, note, ...(name === "change" ? { repaidCents: cents ?? -1 } : {}) };
    const checked = parseMaterialsDecision(payload);
    if (!checked.ok) {
      if (checked.field === "form") setFailure(checked.message);
      else setErrors({ [checked.field]: checked.message });
      return;
    }
    setErrors({});
    let result: Awaited<ReturnType<SubmitMaterialsDecision>>;
    try {
      result = await decide(payload);
    } catch {
      setFailure("Couldn’t save that. Nothing was changed. Try again.");
      return;
    }
    if (sessionExpired?.check(result, { resend: send })) return;
    if (result.ok) return onDone(result.repaidCents);
    if (!("message" in result)) setFailure("You’re not able to do that. Log in again, or ask for office access.");
    else if (result.field) setErrors({ [result.field]: result.message });
    else setFailure(result.message);
  };

  const noteField = (
    <TextAreaField label="Note" required rows={3} maxLength={NOTE_MAX} value={note} error={errors.note} onChange={(event) => setNote(event.target.value)} />
  );
  const common = { open: true, onCancel: onClose, onConfirm: send, error: failure, size: "md" as const };

  return name === "approve" ? (
    <ConfirmDialog {...common} title="Approve spend" confirmLabel="Approve spend">
      <p className={styles.dialogText}>{who} is repaid the full {money(spentCents)} with their payout.</p>
      {noteField}
    </ConfirmDialog>
  ) : (
    <ConfirmDialog {...common} title="Change amount" confirmLabel="Save amount">
      <p className={styles.dialogText}>{who} is repaid this amount with their payout instead of the {money(spentCents)} spend.</p>
      <MoneyField label="Amount to repay" required value={amount} error={errors.amount} hint={`Up to ${money(spentCents)}`} onChange={(event) => setAmount(event.target.value)} />
      {noteField}
    </ConfirmDialog>
  );
}
