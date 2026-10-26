// Writes the demo data from ./data.mjs (#88). Safe to run again: people, places and licences are upserted by fixed
// ids, and each demo job is deleted and posted again (keeping its TM number), so a second run leaves the same rows.
// Only the demo rows are touched; anything else in the database is left alone.

import { ADDRESSES, examplePricing, JOBS, PEOPLE, photoPath } from "./data.mjs";

/**
 * @typedef {import("./data.mjs").PersonKey} PersonKey
 * @typedef {{ query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> }} Db
 * @typedef {{ id: string; email: string; role: string; firstName: string; lastName: string }} DemoUser
 * @typedef {{ ensureUser(user: DemoUser): Promise<string> }} AuthUsers
 */

/**
 * Plain Postgres (local, CI): insert into the migration's stand-in `auth.users`. Nobody can log in with these:
 * there's no Supabase Auth to log in against. Refuses a real Supabase `auth.users`, where rows without a
 * password would be accounts nobody can use.
 * @param {Db} db
 * @returns {AuthUsers}
 */
export function plainAuthUsers(db) {
  let checked = false;
  return {
    async ensureUser(user) {
      if (!checked) {
        const { rows } = await db.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password'`,
        );
        if (rows.length > 0) {
          throw new Error(
            "This database has Supabase Auth, so demo users must be made through it: set NEXT_PUBLIC_SUPABASE_URL " +
              "and SUPABASE_SECRET_KEY for this project (docs/TESTING.md, Seed data).",
          );
        }
        checked = true;
      }
      const existing = await db.query("SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1", [user.email]);
      if (existing.rows.length > 0) return existing.rows[0].id;
      await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET email = $2", [
        user.id,
        user.email,
      ]);
      return user.id;
    },
  };
}

/**
 * @typedef {{ id: string; email?: string }} AdminUser
 * @typedef {{ message: string } | null} AdminError
 * @typedef {{
 *   listUsers(params: { page: number; perPage: number }): Promise<{ data: { users: AdminUser[] }; error: AdminError }>;
 *   createUser(attributes: Record<string, unknown>): Promise<{ data: { user: AdminUser | null }; error: AdminError }>;
 *   updateUserById(id: string, attributes: Record<string, unknown>): Promise<{ data: { user: AdminUser | null }; error: AdminError }>;
 * }} AdminApi
 */

/**
 * A Supabase project (preview/staging, or `supabase start`): users are made through the Auth admin API with the
 * server-only secret key, so SEED_DEMO_PASSWORD really logs in. An existing demo user keeps their id and gets the
 * password and confirmed email again.
 * @param {AdminApi} admin `supabase.auth.admin` from a client made with the secret key
 * @param {string} password
 * @returns {AuthUsers}
 */
export function supabaseAuthUsers(admin, password) {
  /** @type {Map<string, string> | undefined} */
  let byEmail;
  return {
    async ensureUser(user) {
      byEmail ??= await listAllUsers(admin);
      const attributes = {
        password,
        email_confirm: true,
        user_metadata: { first_name: user.firstName, last_name: user.lastName, role: user.role },
      };
      const existingId = byEmail.get(user.email);
      if (existingId) {
        const { error } = await admin.updateUserById(existingId, attributes);
        if (error) throw new Error(`Couldn't update demo user ${user.email}: ${error.message}`);
        return existingId;
      }
      const { data, error } = await admin.createUser({ id: user.id, email: user.email, ...attributes });
      if (error || !data.user) throw new Error(`Couldn't create demo user ${user.email}: ${error?.message}`);
      byEmail.set(user.email, data.user.id);
      return data.user.id;
    },
  };
}

/** @param {AdminApi} admin */
async function listAllUsers(admin) {
  /** @type {Map<string, string>} */
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Couldn't list Supabase Auth users: ${error.message}`);
    for (const user of data.users) if (user.email) byEmail.set(user.email.toLowerCase(), user.id);
    if (data.users.length < 1000) return byEmail;
  }
}

const DAY_MS = 86_400_000;

/**
 * Writes every demo row. Auth users first (they may live outside the database), then everything else in one
 * transaction, so a failure part-way leaves the database as it was.
 * @param {{ db: Db; auth: AuthUsers; now?: Date }} options
 * @returns {Promise<{ people: Record<PersonKey, string>; jobs: { jobNumber: number; status: string; title: string }[] }>}
 */
