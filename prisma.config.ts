import { defineConfig } from "prisma/config";

// Prisma doesn't read .env files itself. Load the same files Next.js uses, if they exist.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // No file: fine. The database is optional until Supabase keys exist (see .env.example).
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
  datasource: {
    // Migrations use the direct connection; Supabase's pooled one can't run them.
    // Read process.env directly (not Prisma's env()), so `prisma generate` works with no keys.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
