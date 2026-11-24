import "server-only";

import { z } from "zod";
import type { Prisma, PrismaClient, TimeOfDay } from "@/generated/prisma/client";
import { SITE_URL } from "@/lib/metadata";
import { TRADE_LABELS } from "@/lib/office-jobs";
import type { Guards } from "@/server/auth/guard";

const calendarFields = {
  id: true, jobNumber: true, title: true, category: true, bookedDate: true, bookedTime: true,
  addressLine1: true, addressLine2: true, suburb: true, city: true, postcode: true, updatedAt: true,
} satisfies Prisma.JobSelect;
type CalendarJob = Prisma.JobGetPayload<{ select: typeof calendarFields }>;
const hours = { MORNING: [8, 12], AFTERNOON: [12, 17], EVENING: [17, 20] } as const;
const aucklandHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Auckland", hour: "numeric", hourCycle: "h23" });
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function timeAt(bookedDate: Date, hour: number) {
  // A Prisma DATE is midnight UTC. In Auckland that is noon or 1 pm on the same day,
  // after either daylight-saving transition and on the same offset as every bookable hour.
  return stamp(new Date(bookedDate.getTime() + (hour - Number(aucklandHour.format(bookedDate))) * 3_600_000));
}

function escapeText(text: string) {
  return text.replaceAll("\\", "\\\\").replace(/\r\n|[\r\n]/g, "\\n").replace(/[,;]/g, "\\$&")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

// RFC 5545 content lines fold at 75 octets, including the continuation space.
function fold(line: string) {
  const parts: string[] = [];
  let part = "", size = 0;
  for (const character of line) {
    const octets = Buffer.byteLength(character);
    if (size + octets > 75) {
      parts.push(part);
      part = " ";
      size = 1;
    }
    part += character;
    size += octets;
  }
  return [...parts, part].join("\r\n");
}

export function calendarEvent(job: CalendarJob, date: Date, period: TimeOfDay, sequence: number) {
  const [start, end] = hours[period];
  const location = [job.addressLine1, job.addressLine2, job.suburb, job.city, job.postcode].filter(Boolean).join(", ");
  const url = new URL(`/jobs/${job.id}`, SITE_URL).href;
  const description = `TM-${job.jobNumber} · ${TRADE_LABELS[job.category]}\n${url}`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trade Marketplace//Booked jobs//EN", "BEGIN:VEVENT",
    `UID:job-${job.id}@trademarketplace.nz`, `SEQUENCE:${sequence}`, `DTSTAMP:${stamp(job.updatedAt)}`,
    `DTSTART:${timeAt(date, start)}`, `DTEND:${timeAt(date, end)}`,
    `SUMMARY:${escapeText(`Trade Marketplace: ${job.title}`)}`, `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(description)}`, `URL:${url}`, "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

const privateHeaders = { "Cache-Control": "private, no-store" };
const missing = () => new Response(null, { status: 404, headers: privateHeaders });

export function createCalendarRoute(authorize: Guards["authorize"], db: () => PrismaClient) {
  return async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authorize(["CUSTOMER", "TRADIE"]);
    if (!auth.ok) return missing();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return missing();
    const owner = auth.viewer.role === "CUSTOMER" ? { customerId: auth.viewer.userId } : { workerId: auth.viewer.userId };
    // Read the time and its immutable booking-audit count from the same committed snapshot.
    return db().$transaction(async tx => {
      const job = await tx.job.findFirst({ where: { id, ...owner }, select: calendarFields });
      if (!job?.bookedDate || !job.bookedTime) return missing();
      const sequence = await tx.auditLog.count({ where: { recordType: "jobs", recordId: id, action: "job.window_booked" } });
      return new Response(calendarEvent(job, job.bookedDate, job.bookedTime, sequence), { headers: {
        ...privateHeaders, "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="TM-${job.jobNumber}.ics"`,
      } });
    }, { isolationLevel: "RepeatableRead" });
  };
}
