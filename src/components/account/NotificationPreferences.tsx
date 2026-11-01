"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data/DataTable";
import dataStyles from "@/components/data/data.module.css";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState, InlineError, LiveMessage, OfflineBanner, useOnlineStatus } from "@/components/feedback";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { createPreferenceEditor } from "@/lib/notification-preference-editor";
import { PREFERENCE_CHANNELS, type PreferenceLoadResult, type PreferenceSnapshot, type PreferenceSource } from "@/lib/notification-preferences";
import { loadPreferencesAction, savePreferenceAction } from "@/server/notifications/preference-actions";

import styles from "./account.module.css";

const liveSource: PreferenceSource = { load: loadPreferencesAction, save: savePreferenceAction };
export type PreferencesPreview = "loading" | "saving" | "offline" | "saved" | "save-error" | "expired";

export function NotificationPreferences({ initial, source = liveSource, preview }: { initial: PreferenceLoadResult; source?: PreferenceSource; preview?: PreferencesPreview }) {
  const [loaded, setLoaded] = useState(initial);
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    setLoading(true);
    try { setLoaded(await source.load()); }
    catch { setLoaded({ ok: false, error: "unavailable" }); }
    finally { setLoading(false); }
  };
  return <ToastProvider>
    <h1 className={styles.title}>Notifications</h1>
    {loading || preview === "loading" ? <PreferencesLoading /> : loaded.ok ? <PreferenceMatrix initial={loaded.snapshot} source={source} preview={preview} /> :
      <ErrorState title="Couldn’t load notifications." onRetry={reload} />}
  </ToastProvider>;
}

export function PreferencesLoading() {
  return <DataTable caption="Notification preferences" columns={[{ key: "event", header: "When…", cell: () => null }, { key: "email", header: "Email", cell: () => null }, { key: "push", header: "Push", cell: () => null }]} rows={[]} rowId={() => ""} rowLabel={() => ""} loading skeletonRows={6} />;
}

function PreferenceMatrix({ initial, source, preview }: { initial: PreferenceSnapshot; source: PreferenceSource; preview?: PreferencesPreview }) {
  const toast = useToast();
  const router = useRouter();
  const toastId = useRef<number | null>(null);
  const [editor] = useState(() => createPreferenceEditor(initial, source.save, () => {}));
  useEffect(() => editor.subscribeSaved((change, before) => {
    if (!navigator.onLine) return;
    let id = 0;
    id = toast.show({ message: "Saved.", action: { label: "Undo", onAction: () => {
      if (toastId.current !== id) return;
      toastId.current = null;
      editor.change({ ...change, enabled: before });
    } } });
    toastId.current = id;
  }), [editor, toast]);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const browserOnline = useOnlineStatus();
  const online = browserOnline && preview !== "offline";
  useEffect(() => { editor.activate(); return editor.deactivate; }, [editor]);
  useEffect(() => {
    editor.setOnline(online);
    if (!online && toastId.current !== null) { toast.dismiss(toastId.current); toastId.current = null; }
  }, [editor, online, toast]);
  const previewStarted = useRef(false);
  useEffect(() => {
    if (previewStarted.current || !["saved", "saving", "save-error", "expired"].includes(preview ?? "")) return;
    previewStarted.current = true;
    const row = initial.rows.find(row => !row.channels.EMAIL.locked);
    if (row) editor.change({ event: row.event, channel: "EMAIL", enabled: !row.channels.EMAIL.enabled });
  }, [editor, initial, preview]);
  const failure = state.failure?.error;
  const expired = failure === "session-expired" || failure === "forbidden";
  return <>
    <OfflineBanner online={online} sticky={false} />
    {failure && (expired ? <InlineError message="Log in to save." onRetry={() => router.push("/login?next=%2Fprofile%2Fnotifications")} retryLabel="Log in" /> :
      <InlineError message="Couldn’t save." onRetry={online ? editor.retry : undefined} />)}
    <DataTable caption="Notification preferences" rows={state.rows} rowId={row => row.event} rowLabel={row => row.label}
      empty={<EmptyState title="No notifications." icon="notifications_off" />}
      columns={[
        { key: "event", header: "When…", primary: true, cell: row => <b>{row.label}</b> },
        ...PREFERENCE_CHANNELS.map(channel => ({ key: channel, header: channel === "EMAIL" ? "Email" : "Push", width: "112px", cell: (row: typeof state.rows[number]) => {
          const cell = row.channels[channel];
          const id = `preference-${row.event}-${channel}`;
          return <>
            <span className={dataStyles.checkbox}>
            <input type="checkbox" className={dataStyles.checkboxInput} aria-label={`${channel === "EMAIL" ? "Email" : "Push"}: ${row.label}`} checked={cell.enabled}
              disabled={cell.locked || !online || expired} aria-describedby={cell.locked ? `${id}-reason` : !online ? "preferences-offline" : undefined}
              onChange={event => {
                if (toastId.current !== null) { toast.dismiss(toastId.current); toastId.current = null; }
                editor.change({ event: row.event, channel, enabled: event.currentTarget.checked });
              }} />
            <span className={dataStyles.checkboxBox} aria-hidden="true"><Icon name="check" size="sm" decorative className={cell.locked && cell.enabled ? dataStyles.muted : undefined} /></span>
            </span>
            {cell.locked && <span id={`${id}-reason`} className={styles.srOnly}>{cell.reason}</span>}
          </>;
        } })),
      ]} />
    <span id="preferences-offline" className={styles.srOnly}>Reconnect before changing notifications.</span>
    <LiveMessage message={state.saving || preview === "saving" ? "Saving…" : null} />
  </>;
}
