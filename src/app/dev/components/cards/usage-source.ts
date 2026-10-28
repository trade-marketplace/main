// The code shown under "Usage" on /dev/components/cards, so people can copy it. It matches the "Customer, phone"
// job rows on that page. Keep the two in step.
export const USAGE_SOURCE = `import { CATEGORIES, CategoryRail, CategoryTile, EmptyCard, JobRow } from "@/components/cards";
import { StatusPill } from "@/components/status/StatusPill";

<CategoryRail label="What needs doing?">
  {CATEGORIES.map((category) => (
    <li key={category}><CategoryTile category={category} href={\`/jobs/new?type=\${category}\`} /></li>
  ))}
</CategoryRail>

{jobs.length === 0 ? (
  <EmptyCard illustration="van" title="Nothing on yet."
    action={<Button href="/jobs/new" width="auto">Post a job</Button>} />
) : (
  <ul aria-label="Your jobs">
    {jobs.map((job) => (
      <li key={job.id}>
        <JobRow href={\`/jobs/\${job.id}\`} category={job.trade} title={job.title} meta={\`\${job.suburb} · \${job.number}\`}
          photo={job.thumbUrl} price={job.priceCents === null ? undefined : formatCents(job.priceCents)}
          status={<StatusPill status={job.status} audience="customer" />} />
      </li>
    ))}
  </ul>
)}`;
