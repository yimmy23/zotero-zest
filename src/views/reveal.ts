import { activeItemFilters, refreshItemView } from "./itemFilter";
import { createWrapGuard } from "../utils/wrap";
import { clearSelection as clearTagSelection } from "../tags/nestedTree";

/**
 * "Show Item in Library" must win over a Zest filter.
 *
 * Zotero reveals an item by selecting its library row and then asking the item
 * tree to select the id. Zest's filters live inside `CollectionTreeRow.getItems`,
 * so a filtered-out item is simply not in the tree: Zotero's reveal finds
 * nothing and returns silently. That happens on View ▸ Show Item in Library
 * from a reader tab, on a connector save, and on "Show in Library" from Word —
 * none of which the user connects to a tag branch they clicked earlier.
 *
 * So: let Zotero try first; if the item did not become visible and Zest has a
 * filter on, drop OUR filters (that is what the user just asked for, implicitly)
 * and let Zotero try again.
 */

interface Wrapped {
  pane: any;
  original: (...args: any[]) => any;
  /** this copy's wrapper — uninstall restores only over ITS OWN function */
  wrapper: (...args: any[]) => any;
}

const wrapGuard = createWrapGuard("__zestRevealAlive");

const wrapped = new Map<Window, Wrapped>();

function isVisible(pane: any, itemIDs: number[]): boolean {
  const view = pane?.itemsView;
  if (!view?.getRowIndexByID) return true; // cannot tell — assume Zotero coped
  for (const id of itemIDs) {
    const row = view.getRowIndexByID(id);
    if (row !== false && row !== undefined && row !== null) return true;
  }
  return false;
}

export function installRevealGuard(win: Window) {
  if (wrapped.has(win)) return;
  const pane = (win as any).ZoteroPane;
  if (!pane || typeof pane.selectItems !== "function") return;
  // unwind only wrappers whose copy has retired; a live copy's wrapper
  // stays (same rule as itemFilter / collectionCounts)
  const base = wrapGuard.stripStale(pane.selectItems);
  pane.selectItems = base;

  const original = base;
  const wrapper = async function (this: any, ...args: any[]) {
    const result = await original.apply(this, args);
    try {
      const ids = (args[0] as number[]) || [];
      if (!ids.length || !activeItemFilters(win).length) return result;
      if (isVisible(this, ids)) return result;
      await clearZestFilters(win);
      return await original.apply(this, args);
    } catch (e) {
      ztoolkit.log("[reveal] retry after clearing filters failed", e);
      return result;
    }
  };
  wrapGuard.mark(wrapper, original);
  pane.selectItems = wrapper;
  wrapped.set(win, { pane, original, wrapper });
}

/** clear every Zest filter in this window, UI state included */
export async function clearZestFilters(win: Window) {
  try {
    clearTagSelection(win);
  } catch (e) {
    ztoolkit.log("[reveal] clearing the tag selection failed", e);
  }
  await refreshItemView(win);
}

export function uninstallRevealGuard(win: Window) {
  const entry = wrapped.get(win);
  if (!entry) return;
  wrapped.delete(win);
  try {
    // referential identity: two copies' wrappers share the same base, so
    // comparing __zestOriginal let one copy strip the other's live wrapper
    if (entry.pane.selectItems === entry.wrapper) {
      entry.pane.selectItems = entry.original;
    }
  } catch {
    // window gone
  }
}

export function uninstallAllRevealGuards() {
  for (const win of [...wrapped.keys()]) uninstallRevealGuard(win);
  wrapGuard.retire();
}

/** exported for the probe */
export function revealGuardInstalled(win: Window): boolean {
  return wrapped.has(win);
}
