"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider } from "@/components/overlays/Toast";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { signoffClock, type SignoffListData } from "@/lib/office/signoff";
import styles from "./signoff.module.css";
export function SignoffList({ data, loading = false, toast, base = "/admin/signoff", now }: { data: SignoffListData | null; loading?: boolean; toast?: string; base?: string; now?: number }) {
  const router = useRouter();
  const href = (id: string) => base.startsWith("/dev/") ? `${base}?state=review-electrical` : `${base}/${id}`;
  return <ToastProvider initial={toast ? { message: toast } : undefined}><section className={styles.page} data-mode="office"><header className={styles.header}><h1>Sign-off / CoC review</h1></header><OfflineBanner sticky={false} />{loading ? <div role="status" aria-label="Loading sign-off"><SkeletonText /><SkeletonText /><SkeletonText /></div> : !data ? <Banner tone="alert" action={<Button onClick={() => router.refresh()}>Try again</Button>}>Couldn’t load sign-off. Try again.</Banner> : !data.rows.length ? <div className={styles.card}><p>Nothing to check.</p></div> : <><ul className={styles.rows}>{data.rows.map(row => <li key={row.id} className={styles.row}><TextLink href={href(row.id)}>{row.number} · {row.title}</TextLink><p className={styles.muted}>{row.worker}</p><p className={styles.muted}>{signoffClock(row.sentAt, row.hours, row.problem, now ?? data.loadedAt)}</p><div className={styles.pills}>{row.problem && <span className={styles.pill}>Problem reported</span>}{row.checked && <span className={styles.pill}>Checked</span>}</div></li>)}</ul>{data.total > 20 && <nav aria-label="Sign-off pages" className={styles.pagination}>{data.page > 1 && <TextLink href={`${base}?page=${data.page - 1}`}>Previous</TextLink>}<span>Page {data.page}</span>{data.page * 20 < data.total && <TextLink href={`${base}?page=${data.page + 1}`}>Next</TextLink>}</nav>}</>}</section></ToastProvider>;
}
