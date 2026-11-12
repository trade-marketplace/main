export const CUSTOMER_WORKER_UPDATE_TYPES = ["job.window_booked", "job.on_my_way", "job.running_late", "job.reschedule_requested"] as const;
export type CustomerWorkerUpdateType = typeof CUSTOMER_WORKER_UPDATE_TYPES[number];
export type CustomerWorkerUpdate = { id: string; type: CustomerWorkerUpdateType; label: string; createdAt: string; lateMinutes: 15 | 30 | 60 | null };
export type CustomerWorkerCard = { avatarUrl: string | null; licensed: boolean; rating: { average: number; count: number } | null; updates: CustomerWorkerUpdate[]; askedForTimes: boolean };
export const CUSTOMER_WORKER_LICENCE_LABELS = { ELECTRICAL: "Licensed electrician", PLUMBING: "Licensed plumber", GAS: "Licensed gasfitter", CONSTRUCTION: "Licensed builder", OTHER: null } as const;
