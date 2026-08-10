/**
 * Apply Postgres schema (Neon). Safe to run multiple times.
 *
 * Env: DATABASE_URL
 * Usage: npm run db:migrate
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").replace(/\r/g, "").split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
} catch {
  // optional
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("[db:migrate] DATABASE_URL is required");
  process.exit(1);
}

const schemaPath = path.join(__dirname, "..", "sql", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = neon(url);

for (const statement of statements) {
  await sql.query(statement);
  console.log("[db:migrate] OK:", statement.split("\n")[0].slice(0, 72));
}

console.log("[db:migrate] Schema applied.");
