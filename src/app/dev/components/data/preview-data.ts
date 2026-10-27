// Example rows for /dev/components/data (#80), shared by the page (a server component) and its client demos
// (DataDemos.tsx). Every name, price and suburb is an example (AGENTS.md: real values come from the server).
import type { FilterDefinition, SavedFilter } from "@/components/data";
import type { JobStatus } from "@/lib/job-status";

/** What `?open=` can open, for screenshots. */
export const OPEN_IDS = ["status-filter", "saved-filters", "row-menu"] as const;
export type OpenId = (typeof OPEN_IDS)[number];

export type ExampleJob = {
  id: string;
  number: string;
  title: string;
  trade: "Electrical" | "Plumbing" | "Construction" | "Other";
  status: JobStatus;
  region: "invercargill" | "gore" | "bluff";
  suburb: string;
  customer: string;
  tradie: string | null;
  /** null until it's priced. */
  priceCents: number | null;
  /** Minutes since it last changed. */
  updatedMinutes: number;
  image: string;
};

/** The six rows of the office "All jobs" mockup (w-o-jobs), first, then more made from them. */
const SEED: Omit<ExampleJob, "id" | "number">[] = [
  { title: "Sub wiring", trade: "Electrical", status: "ASSIGNED", region: "invercargill", suburb: "Windsor", customer: "Sarah T", tradie: "Jack W", priceCents: 37200, updatedMinutes: 46, image: "wires" },
  { title: "Switchboard upgrade", trade: "Electrical", status: "REVIEW", region: "invercargill", suburb: "Richmond", customer: "Tom H", tradie: null, priceCents: null, updatedMinutes: 26 * 60, image: "board" },
  { title: "Kitchen tap leaking", trade: "Plumbing", status: "REVIEW", region: "invercargill", suburb: "Windsor", customer: "Sarah T", tradie: null, priceCents: null, updatedMinutes: 5 * 60, image: "sink" },
  { title: "Control panel", trade: "Electrical", status: "SUBMITTED", region: "invercargill", suburb: "Georgetown", customer: "Ana P", tradie: "Jack W", priceCents: 56000, updatedMinutes: 3 * 24 * 60, image: "modules" },
  { title: "Fix fence palings", trade: "Construction", status: "COMPLETED", region: "invercargill", suburb: "Glengarry", customer: "Sarah T", tradie: "Mere R", priceCents: 54000, updatedMinutes: 3 * 24 * 60 + 120, image: "house" },
  { title: "Pump wiring", trade: "Electrical", status: "CANCEL_REVIEW", region: "gore", suburb: "Gore", customer: "Rob K", tradie: "Ben L", priceCents: 26450, updatedMinutes: 4 * 24 * 60, image: "tanks" },
];

