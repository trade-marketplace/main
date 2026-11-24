import { DataTable, TableItem, type Column } from "@/components/data/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Pill } from "@/components/status/Pill";
import { formatCents } from "@/lib/earnings";
import { boardJobHref } from "@/lib/job-board";
import { myWorkHref, type MyQuote, type MyQuotesData, type MyWorkQuery } from "@/lib/my-work";

export function MyQuotes({ data, query }: { data: MyQuotesData; query: MyWorkQuery }) {
  const columns: Column<MyQuote>[] = [
    { key: "job", header: "Job", primary: true, cell: row => row.canOpen
      ? <TableItem title={row.title} href={boardJobHref(row.jobId, myWorkHref(query))} />
      : <span data-plain-quote style={{ display: "contents" }}><TableItem title={row.title} /></span> },
    { key: "estimate", header: "Your estimate", cell: row => `${row.estimateHours} h` },
    { key: "earn", header: "Earn", cell: row => row.earnCents === null ? null : `Earn ${formatCents(row.earnCents)}` },
    { key: "outcome", header: "Outcome", cell: row => <Pill kind={row.outcome === "Taken by you" ? "good" : "waiting"}>{row.outcome}</Pill> },
  ];
  // Some past quotes no longer pass the existing job read boundary. Keep the history,
  // with a real title link only for a readable job; do not attach a whole-row click handler.
  return <div data-quote-history><style>{`
    [data-quote-history] tbody > tr:has([data-plain-quote]):hover,
    [data-quote-history] tbody > tr:has([data-plain-quote]):hover > td { background: transparent; cursor: auto; }
  `}</style><DataTable caption="My quotes" columns={columns} rows={data.rows} rowId={row => row.id} rowLabel={row => row.title}
    empty={<EmptyState title="No quotes yet." icon="request_quote" />} footer={data.total > data.rows.length ? <p>Showing your latest {data.rows.length} quotes.</p> : undefined} /></div>;
}
