// The job admin view while it loads (M15): grey shapes the size of the breadcrumb, title, cards and timeline.
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/feedback";

import styles from "./job-admin.module.css";

export function JobAdminSkeleton({ loading = true }: { loading?: boolean }) {
  return (
    <LoadingRegion
      loading={loading}
      label="Loading job"
      className={styles.page}
      skeleton={
        <div className={styles.page}>
          <Skeleton width={140} />
          <div className={styles.head}>
            <div>
              <Skeleton width={260} height={30} />
              <Skeleton width={320} />
            </div>
            <Skeleton width={110} height={40} />
          </div>
          <div className={styles.grid}>
            <div className={styles.left}>
              <div className={styles.card}>
                <SkeletonText lines={4} />
              </div>
              <div className={styles.card}>
                <SkeletonText lines={3} />
              </div>
            </div>
            <div className={styles.card}>
              <SkeletonText lines={8} />
            </div>
          </div>
        </div>
      }
    />
  );
}
