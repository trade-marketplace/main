// Runs before `npm run db:migrate` and `npm run db:seed`: explains what to do instead of Prisma's error.
const missing = ["DATABASE_URL", "DIRECT_URL"].filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(
    [
      `The database isn't connected yet (${missing.join(" and ")} not set).`,
      "To connect it:",
      "  1. Copy .env.example to .env.local.",
      "  2. In the Supabase dashboard, open Project Settings → Database → Connection string.",
      "  3. Paste the pooled string into DATABASE_URL and the direct one into DIRECT_URL.",
      "  4. Run this command again.",
    ].join("\n"),
  );
  process.exit(1);
}
