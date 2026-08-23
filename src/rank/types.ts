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
  /** normalised journal name — the cache key */
  key: string;
  /** the journal name as it was on the item */
  name: string;
  issn?: string;
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

/** first numeric value among the given fields (impact-factor column) */
export function numberOf(
  rec: JournalRecord | undefined,
  fields: string[],
): number | undefined {
  for (const f of fields) {
    const v = valueOf(rec, f);
    if (!v) continue;
    const n = Number(String(v.value).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
