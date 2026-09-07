import { getPref } from "../utils/prefs";
import { parseTagRule } from "./match";
import type { TagInput } from "./tree";

/**
 * Which tags exist right now, and how often — the input of the nested tree.
 *
 * Two sets are collected in one pass over the library:
 *   inView      tags on the rows the item list is currently showing
 *   inScope     tags anywhere in the selected library
 * so the tree can grey out branches that cannot narrow the current view
 * (Zotero's own tag selector does the same thing).
 *
 * Child items count: a tag on a PDF attachment, a note or an annotation makes
 * its parent item match. That is what makes "click a tag → see the papers
 * where I tagged an annotation with it" work, and it is also what the
 * annotation locator cards rely on.
 */

export interface TagScope {
  /** display-name → aggregated input for the tree */
  inputs: TagInput[];
  /** tag names present on the rows currently listed */
  inView: Set<string>;
  /** tag names present anywhere in the library */
  inLibrary: Set<string>;
  libraryID: number;
}

/**
 * The library the pane is looking at. Zotero 10 replaced the singular
 * `getSelectedLibraryID()` (it throws) with the plural form, because a
 * selection can span libraries; we take the first one and fall back to the
 * user library.
 */
export function selectedLibraryID(win: Window): number {
  const zp = (win as any).ZoteroPane;
  try {
    const many = zp?.getSelectedLibraryIDs?.();
    if (Array.isArray(many) && many.length) return Number(many[0]);
  } catch {
    // not available on this build
  }
  return Zotero.Libraries.userLibraryID;
}

export function matchChildTags(): boolean {
  return getPref("nestedTags.matchChildTags") !== false;
}

interface CachedTagList {
  all: string[];
  manual: string[];
  /** Items whose tags or membership contribute to this answer. */
  dependencies: Set<number>;
}

function readTags(item: Zotero.Item, withChildren: boolean): CachedTagList {
  const all = new Set<string>();
  const manual = new Set<string>();
  const dependencies = new Set<number>();
  const push = (it: Zotero.Item) => {
    dependencies.add(it.id);
    try {
      for (const t of it.getTags()) {
        all.add(t.tag);
        if (t.type !== 1) manual.add(t.tag);
      }
    } catch {
      // unloaded item
    }
  };
  const annotations = (attachment: Zotero.Item) => {
    try {
      if (typeof (attachment as any).getAnnotations === "function") {
        for (const ann of (
          attachment as any
        ).getAnnotations() as Zotero.Item[]) {
          if (ann) push(ann);
        }
      }
    } catch {
      // linked-URL attachments throw on getAnnotations
    }
  };
  push(item);
  if (withChildren) {
    // A standalone PDF/EPUB is itself the attachment, not a regular item
    // with attachments. Its annotations still belong to its tag scope.
    if (item.isAttachment?.()) {
      annotations(item);
    } else if (item.isRegularItem?.() !== false) {
      try {
        for (const attID of item.getAttachments()) {
          const att = Zotero.Items.get(attID) as Zotero.Item;
          if (!att) continue;
          push(att);
          annotations(att);
        }
      } catch {
        // item without attachments
      }
      try {
        for (const noteID of item.getNotes()) {
          const note = Zotero.Items.get(noteID) as Zotero.Item;
          if (note) push(note);
        }
      } catch {
        // item without notes
      }
    }
  }
  return { all: [...all], manual: [...manual], dependencies };
}

/** Unique tags on an item, plus (optionally) on its children. */
export function tagsOfItem(
  item: Zotero.Item,
  withChildren: boolean,
  showAutomatic = true,
): string[] {
  const tags = readTags(item, withChildren);
  return showAutomatic ? tags.all : tags.manual;
}

/** Top-level paper or standalone item; tolerate unloaded/missing parents. */
function scopeItem(item: Zotero.Item): Zotero.Item {
  try {
    const top = (item as any).topLevelItem;
    if (top?.id && top.id !== item.id) return top;
  } catch {
    // Fall back to the parent chain when the top-level getter is unavailable.
  }
  let current = item;
  const seen = new Set<number>([item.id]);
  while (current.parentItemID) {
    try {
      const parent = Zotero.Items.get(current.parentItemID) as Zotero.Item;
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    } catch {
      break;
    }
  }
  return current;
}

/**
 * Collect the tag scope. `viewItems` are the rows the item tree currently
 * shows; the library set comes from Zotero.Tags so tags on items outside the
 * current collection are still visible (greyed out) in the tree.
 */
