import type { DatasetRow, ParsedDataset } from "./localDataset";
import { normalizeISSN } from "../normalize";
import { parseJCRRank, sanitizeJCRMetadata } from "../impactFactor";

interface SubjectColumns {
  suffix: string;
  category: number;
  quartile: number;
  rank: number;
}

/** Check, but never repair, identifiers supplied by the third-party dataset. */
function validISSN(raw: string): string {
  const normalized = normalizeISSN(raw);
  if (!normalized) return "";
  const digits = normalized.replace("-", "");
  const sum = [...digits].reduce(
    (total, character, index) =>
      total + (character === "X" ? 10 : Number(character)) * (8 - index),
    0,
  );
  return sum % 11 === 0 ? normalized : "";
}

/**
 * A pure adapter for ShowJCR's explicit IF(year)/Category_n schema. No fetching,
 * no filename-based year inference, and no re-ranking rounded impact factors.
 * A null result means unrecognised or ambiguous headers; callers must not
 * report a successful ShowJCR import in that case.
 */
export function parseShowJCRRows(input: string[][]): ParsedDataset | null {
  if (!input.length || input[0].length > 200) return null;
  const header = input[0].map((entry) => entry.trim().replace(/^\uFEFF/, ""));
  const indexes = new Map<string, number>();
  for (let index = 0; index < header.length; index++) {
    const key = header[index].toLowerCase();
    if (key && indexes.has(key)) return null;
    if (key) indexes.set(key, index);
  }
  const journalColumn = indexes.get("journal");
  const issnColumn = indexes.get("issn");
  const eissnColumn = indexes.get("eissn");
  const impactColumns = header.flatMap((entry, index) => {
    const match = /^IF\((\d{4})\)$/i.exec(entry);
    return match ? [{ index, year: Number(match[1]) }] : [];
  });
  if (
    journalColumn === undefined ||
    (issnColumn === undefined && eissnColumn === undefined) ||
    impactColumns.length !== 1
  )
    return null;
  const { year, index: impactColumn } = impactColumns[0];
  if (year < 1975 || year > new Date().getFullYear()) return null;
  const subjects: SubjectColumns[] = [];
  for (let index = 0; index < header.length; index++) {
    const category = /^Category_([1-9]\d*)$/i.exec(header[index]);
    if (category) {
      const suffix = category[1];
      if (Number(suffix) > 50) return null;
      const quartile = indexes.get(`if quartile(${year})_${suffix}`);
      const rank = indexes.get(`if rank(${year})_${suffix}`);
      if (quartile === undefined || rank === undefined) return null;
      subjects.push({ suffix, category: index, quartile, rank });
      continue;
    }
    if (/^Category_/i.test(header[index])) return null;
    const metric = /^IF (?:Quartile|Rank)\((\d{4})\)_([1-9]\d*)$/i.exec(
      header[index],
    );
    if (/^IF (?:Quartile|Rank)/i.test(header[index]) && !metric) return null;
    if (
      metric &&
      (Number(metric[1]) !== year || !indexes.has(`category_${metric[2]}`))
    )
      return null;
  }
  if (!subjects.length || subjects.length > 50) return null;
  subjects.sort((a, b) => Number(a.suffix) - Number(b.suffix));
  const rows: DatasetRow[] = [];
  const identifiers = new Map<string, { fingerprint: string; row: number }>();
  const excluded = new Set<number>();
  const subjectTotals = new Map<string, number>();
  const conflictingSubjects = new Set<string>();
  for (const line of input.slice(1)) {
    if (
      line.length > header.length &&
      line.slice(header.length).some((entry) => entry.trim())
    )
      return null;
    const read = (index: number | undefined) =>
      index === undefined ? "" : (line[index] || "").trim();
    const name = read(journalColumn);
    const ids = [
      ...new Set(
        [validISSN(read(issnColumn)), validISSN(read(eissnColumn))].filter(
          Boolean,
        ),
      ),
    ];
    if (!name && !ids.length) continue;
    const fields: Record<string, string> = {};
    const impact = read(impactColumn);
    if (impact) fields.sciif = impact;
    const numericIF = /^\d+(?:\.\d+)?$/.test(impact)
      ? Number(impact)
      : undefined;
    const quartiles = new Set<string>();
    const categories: Array<{
      name: string;
      percentile?: number;
      quartile?: string;
      rank: string;
    }> = [];
    let invalid = false;
    for (const subject of subjects) {
      const category = read(subject.category);
      const quartile = read(subject.quartile).toUpperCase();
      const rank = read(subject.rank);
      // Retain every source category/Q/rank even when no graph can be drawn.
      for (const index of [subject.category, subject.quartile, subject.rank]) {
        const raw = read(index);
        if (raw) fields[header[index]] = raw;
      }
      if (!category) {
        if (quartile || rank) invalid = true;
        continue;
      }
      if (/^Q[1-4]$/.test(quartile)) quartiles.add(quartile);
      const position = parseJCRRank(rank);
      if (position) {
        const key = category.normalize("NFKC").toLowerCase();
        const total = subjectTotals.get(key);
        if (total !== undefined && total !== position.total)
          conflictingSubjects.add(key);
        else subjectTotals.set(key, position.total);
      }
      if (!position || !/^Q[1-4]$/.test(quartile)) invalid = true;
      categories.push({
        name: category,
        percentile: position?.percentile,
        quartile,
        rank,
      });
    }
    if (quartiles.size) fields.sci = [...quartiles].join(" / ");
    const jcr =
      !invalid && numericIF !== undefined && Number.isFinite(numericIF)
        ? sanitizeJCRMetadata({
            year,
            impactFactor: numericIF,
            source: "dataset",
            provider: "showjcr",
            percentileMethod: "rank",
            categories,
          })
        : undefined;
    const row: DatasetRow = {
      ...(name ? { name } : {}),
      ...(ids.length ? { issn: ids.join(", ") } : {}),
      fields,
      ...(jcr ? { jcr } : {}),
    };
    const rowIndex = rows.length;
    rows.push(row);
    const fingerprint = JSON.stringify(row);
    for (const id of ids) {
      const previous = identifiers.get(id);
      if (!previous) identifiers.set(id, { fingerprint, row: rowIndex });
      else if (previous.fingerprint === fingerprint) excluded.add(rowIndex);
      else {
        // Identifier conflicts are not resolved by first-row or highest-IF wins.
        excluded.add(previous.row);
        excluded.add(rowIndex);
      }
    }
  }
  const accepted = rows.filter((_row, index) => !excluded.has(index));
  // A same-year subject must have one denominator. Disable the whole journal's
  // graph when any subject conflicts, so the remaining subjects cannot look
  // like a complete range. Its IF/Q and all original category fields survive.
  for (const row of accepted) {
    if (
      row.jcr?.categories.some((category) =>
        conflictingSubjects.has(category.name.normalize("NFKC").toLowerCase()),
      )
    )
      delete row.jcr;
  }
  const fields = [
    ...new Set(accepted.flatMap((row) => Object.keys(row.fields))),
  ];
  return { name: `ShowJCR ${year}`, rows: accepted, fields };
}
