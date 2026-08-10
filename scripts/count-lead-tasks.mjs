import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const leadId = Number(process.argv[2] ?? 92);
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID;

async function post(path, body) {
  const r = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...body }),
  });
  return (await r.json()).data ?? [];
}

const keys = ["doer_id", "assigned_to", "responsible_id", "responsible_user_id"];
const seen = new Set();
let total = 0;
for (const key of keys) {
  let keyTotal = 0;
  for (let page = 1; page <= 40; page++) {
    const rows = await post("tasks/list", {
      filter: { [key]: leadId, is_completed: 0 },
      detailed_response: true,
      per_page: 25,
      page,
    });
    keyTotal += rows.length;
    for (const t of rows) {
      const id = Number(t.event_id ?? t.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        total++;
      }
    }
    if (rows.length < 25) break;
  }
  console.log(`${key}: ${keyTotal} rows`);
}
console.log(`unique tasks merged: ${total}`);
