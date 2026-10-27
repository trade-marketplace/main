// The empty card (#76): an empty state from the kit (<EmptyState>, #79) in a flat card, for a section of a page
// with nothing in it yet ("In progress", "Ready to claim"), so the section keeps its place. Tone: friendly, not
// sorry (FRONTEND_SPEC "Empty state").
//
//   <EmptyCard icon="inbox" title="Nothing on yet." message="Got something that needs doing? Post it free."
//     action={<Button href="/jobs/new" width="auto">Post a job</Button>} />
import { EmptyState, type EmptyStateProps } from "@/components/feedback";

import styles from "./cards.module.css";

export function EmptyCard({ className, ...state }: EmptyStateProps) {
  return (
    <div className={[styles.emptyCard, className].filter(Boolean).join(" ")}>
      <EmptyState headingLevel={3} {...state} />
    </div>
  );
}
