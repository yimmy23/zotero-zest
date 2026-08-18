import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getExtraLine, setExtraLine } from "../utils/extra";
import { guard } from "../utils/guard";
import { makeCell, rowItem, isPlainClick, type ColumnSpec } from "./registry";

export const REMARK_KEYS = ["Remark", "remark", "简记"];

/** a remark lives in Extra, so it needs a regular item the user may write to */
function canEditRemark(item: Zotero.Item | null): boolean {
  return !!item && item.isRegularItem() && item.isEditable();
}

export function remarkOf(item: Zotero.Item): string {
  return getExtraLine(item, REMARK_KEYS)?.value || "";
}

export async function setRemark(item: Zotero.Item, text: string) {
  await setExtraLine(item, REMARK_KEYS, text.trim() || null);
}

/**
 * "Remark" — a one-line note you actually see in the list.
 *
 * It lives in Extra (`Remark: …`), so it syncs and survives this plugin. A
 * double-click opens a prompt rather than an inline editor: the item tree
 * recycles row nodes as you scroll, and an input living inside a recycled cell
 * loses focus (and sometimes its content) mid-typing.
 */
export function remarkColumn(): ColumnSpec {
  return {
    key: "remark",
    label: getString("column-remark"),
    width: 160,
    enabledPref: `extensions.zotero.${config.addonRef}.column.remark.enable`,
    dataProvider: (item) => (item.isRegularItem() ? remarkOf(item) : ""),
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "remark");
      textSpan.textContent = data || "";
      // notes, attachments and read-only rows have no remark to edit, so they
      // keep Zotero's own double-click (open the item) and are not advertised
      // as editable
      const editable = canEditRemark(rowItem(doc, index));
      cell.title = editable
        ? data
          ? `${data}\n\n${getString("remark-tip")}`
          : getString("remark-tip")
        : data || "";
      cell.addEventListener(
        "dblclick",
        guard("remark edit", (ev: Event) => {
          if (!isPlainClick(ev as unknown as MouseEvent)) return;
          const item = rowItem(doc, index);
          if (!canEditRemark(item) || !item) return;
          ev.stopPropagation();
          ev.preventDefault();
          const win = doc.defaultView as any;
          const out = { value: remarkOf(item) };
          const ok = Services.prompt.prompt(
            win,
            getString("column-remark"),
            getString("remark-prompt"),
            out,
            null as any,
            { value: false },
          );
          if (ok) void setRemark(item, out.value);
        }),
      );
      return cell;
    },
  };
}
