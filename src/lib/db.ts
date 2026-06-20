import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 client singleton with a driver adapter chosen by DATABASE_URL.
 * - Local dev  : `file:./dev.db` → better-sqlite3 adapter (zero DB server).
 * - Production : `postgresql://…` (Azure) → pg adapter.
 *
 * Portability (PRD §5): switching engines means changing only the Prisma
 * `provider` (scripts/set-db-provider.mjs) + DATABASE_URL. The schema stays in
 * the portable subset (no enum, no scalar arrays).
 */
function makeAdapter() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return new PrismaPg({ connectionString: url });
  }
  // SQLite: better-sqlite3 expects a filesystem path; strip the file: scheme.
  const file = url.replace(/^file:/, "");
  return new PrismaBetterSqlite3({ url: file });
}

const globalForPrisma = globalThis as unknown as {
  __kgPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__kgPrisma ??
  new PrismaClient({ adapter: makeAdapter() });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__kgPrisma = prisma;
}
