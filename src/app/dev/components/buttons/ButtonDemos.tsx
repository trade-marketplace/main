"use client";
// /dev/components/buttons demos that need a click: the loading state, and the usage example (a "Cancel job"
// dialog footer, as in WEBAPP_SPEC "Dialogs"). Nothing is saved; the wait is pretend.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";

import styles from "./buttons.module.css";

const PRETEND_WAIT_MS = 2000;

function usePretendWork() {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return {
    busy,
    start: (done: () => void) => {
      setBusy(true);
      timer.current = setTimeout(() => {
        setBusy(false);
        done();
      }, PRETEND_WAIT_MS);
    },
  };
}

export function LoadingDemo() {
  const work = usePretendWork();
  const [presses, setPresses] = useState(0);
  const [done, setDone] = useState(0);
  return (
    <>
      <Button
        width="auto"
        loading={work.busy}
        onClick={() => {
          setPresses((p) => p + 1);
          work.start(() => setDone((d) => d + 1));
        }}
      >
        Post job
      </Button>
      <p className={styles.note} role="status">
        Pressed {presses} {presses === 1 ? "time" : "times"} · finished {done}
      </p>
    </>
  );
}

export function UsageExample() {
  const work = usePretendWork();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className={styles.example}>
      <h3 className={styles.exampleTitle}>Cancel this job?</h3>
      <p className={styles.para}>It hasn’t been paid for yet, so cancelling is free.</p>
      <div className={styles.exampleActions}>
        <Button variant="secondary" disabled={work.busy ? "Wait for the cancel to finish" : false} onClick={() => setResult("Kept.")}>
          Keep job
        </Button>
        <Button variant="destructive" loading={work.busy} onClick={() => work.start(() => setResult("Cancelled."))}>
          Cancel job
        </Button>
      </div>
      <p className={styles.note} role="status">
        {result}
      </p>
    </div>
  );
}
