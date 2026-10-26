// The code shown under the usage example on /dev/components/buttons (ButtonDemos.tsx › UsageExample), so people
// can copy it. Keep the two in step.
export const USAGE_SOURCE = `import { Button } from "@/components/Button";

<div className="actions">
  <Button variant="secondary" disabled={busy ? "Wait for the cancel to finish" : false} onClick={keep}>
    Keep job
  </Button>
  <Button variant="destructive" loading={busy} onClick={cancel}>
    Cancel job
  </Button>
</div>`;
