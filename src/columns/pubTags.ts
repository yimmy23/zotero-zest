import { getPref, getNumPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { hexToRgb } from "../reading/heat";
import { readableTextColor } from "../ui/color";
import { HEAT_LEVELS } from "../ui/palette";
import { accentColor } from "../ui/styles";
import {
  requestJournalRecord,
  getJournalRecord,
  displayValues,
  journalKeyOf,
} from "../rank";
import {
  colorForRank,
  displayFields,
  sortFields,
  sortKeyFor,
  defaultRankColor,
} from "../rank/rank";
import { valueOf, numberOf } from "../rank/types";
import { venueOf } from "../rank/normalize";
import { makeCell, numKey, rowItem, type ColumnSpec } from "./registry";

/**
 * Three journal columns, two of them backed by the same cached record:
 *   pubtags  rank badges ("1区", "Q1", "A") coloured by grade
 *   if       impact factor, as a number over a heat wash (or a bar)
 *   venue    ONE venue column across item types — publication title for
 *            articles, proceedings / conference for papers, book title for
 *            chapters, publisher / university for books and theses. Zotero's
 *            own Publication column shows publicationTitle only, so a mixed
 *            library needs three native columns for what this shows in one.
 *
 * dataProvider is O(1) against the in-memory cache; a miss queues a background
 * lookup (see rank/index.ts) and repaints the row when the answer arrives, so
 * sorting a 5000-item library never blocks on the network.
 */

/**
 * Fallback chain for the badges:
 *   1. the fields the user configured (default `sciUp, sciif, sci`)
 *   2. the common Chinese indexes — a domestic journal has none of the JCR
 *      fields, so the column would otherwise be empty for exactly the
 *      libraries that care most about it
 *   3. OpenAlex's citation average, for users with no easyScholar key
 */
const FALLBACK_FIELDS = [
  "cscd",
  "pku",
  "cssci",
  "zhongguokejihexin",
  "ncsti",
  "oa2yr",
];

function shownValues(rec: ReturnType<typeof getJournalRecord>) {
  const shown = displayValues(rec, displayFields());
  if (shown.length) return shown;
  const fallback = displayValues(rec, FALLBACK_FIELDS);
  return fallback.slice(0, 2);
}

function badgeOpacity(): number {
  const v = Number(getPref("rank.opacity"));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.15;
}

/**
 * An empty journal cell is ambiguous: no data yet, no data at all, or Zest is
 * simply not allowed online (`rank.autoFetch` ships off, so on a fresh install
 * the whole column is blank and looks broken). Say which, in the tooltip.
 *
 * Only for rows that HAVE a journal, though. Attachments, notes, and regular
 * items with no venue/ISSN/DOI (books, theses, films) are empty because there
 * is nothing to look up — telling their owner to switch lookups on would send
 * them after a setting that cannot help.
 */
function emptyJournalCell(
  cell: HTMLElement,
  item: Zotero.Item | null,
): HTMLElement {
  if (!item?.isRegularItem()) return cell;
  // the same identity test `requestJournalRecord` queues on — a DOI alone is
  // NOT enough there, so promising a lookup for a DOI-only item would send the
  // reader after a switch that cannot fill this cell
  const id = journalKeyOf(item);
  if (!id.key && !id.issn) return cell;
  cell.title = getPref("rank.autoFetch")
    ? getString("rank-empty-tip")
    : getString("rank-offline-tip");
  return cell;
}

export function publicationTagsColumn(): ColumnSpec {
  return {
    key: "pubtags",
    label: getString("column-pubtags"),
    width: 120,
    enabledPref: "extensions.zotero.zest.column.pubtags.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const rec = requestJournalRecord(item);
      if (!rec) return "";
      const shown = shownValues(rec);
      if (!shown.length) return "";
      // sort key: the user's Sort By spec, else the displayed order; missing
      // values always sort LAST (the original sorted them first)
      const spec = sortFields();
      if (spec.length) {
        return spec
          .map(({ field, desc }) => {
            const v = valueOf(rec, field);
            if (!v) return "9'9999999";
            const key = sortKeyFor(v.field, v.value);
            return desc ? invert(key) : key;
          })
          .join(".");
      }
      return shown.map((v) => sortKeyFor(v.field, v.value)).join(".");
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "pubtags");
      const item = rowItem(doc, index);
      if (!data) return emptyJournalCell(cell, item);
      const rec = item ? getJournalRecord(item) : undefined;
      const shown = shownValues(rec);
      if (!shown.length) return emptyJournalCell(cell, item);
      const wrap = doc.createElement("span");
      wrap.className = "zest-badges";
      const dark = !!doc.defaultView?.matchMedia?.(
        "(prefers-color-scheme: dark)",
      )?.matches;
      const alpha = badgeOpacity();
      const textPref = String(getPref("rank.textColor") || "auto");
      for (const v of shown) {
        const badge = doc.createElement("span");
        badge.className = "zest-badge zest-rank-badge";
        badge.textContent = v.value;
        badge.title = `${v.field}: ${v.value} · ${v.source}`;
        const color = v.rank ? colorForRank(v.rank) : defaultRankColor();
        const rgb = hexToRgb(color);
        if (rgb) {
          badge.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
          badge.style.color =
            textPref === "auto" ? readableTextColor(rgb, dark) : textPref;
        }
        wrap.appendChild(badge);
      }
      cell.insertBefore(wrap, textSpan);
      return cell;
    },
  };
}

