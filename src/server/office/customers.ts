import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { CUSTOMER_PAGE_SIZE, customerMobileSearch, type CustomersPage, type CustomersQuery } from "@/lib/office/customers";
import { databaseSchema } from "@/server/database-client";
import type { JobViewer } from "@/server/views";
type Row = { id: string; firstName: string; lastName: string | null; email: string; phone: string | null; suburb: string | null; jobs: number; lastJobAt: Date | null; createdAt: Date };
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
export async function listCustomers(db: PrismaClient, viewer: JobViewer, query: CustomersQuery): Promise<CustomersPage | null> {
  if (viewer.role !== "ADMIN" || (await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role !== "ADMIN") return null;
  const schema = `"${databaseSchema(db).replaceAll('"', '""')}"`, profiles = Prisma.raw(`${schema}.profiles`), jobs = Prisma.raw(`${schema}.jobs`), addresses = Prisma.raw(`${schema}.addresses`);
  const like = `%${escapeLike(query.q)}%`, mobile = customerMobileSearch(query.q);
  const search = query.q ? Prisma.sql`AND (concat_ws(' ', p.first_name, p.last_name) ILIKE ${like} OR p.email ILIKE ${like} OR p.phone ILIKE ${like} OR (${mobile}::text IS NOT NULL AND regexp_replace(p.phone, '[^0-9]', '', 'g') LIKE ${mobile ? `%${mobile}%` : null}))` : Prisma.empty;
  const [{ total }] = await db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS total FROM ${profiles} p WHERE p.role = 'CUSTOMER' ${search}`);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)));
  const keys: Record<string, string> = { name: "lower(p.first_name), lower(coalesce(p.last_name, ''))", jobs: "coalesce(j.jobs, 0)", lastJob: "j.last_job_at", joined: "p.created_at" };
  const key = query.sort?.key && Object.hasOwn(keys, query.sort.key) ? query.sort.key : "joined", direction = query.sort?.direction === "asc" ? "ASC" : "DESC";
  const order = Prisma.raw(key === "name" ? `lower(p.first_name) ${direction}, lower(coalesce(p.last_name, '')) ${direction}, p.id ASC` : `${keys[key]} ${direction} NULLS LAST, p.id ASC`);
  // One page query aggregates jobs before joining; the default-address uniqueness rule prevents duplicate rows.
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT p.id, p.first_name AS "firstName", p.last_name AS "lastName", p.email, p.phone, p.created_at AS "createdAt", a.suburb, coalesce(j.jobs, 0)::int AS jobs, j.last_job_at AS "lastJobAt"
    FROM ${profiles} p LEFT JOIN (SELECT customer_id, COUNT(*)::int AS jobs, MAX(created_at) AS last_job_at FROM ${jobs} GROUP BY customer_id) j ON j.customer_id = p.id
    LEFT JOIN ${addresses} a ON a.user_id = p.id AND a.is_default = true
    WHERE p.role = 'CUSTOMER' ${search} ORDER BY ${order} LIMIT ${CUSTOMER_PAGE_SIZE} OFFSET ${(page - 1) * CUSTOMER_PAGE_SIZE}`);
  return { query: { ...query, page }, total, rows: rows.map(row => ({ id: row.id, name: [row.firstName, row.lastName].filter(Boolean).join(" "), email: row.email, mobile: row.phone, suburb: row.suburb, jobs: row.jobs, lastJobAt: row.lastJobAt?.toISOString() ?? null, joinedAt: row.createdAt.toISOString() })) };
}
