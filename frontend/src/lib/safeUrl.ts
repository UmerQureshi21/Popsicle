/**
 * A link from data (Hunter, Google, a pasted table) as an href, only if it's a plain web
 * address. A `javascript:` link would run code in Popsicle when clicked, so it's dropped.
 * The backend refuses such links too; this also covers anything stored before that check.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
