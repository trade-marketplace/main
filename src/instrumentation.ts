// Runs once when the server starts (`npm run dev` / `npm run start`), not during a build.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkDatabase } = await import("@/server/db-check");
  const status = await checkDatabase(process.env.DATABASE_URL);
  if (status.state === "unreachable") console.warn(status.message);
  else console.info(status.message);
}
