import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { parseTagRule } from "../tags/match";
import { hexToRgb } from "../reading/heat";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/**
 * "#Tags" column — tags selected by the match rule, rendered as text badges.
 * Badge colour = the tag's Zotero colour when it has one, else the default
 * badge colour pref. (Phase C adds per-prefix rules / emoji.)
 */

export interface TextTag {
  tag: string;
  text: string;
  color: string;
}

export function textTagsOf(item: Zotero.Item): TextTag[] {
  const matcher = parseTagRule(getPref("textTags.match") as string);
  const colors = Zotero.Tags.getColors(item.libraryID) as Map<
    string,
    { color: string; position: number }
  >;
  const dflt = (getPref("textTags.color") as string) || "#8e44ad";
  const out: TextTag[] = [];
  let tags: Array<{ tag: string }>;
  try {
    tags = item.getTags();
  } catch {
    return out;
  }
  for (const t of tags) {
    const text = matcher.test(t.tag);
    if (text === null) continue;
    out.push({ tag: t.tag, text, color: colors.get(t.tag)?.color || dflt });
  }
  // coloured (Zotero position order) first, then alphabetically
  out.sort((a, b) => {
    const pa = colors.get(a.tag)?.position ?? 99;
    const pb = colors.get(b.tag)?.position ?? 99;
    if (pa !== pb) return pa - pb;
    return a.text.localeCompare(b.text);
  });
  return out;
}

export function textTagsColumn(): ColumnSpec {
  return {
    key: "texttags",
    label: getString("column-texttags"),
    width: 120,
    enabledPref: "extensions.zotero.zest.column.textTags.enable",
    dataProvider: (item) =>
      textTagsOf(item)
        .map((t) => t.text)
        .join(", "),
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "texttags");
      if (!data) return cell;
      const item = rowItem(doc, index);
      const list = item ? textTagsOf(item) : [];
      if (!list.length) {
        textSpan.textContent = data;
        return cell;
      }
      const wrap = doc.createElement("span");
      wrap.className = "zest-badges";
      for (const t of list) {
        const b = doc.createElement("span");
        b.className = "zest-badge";
        b.textContent = t.text;
        b.title = t.tag;
        const rgb = hexToRgb(t.color);
        if (rgb) {
          b.style.color = t.color;
          b.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`;
        }
        wrap.appendChild(b);
      }
      cell.insertBefore(wrap, textSpan);
      textSpan.textContent = data;
      textSpan.classList.add("zest-visually-hidden");
      return cell;
    },
  };
}
