import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";

import styles from "./account.module.css";

export function SecurityLoading() {
  return <LoadingRegion loading label="Loading security settings" skeleton={<div className={styles.sections}>
    <h1 className={styles.title}>Security</h1>
    {[0, 1, 2].map(item => <div className={styles.card} key={item}><Skeleton width="35%" height={24} /><SkeletonText lines={4} /></div>)}
  </div>} />;
}
