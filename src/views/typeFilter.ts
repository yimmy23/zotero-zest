import { getString } from "../utils/locale";
import { setItemFilter, refreshItemView, canFilter } from "./itemFilter";

/**
 * Quick item-type filter ("only journal articles", "only preprints").
 *
 * Runs through the same predicate pipeline as the tag tree, so it composes
 * with Zotero's own quick search, saved searches and tag selection instead of
 * competing with them: every filter narrows, none of them replaces the others.
 */

/** window → selected item types (the filter registry is per window too) */
const active = new Map<Window, Set<string>>();

function typesOf(win: Window): Set<string> {
  let set = active.get(win);
  if (!set) {
    set = new Set();
    active.set(win, set);
  }
  return set;
}

export function activeTypes(win?: Window): string[] {
  if (win) return [...typesOf(win)];
  const out = new Set<string>();
  for (const set of active.values()) for (const t of set) out.add(t);
  return [...out];
}

export function typeFilterActive(win: Window): boolean {
  return typesOf(win).size > 0;
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
  for (const t of typesOf(win)) if (!counts.has(t)) counts.set(t, 0);
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
  const set = typesOf(win);
  if (set.has(type)) set.delete(type);
  else set.add(type);
  await apply(win);
}

export async function clearTypeFilter(win: Window) {
  const set = active.get(win);
  if (!set?.size) return;
  set.clear();
  await apply(win);
}

async function apply(win: Window) {
  const set = typesOf(win);
  if (!set.size) {
    setItemFilter(win, "type", null);
    await refreshItemView(win);
    return;
  }
  const wanted = new Set(set);
  const ok = setItemFilter(win, "type", (items) =>
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

export function typeFilterSummary(win: Window): string {
  const set = typesOf(win);
  if (!set.size) return "";
  return getString("typefilter-active", {
    args: {
      types: [...set].map(localizedType).join(", "),
      count: set.size,
    },
  });
}

export function resetTypeFilter() {
  active.clear();
  for (const w of Zotero.getMainWindows() as unknown as Window[]) {
    setItemFilter(w, "type", null);
  }
}
