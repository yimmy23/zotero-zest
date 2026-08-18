import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { citationOf, isStale } from "../cite";
import { makeCell, numKey, rowItem, type ColumnSpec } from "./registry";

/**
 * "Citations" column — reads the count straight out of Extra, so it is exact,
 * synced, and needs no cache. Stale counts (older than the threshold) are
 * shown dimmed rather than hidden: an old number is still information.
 */
export function citationsColumn(): ColumnSpec {
  return {
    key: "citations",
    label: getString("column-citations"),
    width: 80,
    enabledPref: `extensions.zotero.${config.addonRef}.column.citations.enable`,
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const info = citationOf(item);
      return info ? numKey(info.count) : "";
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "citations");
      if (!data) return cell;
      const item = rowItem(doc, index);
      const info = item ? citationOf(item) : undefined;
      if (!info) return cell;
      textSpan.textContent = String(info.count);
      if (item && isStale(item)) textSpan.classList.add("zest-stale");
      cell.title = getString("citations-cell-tip", {
        args: {
          count: info.count,
          source: info.source || "?",
          date: info.date || "—",
        },
      });
      return cell;
    },
  };
}
