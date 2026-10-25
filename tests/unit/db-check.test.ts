import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { checkDatabase } from "@/server/db-check";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** A port nothing is listening on: open one, note it, close it. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("checkDatabase", () => {
  it("says the database is off, and how to connect it, when DATABASE_URL isn't set", async () => {
    const status = await checkDatabase(undefined);
    expect(status.state).toBe("off");
    expect(status.message).toMatch(/copy \.env\.example to \.env\.local/);
  });

  it("prints how to fix it, instead of throwing, when the database isn't running", async () => {
    const port = await closedPort();
    const status = await checkDatabase(`postgresql://u:p@127.0.0.1:${port}/postgres`, { timeoutMs: 500 });
    expect(status.state).toBe("unreachable");
    expect(status.message).toContain(`Can't reach the database at 127.0.0.1:${port}`);
    expect(status.message).toMatch(/Supabase dashboard[\s\S]*Restore/);
  });

  it("handles a URL it can't parse without throwing", async () => {
    const status = await checkDatabase("postgresql://[not-a-host");
    expect(status.state).toBe("unreachable");
  });

  it("reports the database as reachable when something answers on its port", async () => {
    server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const status = await checkDatabase(`postgresql://u:p@127.0.0.1:${port}/postgres`);
    expect(status).toEqual({ state: "reachable", message: `Database: reachable at 127.0.0.1:${port}.` });
  });
});
