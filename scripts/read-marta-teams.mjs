import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT fetched_at, payload FROM director_snapshots WHERE director_id = 'marta' LIMIT 1`;
if (!rows.length) {
  console.log("no snapshot");
  process.exit(0);
}
console.log("fetched_at:", rows[0].fetched_at);
for (const t of rows[0].payload.teamStats ?? []) {
  const code = t.team?.code;
  if (["1", "2", "4", "01", "02", "04", "COE"].includes(String(code))) {
    console.log({
      code,
      lead: t.team?.leadEmail,
      active: t.stats?.activeProjects,
      details: (t.stats?.activeProjectDetails ?? []).length,
    });
  }
}
