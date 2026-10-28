const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;

export function isTikTokUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && TIKTOK_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Splits pasted text on any whitespace, removes duplicates, and separates valid TikTok links. */
export function parseLinks(raw: string): { valid: string[]; invalid: number } {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const token of raw.split(/\s+/)) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (isTikTokUrl(token)) valid.push(token);
    else invalid += 1;
  }
  return { valid, invalid };
}
