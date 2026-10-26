// The code shown under the usage example on /dev/components/overlays (OverlayDemos.tsx › UsageExample), so people
// can copy it. Keep the two in step.
export const USAGE_SOURCE = `import { Button } from "@/components/Button";
import { ConfirmDialog, useToast } from "@/components/overlays";

const toast = useToast(); // needs a <ToastProvider> around the page
const [open, setOpen] = useState(false);

const remove = () => {
  setOpen(false);
  setPhotos((n) => n - 1);
  toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => setPhotos((n) => n + 1) } });
};

<Button variant="destructive" width="auto" onClick={() => setOpen(true)}>Remove a photo</Button>
<ConfirmDialog
  open={open}
  tone="destructive"
  title="Remove this photo?"
  confirmLabel="Remove photo"
  cancelLabel="Keep it"
  onCancel={() => setOpen(false)}
  onConfirm={remove}
>
  <p>Tradies price from your photos, so keep the clearest ones.</p>
</ConfirmDialog>`;
