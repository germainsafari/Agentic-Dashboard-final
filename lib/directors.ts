import {
  formerLeadersOfTeam,
  leaderNameOfTeam,
  leaderOfTeam,
  membersForTeam,
  teamsForDirector,
  type TeamCode,
} from "./mapping";

export type DirectorRole =
  | "Creative Director"
  | "Strategy Director"
  | "CT Director"
  | "Group Lead";

export type DirectorSeed = {
  id: string;
  name: string;
  role: DirectorRole;
  email: string;
  location: string;
  initials: string;
};

export const DIRECTOR_SEEDS: DirectorSeed[] = [
  {
    id: "piotr",
    name: "Piotr Wiśniewski",
    role: "Creative Director",
    email: "piotr.wisniewski@admindagency.com",
    location: "Kraków",
    initials: "PW",
  },
  {
    id: "marta",
    name: "Marta Szmyd",
    role: "Creative Director",
    email: "marta.szmyd@admindagency.com",
    location: "Kraków",
    initials: "MS",
  },
  {
    id: "dominika",
    name: "Dominika Konieczkowska-Kracik",
    role: "Creative Director",
    email: "dominika.konieczkowska@admindagency.com",
    location: "Kraków",
    initials: "DK",
  },
  {
    id: "michal",
    name: "Michał Majewski",
    role: "Creative Director",
    email: "michal.majewski@admindagency.com",
    location: "Kraków",
    initials: "MM",
  },
  {
    id: "karolina",
    name: "Karolina Pospischil",
    role: "Strategy Director",
    email: "karolina.pospischil@admind.pl",
    location: "Kraków",
    initials: "KP",
  },
  {
    id: "jonattas",
    name: "Jonattas Poltronieri",
    role: "CT Director",
    email: "jonattas.poltronieri@admindagency.com",
    location: "Kraków",
    initials: "JP",
  },
  {
    id: "krzysztof",
    name: "Krzysztof Wróblewski",
    role: "Group Lead",
    email: "krzysztof.wroblewski@admindagency.com",
    location: "Kraków",
    initials: "KW",
  },
  {
    id: "maciej",
    name: "Maciej Furtak",
    role: "Group Lead",
    email: "maciej.furtak@admindagency.com",
    location: "Kraków",
    initials: "MF",
  },
  {
    id: "justyna",
    name: "Justyna Dorman",
    role: "Group Lead",
    email: "justyna.dorman@admindagency.com",
    location: "Kraków",
    initials: "JD",
  },
];

/** Seconds scheduled per weekday, straight from Scoro's live user record. */
export type WeekAvailability = {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
};

export type ResolvedTeam = {
  code: TeamCode;
  name: string;
  leadEmail: string | undefined;
  leadName: string | undefined;
  /** Previous leads (e.g. someone who left the company) whose historical
   * completed projects should still count toward this team's FTA/Estimate
   * KPIs — see mapping.ts's former_leader_emails. */
  formerLeadEmails: string[];
  people: number;
  members: {
    name: string;
    email: string;
    weeklyTarget: number;
    /** Present only for members resolved from a live Scoro roster (not the static JSON fallback). */
    availability?: WeekAvailability;
  }[];
};

export type ResolvedDirector = DirectorSeed & {
  teams: ResolvedTeam[];
  peopleTotal: number;
};

function prettyTeamName(code: TeamCode): string {
  const overrides: Record<string, string> = {
    "MO - MAJA": "Motion — Maja",
    "MO - MO": "Motion — Mohammad",
    "DP & BP": "Design & Brand Platform",
    FE: "Formula E",
    "UBS-SYN": "Design Rescue",
    UBS_BA: "UBS BA",
    PM_1: "PM 01",
    "PM-1": "PM 01",
    "PM-2": "PM 02",
    "PM-4": "PM 04",
    "PM-BM": "PM · Brand Mgmt",
    "PM-DP": "PM · Design Platform",
    "PM-OTHER": "PM · Cross-client",
    "PM-PPT": "PM · Presentations",
    CAMPAIGNS: "Campaigns",
    COPYWRITER: "Copywriting",
    ACC: "Accelleron",
    "3D": "3D",
    COE: "Events",
    PRINC: "Principles",
    STR: "Strategy",
    CT: "Creative Tech",
    UX: "UX",
    CD: "Creative Direction",
    BA: "Brand Assets",
    PPT: "Presentations",
    FURTI: "Furti",
  };
  if (overrides[code]) return overrides[code];
  if (/^\d+$/.test(code)) return `Team ${code.padStart(2, "0")}`;
  return code;
}

export function resolveDirector(id: string): ResolvedDirector | null {
  const seed = DIRECTOR_SEEDS.find((d) => d.id === id);
  if (!seed) return null;

  const teamCodes = teamsForDirector(seed.email);
  const teams: ResolvedTeam[] = teamCodes.map((code) => {
    const members = membersForTeam(code);
    return {
      code,
      name: prettyTeamName(code),
      leadEmail: leaderOfTeam(code),
      leadName: leaderNameOfTeam(code),
      formerLeadEmails: formerLeadersOfTeam(code),
      people: members.length,
      members: members.map((m) => ({
        name: m.name,
        email: m.email,
        weeklyTarget: m.weekly_target,
      })),
    };
  });

  return {
    ...seed,
    teams,
    peopleTotal: teams.reduce((s, t) => s + t.people, 0),
  };
}

export function allResolvedDirectors(): ResolvedDirector[] {
  return DIRECTOR_SEEDS.map((d) => resolveDirector(d.id)!).filter(Boolean);
}
