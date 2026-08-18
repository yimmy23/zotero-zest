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
 * The library the pane is looking at. Zotero 10 REMOVED the singular
 * `getSelectedLibraryID()` (it throws a descriptive error) in favour of the
 * plural form, because a selection can now span libraries; we take the first
 * one and fall back to the user library.
 */
export function selectedLibraryID(win: Window): number {
  const zp = (win as any).ZoteroPane;
  try {
    const many = zp?.getSelectedLibraryIDs?.();
    if (Array.isArray(many) && many.length) return Number(many[0]);
  } catch {
    // not available on this build
  }
  try {
    const one = zp?.getSelectedLibraryID?.();
    if (typeof one === "number") return one;
  } catch {
    // Zotero 10 throws here on purpose
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

  for (const item of viewItems) {
    for (const tag of tagsOfItem(item, withChildren)) {
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
    const all = (await Zotero.Tags.getAll(libraryID)) as Array<{
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
 * read walks the item's attachments, notes and annotations. One short-lived
 * cache per filter pass keeps that O(items) instead of O(items × branches);
 * it is dropped whenever the filter is re-applied.
 */
const tagCache = new Map<number, string[]>();

export function clearTagCache() {
  tagCache.clear();
}

function cachedTags(item: Zotero.Item, withChildren: boolean): string[] {
  const hit = tagCache.get(item.id);
  if (hit) return hit;
  const tags = tagsOfItem(item, withChildren);
  if (tagCache.size > 20000) tagCache.clear();
  tagCache.set(item.id, tags);
  return tags;
}

/**
 * Does this item (or one of its children) carry a tag under `prefix`?
 * "under" = exactly the prefix, or the prefix followed by the link symbol, so
 * "#Method" does not swallow "#Methodology".
 */
export function itemHasPrefix(
  item: Zotero.Item,
  prefixes: string[],
  linkSymbol: string,
  withChildren: boolean,
): boolean {
  if (!prefixes.length) return true;
  const tags = cachedTags(item, withChildren);
  if (!tags.length) return false;
  for (const p of prefixes) {
    let hit = false;
    for (const t of tags) {
      if (t === p || t.startsWith(p + linkSymbol)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false; // prefixes are ANDed
  }
  return true;
}
