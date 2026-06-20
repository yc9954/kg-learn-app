#!/usr/bin/env node
/**
 * Rewrites ONLY the `provider = "..."` line in prisma/schema.prisma between
 * sqlite (local dev) and postgresql (Azure prod). Keeps the schema portable so
 * the production swap is just provider + DATABASE_URL — never edit anything else.
 *
 * Usage: node scripts/set-db-provider.mjs <sqlite|postgresql>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const target = process.argv[2];
const allowed = new Set(["sqlite", "postgresql"]);
if (!allowed.has(target)) {
  console.error(
    `set-db-provider: expected "sqlite" or "postgresql", got "${target ?? ""}"`,
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "prisma", "schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

// Replace only the provider line inside the datasource block.
const updated = schema.replace(
  /(\n\s*provider\s*=\s*)"(sqlite|postgresql)"/,
  `$1"${target}"`,
);

if (updated === schema && !new RegExp(`provider\\s*=\\s*"${target}"`).test(schema)) {
  console.error("set-db-provider: could not find a datasource provider line to update.");
  process.exit(1);
}

writeFileSync(schemaPath, updated);
console.log(`set-db-provider: datasource provider set to "${target}".`);
