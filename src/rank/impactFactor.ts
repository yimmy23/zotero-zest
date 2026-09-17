import {
  parseRankNumber,
  valueOf,
  type JCRCategory,
  type JCRMetadata,
  type JournalRecord,
  type RankSource,
  type RankValue,
} from "./types";

export interface ResolvedImpactFactor {
  value: number;
  field: string;
  raw: string;
  source: RankSource;
  jcr?: Pick<
    JCRMetadata,
    "year" | "categories" | "provider" | "percentileMethod"
  >;
}

/** A source-provided category position, not a rank reconstructed from rounded IF. */
export function parseJCRRank(raw: unknown):
  | {
      rank: number;
      total: number;
      percentile: number;
      normalized: string;
    }
  | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^([1-9]\d*)\s*\/\s*([1-9]\d*)$/.exec(raw.trim());
  if (!match) return undefined;
  const rank = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isSafeInteger(rank) ||
    !Number.isSafeInteger(total) ||
    rank > total ||
    total > 1_000_000
  )
    return undefined;
  return {
    rank,
    total,
    percentile: ((total - rank + 0.5) / total) * 100,
    normalized: `${rank}/${total}`,
  };
}

/** Validate at import/cache boundaries. Missing years/categories stay missing. */
export function sanitizeJCRMetadata(raw: unknown): JCRMetadata | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.year !== "number" ||
    !Number.isInteger(r.year) ||
    r.year < 1975 ||
    r.year > new Date().getFullYear() ||
    typeof r.source !== "string" ||
    !["dataset", "easyscholar"].includes(r.source) ||
    (r.provider !== undefined && r.provider !== "showjcr") ||
    (r.percentileMethod !== undefined && r.percentileMethod !== "rank") ||
    (r.provider === "showjcr" &&
      (r.source !== "dataset" || r.percentileMethod !== "rank")) ||
    !Array.isArray(r.categories) ||
    !r.categories.length ||
    r.categories.length > 50
  )
    return undefined;
  const impactFactor = parseRankNumber(r.impactFactor);
  if (impactFactor === undefined) return undefined;
  const categories = new Map<string, JCRCategory>();
  for (const rawCategory of r.categories) {
    if (!rawCategory || typeof rawCategory !== "object") return undefined;
    const category = rawCategory as Record<string, unknown>;
    if (typeof category.name !== "string") return undefined;
    const name = category.name.trim();
    const position =
      r.percentileMethod === "rank" ? parseJCRRank(category.rank) : undefined;
    const percentile =
      r.percentileMethod === "rank"
        ? position?.percentile
        : parseRankNumber(category.percentile);
    if (
      !name ||
      name.length > 200 ||
      percentile === undefined ||
      percentile > 100
    )
      return undefined;
    let rank: string | undefined;
    if (category.rank !== undefined) {
      if (typeof category.rank !== "string") return undefined;
      rank = category.rank.trim() || undefined;
      if (rank && rank.length > 80) return undefined;
    }
    if (position) rank = position.normalized;
    let quartile: JCRCategory["quartile"];
    if (category.quartile !== undefined) {
      if (
        typeof category.quartile !== "string" ||
        !/^Q[1-4]$/.test(category.quartile)
      )
        return undefined;
      quartile = category.quartile as JCRCategory["quartile"];
      if (
        position &&
        quartile !== `Q${Math.ceil((position.rank / position.total) * 4)}`
      )
        return undefined;
    }
    const key = name.normalize("NFKC").toLowerCase();
    const previous = categories.get(key);
    // A conflicting duplicate must not make file order select a percentile.
    if (
      previous &&
      (previous.percentile !== percentile ||
        previous.rank !== rank ||
        previous.quartile !== quartile)
    )
      return undefined;
    if (!previous)
      categories.set(key, {
        name,
        percentile,
        ...(rank ? { rank } : {}),
        ...(quartile ? { quartile } : {}),
      });
  }
  return {
    year: r.year,
    impactFactor,
    source: r.source as RankSource,
    ...(r.provider === "showjcr" ? { provider: r.provider } : {}),
    ...(r.percentileMethod === "rank"
      ? { percentileMethod: r.percentileMethod }
      : {}),
    categories: [...categories.values()],
  };
}

/** JCR metadata is useful only with the exact source/value it describes. */
export function matchingJCRMetadata(
  metadata: JCRMetadata | undefined,
  values: RankValue[],
): JCRMetadata | undefined {
  if (!metadata) return undefined;
  const value = values.find((entry) => entry.field.toLowerCase() === "sciif");
  return value?.source === metadata.source &&
    parseRankNumber(value.value) === metadata.impactFactor
    ? metadata
    : undefined;
}

/** Cheap render-path read of already validated records; no parsing of JSON. */
export function resolveImpactFactor(
  record: JournalRecord | undefined,
  preferredField: string,
): ResolvedImpactFactor | undefined {
  if (!record) return undefined;
  for (const field of [preferredField, "sciif", "sciif5", "oa2yr"]) {
    const entry = valueOf(record, field);
    if (!entry) continue;
    const value = parseRankNumber(entry.value);
    if (value === undefined) continue;
    const jcr =
      entry.field.toLowerCase() === "sciif" &&
      entry.source === record.jcr?.source &&
      value === record.jcr?.impactFactor
        ? {
            year: record.jcr.year,
            categories: record.jcr.categories,
            ...(record.jcr.provider ? { provider: record.jcr.provider } : {}),
            ...(record.jcr.percentileMethod
              ? { percentileMethod: record.jcr.percentileMethod }
              : {}),
          }
        : undefined;
    return {
      value,
      field: entry.field,
      raw: entry.value,
      source: entry.source,
      ...(jcr ? { jcr } : {}),
    };
  }
  return undefined;
}