export async function collectTagScope(
  libraryID: number,
  viewItems: Zotero.Item[],
  cancelled: () => boolean = () => false,
): Promise<TagScope> {
  const empty = (): TagScope => ({
    inputs: [],
    inView: new Set(),
    inLibrary: new Set(),
    libraryID,
  });
  if (cancelled()) return empty();
  const withChildren = matchChildTags();
  const showAutomatic =
    Zotero.Prefs.get("extensions.zotero.tagSelector.showAutomatic", true) !==
    false;
  const matcher = parseTagRule(getPref("textTags.match") as string);
  const inView = new Set<string>();
  const counts = new Map<string, number>();
  const itemIDs = new Map<string, Set<number>>();

  const seen = new Set<number>();
  for (let i = 0; i < viewItems.length; i++) {
    // yield every 200 items: walking attachments/notes/annotations of a large
    // collection would otherwise freeze the UI thread for seconds
    if (i % 200 === 199) {
      if (cancelled()) return empty();
      await Zotero.Promise.delay(0);
      if (cancelled()) return empty();
    }
    const item = scopeItem(viewItems[i]);
    // Expanded attachments/notes must not count the same paper again. When
    // child matching is off, only the root's own tags participate.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    for (const tag of cachedTags(item, withChildren, showAutomatic)) {
      if (matcher.test(tag) === null) continue;
      inView.add(tag);
      counts.set(tag, (counts.get(tag) || 0) + 1);
      let ids = itemIDs.get(tag);
      if (!ids) {
        ids = new Set();
        itemIDs.set(tag, ids);
      }
      ids.add(item.id);
    }
  }

  const inLibrary = new Set<string>();
  if (cancelled()) return empty();
  try {
    // Zotero's own "Show Automatic" switch (tag selector menu): type 1 tags
    // are the ones translators attach, and they stay out of the tree too
    const all = (await Zotero.Tags.getAll(
      libraryID,
      showAutomatic ? undefined : [0],
    )) as Array<{
      tag: string;
      type?: number;
    }>;
    if (cancelled()) return empty();
    for (const t of all) {
      if (matcher.test(t.tag) === null) continue;
      inLibrary.add(t.tag);
    }
  } catch (e) {
    ztoolkit.log("[tags] getAll failed", e);
  }
  if (cancelled()) return empty();

  let colors: Map<string, { color: string; position: number }>;
  try {
    colors = Zotero.Tags.getColors(libraryID) as Map<
      string,
      { color: string; position: number }
    >;
  } catch {
    colors = new Map();
  }

  const names = new Set<string>([...inLibrary, ...inView]);
  const inputs: TagInput[] = [];
  for (const tag of names) {
    inputs.push({
      tag,
      count: counts.get(tag) || 0,
      itemIDs: itemIDs.get(tag),
      position: colors.get(tag)?.position,
      color: colors.get(tag)?.color,
    });
  }
  return { inputs, inView, inLibrary, libraryID };
}

/**
 * Tag lists are re-read for every selected branch during filtering, and each
 * read walks the item's attachments, notes and annotations.
 *
 * The cache therefore has to survive across filter passes: the predicate runs
 * on EVERY item-tree refresh (each quick-search keystroke, each batch of items
 * a sync adds), and rebuilding it every time made a tag filter O(items ×
 * children) per keystroke on a 20k library. It is invalidated by the tag tree's
 * notifier instead — per item where the event names them.
 */
const tagCache = new Map<number, CachedTagList>();
/** Child id → cached slots that read it. Survives deletion from Items.get(). */
const dependents = new Map<number, Set<number>>();
// Own/with-children answers each use one slot; automatic visibility shares
// that answer. Keep the existing hot set at capacity: clearing everything
// (or FIFO/LRU eviction) thrashes on repeated same-order library scans.
const MAX_CACHE_ENTRIES = 20000;

/** one slot per item AND per mode: the own-tags list and the with-children
 *  list are different answers, and the mode is a live preference */
const slot = (itemID: number, withChildren: boolean) =>
  itemID * 2 + (withChildren ? 1 : 0);

export function clearTagCache() {
  tagCache.clear();
  dependents.clear();
}

function dropSlot(key: number) {
  const entry = tagCache.get(key);
  if (!entry) return;
  tagCache.delete(key);
  for (const id of entry.dependencies) {
    const slots = dependents.get(id);
    slots?.delete(key);
    if (!slots?.size) dependents.delete(id);
  }
}

/**
 * Drop the cached tag lists of these items (all of them when ids is empty).
 * A tag added to an attachment, note or annotation is reported with the
 * CHILD's id, but it changes the PARENT's aggregated list — so the top-level
 * item is invalidated as well.
 */
export function invalidateTagCache(ids?: Array<string | number>) {
  if (!ids?.length) {
    clearTagCache();
    return;
  }
  const affected = new Set<number>();
  for (const raw of ids) {
    // item-tag ids arrive as "itemID-tagID"
    const itemID = Number(String(raw).split("-")[0]);
    if (!Number.isSafeInteger(itemID) || itemID <= 0) continue;
    for (const key of dependents.get(itemID) ?? []) affected.add(key);
    affected.add(slot(itemID, false));
    affected.add(slot(itemID, true));
    try {
      let item = Zotero.Items.get(itemID) as Zotero.Item;
      const seen = new Set<number>([itemID]);
      // New or reparented children may not be in any cached dependency set
      // yet. Follow their current ancestors as well as the old dependents.
      while (item?.parentItemID && !seen.has(item.parentItemID)) {
        const parentID = item.parentItemID;
        seen.add(parentID);
        affected.add(slot(parentID, true));
        item = Zotero.Items.get(parentID) as Zotero.Item;
      }
      const top = item && scopeItem(item);
      if (top?.id !== itemID && top?.id) affected.add(slot(top.id, true));
    } catch {
      // Deleted children still invalidate the cached reverse dependencies.
    }
  }
  for (const key of affected) dropSlot(key);
}

export function cachedTags(
  item: Zotero.Item,
  withChildren: boolean,
  showAutomatic = true,
): string[] {
  const key = slot(item.id, withChildren);
  const hit = tagCache.get(key);
  if (hit) return showAutomatic ? hit.all : hit.manual;
  const tags = readTags(item, withChildren);
  if (tagCache.size < MAX_CACHE_ENTRIES) {
    tagCache.set(key, tags);
    for (const id of tags.dependencies) {
      let slots = dependents.get(id);
      if (!slots) dependents.set(id, (slots = new Set()));
      slots.add(key);
    }
  }
  return showAutomatic ? tags.all : tags.manual;
}
