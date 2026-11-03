// The earnings statement (#165, D12 note 4): a PDF of what payroll has paid the tradie in a tax year, for their
// records and tax. Only PAID payouts are listed (nothing that is merely queued), and only this worker's. Amounts are
// the ones stored when the job was signed off (#164), before PAYE.
//
// The PDF is written by hand (plain text in two built-in fonts) so the app needs no PDF library.
import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { dayMonth, formatCents, formatHours, nzDay, payoutTotal, type PayoutRecord, taxYearOf } from "@/lib/earnings";
import { jobNumberLabel } from "@/lib/office-jobs";
import { workerPayoutView } from "@/server/views/earnings";

export type StatementDatabase = Pick<PrismaClient, "payout">;

export type Statement = {
  name: string;
  taxYear: ReturnType<typeof taxYearOf>;
  rows: (PayoutRecord & { paidDay: string })[];
};

export async function loadStatement(db: StatementDatabase, workerId: string, name: string, now: Date = new Date()): Promise<Statement> {
  const taxYear = taxYearOf(nzDay(now));
  // A day either side of the year, because the filter below uses New Zealand days.
  const from = new Date(`${taxYear.start}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${taxYear.end}T23:59:59Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const payouts = await db.payout.findMany({
    where: { workerId, status: "PAID", paidAt: { gte: from, lte: to } },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      workerId: true,
      minutes: true,
      rateCents: true,
      grossCents: true,
      holidayPayCents: true,
      status: true,
      createdAt: true,
      paidAt: true,
      job: { select: { jobNumber: true, title: true } },
    },
  });
  const rows = payouts
    .flatMap(payout => {
      const visible = workerPayoutView({ userId: workerId, role: "TRADIE" }, payout);
      return visible?.paidAt ? [{ id: visible.id, jobNumber: jobNumberLabel(visible.job.jobNumber), title: visible.job.title,
        minutes: visible.minutes, rateCents: visible.rateCents, grossCents: visible.grossCents,
        holidayPayCents: visible.holidayPayCents, status: visible.status, createdAt: visible.createdAt,
        paidAt: visible.paidAt, paidDay: nzDay(new Date(visible.paidAt)) }] : [];
    })
    .filter((row) => row.paidDay >= taxYear.start && row.paidDay <= taxYear.end);
  return { name, taxYear, rows };
}

// ---- The text of the statement ---------------------------------------------------------------------------

const longDate = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const formatDay = (day: string) => longDate.format(new Date(`${day}T00:00:00Z`));

/** Standard fonts only speak Latin-1: macrons and other marks are dropped rather than printed as rubbish. */
export function pdfSafe(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");
}

const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}~` : text.padEnd(width));
const right = (text: string, width: number) => text.padStart(width);

export type StatementLine = { text: string; style: "title" | "heading" | "body" | "mono" | "monoBold" | "gap" };

export function statementLines(statement: Statement): StatementLine[] {
  const { rows, taxYear, name } = statement;
  const lines: StatementLine[] = [
    { text: "Earnings statement", style: "title" },
    { text: name, style: "heading" },
    { text: `Tax year ${formatDay(taxYear.start)} to ${formatDay(taxYear.end)}`, style: "body" },
    { text: "Paid through payroll. Amounts are before PAYE.", style: "body" },
    { text: "", style: "gap" },
  ];
  if (rows.length === 0) {
    lines.push({ text: "Nothing has been paid in this tax year yet.", style: "body" });
    return lines;
  }
  const header = `${fit("Paid", 7)}${fit("Job", 34)}${right("Time", 10)}${right("Rate", 10)}${right("Gross", 11)}${right("Holiday", 10)}${right("Total", 11)}`;
  lines.push({ text: header, style: "monoBold" });
  for (const row of rows) {
    lines.push({
      text:
        fit(dayMonth(row.paidDay), 7) +
        fit(`${row.jobNumber} ${row.title}`, 34) +
        right(formatHours(row.minutes), 10) +
        right(`${formatCents(row.rateCents)}/hr`, 10) +
        right(formatCents(row.grossCents), 11) +
        right(formatCents(row.holidayPayCents), 10) +
        right(formatCents(payoutTotal(row)), 11),
      style: "mono",
    });
  }
  const gross = rows.reduce((total, row) => total + row.grossCents, 0);
  const holiday = rows.reduce((total, row) => total + row.holidayPayCents, 0);
  lines.push({ text: "", style: "gap" });
  lines.push({
    text: fit(`Total, ${rows.length} ${rows.length === 1 ? "job" : "jobs"}`, 41) + right("", 20) + right(formatCents(gross), 11) + right(formatCents(holiday), 10) + right(formatCents(gross + holiday), 11),
    style: "monoBold",
  });
  return lines;
}

// ---- A minimal PDF ---------------------------------------------------------------------------------------------

const PAGE = { width: 595, height: 842, margin: 48 };
const STYLES: Record<StatementLine["style"], { font: "F1" | "F2" | "F3" | "F4"; size: number; leading: number }> = {
  title: { font: "F1", size: 20, leading: 28 },
  heading: { font: "F1", size: 13, leading: 20 },
  body: { font: "F2", size: 10, leading: 15 },
  mono: { font: "F3", size: 7.8, leading: 12 },
  monoBold: { font: "F4", size: 7.8, leading: 12 },
  gap: { font: "F2", size: 10, leading: 10 },
};

const escapeText = (text: string) => pdfSafe(text).replace(/[\\()]/g, (char) => `\\${char}`);

/** The statement as PDF bytes. */
export function statementPdf(statement: Statement): Buffer {
  const pages: string[] = [];
  let content = "";
  let y = PAGE.height - PAGE.margin;
  const startPage = () => {
    content = "";
    y = PAGE.height - PAGE.margin;
  };
  const endPage = () => pages.push(content);
  startPage();
  for (const line of statementLines(statement)) {
    const style = STYLES[line.style];
    if (y - style.leading < PAGE.margin) {
      endPage();
      startPage();
    }
    y -= style.leading;
    if (line.text) content += `BT /${style.font} ${style.size} Tf ${PAGE.margin} ${y.toFixed(1)} Td (${escapeText(line.text)}) Tj ET\n`;
  }
  endPage();

  // Objects: 1 catalog, 2 pages, 3-6 fonts, then a page and its content for each page.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 7 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  objects[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((text, index) => {
    const id = pageIds[index];
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
