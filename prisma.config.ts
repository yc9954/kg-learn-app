import path from "node:path";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 config. The datasource connection URL lives here (no longer in
 * schema.prisma) and is read from DATABASE_URL — `file:./dev.db` locally
 * (SQLite) or Azure PostgreSQL in prod. The Prisma provider itself is flipped
 * by scripts/set-db-provider.mjs (npm run db:dev / db:deploy). The runtime
 * client uses a matching driver adapter (see src/lib/db.ts).
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
