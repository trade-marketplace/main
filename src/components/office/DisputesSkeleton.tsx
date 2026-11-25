// Cancellations & disputes while they load (M15): grey shapes the size of the list, or of the case's cards.
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/feedback";

import styles from "./disputes.module.css";

export function DisputesSkeleton({ view = "list" }: { view?: "list" | "case" }) {
  const label = view === "list" ? "Loading cases" : "Loading case";
  return (
    <LoadingRegion
      loading
      label={label}
      className={styles.page}
      skeleton={
        <div className={styles.page}>
          <h1 className={styles.srOnly}>{label}</h1>
          {view === "case" && <Skeleton width={180} />}
          <div className={styles.head}>
            <div className={styles.headText}>
              <Skeleton width="min(280px, 100%)" height={30} />
              <Skeleton width="min(320px, 100%)" />
            </div>
          </div>
          {view === "list" ? (
            <div className={styles.card}>
              <SkeletonText lines={6} />
            </div>
          ) : (
            <div className={styles.grid}>
              <div className={styles.column}>
                <div className={styles.card}>
                  <SkeletonText lines={4} />
                </div>
                <div className={styles.card}>
                  <SkeletonText lines={5} />
                </div>
              </div>
              <div className={styles.column}>
                <div className={styles.card}>
                  <SkeletonText lines={4} />
                </div>
                <div className={styles.card}>
                  <SkeletonText lines={4} />
                </div>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