export async function seedDemoData({ db, auth, now = new Date() }) {
  const daysAgo = (/** @type {number} */ days) => new Date(now.getTime() - days * DAY_MS);
  const dateIn = (/** @type {number} */ days) => new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);

  /** @type {Record<PersonKey, string>} */
  const ids = /** @type {any} */ ({});
  for (const [key, person] of Object.entries(PEOPLE)) {
    ids[/** @type {PersonKey} */ (key)] = await auth.ensureUser(person);
  }

  await db.query("BEGIN");
  try {
    // Every profile first: worker details name the office user who checked them.
    for (const [key, person] of Object.entries(PEOPLE)) {
      await upsertProfile(db, ids[/** @type {PersonKey} */ (key)], person, daysAgo(30));
    }
    for (const [key, person] of Object.entries(PEOPLE)) {
      await upsertWorker(db, ids[/** @type {PersonKey} */ (key)], person, ids.office, daysAgo(30));
    }
    await upsertAddresses(db, ids.customer);

    // Delete and post the demo jobs again, keeping each one's TM number.
    const jobIds = JOBS.map((job) => job.id);
    const { rows: previous } = await db.query("SELECT id, job_number FROM jobs WHERE id = ANY($1::uuid[])", [jobIds]);
    const jobNumbers = new Map(previous.map((row) => [row.id, row.job_number]));
    await db.query("DELETE FROM jobs WHERE id = ANY($1::uuid[])", [jobIds]);

    const jobs = [];
    for (const job of JOBS) {
      jobs.push(await postJob(db, job, ids, jobNumbers.get(job.id), { daysAgo, dateIn }));
    }
    await db.query("SELECT set_config('app.actor_id', '', true)");
    await db.query("COMMIT");
    return { people: ids, jobs };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/**
 * @param {Db} db
 * @param {string} id
 * @param {(typeof PEOPLE)[PersonKey]} person
 * @param {Date} since
 */
async function upsertProfile(db, id, person, since) {
  await db.query(
    `INSERT INTO profiles (id, email, email_verified_at, role, first_name, last_name, phone, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $3)
     ON CONFLICT (id) DO UPDATE SET email = $2, email_verified_at = coalesce(profiles.email_verified_at, $3),
       role = $4, first_name = $5, last_name = $6, phone = $7`,
    [id, person.email, since, person.role, person.firstName, person.lastName, person.phone],
  );
}

/**
 * @param {Db} db
 * @param {string} id
 * @param {(typeof PEOPLE)[PersonKey]} person
 * @param {string} officeId
 * @param {Date} since
 */
async function upsertWorker(db, id, person, officeId, since) {
  const worker = person.worker;
  if (!worker) return;

  await db.query(
    `INSERT INTO worker_profiles (user_id, bio, base_suburb, area_lat, area_lng, area_radius_km, available,
       verified_at, verified_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id) DO UPDATE SET bio = $2, base_suburb = $3, area_lat = $4, area_lng = $5,
       area_radius_km = $6, available = $7, verified_at = $8, verified_by_id = $9`,
    [
      id,
      worker.bio,
      worker.baseSuburb,
      worker.areaLat,
      worker.areaLng,
      worker.areaRadiusKm,
      worker.available,
      worker.verified ? since : null,
      worker.verified ? officeId : null,
    ],
  );
  // Exactly the demo trades: removing one also removes its licence (cascade).
  await db.query("DELETE FROM worker_trades WHERE user_id = $1 AND NOT (trade::text = ANY($2::text[]))", [
    id,
    worker.trades,
  ]);
  for (const trade of worker.trades) {
    await db.query("INSERT INTO worker_trades (user_id, trade) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, trade]);
  }
  for (const licence of worker.licences) {
    const decided = licence.status !== "PENDING";
    const expiresOn = new Date(since.getTime() + licence.expiresInDays * DAY_MS).toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO licences (user_id, trade, number, type, status, checked_by_id, checked_at, expires_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, trade) DO UPDATE SET number = $3, type = $4, status = $5, rejection_reason = NULL,
         checked_by_id = $6, checked_at = $7, expires_on = $8`,
      [
        id,
        licence.trade,
        licence.number,
        licence.type,
        licence.status,
        decided ? officeId : null,
        decided ? since : null,
        expiresOn,
      ],
    );
  }
}

/**
 * @param {Db} db
 * @param {string} customerId
 */
async function upsertAddresses(db, customerId) {
  const addresses = Object.values(ADDRESSES);
  // Only one default per person (a database rule): the demo default wins over any added since.
  await db.query("UPDATE addresses SET is_default = false WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))", [
    customerId,
    addresses.map((address) => address.id),
  ]);
  for (const a of addresses) {
    await db.query(
      `INSERT INTO addresses (id, user_id, label, line1, suburb, city, postcode, lat, lng, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET user_id = $2, label = $3, line1 = $4, suburb = $5, city = $6, postcode = $7,
         lat = $8, lng = $9, is_default = $10`,
      [a.id, customerId, a.label, a.line1, a.suburb, a.city, a.postcode, a.lat, a.lng, a.isDefault],
    );
  }
}

/**
 * Posts the job as REVIEW with its photos, windows and estimates, then moves it through `steps` the way the app
 * would, so the triggers write its status history and check every rule (pricing only while unpaid, a worker from
 * ASSIGNED on, booking an offered window).
 * @param {Db} db
 * @param {import("./data.mjs").DemoJob} job
 * @param {Record<PersonKey, string>} ids
 * @param {number | undefined} jobNumber
 * @param {{ daysAgo: (days: number) => Date; dateIn: (days: number) => string }} when
 */
async function postJob(db, job, ids, jobNumber, { daysAgo, dateIn }) {
  const actor = (/** @type {PersonKey | null} */ who) =>
    db.query("SELECT set_config('app.actor_id', $1, true)", [who ? ids[who] : ""]);
  const address = ADDRESSES[job.address];
  const posted = daysAgo(job.postedDaysAgo);

  await actor("customer");
  const { rows } = await db.query(
    `INSERT INTO jobs (id, job_number, customer_id, category, title, description, address_line1, suburb, city,
       postcode, lat, lng, access_notes, asap, any_time, created_at)
     VALUES ($1, coalesce($2, nextval(pg_get_serial_sequence('jobs', 'job_number'))), $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16)
     RETURNING job_number`,
    [
      job.id,
      jobNumber ?? null,
      ids.customer,
      job.category,
      job.title,
      job.description,
      address.line1,
      address.suburb,
      address.city,
      address.postcode,
      address.lat,
      address.lng,
      job.accessNotes ?? null,
      job.asap ?? false,
      job.anyTime ?? false,
      posted,
    ],
  );

  for (const [position, photo] of job.photos.entries()) {
    await db.query(
      "INSERT INTO job_photos (job_id, path, position, uploaded_by_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [job.id, photoPath(photo.file), position, ids[photo.by], posted],
    );
  }
  for (const [days, timeOfDay] of job.windows) {
    await db.query("INSERT INTO job_time_windows (job_id, date, time_of_day) VALUES ($1, $2, $3)", [
      job.id,
      dateIn(days),
      timeOfDay,
    ]);
  }
  for (const estimate of job.estimates) {
    await db.query(
      `INSERT INTO estimates (job_id, worker_id, minutes, materials_cents, note, needs_site_visit, created_at,
         updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        job.id,
        ids[estimate.by],
        estimate.minutes,
        estimate.materialsCents,
        estimate.note ?? null,
        estimate.needsSiteVisit ?? false,
        posted,
      ],
    );
  }

  for (const [status, who] of job.steps) {
    await actor(who);
    if (status === "PRICED") {
      if (!job.pricing) throw new Error(`Demo job "${job.title}" is priced but has no pricing.`);
      const p = examplePricing(job.pricing, job.category);
      await db.query(
        `INSERT INTO job_pricing (job_id, worker_rate_cents, min_minutes, holiday_pay_bps, on_cost_bps, margin_bps,
           gst_bps, minutes, materials_cents, worker_gross_cents, holiday_pay_cents, on_cost_cents, margin_cents,
           gst_cents, note, priced_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          job.id,
          p.workerRateCents,
          p.minMinutes,
          p.holidayPayBps,
          p.onCostBps,
          p.marginBps,
          p.gstBps,
          p.minutes,
          p.materialsCents,
          p.workerGrossCents,
          p.holidayPayCents,
          p.onCostCents,
          p.marginCents,
          p.gstCents,
          job.pricing.note,
          ids.office,
        ],
      );
      await db.query("UPDATE jobs SET status = 'PRICED', price_cents = $2 WHERE id = $1", [job.id, p.priceCents]);
    } else if (status === "ASSIGNED") {
      if (!job.worker) throw new Error(`Demo job "${job.title}" is assigned but has no worker.`);
      await db.query(
        `UPDATE jobs SET status = 'ASSIGNED', worker_id = $2, booked_date = $3, booked_time = $4 WHERE id = $1`,
        [job.id, ids[job.worker], job.booked ? dateIn(job.booked[0]) : null, job.booked?.[1] ?? null],
      );
    } else {
      await db.query("UPDATE jobs SET status = $2 WHERE id = $1", [job.id, status]);
    }
  }

  return { jobNumber: rows[0].job_number, status: job.steps.at(-1)?.[0] ?? "REVIEW", title: job.title };
}
