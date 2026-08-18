import { getString } from "../utils/locale";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/**
 * "Tags" column — the coloured / emoji tags Zotero would show in front of
 * the title, in their own column. Reuses Zotero's own swatch markup
 * (`span.tag-swatch.colored[data-color]` → theme-aware palette via
 * zotero.css; `span.tag-swatch.emoji`) so it looks exactly native.
 */

export function tagsColumn(): ColumnSpec {
  return {
    key: "tags",
    label: getString("column-tags"),
    width: 70,
    enabledPref: "extensions.zotero.zest.column.tags.enable",
    dataProvider: (item) => {
      const tags = (item as any).getItemsListTags?.() || [];
      // sort key: coloured tags first in palette order (getItemsListTags
      // already applies Zotero.Tags.compareTagsOrder), then names
      return tags.map((t: any) => t.tag).join("");
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "tags");
      if (!data) return cell;
      const item = rowItem(doc, index);
      const list: Array<{ tag: string; color: string | null }> = item
        ? (item as any).getItemsListTags?.() || []
        : data.split("").map((tag) => ({ tag, color: null }));
      const names: string[] = [];
      for (const t of list) {
        const swatch = doc.createElement("span");
        swatch.className = "tag-swatch";
        const emoji = (Zotero.Tags as any).extractEmojiForItemsList?.(t.tag);
        if (emoji) {
          swatch.textContent = emoji;
          swatch.classList.add("emoji");
        } else if (t.color) {
          swatch.classList.add("colored");
          swatch.dataset.color = t.color.toLowerCase();
          swatch.style.color = t.color;
        } else {
          continue;
        }
        swatch.title = t.tag;
        names.push(t.tag);
        cell.insertBefore(swatch, textSpan);
      }
      textSpan.textContent = names.join(", ");
      textSpan.classList.add("zest-visually-hidden");
      return cell;
    },
  };
}
