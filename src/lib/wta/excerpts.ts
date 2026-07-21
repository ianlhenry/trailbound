/** Condition signals also used when scoring trip reports. */
const SIGNAL_PATTERNS: RegExp[] = [
  /\bclosed\b|\bclosure\b/i,
  /wash\s*out|washed out/i,
  /\bsnow\b|posthole|\bice\b/i,
  /\bbugs?\b|mosquito/i,
  /road condition|impassable road/i,
  /clear|great shape|in good shape|melted out/i,
  /\bopen\b|accessible|easy access/i,
  /\bsmoke\b|\bfire\b|blowdown|creek crossing|\bford\b|\bcrowd/i,
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${base}…`;
}

/**
 * Prefer 1–2 sentences that mention trail conditions; otherwise the lead-in.
 */
export function relevantTripReportExcerpt(
  snippet: string,
  maxLen = 320
): string {
  const cleaned = snippet.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const sentences = splitSentences(cleaned);
  const hits = sentences.filter((s) =>
    SIGNAL_PATTERNS.some((re) => re.test(s))
  );
  const preferred = hits.length
    ? hits.slice(0, 2).join(" ")
    : cleaned;

  return truncateAtWord(preferred, maxLen);
}
