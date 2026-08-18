/**
 * Reading and writing citation counts in the Extra field.
 *
 * Zest writes ONE canonical line —
 *   `Citations: 42 (Crossref) [2026-08-18]`
 * — the same shape zotero-citation-tally uses, which is a plain Zotero
 * `Key: Value` line and therefore survives sync, export and hand editing.
 *
 * It READS every historical format instead, because people arrive with years
 * of counts written by other plugins and re-fetching them all would be both
 * slow and rude to the APIs:
 *
 *   GSCC: 0001719 2025-04-25T18:45:33.000Z 2.34   (Google Scholar plugin)
 *   GSCC:00001001                                  (older, no space)
 *   ZSCC: 0000123                                  (scholar-citations forks)
 *   ZSCC: NoCitationData
 *   Citations: 42 (Crossref) [2026-07-28]          (citation-tally / ours)
 *   42 citations (Crossref) [2026-07-28]           (eschnett gen 2)
 *   Citations (Crossref): 42                       (eschnett gen 1)
 *   openalex.cit_count: 42                         (zotero-openalex)
 */

export interface CitationInfo {
  count: number;
  source?: string;
  /** ISO date (YYYY-MM-DD) of the last successful fetch, when recorded */
  date?: string;
  /** the raw line we parsed, so a rewrite can replace exactly that line */
  line?: string;
}

const PATTERNS: Array<{
  re: RegExp;
  read: (m: RegExpMatchArray) => CitationInfo | null;
}> = [
  {
    // ours / citation-tally
    re: /^Citations:\s*(\d+)\s*(?:\(([^)]+)\))?\s*(?:\[([\d-]+)\])?/im,
    read: (m) => ({ count: Number(m[1]), source: m[2], date: m[3] }),
  },
  {
    // eschnett gen 2: "42 citations (Crossref) [2026-07-28]"
    re: /^(\d+)\s+citations?\s*(?:\(([^)]+)\))?\s*(?:\[([\d-]+)\])?/im,
    read: (m) => ({ count: Number(m[1]), source: m[2], date: m[3] }),
  },
  {
    // eschnett gen 1: "Citations (Crossref): 42"
    re: /^Citations\s*\(([^)]+)\):\s*(\d+)/im,
    read: (m) => ({ count: Number(m[2]), source: m[1] }),
  },
  {
    // Google Scholar plugin: zero-padded, optional timestamp and score
    re: /^GSCC:?\s*(\d+)(?:\s+(\S+))?/im,
    read: (m) => ({
      count: Number(m[1]),
      source: "Google Scholar",
      date: isoDate(m[2]),
    }),
  },
  {
    re: /^ZSCC:?\s*(\d+)/im,
    read: (m) => ({ count: Number(m[1]), source: "Google Scholar" }),
  },
  {
    re: /^openalex\.cit_count:\s*(\d+)/im,
    read: (m) => ({ count: Number(m[1]), source: "OpenAlex" }),
  },
];

function isoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** the citation count recorded on an item, in any known format */
export function readCitations(item: Zotero.Item): CitationInfo | undefined {
  let extra: string;
  try {
    extra = (item.getField("extra") as string) || "";
  } catch {
    return undefined;
  }
  if (!extra) return undefined;
  for (const { re, read } of PATTERNS) {
    const m = extra.match(re);
    if (!m) continue;
    const info = read(m);
    if (!info || !Number.isFinite(info.count)) continue;
    return { ...info, line: m[0] };
  }
  // "NoCitationData" means the other plugin looked and found nothing
  if (/^(GSCC|ZSCC):?\s*NoCitationData/im.test(extra)) {
    return { count: 0, source: "Google Scholar" };
  }
  return undefined;
}

export function formatCitationLine(info: {
  count: number;
  source: string;
  date?: string;
}): string {
  return `Citations: ${info.count} (${info.source}) [${info.date ?? todayISO()}]`;
}

/**
 * Lines that are ONLY a citation record. Anchored at both ends, because the
 * loose patterns used for reading would also swallow a user's own sentence
 * such as "3 citations still missing from the intro" — deleting a note the
 * user wrote is far worse than leaving a duplicate count.
 */
const WHOLE_LINE_PATTERNS: RegExp[] = [
  /^Citations:\s*\d+\s*(?:\([^)]*\))?\s*(?:\[[\d-]+\])?\s*$/i,
  /^\d+\s+citations?\s*(?:\([^)]*\))?\s*(?:\[[\d-]+\])?\s*$/i,
  /^Citations\s*\([^)]*\):\s*\d+\s*$/i,
  /^GSCC:?\s*(?:\d+|NoCitationData)(?:\s+\S+)*\s*$/i,
  /^ZSCC:?\s*(?:\d+|NoCitationData)\s*$/i,
  /^openalex\.cit_count:\s*\d+\s*$/i,
];

export function isCitationOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return WHOLE_LINE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Replace whatever citation line the item has with ours, or append one.
 * Other plugins' lines are REPLACED, not duplicated — two counts in one Extra
 * is exactly the mess users complain about. Everything else, including blank
 * lines the user put there, is preserved verbatim.
 */
export function withCitationLine(extra: string, line: string): string {
  const lines = (extra || "").split(/\r?\n/);
  const kept = lines.filter((l) => !isCitationOnlyLine(l));
  // drop a trailing blank line so the appended record does not leave a gap
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  kept.push(line);
  return kept.join("\n");
}
