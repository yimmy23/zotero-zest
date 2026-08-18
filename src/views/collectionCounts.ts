import { getPref, getNumPref } from "../utils/prefs";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * Item counts next to collection names.
 *
 * Zotero renders collection rows through an instance-level `renderItem`
 * function that rewrites the row's innerHTML on every frame, so there is no
 * CSS-only way in. We swap that one instance field, keep the original, and put
 * it back on shutdown — no prototype patching, nothing left behind.
 *
 * Off by default: on a library with hundreds of collections the recursive
 * count is real work, and Zotero deliberately does not show these numbers.
 *
 * Modes (pref `collectionCounts.mode`):
 *   0  items directly in the collection
 *   1  including subcollections
 *   2  both, as "direct / total"
 */

interface Patched {
  win: Window;
  tree: any;
  original: (...args: any[]) => any;
}

const patched = new Map<Window, Patched>();
const counts = new Map<number, { direct: number; total: number }>();
let recomputeTimer: number | undefined;
let notifierID: string | undefined;

export function countsEnabled(): boolean {
  return !!getPref("collectionCounts.enable");
}

function mode(): number {
  const m = getNumPref("collectionCounts.mode", 0);
  return m === 1 || m === 2 ? m : 0;
}

function countFor(collectionID: number): { direct: number; total: number } {
  const hit = counts.get(collectionID);
  if (hit) return hit;
  let direct = 0;
  let total = 0;
  try {
    const collection = Zotero.Collections.get(collectionID) as any;
    if (collection) {
      // top-level items only: attachments and notes are not "items" here
      direct = (collection.getChildItems(true) as number[])?.length ?? 0;
      const seen = new Set<number>();
      const walk = (c: any) => {
        for (const id of (c.getChildItems(true) as number[]) || [])
          seen.add(id);
        for (const sub of Zotero.Collections.getByParent(c.id) || []) walk(sub);
      };
      walk(collection);
      total = seen.size;
    }
  } catch (e) {
    ztoolkit.log("[counts] failed", e);
  }
  const value = { direct, total };
  counts.set(collectionID, value);
  return value;
}

function label(collectionID: number): string {
  const { direct, total } = countFor(collectionID);
  switch (mode()) {
    case 1:
      return total ? String(total) : "";
    case 2:
      return direct || total ? `${direct} / ${total}` : "";
    default:
      return direct ? String(direct) : "";
  }
}

/** take our badges out of every window's DOM (rows are reused, not rebuilt) */
export function sweepBadges() {
  for (const win of Zotero.getMainWindows() as unknown as Window[]) {
    try {
      for (const badge of win.document.querySelectorAll(".zest-count")) {
        badge.remove();
      }
    } catch {
      // window closing
    }
  }
}

/** rebuild every collection row (badges are baked into the row DOM) */
function redraw(tree: any) {
  try {
    tree.forceUpdate?.();
    tree.tree?.invalidate?.();
    void tree.refresh?.();
  } catch {
    // not mounted yet
  }
}

export function installCollectionCounts(win: Window) {
  if (patched.has(win) || !countsEnabled()) return;
  const tree = (win as any).ZoteroPane?.collectionsView;
  if (!tree || typeof tree.renderItem !== "function") {
    ztoolkit.log("[counts] collectionsView.renderItem unavailable");
    return;
  }
  // undo a wrapper left by a previous plugin instance (hot reload / upgrade)
  let base = tree.renderItem;
  let guard = 0;
  while (base?.__zestOriginal && guard++ < 5) base = base.__zestOriginal;
  tree.renderItem = base;
  const original = base.bind(tree);
  const wrapped = (...args: any[]) => {
    const row = original(...args);
    try {
      const index = args[0] as number;
      const treeRow = tree.getRow?.(index);
      const collectionID = treeRow?.ref?.id;
      if (treeRow?.isCollection?.() && collectionID) {
        const text = label(collectionID);
        if (text && row?.querySelector) {
          const cell = row.querySelector(".cell.primary");
          if (cell && !cell.querySelector(".zest-count")) {
            const badge = row.ownerDocument.createElement("span");
            badge.className = "zest-count";
            badge.textContent = text;
            cell.appendChild(badge);
          }
        }
      }
    } catch {
      // never break a row render over a badge
    }
    return row;
  };
  (wrapped as any).__zestOriginal = base;
  tree.renderItem = wrapped;
  patched.set(win, { win, tree, original: base });
  redraw(tree);
  startWatch();
}

export function uninstallCollectionCounts(win: Window) {
  const entry = patched.get(win);
  if (!entry) {
    // nothing wrapped here, but a previous session (or a hot reload) may have
    // left badges in the DOM
    sweepBadges();
    return;
  }
  patched.delete(win);
  try {
    entry.tree.renderItem = entry.original;
    // The virtualized table reuses row nodes, so restoring renderItem does not
    // remove badges that are already in the DOM — take them out ourselves.
    sweepBadges();
    redraw(entry.tree);
    // The virtualized table received `renderItem` as a React prop, so a render
    // that was already queued still paints badges; sweep once more after it.
    setTimeout(() => sweepBadges(), 600);
  } catch {
    // window gone
  }
  if (!patched.size) stopWatch();
}

export function uninstallAllCollectionCounts() {
  for (const win of [...patched.keys()]) uninstallCollectionCounts(win);
}

/** react to the enable/mode prefs */
export function syncCollectionCounts() {
  const on = countsEnabled();
  for (const win of Zotero.getMainWindows() as unknown as Window[]) {
    if (on) installCollectionCounts(win);
    else uninstallCollectionCounts(win);
  }
  if (on) invalidateCounts();
}

export function invalidateCounts() {
  counts.clear();
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = undefined;
    for (const { tree } of patched.values()) redraw(tree);
  }, 400);
}

function startWatch() {
  if (notifierID) return;
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (_event: string, type: string) => {
        if (
          type === "collection" ||
          type === "collection-item" ||
          type === "item"
        ) {
          invalidateCounts();
        }
      },
    },
    ["collection", "collection-item", "item"],
    "zest-counts",
    102,
  );
}

function stopWatch() {
  if (recomputeTimer) {
    clearTimeout(recomputeTimer);
    recomputeTimer = undefined;
  }
  counts.clear();
  if (!notifierID) return;
  try {
    Zotero.Notifier.unregisterObserver(notifierID);
  } catch {
    // ignore
  }
  notifierID = undefined;
}
