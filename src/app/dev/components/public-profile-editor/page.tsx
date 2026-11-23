import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PublicEditorLoadError, PublicEditorLoading } from "@/components/account/PublicProfileEditor";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { EditorDemo } from "./EditorDemo";

export const metadata: Metadata = { title: "Public profile editor (dev)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "empty" } = await searchParams;
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/public", base: "/dev/components/public-profile-editor" }}>
    <AccountSettings role="TRADIE" active="/profile/public">
      {state === "loading" ? <PublicEditorLoading /> : state === "load-error" ? <PublicEditorLoadError /> : <EditorDemo state={state} />}
    </AccountSettings>
  </AppShellView>;
}
