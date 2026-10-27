import "server-only";

import { createHash } from "node:crypto";

import type { Notification, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db";

import {
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
  isNotificationEvent,
} from "./events";

export type OptionalChannel = Exclude<NotificationChannel, "IN_APP">;
export type NotificationDb = Pick<Prisma.TransactionClient, "notification" | "notificationPreference">;

/** Put private data on its recipient, never on a shared job payload (e.g. a worker's own earnings). */
export type NotificationRecipient = string | { readonly userId: string; readonly payload?: Prisma.InputJsonObject };
export type NotificationData = {
  /** The durable source event's id (webhook id, command id, etc.). Reuse it on every retry. */
  readonly eventId: string;
  /** Only fields every recipient is allowed to see (normally jobId/jobNumber). */
  readonly payload?: Prisma.InputJsonObject;
};

export type ChannelAdapter = {
  /** Future providers must honour this stable key, including a retry after a response was lost. */
  send: (delivery: { notification: Notification; eventId: string; idempotencyKey: string }) => Promise<void>;
};

export type DeliveryFailure = {
  event: NotificationEvent;
  eventId: string;
  userId: string;
  channel: NotificationChannel;
  attempts: number;
};

export type NotifyResult = { notifications: Notification[]; failures: DeliveryFailure[] };

export type NotifyOptions = {
  /** No providers are registered at launch. */
  channels?: Partial<Record<OptionalChannel, ChannelAdapter>>;
  /** Configure future defaults centrally, without changing feature calls. IN_APP is always included. */
  eventChannels?: Partial<Record<NotificationEvent, readonly NotificationChannel[]>>;
  maxAttempts?: number;
  /** Inject for tests. Backoff is bounded to 100ms then 200ms at the default three attempts. */
  wait?: (ms: number) => Promise<void>;
  /** Deliberately excludes exception messages, payloads, phone numbers and provider responses. */
  logFailure?: (failure: DeliveryFailure) => void;
};

export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationInputError";
  }
}

export class NotificationDeliveryError extends Error {
  constructor(readonly result: NotifyResult) {
    super("An in-app notification could not be saved. Retry with the same event id.");
    this.name = "NotificationDeliveryError";
  }
}

/** UUIDv8 from the event id and recipient: the database primary key makes concurrent retries safe. */
export function notificationId(eventId: string, userId: string): string {
  const bytes = createHash("sha256").update(JSON.stringify([eventId, userId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Binds the single notify(event, recipients, data) API to a client or an existing transaction. */
export function createNotify(db: NotificationDb, options: NotifyOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new NotificationInputError("maxAttempts must be an integer from 1 to 5.");
  }
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const logFailure = options.logFailure ?? ((failure: DeliveryFailure) => console.error("Notification delivery failed", failure));

  return async function notify(
    event: NotificationEvent,
    recipients: readonly NotificationRecipient[],
    data: NotificationData,
  ): Promise<NotifyResult> {
    if (!isNotificationEvent(event)) throw new NotificationInputError("Unknown notification event.");
    const eventId = data.eventId?.trim();
    if (!eventId) throw new NotificationInputError("A durable event id is required.");
    const unique = new Map<string, Prisma.InputJsonObject>();
    for (const recipient of recipients) {
      const userId = (typeof recipient === "string" ? recipient : recipient.userId).trim();
      if (!userId) throw new NotificationInputError("A recipient user id is required.");
      const payload = { ...data.payload, ...(typeof recipient === "string" ? {} : recipient.payload) };
      if (unique.has(userId) && JSON.stringify(unique.get(userId)) !== JSON.stringify(payload)) {
        throw new NotificationInputError("A recipient was repeated with different payloads.");
      }
      unique.set(userId, payload);
    }
    const result: NotifyResult = { notifications: [], failures: [] };
    if (!unique.size) return result;

    const channels = new Set<NotificationChannel>(options.eventChannels?.[event] ?? NOTIFICATION_EVENTS[event].channels);
    channels.add("IN_APP");

    // No optional provider means no preference query (and no dependency on the new table) on the launch path.
    const optional = (["EMAIL", "PUSH"] as const).filter((channel) => channels.has(channel) && options.channels?.[channel]);

    async function attempt<T>(userId: string, channel: NotificationChannel, send: () => Promise<T>): Promise<T | undefined> {
      for (let number = 1; number <= maxAttempts; number++) {
        try {
          return await send();
        } catch {
          if (number < maxAttempts) {
            await wait(Math.min(100 * 2 ** (number - 1), 1000));
          } else {
            const failure = { event, eventId, userId, channel, attempts: number };
            result.failures.push(failure);
            logFailure(failure);
          }
        }
      }
    }

    for (const [userId, payload] of unique) {
      const id = notificationId(eventId, userId);
      const notification = await attempt(userId, "IN_APP", () => db.notification.upsert({
        where: { id },
        create: { id, userId, type: event, payload },
        update: {}, // A replay never clears readAt, changes the payload, or reorders the inbox.
      }));
      if (!notification) continue;
      if (notification.type !== event) throw new NotificationInputError("The event id was reused for a different event.");
      result.notifications.push(notification);

      for (const channel of optional) {
        if (notification.channelsSent.includes(channel)) continue;
        const adapter = options.channels![channel]!;
        await attempt(userId, channel, async () => {
          // A preference outage must never lose the in-app row or accidentally send an opted-out channel.
          const preference = await db.notificationPreference.findUnique({ where: { userId_event_channel: { userId, event, channel } } });
          if (preference?.enabled === false) return true;
          await adapter.send({ notification, eventId, idempotencyKey: `${id}:${channel}` });
          await db.notification.update({ where: { id }, data: { channelsSent: { push: channel } } });
          return true;
        });
      }
    }

    if (result.failures.some((failure) => failure.channel === "IN_APP")) throw new NotificationDeliveryError(result);
    return result;
  };
}

/** The launch entry point. getDb is lazy: importing this module or building never opens a connection. */
export async function notify(event: NotificationEvent, recipients: readonly NotificationRecipient[], data: NotificationData) {
  return createNotify(getDb())(event, recipients, data);
}
