import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { parseTagRule } from "../tags/match";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/** tags the #Tags column shows are not repeated here (original: skip "#…") */
function claimedByTextTags(tag: string): boolean {
  if (!getPref("column.textTags.enable")) return false;
  return parseTagRule(getPref("textTags.match") as string).test(tag) !== null;
}

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
      const tags = ((item as any).getItemsListTags?.() || []).filter(
        (t: any) => !claimedByTextTags(t.tag),
      );
      // sort key: coloured tags first in palette order (getItemsListTags
      // already applies Zotero.Tags.compareTagsOrder), then names
      return tags.map((t: any) => t.tag).join("\u0001");
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "tags");
      if (!data) return cell;
      const item = rowItem(doc, index);
      const list: Array<{ tag: string; color: string | null }> = (
        item
          ? (item as any).getItemsListTags?.() || []
          : data.split("\u0001").map((tag) => ({ tag, color: null }))
      ).filter((t: any) => !claimedByTextTags(t.tag));
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
