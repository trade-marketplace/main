"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { ErrorState, InlineError, OfflineBanner, SkeletonText, useOnlineStatus } from "@/components/feedback";
import { TextAreaField } from "@/components/forms/TextFields";
import { Avatar } from "@/components/media/Avatar";
import { TradieProfileCard } from "@/components/site/TradieProfile";
import type { SaveBioResult } from "@/server/workers/public-bio";
import type { OwnProfilePreview } from "@/server/workers/public-profile";
import { BIO_LIMIT, bioError } from "./public-bio-validation";
import account from "./account.module.css";
import styles from "./public-profile-editor.module.css";

type Props = {
  snapshot: OwnProfilePreview;
  onSave: (bio: string) => Promise<SaveBioResult>;
  previewState?: string;
};

export function PublicProfileEditor({ snapshot, onSave, previewState }: Props) {
  const [saved, setSaved] = useState(snapshot.profile.bio ?? "");
  const [bio, setBio] = useState(previewState === "too-long" ? "a".repeat(BIO_LIMIT + 1) : previewState === "typing" ? "Electrical work around Invercargill." : saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "forbidden" | "session-expired">(
    previewState === "saving" || previewState === "saved" || previewState === "error" ? previewState : "idle"
  );
  const busy = useRef(false);
  const connected = useOnlineStatus();
  const online = connected && previewState !== "offline";
  const validation = bioError(bio);
  const disabled = !online || Boolean(validation) || status === "saving" || (bio.trim() === saved && status !== "error");
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy.current || disabled) return;
    busy.current = true;
    setStatus("saving");
    try {
      const result = await onSave(bio);
      if (result.ok) {
        setSaved(result.bio);
        setBio(result.bio);
        setStatus("saved");
      } else {
        setStatus(result.error === "forbidden" || result.error === "session-expired" ? result.error : "error");
      }
    } catch {
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }

  return <>
    <h1 className={account.title}>Public profile</h1>
    <OfflineBanner online={previewState === "offline" ? false : undefined} sticky={false} />
    <div className={styles.columns}>
      <form className={account.card} onSubmit={save}>
        <div className={styles.photo}><Avatar name={snapshot.profile.name} src={snapshot.profile.avatarUrl} decorative /><TextLink href="/profile">Change photo</TextLink></div>
        <div className={styles.fields}>
          <TextAreaField label="Bio" name="bio" hint="Up to 300 characters." value={bio} error={validation ?? undefined}
            readOnly={status === "saving"} onChange={event => { setBio(event.target.value); setStatus("idle"); }} />
          <div className={styles.count}>{Array.from(bio.trim()).length} / {BIO_LIMIT}</div>
          {status === "error" && <InlineError message="Couldn’t save your bio." onRetry={online ? () => save() : undefined} />}
          {status === "session-expired" && <p role="alert">Your session has expired. <TextLink href="/login?next=%2Fprofile%2Fpublic">Log in again</TextLink></p>}
          {status === "forbidden" && <p role="alert">This profile is unavailable.</p>}
          <Button type="submit" disabled={disabled} loading={status === "saving"}>Save bio</Button>
          <span role="status">{status === "saved" && "Saved."}</span>
        </div>
      </form>
      <div className={styles.preview}>
        <h2>Preview</h2>
        <TradieProfileCard heading="h3" profile={{ ...snapshot.profile, bio: bio.trim() }} />
        {snapshot.publicPath ? <TextLink href={snapshot.publicPath}>See your public profile</TextLink> :
          <p>Your profile goes public once we’ve checked your details.</p>}
      </div>
    </div>
  </>;
}

export function PublicEditorLoading() {
  return <><h1 className={account.title}>Public profile</h1><div role="status" aria-label="Loading public profile" className={account.card}><SkeletonText lines={4} /></div></>;
}

export function PublicEditorLoadError() {
  const router = useRouter();
  return <ErrorState size="page" title="Can’t load your public profile" message="Check your connection and try again." onRetry={() => router.refresh()} />;
}
