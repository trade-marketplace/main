import Image from "next/image";
import type { MaintenanceWindow } from "@/lib/maintenance";
import styles from "./maintenance.module.css";

export function MaintenancePage({ window }: { window: MaintenanceWindow }) {
  return <main className={styles.page}>
    <div className="tm-anim-rise">
      <Image src="/images/van.png" alt="" width={200} height={140} unoptimized />
      <h1>Back at {window.endTime}.</h1>
      <p>We’re doing some upgrades tonight ({window.label}).<br />Your jobs are safe.</p>
    </div>
  </main>;
}
