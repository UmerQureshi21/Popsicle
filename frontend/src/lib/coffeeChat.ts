import { API_URL } from "./api";

/** Their coffee chat sheet (About me + your notes) as a PDF: opened in the browser, or saved as a file. */
export function coffeeChatUrl(contactId: number, download = false): string {
  return `${API_URL}/api/contacts/${contactId}/coffee-chat.pdf${download ? "?download=1" : ""}`;
}

export const ABOUT_HINT = `Who I am:
- 3rd year Computer Science student at …
- Working as a software engineering intern at …

Current projects:
- A recipe sharing site: https://…`;

export const NOTES_HINT = `Why I am reaching out:
- Interested in how your team …

What I am curious about:
- How did your day-to-day change when …
- What qualities do you look for when …`;

export const FORMAT_TIP = "A line ending in “:” is a heading, a line starting with “-” is a bullet, and web addresses become links.";
