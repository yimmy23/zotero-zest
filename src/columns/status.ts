import { getString } from "../utils/locale";
import {
  STATUS_SLUG,
  effectiveStatus,
  statusLabel,
  statusRank,
} from "../reading/status";
import { openStatusMenu } from "../reading/statusMenu";
import { makeCell, rowItem, isPlainClick, type ColumnSpec } from "./registry";

/**
 * "Status" column — the effective read status (see reading/status.ts).
 *
 * Cell = dot + label. A status the user set is a filled dot; one read from
 * the data (the automatic layer) is a ring in the same colour, with the label
 * in the secondary text colour, so the two are told apart at a glance.
 *
 * Clicking the DOT opens the status picker (reading/statusMenu.ts) for this
 * row — or for the whole selection when the row is part of it. The label is
 * left alone so an ordinary row click keeps selecting. (The same picker sits
 * in the Zest item-pane section, which Zotero also shows in a reader tab's
 * context pane; there is deliberately no control inside the reader itself.)
 *
 * Zotero selects on MOUSEDOWN and re-renders the row synchronously, which
 * would detach the dot before a `click` could fire (verified on 10.0,
 * virtualized-table.js), so plain mousedown/dblclick are swallowed and the
 * action runs on mouseup — the same contract Zotero's own tree twisty uses.
 * Modified clicks (Shift / Cmd / Ctrl / Alt) stay Zotero's selection gesture.
 */

export function statusColumn(): ColumnSpec {
  return {
    key: "status",
    label: getString("column-status"),
    width: 104,
    enabledPref: "extensions.zotero.zest.column.status.enable",
    // Zotero's own last-read stamp lives on the child attachment: parent rows
    // must be recomputed when a child changes
    dependsOnChildren: true,
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const eff = effectiveStatus(item);
      if (!eff.status) return "";
      // rank first so custom labels sort after the built-ins; a set status
      // sorts before a derived one of the same rank
      return `${statusRank(eff.status)}${eff.source === "manual" ? 0 : 1} ${eff.status}`;
    },
    renderCell: (index, data, column, _first, doc) => {
      const m = data ? /^(\d)(\d) ([\s\S]*)$/.exec(data) : null;
      const status = m ? m[3] : "";
      const auto = !!m && m[2] === "1";
      const { cell, textSpan } = makeCell(doc, column, "status");
      const dot = doc.createElement("span");
      dot.className = `zest-status-dot zest-status-${
        STATUS_SLUG[status] || (status ? "custom" : "none")
      }${auto ? " zest-status-auto" : ""}`;
      dot.title =
        status && auto
          ? getString("status-auto-tip", {
              args: { status: statusLabel(status) },
            })
          : getString("status-set-tip");
      for (const t of ["mousedown", "dblclick"]) {
        dot.addEventListener(t, (ev: Event) => {
          if (isPlainClick(ev as unknown as MouseEvent)) ev.stopPropagation();
        });
      }
      dot.addEventListener("mouseup", (ev: Event) => {
        const mouse = ev as MouseEvent;
        if (!isPlainClick(mouse)) return;
        ev.stopPropagation();
        const item = rowItem(doc, index);
        const win = doc.defaultView as Window | null;
        if (!item || !win) return;
        openStatusMenu({
          win,
          items: targetsFor(win, item),
          anchor: dot,
          screenX: mouse.screenX,
          screenY: mouse.screenY,
        });
      });
      cell.insertBefore(dot, textSpan);
      textSpan.textContent = statusLabel(status);
      if (auto) textSpan.classList.add("zest-status-auto-text");
      return cell;
    },
  };
}

/** the clicked row's item — or the whole selection when the row is in it */
function targetsFor(win: Window, item: Zotero.Item): Zotero.Item[] {
  try {
    const selected: Zotero.Item[] =
      (win as any).ZoteroPane?.getSelectedItems?.() ?? [];
    if (selected.length > 1 && selected.some((s) => s.id === item.id)) {
      return selected.filter((s) => s.isRegularItem());
    }
  } catch {
    // fall through to the single item
  }
  return [item];
}
