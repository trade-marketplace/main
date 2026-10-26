// Where `npm run db:seed` may write, and how it makes the demo sign-ins (#88). Pure: reads only the env it's given.
//
// The seed refuses unless ALLOW_SEED=1 AND every database it could reach looks like a local or preview one:
// - a Postgres on this machine (localhost, 127.0.0.1, ::1), or
// - a database whose name contains "preview" or "local", or
// - a Supabase project whose ref can be read from the URL and isn't production (docs/SERVICES.md). Supabase
//   databases are always called `postgres`, so the name says nothing there.
// The production ref anywhere in the database or Supabase URLs is refused, whatever else is set.

/** The real project (docs/SERVICES.md). Never seeded. */
export const PRODUCTION_PROJECT_REF = "bwbwbpnqfxjdkbompsvg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class SeedRefusedError extends Error {
  /** @param {string[]} reasons */
  constructor(reasons) {
    super(
      [
        "Seed refused: it only writes demo data to a local or preview database.",
        ...reasons.map((reason) => `  - ${reason}`),
        "See docs/TESTING.md (Seed data).",
      ].join("\n"),
    );
    this.name = "SeedRefusedError";
  }
}

/**
 * @typedef {{ kind: "local" } | { kind: "preview" } | { kind: "supabase"; ref: string }} DatabaseKind
 * @typedef {{ mode: "plain" } | { mode: "supabase"; url: string; secretKey: string; ref: string }} AuthMode
 * @typedef {{ url: string; auth: AuthMode; password: string | undefined }} SeedTarget
 */

/**
 * Checks the environment and says where to seed and how to make the demo sign-ins:
 * - `supabase`: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are set, so users are
 *   made through the Supabase Auth admin API and SEED_DEMO_PASSWORD really logs in.
 * - `plain`: a plain Postgres with the migration's stand-in `auth.users`; rows are inserted directly.
 * Throws a SeedRefusedError naming every problem.
 * @param {Record<string, string | undefined>} env
 * @returns {SeedTarget}
 */
export function checkSeedTarget(env) {
  const value = (/** @type {string} */ name) => env[name]?.trim() || undefined;
  const reasons = [];

  if (value("ALLOW_SEED") !== "1") {
    reasons.push("ALLOW_SEED isn't 1. Set ALLOW_SEED=1 to say you mean to fill this database with demo data.");
  }

  const urls = /** @type {const} */ (["DIRECT_URL", "DATABASE_URL"])
    .map((name) => ({ name, url: value(name) }))
    .filter((entry) => entry.url !== undefined);
  if (urls.length === 0) reasons.push("Neither DIRECT_URL nor DATABASE_URL is set, so there's nothing to seed.");

  const supabaseUrl = value("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = value("SUPABASE_SECRET_KEY") ?? value("SUPABASE_SERVICE_ROLE_KEY");

  for (const [name, url] of [...urls.map((entry) => [entry.name, entry.url]), ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl]]) {
    if (url?.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      reasons.push(`${name} points at the production Supabase project (${PRODUCTION_PROJECT_REF}).`);
    }
  }

  /** @type {Set<string>} */
  const refs = new Set();
  let onSupabase = false;
  let allLocal = urls.length > 0;
  for (const { name, url } of urls) {
    const kind = classifyDatabase(/** @type {string} */ (url));
    if ("problem" in kind) {
      // The production ref is already reported above.
      if (!url?.toLowerCase().includes(PRODUCTION_PROJECT_REF)) reasons.push(`${name}: ${kind.problem}`);
      allLocal = false;
    } else {
      if (kind.kind !== "local") allLocal = false;
      if (kind.kind === "supabase") {
        onSupabase = true;
        refs.add(kind.ref);
      }
    }
  }
  if (refs.size > 1) reasons.push(`DIRECT_URL and DATABASE_URL are different Supabase projects (${[...refs].join(", ")}).`);

  /** @type {AuthMode} */
  let auth = { mode: "plain" };
  if (supabaseUrl && secretKey) {
    // A local Supabase (`supabase start`) serves Auth on this machine next to a local database.
    const localAuth = isLocalUrl(supabaseUrl);
    const ref = localAuth ? "local" : supabaseProjectRef(supabaseUrl);
    if (localAuth) {
      if (!allLocal) reasons.push("NEXT_PUBLIC_SUPABASE_URL is on this machine but the database isn't.");
    } else if (!ref) {
      reasons.push("NEXT_PUBLIC_SUPABASE_URL isn't a Supabase project URL (https://<project-ref>.supabase.co).");
    } else if (!onSupabase && urls.length > 0) {
      reasons.push("NEXT_PUBLIC_SUPABASE_URL and a secret key are set but the database isn't that Supabase project.");
    } else if (refs.size === 1 && !refs.has(ref)) {
      reasons.push(`NEXT_PUBLIC_SUPABASE_URL is project ${ref} but the database is ${[...refs][0]}.`);
    }
    auth = { mode: "supabase", url: supabaseUrl, secretKey, ref: ref ?? "" };
  } else if (onSupabase) {
    // Rows inserted straight into Supabase's auth.users would have no password, so nobody could log in.
    reasons.push(
      "The database is a Supabase project, so demo users must be made through Supabase Auth: set " +
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY for the same project.",
    );
  }

  const password = value("SEED_DEMO_PASSWORD");
  if (auth.mode === "supabase" && !password) {
    reasons.push("SEED_DEMO_PASSWORD isn't set. The demo accounts need a password to log in with (.env.example).");
  } else if (password && [...password].length < 10) {
    reasons.push("SEED_DEMO_PASSWORD is shorter than 10 characters, the sign-in minimum.");
  }

  if (reasons.length > 0) throw new SeedRefusedError(reasons);
  return { url: /** @type {string} */ (urls[0].url), auth, password };
}

/**
 * @param {string} url
 * @returns {DatabaseKind | { problem: string }}
 */
export function classifyDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { problem: "isn't a postgres:// connection string." };
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return { problem: "isn't a postgres:// connection string." };

  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();

  if (/(^|\.)supabase\.(co|com)$/.test(host)) {
    const ref = supabaseDatabaseRef(host, decodeURIComponent(parsed.username));
    if (!ref) return { problem: `is a Supabase database but its project ref can't be read from ${host}.` };
    if (ref === PRODUCTION_PROJECT_REF) return { problem: "is the production Supabase project." };
    return { kind: "supabase", ref };
  }
  if (LOCAL_HOSTS.has(host)) return { kind: "local" };
  if (/preview|local/.test(database)) return { kind: "preview" };
  return {
    problem: `${host}/${database || "(no database)"} doesn't look local or preview (not localhost, and the ` +
      "database name doesn't contain \"preview\" or \"local\").",
  };
}

/**
 * The project ref from a Supabase database URL: the direct host `db.<ref>.supabase.co`, or the pooler's user name
 * `postgres.<ref>` (the pooler host is shared by every project in the region).
 * @param {string} host
 * @param {string} username
 */
function supabaseDatabaseRef(host, username) {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
  if (direct) return direct[1];
  const pooled = /^[a-z_]+\.([a-z0-9]{20})$/.exec(username.toLowerCase());
  return pooled ? pooled[1] : undefined;
}

/** @param {string} url */
function isLocalUrl(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** @param {string} url */
function supabaseProjectRef(url) {
  try {
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(new URL(url).hostname.toLowerCase());
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}
