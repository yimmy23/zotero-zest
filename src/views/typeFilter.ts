import { getString } from "../utils/locale";
import { setItemFilter, refreshItemView, canFilter } from "./itemFilter";

/**
 * Quick item-type filter ("only journal articles", "only preprints").
 *
 * Runs through the same predicate pipeline as the tag tree, so it composes
 * with Zotero's own quick search, saved searches and tag selection instead of
 * competing with them: every filter narrows, none of them replaces the others.
 */

let active = new Set<string>();

export function activeTypes(): string[] {
  return [...active];
}

export function typeFilterActive(): boolean {
  return active.size > 0;
}

export function canTypeFilter(): boolean {
  return canFilter();
}

/** item types present in the current view, with counts, for the menu */
export function typesInView(
  win: Window,
): Array<{ type: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  try {
    const rows: Zotero.Item[] =
      (win as any).ZoteroPane?.itemsView?.getSortedItems?.() ?? [];
    for (const item of rows) {
      if (!(item instanceof Zotero.Item)) continue;
      let type = "";
      try {
        type = Zotero.ItemTypes.getName(item.itemTypeID);
      } catch {
        continue;
      }
      if (!type) continue;
      counts.set(type, (counts.get(type) || 0) + 1);
    }
  } catch (e) {
    ztoolkit.log("[typeFilter] scan failed", e);
  }
  // keep already-selected types listed even when the filter hid them
  for (const t of active) if (!counts.has(t)) counts.set(t, 0);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: localizedType(type), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function localizedType(type: string): string {
  try {
    return Zotero.ItemTypes.getLocalizedString(type) || type;
  } catch {
    return type;
  }
}

export async function toggleType(win: Window, type: string) {
  if (active.has(type)) active.delete(type);
  else active.add(type);
  await apply(win);
}

export async function clearTypeFilter(win: Window) {
  if (!active.size) return;
  active = new Set();
  await apply(win);
}

async function apply(win: Window) {
  if (!active.size) {
    setItemFilter("type", null);
    await refreshItemView(win);
    return;
  }
  const wanted = new Set(active);
  const ok = setItemFilter("type", (items) =>
    items.filter((item) => {
      try {
        return wanted.has(Zotero.ItemTypes.getName(item.itemTypeID));
      } catch {
        return true;
      }
    }),
  );
  if (!ok) {
    ztoolkit.log("[typeFilter] pipeline unavailable");
    return;
  }
  await refreshItemView(win);
}

export function typeFilterSummary(): string {
  if (!active.size) return "";
  return getString("typefilter-active", {
    args: {
      types: [...active].map(localizedType).join(", "),
      count: active.size,
    },
  });
}

export function resetTypeFilter() {
  active = new Set();
  setItemFilter("type", null);
}
