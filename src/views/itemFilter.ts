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

/**
 * Filters are per WINDOW: the prototype is shared by every main window, so a
 * tag selection made in one window must not silently filter another. A row
 * knows its window through `row.view._ownerDocument` (verified on 9.0.6 and
 * 10.0); when that cannot be resolved we filter nothing rather than guess.
 */
const filters = new Map<Window, Map<string, ItemFilter>>();
let original:
  ((this: any, ...args: any[]) => Promise<Zotero.Item[]>) | undefined;
let target: any;
/** the exact function we put on the prototype, so we can tell ours from a
 *  wrapper another plugin (or another copy of this one) installed after us */
let wrapper:
  ((this: any, ...args: any[]) => Promise<Zotero.Item[]>) | undefined;

function proto(): any {
  return (Zotero as any).CollectionTreeRow?.prototype;
}

function activeCount(): number {
  let n = 0;
  for (const m of filters.values()) n += m.size;
  return n;
}

function windowOf(row: any): Window | undefined {
  try {
    const doc = row?.view?._ownerDocument;
    return (doc?.defaultView as Window) || undefined;
  } catch {
    return undefined;
  }
}

/** true when the pipeline can be installed on this Zotero build */
export function canFilter(): boolean {
  return typeof proto()?.getItems === "function";
}

/**
 * Restore a wrapper left behind by a PREVIOUS instance of this plugin (a hot
 * reload or an upgrade shuts the old copy down after the new one has already
 * loaded, and the old copy's module state is gone). The original function is
 * parked on the wrapper itself so any instance can undo it — but only a
 * wrapper that is no longer alive is unwound: a live one (this copy's, or a
 * newer copy's) is left exactly where it is.
 */
const INSTANCE = Symbol("zest-filter-instance");
const ALIVE_KEY = "__zestFilterAlive";
function aliveSet(): Set<symbol> {
  const z = Zotero as any;
  if (!z[ALIVE_KEY]) z[ALIVE_KEY] = new Set<symbol>();
  return z[ALIVE_KEY];
}

function unwrapStale(p: any) {
  let guard = 0;
  while (guard++ < 5) {
    const fn = p?.getItems;
    if (!fn || !(fn as any).__zestOriginal) return;
    if (aliveSet().has((fn as any).__zestInstance)) return; // live wrapper
    p.getItems = (fn as any).__zestOriginal;
  }
}

function install(): boolean {
  const p = proto();
  // `original` on its own is not proof that we are still installed. An upgrade
  // loads the new copy BEFORE the old one shuts down, and the old copy's
  // teardown puts Zotero's own function back — over the new copy's wrapper.
  // Check the prototype rather than our own bookkeeping.
  if (original && p?.getItems === wrapper) return true;
  if (typeof p?.getItems !== "function") {
    ztoolkit.log("[filter] CollectionTreeRow.getItems missing — no filtering");
    return false;
  }
  unwrapStale(p);
  original = p.getItems;
  target = p;
  aliveSet().add(INSTANCE);
  // the wrapper captures the function it wraps: the module-level `original`
  // is cleared on uninstall, but a wrapper another plugin installed on top of
  // ours keeps calling ours — it must keep forwarding to what it wrapped
  const inner = original!;
  // NOTE: a plain function, not an arrow and not guardAsync — the wrapper is
  // installed as a prototype method, so it must forward `this` to the original
  // (an arrow wrapper silently loses it and Zotero's getItems throws).
  p.getItems = async function (this: any, ...args: any[]) {
    // Zotero's own failure must propagate untouched — only our own filtering
    // is wrapped below.
    const items: any = await inner.apply(this, args);
    try {
      // `unfiltered` asks for the raw set (Zotero 10 uses it for counts and
      // for the tag selector's scope) — never touch it
      if (args[0]?.unfiltered || !activeCount() || !Array.isArray(items)) {
        return items;
      }
      const win = windowOf(this);
      const mine = win ? filters.get(win) : undefined;
      if (!mine?.size) return items;
      // Search can return only a matching attachment/note/annotation, and the
      // native tree then reinstates its owner. Evaluate that owner even when
      // it is absent from the result. Owners are only predicate inputs: the
      // native query still decides which rows exist (including in Trash).
      const owners = new Map<number, Zotero.Item>();
      const ownerIDs = new Map<Zotero.Item, number>();
      for (const it of items as Zotero.Item[]) {
        try {
          const isTop =
            typeof it?.isTopLevelItem === "function"
              ? it.isTopLevelItem()
              : true;
          const owner = isTop ? it : it.topLevelItem;
          if (!owner) continue;
          owners.set(owner.id, owner);
          ownerIDs.set(it, owner.id);
        } catch {
          // An unreadable owner must not hide a native result.
        }
      }
      let out: Zotero.Item[] = [...owners.values()];
      for (const fn of mine.values()) {
        const next = fn(out);
        if (Array.isArray(next)) out = next;
      }
      const kept = new Set(out.map((i) => i.id));
      // Preserve source objects, ordering and multiplicity; never add a live
      // parent to Trash or a nonmatching parent to the native search result.
      return (items as Zotero.Item[]).filter((item) => {
        const ownerID = ownerIDs.get(item);
        return ownerID === undefined || kept.has(ownerID);
      });
    } catch (e) {
      ztoolkit.log("[filter] predicate failed — showing unfiltered", e);
      return items;
    }
  };
  (p.getItems as any).__zestWrapped = true;
  (p.getItems as any).__zestOriginal = original;
  (p.getItems as any).__zestInstance = INSTANCE;
  wrapper = p.getItems;
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
    // Only put the original back if OUR wrapper is still the one on top.
    // Someone else wrapping after us means restoring here would delete their
    // hook — Zest degrading another plugin, which invariant 1 forbids. Leaving
    // the chain alone is safe: with `filters` empty our wrapper is a
    // pass-through.
    if (target.getItems === wrapper) target.getItems = original;
    else
      ztoolkit.log("[filter] another wrapper sits on ours — chain left intact");
  } catch (e) {
    ztoolkit.log("[filter] restore failed", e);
  }
  original = undefined;
  target = undefined;
  wrapper = undefined;
  aliveSet().delete(INSTANCE);
}

/**
 * Add/replace a named filter for ONE window (null removes it). Returns false
 * when the pipeline is unavailable on this Zotero build.
 */
export function setItemFilter(
  win: Window,
  name: string,
  fn: ItemFilter | null,
): boolean {
  if (fn) {
    if (!install()) return false;
    let mine = filters.get(win);
    if (!mine) {
      mine = new Map();
      filters.set(win, mine);
    }
    mine.set(name, fn);
  } else {
    const mine = filters.get(win);
    mine?.delete(name);
    if (mine && !mine.size) filters.delete(win);
    if (!activeCount()) uninstall();
  }
  return true;
}

export function activeItemFilters(win?: Window): string[] {
  if (win) return [...(filters.get(win)?.keys() ?? [])];
  const out: string[] = [];
  for (const m of filters.values()) out.push(...m.keys());
  return out;
}

/** drop every filter of one window (the window is closing) */
export function clearWindowFilters(win: Window) {
  if (filters.delete(win) && !activeCount()) uninstall();
}

export function clearItemFilters() {
  filters.clear();
  uninstall();
  // belt and braces on shutdown: no DEAD wrapper of ours survives (a newer
  // copy's live wrapper is left alone)
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
      await iv.refreshAndMaintainSelection();
    } catch (e) {
      ztoolkit.log("[filter] refresh failed", e);
    }
  }
}
