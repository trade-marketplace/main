"use client";
import { PublicProfileEditor } from "@/components/account/PublicProfileEditor";

export function EditorDemo({ state }: { state: string }) {
  return <PublicProfileEditor previewState={state}
    snapshot={{
      profile: { name: "Jack W.", avatarUrl: null, city: "Invercargill", joined: 2024, trades: ["ELECTRICAL"], jobs: 32, rating: 4.9, bio: state === "empty" || state === "typing" ? null : "Electrical work around Invercargill." },
      publicPath: state === "not-public-yet" ? null : "/dev/components/tradie-profile?state=full",
    }}
    onSave={async bio => ({ ok: true, bio: bio.trim() })} />;
}
