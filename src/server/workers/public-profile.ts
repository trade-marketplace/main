import "server-only";

import { z } from "zod";
import { Prisma, type LicenceStatus, type PrismaClient, type Trade } from "@/generated/prisma/client";
import { databaseSchema } from "@/server/database-client";
import { shellAvatarUrl } from "@/server/app-shell";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { hasCurrentTradeLicence } from "./verification";

type PublicReview = { rating: number; month: string; comment: string | null; customer: string; job: string };

export type PublicTradieProfile = {
  name: string;
  avatarUrl: string | null;
  trades: Trade[];
  city: string;
  rating: number | null;
  reviewCount: number;
  jobs: number;
  joined: number;
  bio: string | null;
  reviews: PublicReview[];
};

export type PublicProfileCard = Omit<PublicTradieProfile, "reviews" | "reviewCount">;
export type OwnProfilePreview = { profile: PublicProfileCard; publicPath: string | null };

type TradeProof = {
  trade: Trade;
  status: LicenceStatus | null;
  checkedAt: string | null;
  checkedById: string | null;
  expiresOn: string | null;
};

type Row = Omit<PublicTradieProfile, "city" | "avatarUrl" | "trades"> & {
  avatarPath: string | null;
  published: boolean;
  proofs: TradeProof[];
  coverage: { lat: number; lng: number; radiusKm: number } | null;
};

async function readProfile(db: Pick<PrismaClient, "$queryRaw">, id: string, now: Date, ownPreview: boolean) {
  if (!z.uuid().safeParse(id).success) return null;

  // Keep the eligibility check, moderation state, and all aggregates on the same database snapshot.
  const schema = Prisma.raw(`"${databaseSchema(db).replaceAll('"', '""')}"`);
  const [row] = await db.$queryRaw<Row[]>`
    SELECT concat_ws(' ', p.first_name, nullif(left(trim(p.last_name), 1), '') || '.') AS name,
      p.avatar_path AS "avatarPath", wp.bio, (wp.verified_at IS NOT NULL AND wp.paused_at IS NULL) AS published,
      extract(year FROM p.created_at AT TIME ZONE 'Pacific/Auckland')::int AS joined,
      (SELECT count(*)::int FROM ${schema}.jobs WHERE worker_id = p.id AND status = 'COMPLETED') AS jobs,
      (SELECT jsonb_build_object('lat', coverage_centre_lat, 'lng', coverage_centre_lng, 'radiusKm', coverage_radius_km)
         FROM ${schema}.settings WHERE id = 1) AS coverage,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('trade', t.trade, 'status', l.status, 'checkedAt', l.checked_at,
        'checkedById', l.checked_by_id, 'expiresOn', l.expires_on) ORDER BY t.trade)
        FROM ${schema}.worker_trades t LEFT JOIN ${schema}.licences l USING (user_id, trade) WHERE t.user_id = p.id), '[]') AS proofs,
      stats.rating, stats.total AS "reviewCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(detail) - 'created_at' - 'id' ORDER BY created_at DESC, id DESC)
        FROM (SELECT r.id, r.created_at, r.rating, r.comment, c.first_name AS customer, j.title AS job,
                to_char(r.created_at AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM') AS month
              FROM ${schema}.reviews r JOIN ${schema}.profiles c ON c.id = r.reviewer_id JOIN ${schema}.jobs j ON j.id = r.job_id
              WHERE NOT ${ownPreview} AND r.worker_id = p.id AND r.hidden_at IS NULL
              ORDER BY r.created_at DESC, r.id DESC LIMIT 10) detail), '[]') AS reviews
    FROM ${schema}.profiles p JOIN ${schema}.worker_profiles wp ON wp.user_id = p.id
    CROSS JOIN LATERAL (SELECT round(avg(rating), 1)::float8 AS rating, count(*)::int AS total
      FROM ${schema}.reviews WHERE worker_id = p.id AND hidden_at IS NULL) stats
    WHERE p.id = ${id}::uuid AND p.role = 'TRADIE' AND (${ownPreview} OR (wp.verified_at IS NOT NULL AND wp.paused_at IS NULL))
  `;
  if (!row) return null;
  const workerTrades = row.proofs.map(proof => ({
    trade: proof.trade,
    licence: proof.status ? {
      status: proof.status, checkedById: proof.checkedById,
      checkedAt: proof.checkedAt ? new Date(proof.checkedAt) : null,
      expiresOn: proof.expiresOn ? new Date(proof.expiresOn) : null,
    } : null,
  }));
  const coverage = await loadCoverage(async () => row.coverage);
  const card: PublicProfileCard = {
    name: row.name, avatarUrl: await shellAvatarUrl(id, row.avatarPath),
    trades: workerTrades.map(t => t.trade).filter(trade => trade === "OTHER" || hasCurrentTradeLicence({ workerTrades }, trade, now)),
    city: coverage.name, rating: row.rating, jobs: row.jobs,
    joined: row.joined, bio: row.bio,
  };
  return { card, reviewCount: row.reviewCount, reviews: row.reviews, published: row.published };
}

export async function loadPublicProfile(db: Pick<PrismaClient, "$queryRaw">, id: string, now = new Date()): Promise<PublicTradieProfile | null> {
  const row = await readProfile(db, id, now, false);
  return row ? { ...row.card, reviewCount: row.reviewCount, reviews: row.reviews } : null;
}

// The private editor takes its owner exclusively from the authenticated viewer.
export async function loadOwnProfilePreview(db: Pick<PrismaClient, "$queryRaw">, viewer: { userId: string; role: string }): Promise<OwnProfilePreview | null> {
  if (viewer.role !== "TRADIE") return null;
  const row = await readProfile(db, viewer.userId, new Date(), true);
  return row ? { profile: row.card, publicPath: row.published ? `/tradies/${viewer.userId}` : null } : null;
}
