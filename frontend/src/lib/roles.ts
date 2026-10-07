/**
 * Ready-made job title lists for Find people. Hunter matches titles on whole words and common
 * word forms ("engineer" also finds "Engineering"), so each list names a role's usual titles.
 * Bare words like "developer" or "engineer" are left out on purpose: they'd also match sales
 * engineers and business-development managers.
 */
export const ROLES = [
  {
    id: "software-data",
    label: "Software & data",
    short: "software & data roles",
    titles: [
      // Software
      "software engineer", "software developer", "programmer", "software development engineer", "member of technical staff",
      "frontend engineer", "front-end developer", "backend engineer", "back-end developer", "full stack engineer",
      "full-stack developer", "web developer", "mobile engineer", "ios engineer", "android engineer", "application developer",
      "platform engineer", "infrastructure engineer", "systems engineer", "embedded software engineer", "firmware engineer",
      "cloud engineer", "devops engineer", "site reliability engineer", "qa engineer", "sdet", "security engineer",
      // Data and ML
      "data scientist", "data engineer", "data analyst", "analytics engineer", "machine learning engineer", "ml engineer",
      "ai engineer", "research scientist", "applied scientist", "research engineer", "business intelligence developer",
      "quantitative developer",
    ],
  },
  {
    id: "recruiting",
    label: "Recruiting",
    short: "recruiters",
    titles: ["recruiter", "technical recruiter", "talent acquisition", "talent partner", "sourcer", "university recruiter", "campus recruiter", "recruiting coordinator"],
  },
  {
    id: "eng-leaders",
    label: "Engineering leaders",
    short: "engineering leaders",
    titles: ["engineering manager", "head of engineering", "director of engineering", "vp of engineering", "cto", "tech lead", "team lead"],
  },
  {
    id: "product",
    label: "Product",
    short: "product roles",
    titles: ["product manager", "product owner", "technical product manager", "program manager", "technical program manager"],
  },
  {
    id: "design",
    label: "Design",
    short: "designers",
    titles: ["product designer", "ux designer", "ui designer", "ux researcher", "visual designer"],
  },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export const roleTitles = (id: RoleId) => ROLES.find((r) => r.id === id)!.titles.join(", ");

export const DEFAULT_TITLES = roleTitles("software-data");

const normalise = (titles: string) =>
  titles
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(",");

/** The preset a job title box holds exactly, if any. */
export function roleOf(jobTitle: string) {
  const want = normalise(jobTitle);
  return ROLES.find((r) => normalise(r.titles.join(",")) === want);
}

/** How a search's job titles read in a sentence: "software & data roles", or the typed title. */
export function titleLabel(jobTitle: string): string {
  const trimmed = jobTitle.trim();
  if (!trimmed) return "";
  const role = roleOf(trimmed);
  return role ? role.short : `matching “${trimmed}”`;
}
