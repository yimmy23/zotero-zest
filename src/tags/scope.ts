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

/** every tag on an item, plus (optionally) on its children */
export function tagsOfItem(item: Zotero.Item, withChildren: boolean): string[] {
  const out: string[] = [];
  const push = (it: Zotero.Item) => {
    try {
      for (const t of it.getTags()) out.push(t.tag);
    } catch {
      // unloaded item
    }
  };
  push(item);
  if (!withChildren) return out;
  try {
    for (const attID of item.getAttachments()) {
      const att = Zotero.Items.get(attID) as Zotero.Item;
      if (!att) continue;
      push(att);
      try {
        if (typeof (att as any).getAnnotations === "function") {
          for (const ann of (att as any).getAnnotations() as Zotero.Item[]) {
            push(ann);
          }
        }
      } catch {
        // linked-URL attachments throw on getAnnotations
      }
    }
    for (const noteID of item.getNotes()) {
      const note = Zotero.Items.get(noteID) as Zotero.Item;
      if (note) push(note);
    }
  } catch {
    // item without children
  }
  return out;
}

/**
 * Collect the tag scope. `viewItems` are the rows the item tree currently
 * shows; the library set comes from Zotero.Tags so tags on items outside the
 * current collection are still visible (greyed out) in the tree.
 */
export async function collectTagScope(
  libraryID: number,
  viewItems: Zotero.Item[],
): Promise<TagScope> {
  const withChildren = matchChildTags();
  const matcher = parseTagRule(getPref("textTags.match") as string);
  const inView = new Set<string>();
  const counts = new Map<string, number>();
  const itemIDs = new Map<string, Set<number>>();

  for (let i = 0; i < viewItems.length; i++) {
    const item = viewItems[i];
    // yield every 200 items: walking attachments/notes/annotations of a large
    // collection would otherwise freeze the UI thread for seconds
    if (i % 200 === 199) await Zotero.Promise.delay(0);
    for (const tag of cachedTags(item, withChildren)) {
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
  try {
    // Zotero's own "Show Automatic" switch (tag selector menu): type 1 tags
    // are the ones translators attach, and they stay out of the tree too
    const showAutomatic =
      Zotero.Prefs.get("extensions.zotero.tagSelector.showAutomatic") !== false;
    const all = (await Zotero.Tags.getAll(
      libraryID,
      showAutomatic ? undefined : [0],
    )) as Array<{
      tag: string;
      type?: number;
    }>;
    for (const t of all) {
      if (matcher.test(t.tag) === null) continue;
      inLibrary.add(t.tag);
    }
  } catch (e) {
    ztoolkit.log("[tags] getAll failed", e);
  }

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
const tagCache = new Map<number, string[]>();

/** one slot per item AND per mode: the own-tags list and the with-children
 *  list are different answers, and the mode is a live preference */
const slot = (itemID: number, withChildren: boolean) =>
  itemID * 2 + (withChildren ? 1 : 0);

export function clearTagCache() {
  tagCache.clear();
}

/**
 * Drop the cached tag lists of these items (all of them when ids is empty).
 * A tag added to an attachment, note or annotation is reported with the
 * CHILD's id, but it changes the PARENT's aggregated list — so the top-level
 * item is invalidated as well.
 */
export function invalidateTagCache(ids?: Array<string | number>) {
  if (!ids?.length) {
    tagCache.clear();
    return;
  }
  for (const raw of ids) {
    // item-tag ids arrive as "itemID-tagID"
    const itemID = Number(String(raw).split("-")[0]);
    if (!Number.isInteger(itemID)) continue;
    tagCache.delete(slot(itemID, false));
    tagCache.delete(slot(itemID, true));
    try {
      const top = (Zotero.Items.get(itemID) as any)?.topLevelItem;
      if (top && top.id !== itemID) {
        tagCache.delete(slot(top.id, false));
        tagCache.delete(slot(top.id, true));
      }
    } catch {
      // deleted child: its parent will be refreshed by the next event
    }
  }
}

export function cachedTags(item: Zotero.Item, withChildren: boolean): string[] {
  const key = slot(item.id, withChildren);
  const hit = tagCache.get(key);
  if (hit) return hit;
  const tags = tagsOfItem(item, withChildren);
  if (tagCache.size > 20000) tagCache.clear();
  tagCache.set(key, tags);
  return tags;
}
