import { getString } from "../utils/locale";
import {
  READ_STATUSES,
  getReadStatus,
  nextStatus,
  setReadStatus,
  statusRank,
} from "../reading/status";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/**
 * "Status" column — Reading-List-compatible `Read_Status` from Extra.
 * Cell = coloured dot + label. Clicking the DOT (not the row) cycles the
 * status; the label text is left alone so a normal row click never edits.
 */

export const STATUS_SLUG: Record<string, string> = {
  New: "new",
  "To Read": "to-read",
  "In Progress": "in-progress",
  Read: "read",
  "Not Reading": "not-reading",
};

export function statusLabel(status: string): string {
  switch (status) {
    case "New":
      return getString("status-new");
    case "To Read":
      return getString("status-to-read");
    case "In Progress":
      return getString("status-in-progress");
    case "Read":
      return getString("status-read");
    case "Not Reading":
      return getString("status-not-reading");
    default:
      return status;
  }
}

export function statusColumn(): ColumnSpec {
  return {
    key: "status",
    label: getString("column-status"),
    width: 104,
    enabledPref: "extensions.zotero.zest.column.status.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const s = getReadStatus(item);
      if (!s) return "";
      // rank first so custom labels sort after the built-ins
      return `${statusRank(s)} ${s}`;
    },
    renderCell: (index, data, column, _first, doc) => {
      const status = data ? data.replace(/^\d+ /, "") : "";
      const { cell, textSpan } = makeCell(doc, column, "status");
      const dot = doc.createElement("span");
      dot.className = `zest-status-dot zest-status-${STATUS_SLUG[status] || (status ? "custom" : "none")}`;
      dot.title = getString("status-click-tip", {
        args: { next: statusLabel(nextStatus(status)) },
      });
      dot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const item = rowItem(doc, index);
        if (!item || !item.isEditable()) return;
        void setReadStatus(item, nextStatus(getReadStatus(item)));
      });
      cell.insertBefore(dot, textSpan);
      textSpan.textContent = statusLabel(status);
      return cell;
    },
  };
}

export { READ_STATUSES };
