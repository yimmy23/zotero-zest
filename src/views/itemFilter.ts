/**
 * One shared filter pipeline over the item list.
 *
 * Zotero's supported filter slots do not fit what we need:
 *   - `setFilter('tags', Set)` ANDs EXACT tag names, so "everything under
 *     #Method/" cannot be expressed by expanding the prefix into its leaves
 *     (an item would have to carry all of them at once);
 *   - `setFilter('advanced-search', …)` only exists in Zotero 10 and shares
 *     its slot with the Advanced Search pane, so using it would fight the UI;
 *   - `setFilter('search', …)` is the quick-search box the user is typing in.
 *
 * So we wrap `CollectionTreeRow.prototype.getItems` once — the same hook the
 * original plugin used for its type filter — and run our own predicates over
 * the row set. The wrapper is installed lazily (only when a filter is active),
 * is feature-detected, passes `options` through unchanged (Zotero 10 added
 * `{unfiltered: true}`, which must never be filtered), and restores the
 * original function when the last filter is removed.
 */

export type ItemFilter = (items: Zotero.Item[]) => Zotero.Item[];

const filters = new Map<string, ItemFilter>();
let original:
  ((this: any, ...args: any[]) => Promise<Zotero.Item[]>) | undefined;
let target: any;

function proto(): any {
  return (Zotero as any).CollectionTreeRow?.prototype;
}

/** true when the pipeline can be installed on this Zotero build */
export function canFilter(): boolean {
  return typeof proto()?.getItems === "function";
}

/**
 * Restore a wrapper left behind by a PREVIOUS instance of this plugin (a hot
 * reload or an upgrade shuts the old copy down after the new one has already
 * loaded, and the old copy's module state is gone). The original function is
 * parked on the wrapper itself so any instance can undo it.
 */
function unwrapStale(p: any) {
  let fn = p?.getItems;
  let guard = 0;
  while (fn && (fn as any).__zestOriginal && guard++ < 5) {
    fn = (fn as any).__zestOriginal;
    p.getItems = fn;
  }
}

function install(): boolean {
  if (original) return true;
  const p = proto();
  if (typeof p?.getItems !== "function") {
    ztoolkit.log("[filter] CollectionTreeRow.getItems missing — no filtering");
    return false;
  }
  unwrapStale(p);
  original = p.getItems;
  target = p;
  // NOTE: a plain function, not an arrow and not guardAsync — the wrapper is
  // installed as a prototype method, so it must forward `this` to the original
  // (an arrow wrapper silently loses it and Zotero's getItems throws).
  p.getItems = async function (this: any, ...args: any[]) {
    // Zotero's own failure must propagate untouched — only our own filtering
    // is wrapped below.
    const items: any = await original!.apply(this, args);
    try {
      // `unfiltered` asks for the raw set (Zotero 10 uses it for counts and
      // for the tag selector's scope) — never touch it
      if (args[0]?.unfiltered || !filters.size || !Array.isArray(items)) {
        return items;
      }
      // `getItems` also returns child items (attachments, notes, annotations);
      // the tree only renders top-level rows but still needs the children in
      // the set, so predicates never see them and they are passed through.
      const top: Zotero.Item[] = [];
      const children: Zotero.Item[] = [];
      for (const it of items as Zotero.Item[]) {
        const isTop =
          typeof (it as any)?.isTopLevelItem === "function"
            ? (it as any).isTopLevelItem()
            : true;
        (isTop ? top : children).push(it);
      }
      let out: Zotero.Item[] = top;
      for (const fn of filters.values()) {
        const next = fn(out);
        if (Array.isArray(next)) out = next;
      }
      if (!children.length) return out;
      // a child whose parent was filtered out must go too: the item tree
      // reinstates the parent row for any child left in the set
      const kept = new Set(out.map((i) => i.id));
      const keptChildren = children.filter((c) => {
        try {
          const topItem = (c as any).topLevelItem;
          return topItem ? kept.has(topItem.id) : true;
        } catch {
          return false;
        }
      });
      return keptChildren.length ? out.concat(keptChildren) : out;
    } catch (e) {
      ztoolkit.log("[filter] predicate failed — showing unfiltered", e);
      return items;
    }
  };
  (p.getItems as any).__zestWrapped = true;
  (p.getItems as any).__zestOriginal = original;
  return true;
}

function uninstall() {
  const p = proto();
  if (!original || !target) {
    // nothing of ours is tracked, but a previous instance may still be wrapped
    if (p) unwrapStale(p);
    return;
  }
  try {
    target.getItems = original;
  } catch (e) {
    ztoolkit.log("[filter] restore failed", e);
  }
  original = undefined;
  target = undefined;
}

/** add/replace a named filter (null removes it); returns false when unsupported */
export function setItemFilter(name: string, fn: ItemFilter | null): boolean {
  if (fn) {
    if (!install()) return false;
    filters.set(name, fn);
  } else {
    filters.delete(name);
    if (!filters.size) uninstall();
  }
  return true;
}

export function hasItemFilter(name: string): boolean {
  return filters.has(name);
}

export function activeItemFilters(): string[] {
  return [...filters.keys()];
}

export function clearItemFilters() {
  filters.clear();
  uninstall();
  // belt and braces on shutdown: make sure no wrapper of ours survives
  const p = proto();
  if (p) unwrapStale(p);
}

/** re-run the current view through the pipeline, keeping the selection */
export async function refreshItemView(win?: Window) {
  const wins = win ? [win] : (Zotero.getMainWindows() as unknown as Window[]);
  for (const w of wins) {
    try {
      const iv = (w as any).ZoteroPane?.itemsView;
      if (!iv) continue;
      if (typeof iv.refreshAndMaintainSelection === "function") {
        await iv.refreshAndMaintainSelection();
      } else if (typeof iv.refresh === "function") {
        await iv.refresh();
        iv.tree?.invalidate?.();
      }
    } catch (e) {
      ztoolkit.log("[filter] refresh failed", e);
    }
  }
}
