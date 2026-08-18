import { getPref } from "../utils/prefs";

/**
 * Turning a rank VALUE ("1区", "Q2", "58.7") into a 1–5 grade and a colour.
 *
 * Thresholds and colours keep the original plugin's defaults so a migrating
 * user sees the same picture, with three deliberate fixes:
 *   - unknown shapes fall through to "no rank" instead of throwing
 *     (`rankColors[NaN]` used to blank the whole cell);
 *   - a value that IS "A" is no longer treated as "not found" (the original
 *     used `["A","B","C","D"].indexOf(v)` as a truthiness test, so grade A
 *     silently lost its colour);
 *   - grades are recognised case-insensitively and with full-width digits.
 */

export const DEFAULT_RANK_COLORS = [
  "#EE0000",
  "#2F998C",
  "#D2A500",
  "#DA6D00",
  "#007BF6",
];

/** colour-vision-friendly alternative: one hue, five lightness steps */
export const CVD_RANK_COLORS = [
  "#08306B",
  "#2171B5",
  "#4292C6",
  "#6BAED6",
  "#9ECAE1",
];

export const DEFAULT_RANK_COLOR = "#86DAD1";

/** numeric thresholds, highest first → rank 1..n */
const THRESHOLDS: Record<string, number[]> = {
  sciif: [10, 4, 2, 1, 0],
  sciif5: [10, 4, 2, 1, 0],
  oa2yr: [10, 4, 2, 1, 0],
  jci: [3, 1, 0.5, 0],
};

export function rankColors(): string[] {
  const raw = String(getPref("rank.colors") || "").trim();
  const list = raw
    ? raw
        .split(/[,，;；]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return list.length ? list : DEFAULT_RANK_COLORS;
}

export function colorForRank(rank: number | undefined): string {
  if (!rank || rank < 1) return defaultRankColor();
  const colors = rankColors();
  return colors[Math.min(rank, colors.length) - 1] || defaultRankColor();
}

export function defaultRankColor(): string {
  return String(getPref("rank.defaultColor") || "") || DEFAULT_RANK_COLOR;
}

const FULLWIDTH_DIGITS = /[０-９．]/g;

function toNumber(value: string): number {
  const half = value.replace(FULLWIDTH_DIGITS, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  return Number(half.replace(/[^\d.]/g, ""));
}

/**
 * Grade of a value. `field` picks a numeric threshold table when one exists;
 * otherwise the value's own shape decides (Q1, 1区, T1, A+, 一类…).
 */
export function inferRank(field: string, value: string): number | undefined {
  const v = String(value ?? "").trim();
  if (!v) return undefined;

  const thresholds = THRESHOLDS[field.toLowerCase()];
  if (thresholds) {
    const n = toNumber(v);
    if (!Number.isFinite(n)) return undefined;
    for (let i = 0; i < thresholds.length; i++) {
      if (n >= thresholds[i]) return i + 1;
    }
    return undefined;
  }

  let m: RegExpMatchArray | null;
  if ((m = v.match(/^Q\s*([1-4])$/i))) return Number(m[1]);
  if ((m = v.match(/([1-5])\s*区/))) return Number(m[1]);
  if ((m = v.match(/^T\s*([1-5])$/i))) return Number(m[1]);
  if ((m = v.match(/^([1-5])\s*类$/))) return Number(m[1]);
  if (/^[一二三四五]\s*[区类]$/.test(v)) {
    const idx = "一二三四五".indexOf(v[0]);
    return idx >= 0 ? idx + 1 : undefined;
  }
  if ((m = v.match(/^(A\+\+|A\+|A-|A|B\+|B-|B|C\+|C|D|E)$/i))) {
    const order = [
      "a++",
      "a+",
      "a",
      "a-",
      "b+",
      "b",
      "b-",
      "c+",
      "c",
      "d",
      "e",
    ];
    const i = order.indexOf(m[1].toLowerCase());
    if (i < 0) return undefined;
    return Math.min(5, Math.floor(i / 2) + 1);
  }
  // A bare number only gets a grade when the FIELD is impact-factor-like.
  // Ranking every number by IF thresholds would paint an h-index of 1851 as
  // "top tier", which is meaningless.
  if (/(^|[^a-z])(if|impact|factor|因子)/i.test(field)) {
    const n = toNumber(v);
    if (Number.isFinite(n) && /^[\d.]/.test(v)) {
      const t = THRESHOLDS.sciif;
      for (let i = 0; i < t.length; i++) if (n >= t[i]) return i + 1;
    }
  }
  return undefined;
}

/**
 * Sort key for a value: rank first (missing ALWAYS last, the original sorted
 * them first), then the numeric value descending inside the same rank.
 */
export function sortKeyFor(field: string, value: string): string {
  const rank = inferRank(field, value);
  const n = toNumber(value);
  const rankPart = String(rank ?? 9);
  const numPart = Number.isFinite(n)
    ? String(Math.max(0, 999999 - Math.round(n * 100))).padStart(7, "0")
    : "9999999";
  return `${rankPart}${numPart}`;
}

/** the fields the user wants to see, in their order */
export function displayFields(): string[] {
  const raw = String(getPref("rank.fields") || "").trim();
  const list = (raw || "sciUp, sciif, sci")
    .split(/[,，;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list;
}

/** sort spec: ["sci", "-sciif"] → by sci asc, then sciif desc */
export function sortFields(): Array<{ field: string; desc: boolean }> {
  const raw = String(getPref("rank.sortBy") || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,，;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith("-")
        ? { field: s.slice(1), desc: true }
        : { field: s, desc: false },
    );
}
