import { Socket } from "node:net";

export type DatabaseStatus =
  | { state: "off"; message: string }
  | { state: "unreachable"; message: string }
  | { state: "reachable"; message: string };

const DEFAULT_PORT = 5432;

/**
 * Checks whether the database in DATABASE_URL can be reached, without logging in.
 * Never throws: `npm run dev` prints the message instead of a stack trace.
 */
export async function checkDatabase(
  databaseUrl: string | undefined,
  { timeoutMs = 2000 }: { timeoutMs?: number } = {},
): Promise<DatabaseStatus> {
  if (!databaseUrl?.trim()) {
    return {
      state: "off",
      message: [
        "Database: off. The app runs without it for now.",
        "To connect, copy .env.example to .env.local and fill in DATABASE_URL and DIRECT_URL from Supabase.",
      ].join("\n"),
    };
  }

  let host: string;
  let port: number;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    port = url.port ? Number(url.port) : DEFAULT_PORT;
  } catch {
    return { state: "unreachable", message: unreachableMessage("DATABASE_URL isn't a valid connection string") };
  }

  const reached = await canConnect(host, port, timeoutMs);
  if (reached) return { state: "reachable", message: `Database: reachable at ${host}:${port}.` };
  return { state: "unreachable", message: unreachableMessage(`Can't reach the database at ${host}:${port}`) };
}

function unreachableMessage(problem: string): string {
  return [
    `Database: ${problem}. The app will keep running, but anything that needs the database will fail.`,
    "To fix it:",
    "  1. Open the project in the Supabase dashboard. Free projects pause after a week idle: click Restore.",
    "  2. Check DATABASE_URL and DIRECT_URL in .env.local against Project Settings → Database.",
    "  3. Check your internet connection, then restart `npm run dev`.",
  ].join("\n");
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}
