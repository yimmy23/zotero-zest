import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { hexToRgb } from "../reading/heat";
import { setSemanticBadge } from "../ui/color";
import {
  requestJournalRecord,
  getJournalRecord,
  displayValuesForUI,
  journalKeyOf,
} from "../rank";
import {
  colorForRank,
  displayFields,
  sortFields,
  sortKeyFor,
  defaultRankColor,
} from "../rank/rank";
import { valueOf } from "../rank/types";
import { resolveImpactFactor } from "../rank/impactFactor";
import { rankFieldsForDisplay, rankValueDisplay } from "../rank/display";
import { venueOf } from "../rank/normalize";
import { makeCell, numKey, rowItem, type ColumnSpec } from "./registry";

/**
 * Three journal columns, two of them backed by the same cached record:
 *   pubtags  rank badges ("1区", "Q1", "A") coloured by grade
 *   if       impact factor, above a verified JCR percentile marker
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
 *   1. the fields the user configured (default XinRui/CAS -> JCR -> IF;
 *      English keeps JCR first)
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
  const shown = displayValuesForUI(
    rec,
    rankFieldsForDisplay(displayFields(), rec),
  );
  if (shown.length) return shown;
  const fallback = displayValuesForUI(rec, FALLBACK_FIELDS);
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
  const description = getPref("rank.autoFetch")
    ? getString("rank-empty-tip")
    : getString("rank-offline-tip");
  cell.setAttribute("aria-label", description);
  if (!cell.classList.contains("zest-if")) cell.title = description;
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
            // "~" (0x7E) sorts after every digit, so a missing field lands
            // behind even present-but-unparsable values ("99999999")
            if (!v) return "~9999999";
            const key = sortKeyFor(v.field, v.value);
            return desc ? invert(key) : key;
          })
          .join(".");
      }
      return shown.map((v) => sortKeyFor(v.sourceField, v.value)).join(".");
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
      const alpha = badgeOpacity();
      const textPref = String(getPref("rank.textColor") || "auto");
      for (const v of shown) {
        const display = rankValueDisplay(v, v.sourceField, v.customized);
        const badge = doc.createElement("span");
        badge.className = "zest-badge zest-rank-badge";
        badge.textContent = display.text;
        badge.title = getString("rank-badge-tip", {
          args: {
            field: v.field,
            value: display.description,
            source: v.source,
          },
        });
        const color = v.rank ? colorForRank(v.rank) : defaultRankColor();
        const rgb = hexToRgb(color);
        if (rgb) {
          if (textPref === "auto") {
            setSemanticBadge(badge, rgb, alpha);
          } else {
            badge.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
            badge.style.color = textPref;
          }
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
      const metric = resolveImpactFactor(rec, field);
      // keepZero: OpenAlex legitimately reports 0.00 for tiny venues
      return metric ? numKey(Math.round(metric.value * 1000), 8, true) : "";
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "if");
      const item = rowItem(doc, index);
      if (!data) return emptyJournalCell(cell, item);
      const rec = item ? getJournalRecord(item) : undefined;
      const field = String(getPref("if.field") || "sciif");
      const metric = resolveImpactFactor(rec, field);
      if (!metric) return emptyJournalCell(cell, item);
      const n = metric.value;
      // The number remains legible even with legacy if.info=false. Graphs
      // convey the verified within-category percentile, never IF magnitude.
      textSpan.textContent = n >= 100 ? n.toFixed(0) : n.toFixed(1);
      const tooltip = [
        getString("if-cell-tip", {
          args: {
            field: metric.field,
            value: metric.raw,
            source: metric.source,
          },
        }),
      ];
      const jcr = metric.jcr;
      if (jcr) {
        if (jcr.provider === "showjcr" && jcr.percentileMethod === "rank")
          tooltip.push(getString("if-jcr-showjcr-derived"));
        for (const category of jcr.categories) {
          tooltip.push(
            getString("if-jcr-detail", {
              args: {
                year: String(jcr.year),
                category: category.quartile
                  ? `${category.name} · ${category.quartile}`
                  : category.name,
                percentile: Number(category.percentile.toFixed(1)),
                rank: category.rank || "—",
              },
            }),
          );
        }
        // Historic heat/bar preferences migrate at read time. The number-only
        // option stays explicit; no preference or journal data is rewritten.
        if (getPref("if.style") !== "none") {
          cell.classList.add("zest-if-with-percentile");
          const graph = doc.createElement("span");
          graph.className = "zest-if-percentile";
          graph.setAttribute("aria-hidden", "true");
          const percentiles = jcr.categories.map((entry) => entry.percentile);
          const lower = Math.min(...percentiles);
          const upper = Math.max(...percentiles);
          const multiple = jcr.categories.length > 1;
          if (multiple) {
            graph.classList.add("zest-if-multiple");
            const range = doc.createElement("span");
            range.className = "zest-if-range";
            range.style.left = `${lower}%`;
            range.style.width = `${upper - lower}%`;
            graph.appendChild(range);
          }
          for (const percentile of lower === upper ? [lower] : [lower, upper]) {
            const point = doc.createElement("span");
            point.className = "zest-if-point";
            point.style.left = `${percentile}%`;
            // Multiple categories have no single rank; keep their whole range
            // neutral instead of promoting the most flattering percentile.
            if (!multiple && percentile >= 90) {
              point.classList.add("zest-if-top");
            }
            graph.appendChild(point);
          }
          cell.appendChild(graph);
        }
      } else {
        tooltip.push(
          getString(
            metric.field.toLowerCase() === "sciif"
              ? "if-percentile-missing"
              : "if-percentile-not-applicable",
          ),
        );
      }
      // Details are visible in the Zest side pane; keep the full description
      // for assistive technology without creating a hover popup.
      cell.setAttribute("aria-label", tooltip.join("\n"));
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
