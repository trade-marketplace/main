import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { WhereDemo } from "./WhereDemo";
import styles from "./gallery.module.css";
export const metadata: Metadata = { title: "Where and when (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "empty";
  if (state === "editor-states") return <main id="main" data-mode="customer" className={styles.gallery}>
    <h1>When do you need it?</h1>
    {["update", "update-error", "update-loading", "update-load-error", "update-changed", "update-offline", "update-claimed", "update-saving"].map(name => <section key={name}>
      <h2 className={styles.state}>{name}</h2><WhereDemo state={name} embedded />
    </section>)}
  </main>;
  return <WhereDemo key={state} state={state} />;
}
