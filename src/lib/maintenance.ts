import { z } from "zod";

const DAY = 24 * 60 * 60 * 1000;
const ZONE = "Pacific/Auckland";
const timestamp = z.iso.datetime({ offset: true });
const dateFormat = new Intl.DateTimeFormat("en-NZ", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" });
const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const zoneName = new Intl.DateTimeFormat("en-NZ", { timeZone: ZONE, timeZoneName: "short" });

export type MaintenanceWindow = { warnAt: number; from: number; until: number; label: string; endTime: string };

function clock(time: number) {
  const instant = new Date(time);
  const seconds = instant.getUTCSeconds() || instant.getUTCMilliseconds();
  const format = new Intl.DateTimeFormat("en-NZ", {
    timeZone: ZONE, hour12: true, hour: "numeric",
    ...(instant.getUTCMinutes() || seconds ? { minute: "2-digit" } : {}),
    ...(seconds ? { second: "2-digit" } : {}),
    ...(instant.getUTCMilliseconds() ? { fractionalSecondDigits: 3 } : {}),
  });
  return format.format(time).replace(/\s/g, "").toLowerCase();
}

export function maintenanceWindow(start: string | undefined, end: string | undefined): MaintenanceWindow | null {
  if (!start || !end || !timestamp.safeParse(start).success || !timestamp.safeParse(end).success) return null;
  const from = Date.parse(start);
  const until = Date.parse(end);
  if (!(from < until)) return null;
  const day = (ms: number) => dateFormat.format(ms).replace(",", "");
  const zone = (ms: number) => zoneName.formatToParts(ms).find(part => part.type === "timeZoneName")?.value;
  const clocksChange = zone(from) !== zone(until);
  const time = (ms: number) => clock(ms) + (clocksChange ? " " + zone(ms) : "");
  const sameDay = calendar.format(from) === calendar.format(until);
  // Ordinary overnight windows follow the mockup. For longer windows, name the end date too.
  const showEndDate = !sameDay && (until - from >= DAY || calendar.format(from + DAY) !== calendar.format(until));
  const endTime = time(until);
  const label = day(from) + ", " + time(from) + "–" + (showEndDate ? day(until) + ", " : "") + endTime;
  return { warnAt: from - DAY, from, until, endTime, label };
}

export function maintenancePhase(window: MaintenanceWindow | null, now: number) {
  if (!window || now < window.warnAt || now >= window.until) return "off";
  return now < window.from ? "banner" : "page";
}

const preservedRoutes = new Set([
  "/api/stripe/webhook", "/api/scheduler/run", "/robots.txt", "/sitemap.xml",
  "/firebase-messaging-sw.js", "/firebase-messaging-worker.js", "/manifest.webmanifest",
  "/favicon.ico", "/icon.png", "/icon.svg", "/apple-icon.png",
  "/opengraph-image", "/twitter-image", "/for-tradies/opengraph-image", "/for-tradies/twitter-image",
]);

export function maintenanceException(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  return preservedRoutes.has(path) || ["/_next/", "/fonts/", "/images/", "/icons/"].some(prefix => path.startsWith(prefix));
}

export function configuredMaintenance() {
  return maintenanceWindow(process.env.MAINTENANCE_FROM, process.env.MAINTENANCE_UNTIL);
}
