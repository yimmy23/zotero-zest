import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { getExtraLine, setExtraLine } from "../utils/extra";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/**
 * "Rating" column — 1–5 stars in Extra. Reads `Rating:` and the legacy
 * zotero-style `rate:` line; writes back to whichever key the item already
 * has (default `Rating`). Hover preview is pure CSS (:has); click star k
 * sets k, clicking the current top star lowers it by one (click 1 → clear).
 */

/** read both spellings; write the one the pref says (default `rate`, the
 *  zotero-style key most existing libraries already carry) unless the item
 *  already has the other one (upsert keeps the existing key) */
export const RATING_KEYS = ["rate", "Rating"];

export function ratingWriteKeys(): string[] {
  const k =
    (getPref("rating.extraKey") as string) === "Rating" ? "Rating" : "rate";
  return k === "rate" ? ["rate", "Rating"] : ["Rating", "rate"];
}

export function getRating(item: Zotero.Item): number {
  const v = getExtraLine(item, RATING_KEYS)?.value;
  const n = v ? parseInt(v, 10) : 0;
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 0;
}

export async function setRating(item: Zotero.Item, n: number): Promise<void> {
  if (!item.isRegularItem()) return;
  await setExtraLine(
    item,
    ratingWriteKeys(),
    n >= 1 && n <= 5 ? String(n) : null,
  );
}

export function ratingColumn(): ColumnSpec {
  return {
    key: "rating",
    label: getString("column-rating"),
    width: 100,
    enabledPref: "extensions.zotero.zest.column.rating.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const n = getRating(item);
      return n ? String(n) : "";
    },
    renderCell: (index, data, column, _first, doc) => {
      const n = data ? Number(data) : 0;
      const { cell, textSpan } = makeCell(doc, column, "rating");
      const box = doc.createElement("span");
      // unrated rows only reveal the empty stars on hover / selection
      box.className = n ? "zest-stars" : "zest-stars zest-stars-empty";
      box.title = getString("rating-tip");
      const mark = (getPref("rating.mark") as string) || "★";
      const option = (getPref("rating.option") as string) || mark;
      const color = (getPref("rating.color") as string) || "";
      if (color) box.style.setProperty("--zest-star-color", color);
      for (let k = 1; k <= 5; k++) {
        const star = doc.createElement("span");
        star.className = `zest-star${k <= n ? " on" : ""}`;
        star.textContent = k <= n ? mark : option;
        star.dataset.value = String(k);
        for (const t of ["mousedown", "mouseup", "dblclick"]) {
          star.addEventListener(t, (ev: Event) => ev.stopPropagation());
        }
        star.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const item = rowItem(doc, index);
          if (!item || !item.isEditable()) return;
          const cur = getRating(item);
          void setRating(item, cur === k ? k - 1 : k);
        });
        box.appendChild(star);
      }
      cell.insertBefore(box, textSpan);
      // sortable text kept invisible for accessibility / type-to-find
      textSpan.textContent = n ? String(n) : "";
      textSpan.classList.add("zest-visually-hidden");
      return cell;
    },
  };
}
