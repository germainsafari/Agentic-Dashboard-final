import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT payload, fetched_at
  FROM director_snapshots
  WHERE director_id = 'marta'
  LIMIT 1
`;
if (!rows.length) {
  console.log("no snapshot");
  process.exit(0);
}
const entry = rows[0].payload;
for (const t of entry.teamStats ?? []) {
  if (t.team?.code === "COE" || String(t.team?.leadEmail ?? "").includes("hayley")) {
    console.log(
      JSON.stringify(
        {
          code: t.team.code,
          name: t.team.name,
          lead: t.team.leadEmail,
          activeProjects: t.stats?.activeProjects,
          fetchedAt: rows[0].fetched_at,
        },
        null,
        2
      )
    );
  }
}
