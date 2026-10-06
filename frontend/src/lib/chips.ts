/** A company to search on the Find people page: a picked suggestion (exact domain) or text typed as-is. */
export type Chip = { query: string; label: string; domain: string | null };

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Typed text as a chip: "https://www.Stripe.com/jobs" becomes the domain stripe.com, "Stripe" stays a name. */
export function textChip(text: string): Chip {
  const q = text.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  return DOMAIN.test(q) ? { query: q.toLowerCase(), label: q.toLowerCase(), domain: q.toLowerCase() } : { query: text.trim(), label: text.trim(), domain: null };
}

/** Several companies pasted at once, separated by new lines or commas. */
export function textToChips(text: string): Chip[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(textChip);
}
