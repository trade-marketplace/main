"use client";
// Drawers (#78): web.css .w-drawer, M12, WEBAPP_SPEC rule 8 “drawers for side tasks, dialogs for decisions”.
// Slides in from the right (480px; the whole width on a phone) so the page stays visible behind: estimate,
// extra work, filters on narrow screens. Header with the title and ×, a body that scrolls, a footer for buttons.
// Focus moves to the title (M12); Esc, the scrim and × close it; focus returns to the trigger.
//
//   <Drawer open={open} onClose={() => setOpen(false)} eyebrow="Sub wiring · TM-1005" title="Your estimate"
//     footer={<Button width="full" onClick={send}>Send estimate</Button>}>
//     <TextField label="Hours on site" … />
//   </Drawer>
import { ModalShell, type ModalProps } from "./ModalShell";

export type DrawerProps = ModalProps;

export function Drawer(props: DrawerProps) {
  return <ModalShell {...props} layout="drawer" />;
}
