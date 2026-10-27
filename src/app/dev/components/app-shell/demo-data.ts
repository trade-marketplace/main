// The pretend people and counts on /dev/components/app-shell (#84). Every name, email and number is an example.
import type { ShellViewer } from "@/components/app/AppShellView";

export const DEMO_VIEWERS = {
  customer: {
    name: "Customer",
    home: "/",
    viewer: { role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "sarah@email.co.nz" },
  },
  tradie: {
    name: "Tradie",
    home: "/jobs",
    viewer: { role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "jack@wilsonelectrical.co.nz" },
  },
  long: {
    name: "Long name",
    home: "/",
    viewer: {
      role: "CUSTOMER",
      firstName: "Te Rangi-Hēnare",
      lastName: "Fitzgerald-MacPherson Wolfeschlegelsteinhausen",
      email: "te.rangi-henare.fitzgerald-macpherson@a-very-long-company-name.co.nz",
    },
  },
  "first-only": {
    name: "No last name",
    home: "/jobs",
    viewer: { role: "TRADIE", firstName: "Wiremu", lastName: null, email: "wiremu@example.nz" },
  },
} as const satisfies Record<string, { name: string; home: string; viewer: Omit<ShellViewer, "counts"> }>;

export type DemoKey = keyof typeof DEMO_VIEWERS;

export const COUNTS = {
  some: { name: "Some unread", messages: 1, notifications: 2 },
  none: { name: "All read", messages: 0, notifications: 0 },
  many: { name: "Lots unread", messages: 120, notifications: 99 },
} as const;

export type CountsKey = keyof typeof COUNTS;
