import { getPref, getNumPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { hexToRgb } from "../reading/heat";
import { readableTextColor } from "../ui/color";
import { requestJournalRecord, getJournalRecord, displayValues } from "../rank";
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
 * Three journal columns backed by the same cached record:
 *   pubtags  rank badges ("1区", "Q1", "A") coloured by grade
 *   if       impact factor, as a number and an optional bar
 *   venue    the journal/venue name, from whichever field the item type uses
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
 */
function emptyJournalCell(cell: HTMLElement): HTMLElement {
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
      if (!data) return emptyJournalCell(cell);
      const item = rowItem(doc, index);
      const rec = item ? getJournalRecord(item) : undefined;
      const shown = shownValues(rec);
      if (!shown.length) return emptyJournalCell(cell);
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
      if (!data) return emptyJournalCell(cell);
      const item = rowItem(doc, index);
      const rec = item ? getJournalRecord(item) : undefined;
      const field = String(getPref("if.field") || "sciif");
      const n = numberOf(rec, [field, "sciif", "sciif5", "oa2yr"]);
      if (n === undefined) return emptyJournalCell(cell);
      const max = Math.max(1, getNumPref("if.max", 15));
      if (getPref("if.progress")) {
        const track = doc.createElement("span");
        track.className = "zest-if-track";
        const bar = doc.createElement("span");
        bar.className = "zest-if-bar";
        bar.style.width = `${Math.min(100, (n / max) * 100).toFixed(1)}%`;
        const color = String(getPref("if.color") || "");
        if (color) bar.style.backgroundColor = color;
        track.appendChild(bar);
        cell.insertBefore(track, textSpan);
      }
      if (getPref("if.info")) {
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
