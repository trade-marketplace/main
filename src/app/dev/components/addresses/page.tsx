import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { ADDRESS_STATES } from "@/lib/account/addresses";
import { guardDevPage } from "@/server/dev-pages";
import account from "@/components/account/account.module.css";
import styles from "@/components/account/addresses.module.css";
import { AddressesDemo } from "./AddressesDemo";

export const metadata: Metadata = { title: "Addresses (dev)", robots: { index: false, follow: false } };
export default async function AddressesPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const value = (await searchParams).state;
  const state = ADDRESS_STATES.find(state => state === value) ?? "list";
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/addresses", base: "/dev/components/addresses" }}>
    <AccountSettings role="CUSTOMER" active="/profile/addresses">
      {value === "gallery" ? <div className={styles.gallery}><h1 className={account.title}>Addresses</h1>{(["error", "offline", "loading"] as const).map(state => <section key={state} aria-label={state}><AddressesDemo state={state} headingLevel={2} /></section>)}</div> : <AddressesDemo key={state} state={state} />}
    </AccountSettings>
  </AppShellView>;
}
