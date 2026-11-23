// The code shown under the usage example on /dev/components/buttons (ButtonDemos.tsx › UsageExample), so people
// can copy it. Keep the two in step.
export const USAGE_SOURCE = `"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/Button";

const noSubscribe = () => () => {};

type Props = { busy: boolean; keep: () => void; cancel: () => void };

export function CancelActions({ busy, keep, cancel }: Props) {
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (
    <div className="actions">
      <Button variant="secondary" disabled={busy ? "Wait for the cancel to finish" : !ready} onClick={keep}>
        Keep job
      </Button>
      <Button variant="destructive" disabled={!ready} loading={busy} onClick={cancel}>
        Cancel job
      </Button>
    </div>
  );
}`;