const MORE_TITLES: [string, ExampleJob["trade"], string][] = [
  ["Hot water cylinder", "Plumbing", "pipes"],
  ["New power point", "Electrical", "outlet"],
  ["Light switch", "Electrical", "switch"],
  ["Move a couch", "Other", "furniture"],
  ["Outdoor lights", "Electrical", "house"],
  ["Blocked drain", "Plumbing", "pipes"],
  ["Heat pump wiring", "Electrical", "board"],
  ["Shower mixer", "Plumbing", "sink"],
];
const SUBURBS: [string, ExampleJob["region"]][] = [
  ["Waikiwi", "invercargill"],
  ["Otatara", "invercargill"],
  ["Rosedale", "invercargill"],
  ["Gladstone", "invercargill"],
  ["Bluff", "bluff"],
  ["Gore", "gore"],
];
const PEOPLE = ["Aroha K", "Tom H", "Sarah T", "Ana P", "Rob K", "Mere R", "Hemi W", "Lucy B"];
const TRADIES = ["Jack W", "Mere R", "Ben L", null];
const STATUSES: JobStatus[] = ["REVIEW", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"];

/** 128 jobs, like the mockup's "of 128": enough for six pages of 25. Always the same, so screenshots don't move. */
export const EXAMPLE_JOBS: ExampleJob[] = Array.from({ length: 128 }, (_, index) => {
  const number = `TM-${1005 - index}`;
  if (index < SEED.length) return { ...SEED[index], id: `job-${index + 1}`, number };
  const [title, trade, image] = MORE_TITLES[index % MORE_TITLES.length];
  const [suburb, region] = SUBURBS[(index * 5) % SUBURBS.length];
  const status = STATUSES[(index * 3) % STATUSES.length];
  const assigned = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
  const priced = status !== "REVIEW";
  return {
    id: `job-${index + 1}`,
    number,
    title,
    trade,
    status,
    region,
    suburb,
    customer: PEOPLE[(index * 7) % PEOPLE.length],
    tradie: assigned ? (TRADIES[index % 3] ?? "Jack W") : null,
    priceCents: priced ? 6400 + ((index * 3733) % 52000) : null,
    updatedMinutes: 30 + index * 211,
    image,
  };
});

/** Names and words of any length must truncate or wrap, never spill (the “What if…” cases). */
export const LONG_NAME = "Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services";
export const LONG_WORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
export const LONG_JOBS: ExampleJob[] = [
  {
    ...SEED[0],
    id: "long-1",
    number: "TM-2001",
    title: "Replace the whole switchboard, move the meter box to the garage wall and add a separate circuit for the heat pump",
    customer: LONG_NAME,
    suburb: LONG_WORD,
  },
  { ...SEED[2], id: "long-2", number: "TM-2002", title: LONG_WORD, customer: "Aroha King-Tūhoe", tradie: LONG_NAME },
];

export const JOB_FILTERS: FilterDefinition[] = [
  {
    key: "status",
    label: "Status",
    defaultValue: "all",
    options: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "price", label: "To price" },
      { value: "signoff", label: "Sign-off" },
      { value: "done", label: "Done" },
      { value: "cancel", label: "Cancellations" },
    ],
  },
  {
    key: "trade",
    label: "Trade",
    defaultValue: "all",
    options: [
      { value: "all", label: "All" },
      { value: "Electrical", label: "Electrical" },
      { value: "Plumbing", label: "Plumbing" },
      { value: "Construction", label: "Construction" },
      { value: "Other", label: "Other" },
    ],
  },
  {
    key: "region",
    label: "Region",
    defaultValue: "all",
    options: [
      { value: "all", label: "All" },
      { value: "invercargill", label: "Invercargill" },
      { value: "gore", label: "Gore" },
      { value: "bluff", label: "Bluff" },
    ],
  },
  {
    key: "date",
    label: "Date",
    defaultValue: "30d",
    options: [
      { value: "7d", label: "Last 7 days" },
      { value: "30d", label: "Last 30 days" },
      { value: "90d", label: "Last 90 days" },
      { value: "all", label: "Any time" },
    ],
  },
];

/** Which statuses each Status choice means. */
export const STATUS_GROUPS: Record<string, readonly JobStatus[]> = {
  active: ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"],
  price: ["REVIEW", "QUOTE_BOUNTY"],
  signoff: ["SUBMITTED"],
  done: ["COMPLETED"],
  cancel: ["CANCEL_REVIEW", "CANCELLED"],
};

export const DATE_LIMIT_MINUTES: Record<string, number> = {
  "7d": 7 * 24 * 60,
  "30d": 30 * 24 * 60,
  "90d": 90 * 24 * 60,
  all: Number.POSITIVE_INFINITY,
};

export const EXAMPLE_SAVED: SavedFilter[] = [
  { id: "saved-1", name: "Overdue to price", values: { status: "price", trade: "all", region: "all", date: "30d" } },
  { id: "saved-2", name: "Electrical in Invercargill", values: { status: "active", trade: "Electrical", region: "invercargill", date: "30d" } },
];

/** The office queue tabs (w-o-queues). */
export const QUEUE_TABS = [
  { value: "price", label: "To price", count: 4 },
  { value: "extra", label: "Extra work", count: 2 },
  { value: "cancel", label: "Cancellations", count: 1 },
  { value: "signoff", label: "Sign-off", count: 3 },
  { value: "unclaimed", label: "Unclaimed", count: 1 },
] as const;

/** "$372.00", or "—" before it's priced. */
export function money(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

/** "46m ago", "26h ago", "3 days ago": how long since it changed (the mockup's Updated column). */
export function ago(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (24 * 60))} days ago`;
}
