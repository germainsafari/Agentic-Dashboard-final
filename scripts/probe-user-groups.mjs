import fs from "fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const res = await fetch(`${base}/userGroups/list`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    apiKey: process.env.SCORO_API_KEY,
    company_account_id: process.env.SCORO_COMPANY_ACCOUNT_ID,
    detailed_response: true,
    per_page: 100,
    page: 1,
  }),
});
const j = await res.json();
console.log(JSON.stringify(j.data?.[0], null, 2));
console.log("count", j.data?.length);
for (const g of j.data ?? []) console.log(g.group_id ?? g.id, g.name ?? g.group_name, (g.users ?? g.user_ids ?? []).length);
