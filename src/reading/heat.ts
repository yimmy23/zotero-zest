import type { ItemReading } from "./store";
import { HEAT_COLOR_DEFAULT, HEAT_LEVELS } from "../ui/palette";

/**
 * Per-page reading heat → CSS gradient (used as cell/title background).
 *
 * Intensity (kept from zotero-style so numbers mean the same thing):
 * t_i = time_i / max(60 s, mean + (max - mean) / 2), clamped to [0, 1].
 *
 * Rendering follows the GitHub / Codex contribution graph: t is quantised to
 * four discrete steps (HEAT_LEVELS) instead of a smooth ramp, so "read a
 * little" and "read a lot" are told apart at a glance in a 90 px column.
 * Alpha compositing (rather than opaque shades) keeps the strip correct over
 * selected/hovered rows and in dark mode. Pages are bucketed to ≤ MAX_BUCKETS
 * segments so a 600-page book does not produce a 600-stop gradient, and runs
 * of equal level are merged.
 */

const MAX_BUCKETS = 160;

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function heatAlphas(rec: ItemReading, buckets = MAX_BUCKETS): number[] {
  let maxIdx = -1;
  for (const i of rec.page.keys()) if (i > maxIdx) maxIdx = i;
  const pages = Math.max(rec.pages || 0, maxIdx + 1);
  if (pages <= 0 || !rec.page.size) return [];
  const n = Math.min(pages, buckets);
  const per = pages / n;
  const sums = new Array<number>(n).fill(0);
  let max = 0;
  let total = 0;
  let count = 0;
  for (const [i, s] of rec.page) {
    if (i < 0 || i >= pages) continue;
    const b = Math.min(n - 1, Math.floor(i / per));
    sums[b] += s;
    total += s;
    count++;
    if (s > max) max = s;
  }
  if (!count) return [];
  const mean = total / count;
  const norm = Math.max(60, mean + (max - mean) / 2) * (pages > n ? per : 1);
  return sums.map((s) => Math.min(1, s / norm));
}

/** continuous intensity → GitHub-style step (0 = untouched, 1..4) */
export function heatLevel(t: number): number {
  if (t <= 0.005) return 0;
  return Math.min(
    HEAT_LEVELS.length,
    Math.max(1, Math.ceil(t * HEAT_LEVELS.length)),
  );
}

export function heatGradient(
  rec: ItemReading,
  color: string,
  opacity: number,
): string {
  const rgb = hexToRgb(color) || hexToRgb(HEAT_COLOR_DEFAULT)!;
  const alphas = heatAlphas(rec);
  if (!alphas.length) return "";
  const n = alphas.length;
  const levels = alphas.map(heatLevel);
  const stops: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || levels[i] !== levels[runStart]) {
      const lvl = levels[runStart];
      const a = lvl ? HEAT_LEVELS[lvl - 1] * opacity : 0;
      const s = ((runStart / n) * 100).toFixed(2);
      const e = ((i / n) * 100).toFixed(2);
      stops.push(
        a <= 0.005
          ? `transparent ${s}% ${e}%`
          : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)}) ${s}% ${e}%`,
      );
      runStart = i;
    }
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** cached per record: invalidated by the store on every update */
export function cachedHeat(
  rec: ItemReading,
  color: string,
  opacity: number,
): string {
  const key = `${color}|${opacity}`;
  if (rec._heat !== undefined && rec._heatKey === key) return rec._heat;
  rec._heat = heatGradient(rec, color, opacity);
  rec._heatKey = key;
  return rec._heat;
}
