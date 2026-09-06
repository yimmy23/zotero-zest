import { getPref, getNumPref } from "../utils/prefs";
import { createWrapGuard } from "../utils/wrap";
import { setTimeout, clearTimeout } from "../utils/timers";
import { createDOMOwnership } from "../utils/domOwnership";

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
  /** this copy's wrapper — uninstall restores only over ITS OWN function */
  wrapped: (...args: any[]) => any;
  badgeMount: symbol;
}

const wrapGuard = createWrapGuard("__zestCountsAlive");
const BADGE_OWNER = Symbol("zest-count-badge");
const ownership = createDOMOwnership();
const RENDER_OWNER = "zest-count-renderer";

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

/**
 * One bottom-up pass over every collection, off the render path.
 *
 * The renderer runs for every visible row on every frame, so it may only READ
 * this map — the recursive walk it used to do took `O(subtree)` per row and
 * was thrown away by the next item event, which on a syncing 20k library is
 * several times a second.
 *
 * Totals dedupe: an item filed in both a parent and a child must count once,
 * so the pass carries a Set per subtree and keeps only its size.
 */
let recomputing: Promise<void> | undefined;

/** libraries with more collections than this get direct counts only */
const MAX_COLLECTIONS_PER_LIBRARY = 2000;

async function recomputeCounts(): Promise<void> {
  const next = new Map<number, { direct: number; total: number }>();
  const libraries = (Zotero.Libraries.getAll() ?? []) as Array<{
    libraryID: number;
  }>;
  for (const library of libraries) {
    let all: any[];
    try {
      all = (Zotero.Collections.getByLibrary(library.libraryID, true) ??
        []) as any[];
    } catch {
      continue;
    }
    const recursive = mode() !== 0;
    if (recursive && all.length > MAX_COLLECTIONS_PER_LIBRARY) {
      ztoolkit.log(
        `[counts] library ${library.libraryID} has ${all.length} collections — showing direct counts only`,
      );
    }
    const direct = new Map<number, number[]>();
    let n = 0;
    for (const c of all) {
      try {
        direct.set(c.id, ((c.getChildItems(true) as number[]) || []).slice());
      } catch {
        direct.set(c.id, []);
      }
      // the pass can touch thousands of collections; let the UI breathe
      if (++n % 50 === 0) await Zotero.Promise.delay(0);
    }
    const subtree = new Map<number, Set<number>>();
    const walk = (c: any): Set<number> => {
      const hit = subtree.get(c.id);
      if (hit) return hit;
      const set = new Set<number>(direct.get(c.id) ?? []);
      subtree.set(c.id, set);
      let children: any[];
      try {
        children = (Zotero.Collections.getByParent(c.id) as any[]) || [];
      } catch {
        children = [];
      }
      for (const sub of children) for (const id of walk(sub)) set.add(id);
      return set;
    };
    const wantTotals = recursive && all.length <= MAX_COLLECTIONS_PER_LIBRARY;
    for (const c of all) {
      const d = (direct.get(c.id) ?? []).length;
      next.set(c.id, {
        direct: d,
        total: wantTotals ? walk(c).size : d,
      });
    }
  }
  counts.clear();
  for (const [id, value] of next) counts.set(id, value);
}

