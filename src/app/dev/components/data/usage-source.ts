// The code shown under the usage example on /dev/components/data, so people can copy it. It is the queues
// example (DataDemos.tsx › QueuesDemo), cut down. Keep the two in step.
export const USAGE_SOURCE = `import { Button } from "@/components/Button";
import { DataTable, TableItem, Tabs, type Column } from "@/components/data";
import { EmptyState } from "@/components/feedback";

const columns: Column<Job>[] = [
  { key: "job", header: "Job", primary: true,
    cell: (job) => <TableItem title={job.title} meta={\`\${job.trade} · \${job.number}\`} image={job.thumbUrl} /> },
  { key: "customer", header: "Customer", cell: (job) => \`\${job.customer} · \${job.suburb}\` },
  { key: "waiting", header: "Waiting", cell: (job) => ago(job.updatedAt) },
];

<Tabs label="Queues" value={tab} onChange={setTab}
  items={[{ value: "price", label: "To price", count: 4 }, { value: "extra", label: "Extra work", count: 2 }]}>
  <DataTable
    caption="To price"
    columns={columns}
    rows={jobs}
    rowId={(job) => job.id}
    rowLabel={(job) => job.title}
    rowActions={(job) => <Button size="sm" width="auto" href={\`/admin/jobs/\${job.id}/price\`}>Price it</Button>}
    empty={<EmptyState icon="task_alt" title="All clear." message="Nothing waiting in this queue." />}
  />
</Tabs>`;
