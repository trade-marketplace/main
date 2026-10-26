// The code shown under the usage example on /dev/components/feedback (FeedbackDemos.tsx › UsageExample), so
// people can copy it. Keep the two in step.
export const USAGE_SOURCE = `import { Button } from "@/components/Button";
import { EmptyState, ErrorState, JobRowSkeleton, LoadingRegion } from "@/components/feedback";

<LoadingRegion loading={loading} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
  {error ? (
    <ErrorState
      title="Can’t load your jobs"
      message="Check your connection and try again. If it keeps happening, let us know."
      onRetry={reload}
    />
  ) : jobs.length === 0 ? (
    <EmptyState
      illustration="van"
      title="Nothing on yet."
      message="Got something that needs doing? Post it free and we’ll get you a price."
      action={<Button href="/jobs/new">Post a job</Button>}
    />
  ) : (
    <JobList jobs={jobs} />
  )}
</LoadingRegion>`;