/** the wash never goes fully opaque: the row (selection, hover) shows through */
const IF_HEAT_OPACITY = 0.7;

/** 0 = below the ladder, 1..4 = max/15, max/5, max/2, max */
export function ifLevel(n: number, max: number): number {
  if (n >= max) return 4;
  if (n >= max / 2) return 3;
  if (n >= max / 5) return 2;
  if (n >= max / 15) return 1;
  return 0;
}

/** flip a numeric sort key so "descending" works inside one string key */
function invert(key: string): string {
  let out = "";
  for (const c of key) {
    const n = Number(c);
    out += Number.isFinite(n) ? String(9 - n) : c;
  }
  return out;
}

export function impactFactorColumn(): ColumnSpec {
  return {
    key: "if",
    label: getString("column-if"),
    width: 80,
    enabledPref: "extensions.zotero.zest.column.if.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const rec = requestJournalRecord(item);
      const field = String(getPref("if.field") || "sciif");
      const n = numberOf(rec, [field, "sciif", "sciif5", "oa2yr"]);
      return n === undefined ? "" : numKey(Math.round(n * 1000));
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "if");
      const item = rowItem(doc, index);
      if (!data) return emptyJournalCell(cell, item);
      const rec = item ? getJournalRecord(item) : undefined;
      const field = String(getPref("if.field") || "sciif");
      const n = numberOf(rec, [field, "sciif", "sciif5", "oa2yr"]);
      if (n === undefined) return emptyJournalCell(cell, item);
      const max = Math.max(1, getNumPref("if.max", 15));
      const style = String(getPref("if.style") || "heat");
      const color = String(getPref("if.color") || "");
      if (style === "heat") {
        // one hue, light → dark: the same four GitHub-style steps as the
        // reading heat, on a log-ish ladder (max/15, max/5, max/2, max) so the
        // heavy tail of impact factors does not saturate at the top like a
        // linear bar does. The number stays in the text colour; only the wash
        // behind it carries the magnitude.
        const level = ifLevel(n, max);
        if (level) {
          const wash = doc.createElement("span");
          wash.className = "zest-if-heat";
          const rgb = hexToRgb(color || accentColor());
          if (rgb) {
            const alpha = HEAT_LEVELS[level - 1] * IF_HEAT_OPACITY;
            wash.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
          }
          cell.insertBefore(wash, textSpan);
        }
      } else if (style === "bar") {
        const track = doc.createElement("span");
        track.className = "zest-if-track";
        const bar = doc.createElement("span");
        bar.className = "zest-if-bar";
        bar.style.width = `${Math.min(100, (n / max) * 100).toFixed(1)}%`;
        if (color) bar.style.backgroundColor = color;
        track.appendChild(bar);
        cell.insertBefore(track, textSpan);
      }
      if (getPref("if.info") || style === "none") {
        textSpan.textContent = n >= 100 ? n.toFixed(0) : n.toFixed(1);
      }
      const src = valueOf(rec, field) || valueOf(rec, "oa2yr");
      cell.title = src
        ? getString("if-cell-tip", {
            args: { field: src.field, value: src.value, source: src.source },
          })
        : "";
      return cell;
    },
  };
}

export function venueColumn(): ColumnSpec {
  return {
    key: "venue",
    label: getString("column-venue"),
    width: 140,
    enabledPref: "extensions.zotero.zest.column.venue.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      return venueOf(item);
    },
    renderCell: (_index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "venue");
      textSpan.textContent = data || "";
      if (data) cell.title = data;
      return cell;
    },
  };
}
