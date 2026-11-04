import { Icon } from "@/components/Icon";
import styles from "./app.module.css";

/** A tradie's quote points (#488): the gold coin next to the bell, on every page. */
export function PointsBalance({ points }: { points: number }) {
  const label = `${points} ${points === 1 ? "point" : "points"}`;
  return <span className={styles.points} role="img" aria-label={label} title={label}>
    <Icon name="toll" fill size="sm" decorative /><span aria-hidden="true">{points}</span>
  </span>;
}
