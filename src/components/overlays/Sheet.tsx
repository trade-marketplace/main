"use client";
// Bottom sheets (#78): components.css .tm-sheet + .tm-scrim, FRONTEND_SPEC “Sheet” (22px top radius, grab
// handle, focus trap, Esc or a swipe down closes, focus returns). Rises from the bottom (320ms in, 200ms out).
// For phone-first tasks such as the job filter. A <Dialog> becomes one of these on a phone by itself.
//
//   <Sheet open={open} onClose={() => setOpen(false)} title="Filter"
//     footer={<Button width="full" onClick={apply}>Show 24 jobs</Button>}>
//     <ChipGroup … />
//   </Sheet>
import { ModalShell, type ModalProps } from "./ModalShell";

export type SheetProps = ModalProps;

export function Sheet(props: SheetProps) {
  return <ModalShell {...props} layout="sheet" />;
}