function countFor(collectionID: number): { direct: number; total: number } {
  // read-only: a miss means the pass has not finished yet, and an empty badge
  // is better than a synchronous walk inside the row renderer
  return counts.get(collectionID) ?? { direct: 0, total: 0 };
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

/** take our badges out of ONE window's DOM (rows are reused, not rebuilt) */
export function sweepBadgesIn(win: Window, mount?: symbol) {
  try {
    for (const badge of win.document.querySelectorAll(".zest-count")) {
      if (
        (badge as any).__zestCountOwner === BADGE_OWNER &&
        (!mount || (badge as any).__zestCountMount === mount)
      )
        badge.remove();
    }
  } catch {
    // window closing
  }
}

/**
 * Repaint every collection row (badges are baked into the row DOM).
 *
 * NEVER call `tree.refresh()` here: on CollectionTree that is a full data
 * rebuild which sets `selection.selectEventsSuppressed = true` and expects the
 * caller to restore the selection and clear the flag afterwards. Called bare —
 * and we used to call it on every item event — it leaves selection events
 * suppressed, so clicking a collection stops loading its items.
 * forceUpdate + invalidate re-run renderItem for every visible row, which is
 * all a badge needs.
 */
function redraw(tree: any) {
  try {
    tree.forceUpdate?.();
    tree.tree?.invalidate?.();
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
  // unwind only wrappers whose copy has RETIRED — a live copy's wrapper
  // (the outgoing one during an in-place upgrade) must stay in the chain
  const base = wrapGuard.stripStale(tree.renderItem);
  tree.renderItem = base;
  const original = base.bind(tree);
  const badgeMount = Symbol("zest-count-mount");
  // Even a queued React callback belonging to the outgoing copy must stop
  // painting as soon as this copy takes over the same tree.
  ownership.claim(tree, RENDER_OWNER, () => {});
  const wrapped = (...args: any[]): any => {
    const row = original(...args);
    try {
      // React or an incoming plugin copy may retain our function after teardown.
      if (
        patched.get(win)?.wrapped !== wrapped ||
        !ownership.owns(tree, RENDER_OWNER)
      )
        return row;
      const index = args[0] as number;
      const treeRow = tree.getRow?.(index);
      const collectionID = treeRow?.ref?.id;
      if (treeRow?.isCollection?.() && collectionID) {
        const text = label(collectionID);
        if (text && row?.querySelector) {
          const cell = row.querySelector(".cell.primary");
          if (cell) {
            const badge =
              cell.querySelector(".zest-count") ||
              row.ownerDocument.createElement("span");
            badge.className = "zest-count";
            (badge as any).__zestCountOwner = BADGE_OWNER;
            (badge as any).__zestCountMount = badgeMount;
            badge.textContent = text;
            if (!badge.parentElement) cell.appendChild(badge);
          }
        }
      }
    } catch {
      // never break a row render over a badge
    }
    return row;
  };
  wrapGuard.mark(wrapped, base);
  tree.renderItem = wrapped;
  patched.set(win, { win, tree, original: base, wrapped, badgeMount });
  startWatch();
  invalidateCounts();
  redraw(tree);
}

export function uninstallCollectionCounts(win: Window) {
  const entry = patched.get(win);
  if (!entry) {
    // nothing wrapped here, but a previous session (or a hot reload) may have
    // left badges in THIS window's DOM — never sweep the other windows, they
    // may still have counts installed
    sweepBadgesIn(win);
    return;
  }
  patched.delete(win);
  ownership.release(entry.tree, RENDER_OWNER);
  try {
    // restore only over our own wrapper; anything else (another plugin, the
    // incoming copy of an upgrade) owns the slot now
    if (entry.tree.renderItem === entry.wrapped) {
      entry.tree.renderItem = entry.original;
    }
    // The virtualized table reuses row nodes, so restoring renderItem does not
    // remove badges that are already in the DOM — take them out ourselves.
    sweepBadgesIn(entry.win, entry.badgeMount);
    redraw(entry.tree);
    // The virtualized table received `renderItem` as a React prop, so a render
    // that was already queued still paints badges; sweep once more after it.
    setTimeout(() => sweepBadgesIn(entry.win, entry.badgeMount), 600);
  } catch {
    // window gone
  }
  if (!patched.size) stopWatch();
}

export function uninstallAllCollectionCounts() {
  for (const win of [...patched.keys()]) uninstallCollectionCounts(win);
  // this copy stops wrapping for good — a newer copy may now strip our
  // leftovers safely
  wrapGuard.retire();
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
  if (recomputeTimer) clearTimeout(recomputeTimer);
  // a sync run fires item events continuously; coalesce them into one pass
  recomputeTimer = setTimeout(() => {
    recomputeTimer = undefined;
    if (!patched.size) return;
    const run = (recomputing ?? Promise.resolve())
      .then(() => recomputeCounts())
      .catch((e) => ztoolkit.log("[counts] recompute failed", e))
      .then(() => {
        if (recomputing === run) recomputing = undefined;
        for (const { tree } of patched.values()) redraw(tree);
      });
    recomputing = run;
  }, 1500);
}

function startWatch() {
  if (notifierID) return;
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string) => {
        // `modify` on an item cannot change which collection it is in
        // (that is a collection-item event), so ignore it — otherwise every
        // rating click and every synced field repaints the whole tree.
        // Restoring from the trash is not an item event at all in Zotero 10:
        // it arrives as ('refresh', 'trash') — that one counts.
        if (
          type === "item" &&
          event !== "add" &&
          event !== "delete" &&
          event !== "trash"
        ) {
          return;
        }
        if (type === "trash" && event !== "refresh") return;
        invalidateCounts();
      },
    },
    ["collection", "collection-item", "item", "trash"],
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
