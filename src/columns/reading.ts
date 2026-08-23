import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { readingStore, formatDuration, pagesSeen } from "../reading/store";
import { cachedHeat } from "../reading/heat";
import { makeCell, numKey, rowItem, type ColumnSpec } from "./registry";
import { isTrackedItem } from "../utils/items";
import { HEAT_COLOR_DEFAULT, HEAT_OPACITY_DEFAULT } from "../ui/palette";

/**
 * "Reading" column: total time read (sortable) over a per-page heat strip.
 * dataProvider is O(1) against the in-memory store; renderCell paints a
 * cached CSS gradient.
 */

export function heatColor(): string {
  return (getPref("heat.color") as string) || HEAT_COLOR_DEFAULT;
}
export function heatOpacity(): number {
  const v = Number(getPref("heat.opacity"));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : HEAT_OPACITY_DEFAULT;
}

export function readingColumn(): ColumnSpec {
  return {
    key: "reading",
    label: getString("column-reading"),
    width: 90,
    enabledPref: "extensions.zotero.zest.column.reading.enable",
    dataProvider: (item) => {
      if (!isTrackedItem(item)) return "";
      const rec = readingStore.getForItem(item);
      return rec ? numKey(rec.total) : "";
    },
    renderCell: (index, data, column, _first, doc) => {
      const seconds = data ? Number(data) : 0;
      const { cell, textSpan } = makeCell(doc, column, "reading");
      if (seconds > 0) {
        textSpan.textContent = formatDuration(seconds);
        const item = rowItem(doc, index);
        const rec = item && readingStore.getForItem(item);
        if (rec) {
          const bg = cachedHeat(rec, heatColor(), heatOpacity());
          if (bg) {
            const strip = doc.createElement("span");
            strip.className = "zest-heat";
            strip.style.backgroundImage = bg;
            cell.insertBefore(strip, textSpan);
          }
          const pages = rec.pages ? ` / ${rec.pages}` : "";
          cell.title = getString("reading-cell-tip", {
            args: {
              time: formatDuration(rec.total),
              read: pagesSeen(rec, 1),
              pages,
            },
          });
        }
      }
      return cell;
    },
  };
}
