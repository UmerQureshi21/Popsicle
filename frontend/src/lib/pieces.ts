/**
 * Long jobs are sent to the backend a few items at a time, so no single request runs long
 * enough to be cut off by the hosting proxy's time limit.
 */
export function inPieces<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const VERIFY_PIECE = 10; // addresses per verify request (the backend's limit)
export const COMPANIES_PIECE = 25; // pasted companies per request (the backend's limit)

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
