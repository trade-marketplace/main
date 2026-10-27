// Example content for /dev/components/cards (#76), from the mockups (screens.html tr-home, tr-all, cus-home,
// cus-myjobs, tr-mywork, tr-earnings, sh-tradie-public; pages.html w-c-home, w-t-board, w-o-queues,
// w-t-earnings, w-profile-public). Every name, price, distance and suburb is an example.
import { formatKm } from "@/lib/geo/distance";
import { tileMeta } from "@/lib/cards";

const photo = (name: string) => `/images/examples/${name}.jpg`;

/** Job tiles on the tradie's board: what they earn, needs an estimate, already estimated, a bounty. */
export const BOARD_TILES = [
  { id: "t1", title: "Sub wiring", meta: tileMeta(formatKm(3.6), "Windsor"), photo: photo("wires"), tag: { kind: "earn", text: "Earn $259" } },
  { id: "t2", title: "Control panel", meta: tileMeta(formatKm(4), "Georgetown"), photo: photo("modules"), tag: { kind: "earn", text: "Earn $410" }, saved: true },
  { id: "t3", title: "Power point", meta: tileMeta(formatKm(5), "Glengarry"), photo: photo("outlet"), tag: { kind: "earn", text: "Earn $96" } },
  { id: "t4", title: "Switchboard", meta: tileMeta(formatKm(7), "Richmond"), photo: photo("board"), tag: { kind: "estimate" } },
  { id: "t5", title: "Light switch", meta: tileMeta(formatKm(2), "Gladstone"), photo: photo("switch"), tag: { kind: "estimated" } },
  { id: "t6", title: "Outdoor lights", meta: tileMeta(formatKm(9), "Otatara"), photo: photo("house"), tag: { kind: "earn", text: "Earn $188" } },
  { id: "t7", title: "Hot water cylinder", meta: tileMeta(formatKm(6), "Waikiwi"), photo: photo("pipes"), tag: { kind: "bounty", text: "Bounty $30 · 17h" } },
  { id: "t8", title: "Move a couch + boxes", meta: tileMeta(formatKm(3), "Rosedale"), photo: photo("furniture"), tag: { kind: "earn", text: "Earn $120" } },
] as const;

/** Names and words of any length must truncate or wrap, never spill (the “What if…” cases). */
export const LONG_NAME = "Wiremu Te Rangi-Hēnare";
export const LONG_WORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
export const LONG_TITLE = "Replace the whole switchboard, move the meter box to the garage wall and add a heat pump circuit";
