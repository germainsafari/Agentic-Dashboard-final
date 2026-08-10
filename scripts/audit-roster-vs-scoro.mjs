/**
 * Diff mapping JSON rosters vs live Scoro user groups.
 * Usage: node scripts/audit-roster-vs-scoro.mjs [teamCode]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const filterTeam = process.argv[2];

const JSON_ROSTER = new Set([
  "COPYWRITER", "FURTI", "PM-1", "PM-2", "PM-4", "PM-OTHER", "PM-PPT", "PM-BM", "PM-DP",
]);
const OVERRIDES = {
  ACC: "Team #Accelleron", BA: "Team #Other_BA", CAMPAIGNS: "Team #Campaigns", CD: "Team #CDs",
  COE: "Team #COE", CT: "Creative Technology", "DP & BP": "Digital Platforms",
  "MO - MAJA": "Team #Motion", "MO - MO": "Team #Motion", PRINC: "Team #Principles",
  STR: "Team #Therefore Strategy", "UBS-SYN": "Team #Design Rescue", UBS_BA: "Team #ABB_BA",
};

function groupName(code) {
  if (JSON_ROSTER.has(code)) return null;
  return OVERRIDES[code] ?? `Team #${code}`;
}

const base = process.env.COMPANY_BASE_URL.replace(/\/$/, "");
const apiKey = process.env.SCORO_API_KEY;
const companyId = process.env.SCORO_COMPANY_ACCOUNT_ID;

async function post(p, b) {
  const r = await fetch(`${base}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, company_account_id: companyId, ...b }),
  });
  return (await r.json()).data ?? [];
}

async function list(path, body = {}) {
  const out = [];
  const perPage = body.detailed_response ? 25 : 100;
  for (let page = 1; page <= 80; page++) {
    const rows = await post(path, { ...body, per_page: perPage, page, detailed_response: true });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < perPage) break;
  }
  return out;
}

const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mapping_ba_update.json"), "utf8"));
const teams = Object.keys(mapping.team_leader_lookup).filter((c) => !filterTeam || c === filterTeam);
const groups = await list("userGroups/list");
const groupId = new Map(groups.map((g) => [g.group_name, g.group_id]));
const users = await list("users/list");

function active(u) {
  if (u.is_active === 0 || u.is_active === "0") return false;
  const s = String(u.status ?? "").toLowerCase();
  return s !== "inactive" && s !== "awaiting";
}

console.log("Team roster audit: JSON mapping vs Scoro user group\n");

for (const code of teams) {
  const jsonEmails = new Set(
    mapping.members.filter((m) => m.team === code).map((m) => m.email.toLowerCase())
  );
  const gName = groupName(code);
  if (!gName) {
    console.log(`${code}: JSON-only roster (${jsonEmails.size} in mapping)`);
    continue;
  }
  const gid = groupId.get(gName);
  if (!gid) {
    console.log(`${code}: missing Scoro group "${gName}"`);
    continue;
  }
  const scoroEmails = new Set(
    users
      .filter((u) => active(u) && (u.user_groups_ids ?? []).map(Number).includes(gid))
      .map((u) => String(u.email).toLowerCase())
  );
  const onlyJson = [...jsonEmails].filter((e) => !scoroEmails.has(e));
  const onlyScoro = [...scoroEmails].filter((e) => !jsonEmails.has(e));
  const match = onlyJson.length === 0 && onlyScoro.length === 0;
  console.log(
    `${code} (${gName}): JSON=${jsonEmails.size} Scoro=${scoroEmails.size} ${match ? "OK" : "MISMATCH"}`
  );
  if (onlyJson.length) console.log(`  in JSON only: ${onlyJson.join(", ")}`);
  if (onlyScoro.length) console.log(`  in Scoro only: ${onlyScoro.join(", ")}`);
}
