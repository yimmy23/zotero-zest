/** Journal metrics shared by every rank source. */

export type RankSource = "dataset" | "easyscholar" | "openalex";

export interface RankValue {
  /** field key, e.g. "sciif", "sci", "sciUp", "oa2yr" */
  field: string;
  /** value as shown, e.g. "1区", "Q1", "58.7" */
  value: string;
  /** 1 (best) … 5, or undefined when the value has no meaningful order */
  rank?: number;
  source: RankSource;
}

export interface JournalRecord {
  /** Lookup-rule revision; absent on older caches, never a ranking year. */
  lookupVersion?: number;
  /** Input IDs identify a repeated request; they do not prove source aliases. */
  requestedISSNs?: string[];
  /** ISSN first; otherwise a namespaced normalised title. */
  key: string;
  /** the journal name as it was on the item */
  name: string;
  issn?: string;
  /** Verified print/electronic ISSN aliases for the same source. */
  issns?: string[];
  values: RankValue[];
  /** epoch ms of the lookup */
  updated: number;
  /** sources that were asked and had nothing (so we do not ask again soon) */
  misses?: RankSource[];
  /** a source could not be reached when this was built: show it, but ask
   *  again soon rather than after the full TTL */
  partial?: boolean;
}

export function valueOf(
  rec: JournalRecord | undefined,
  field: string,
): RankValue | undefined {
  if (!rec) return undefined;
  const lower = field.toLowerCase();
  return rec.values.find((v) => v.field.toLowerCase() === lower);
}

/**
 * Nonnegative metric, with unknown distinct from zero. Human-authored dataset
 * and easyScholar strings may use full-width digits, a dot decimal separator
 * and correctly grouped thousands commas. Never strip arbitrary text/signs
 * or guess that a decimal comma is a thousands separator. Typed API adapters
 * must check their JSON number type before calling this parser.
 */
export function parseRankNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value
    .trim()
    .replace(/[０-９．，]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(text))
    return undefined;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

/** first numeric value among the given fields (impact-factor column) */
export function numberOf(
  rec: JournalRecord | undefined,
  fields: string[],
): number | undefined {
  for (const f of fields) {
    const v = valueOf(rec, f);
    if (!v) continue;
    const n = parseRankNumber(v.value);
    if (n !== undefined) return n;
  }
  return undefined;
}
