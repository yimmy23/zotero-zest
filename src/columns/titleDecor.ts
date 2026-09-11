import { getPref } from "../utils/prefs";
import { readingStore } from "../reading/store";
import { cachedHeat } from "../reading/heat";
import { effectiveStatus } from "../reading/status";
import { isTrackedItem } from "../utils/items";
import { heatColor, heatOpacity } from "./reading";
import {
  getRating,
  ratingListDisplayEnabled,
  ratingTitleDisplayEnabled,
} from "./rating";
import { parseStarRatingTag } from "../rating/starTags";
import { getString } from "../utils/locale";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * Optional decoration of the built-in Title column: reading heat as the
 * cell background and bold text for unread items.
 *
 * Zotero offers no hook for the primary column, so this wraps
 * `ItemTree.prototype._renderCell` per main window — private, but its name,
 * signature (index, data, column, isFirstColumn), return value and `this`
 * (the tree) are identical in 7.0.0 / 9.0.6 / 10.0. The wrapper only ADDS
 * (background-image, a class) after the original ran, swallows every error
 * and returns the original cell. If the probe fails the feature silently
 * stays off — the Reading / Status columns carry the same information.
 */

const MARK = "__zestOrigRenderCell";
const patched = new Map<
  Window,
  { proto: any; inherited: boolean; wrapped: any }
>();
const waiters = new Map<Window, number>();
const decoratedCells = new Map<Window, Set<any>>();
const cellState = new WeakMap<
  object,
  { backgroundImage: string; backgroundPriority: string; appliedHeat: string }
>();

/** unread = effective status New / To Read (set or derived); items with no
 *  status at all only if opted in, otherwise a fresh install would bold every
 *  item that has nothing to read */
function isUnread(item: Zotero.Item): boolean {
  if (!item.isRegularItem()) return false;
  const eff = effectiveStatus(item);
  if (eff.source === "none") return !!getPref("titleDecor.unreadIncludesEmpty");
  return eff.status === "New" || eff.status === "To Read";
}

/** Remove only DOM/classes/styles introduced by this decoration. Item-tree
 * cells are recycled, so this runs before every new title render and again on
 * teardown. */
function cleanupCell(win: Window, cell: any) {
  if (!cell) return;
  const owned = [
    ...Array.from(cell.querySelectorAll?.(".zest-title-rating") || []),
    ...Array.from(
      cell.querySelectorAll?.(".zest-title-rating-duplicate") || [],
    ),
  ] as any[];
  for (const node of owned) {
    if (node.classList?.contains("zest-title-rating-duplicate"))
      node.classList.remove("zest-title-rating-duplicate");
    else node.remove?.();
  }
  cell.classList?.remove("zest-unread");
  cell.classList?.remove("zest-heat-cell");
  const state = cellState.get(cell);
  if (
    state &&
    cell.style?.getPropertyValue?.("background-image") === state.appliedHeat
  ) {
    if (state.backgroundImage)
      cell.style.setProperty(
        "background-image",
        state.backgroundImage,
        state.backgroundPriority,
      );
    else cell.style.removeProperty("background-image");
  }
  cellState.delete(cell);
  decoratedCells.get(win)?.delete(cell);
}

function rememberCell(win: Window, cell: any) {
  let cells = decoratedCells.get(win);
  if (!cells) decoratedCells.set(win, (cells = new Set()));
  // Virtualized rows replace DOM cells as the library scrolls. Do not retain
  // detached rows for the lifetime of the main window.
  if (cells.size >= 256) {
    for (const prior of cells) {
      if (prior !== cell && prior.isConnected === false)
        cleanupCell(win, prior);
    }
  }
  cells.add(cell);
}

function applyHeat(cell: any, backgroundImage: string) {
  const style = cell?.style;
  if (!style?.getPropertyValue || !style?.setProperty) return;
  const original = style.getPropertyValue("background-image");
  const priority = style.getPropertyPriority?.("background-image") || "";
  style.setProperty("background-image", backgroundImage);
  cellState.set(cell, {
    backgroundImage: original,
    backgroundPriority: priority,
    appliedHeat: backgroundImage,
  });
  cell.classList?.add("zest-heat-cell");
}

/** Hide only a native swatch whose *raw* tag is a legacy star rating. The
 * swatch text is insufficient because Zotero strips non-emoji text from it. */
function hideDuplicateStarTag(
  win: Window,
  item: Zotero.Item,
  cell: any,
  rating: number,
) {
  if (!rating || !cell?.querySelectorAll) return;
  try {
    const containsEmoji = (Zotero.Utilities as any)?.Internal?.containsEmoji;
    const tags = (item as any).getItemsListTags?.();
    if (typeof containsEmoji !== "function" || !Array.isArray(tags)) return;
    const emojiTags = tags.filter((tag: any) =>
      containsEmoji(String(tag?.tag || "")),
    );
    const swatches = Array.from(cell.querySelectorAll(".tag-swatch.emoji"));
    // Native swatch extraction also recognises some colored VS16 tags that
    // containsEmoji does not. If the sequences cannot be paired exactly,
    // preserve every native tag rather than hide an unrelated semantic tag.
    if (swatches.length !== emojiTags.length) return;
    for (let i = 0; i < swatches.length && i < emojiTags.length; i++) {
      if (parseStarRatingTag(emojiTags[i]?.tag) === rating) {
        (swatches[i] as HTMLElement).classList.add(
          "zest-title-rating-duplicate",
        );
        rememberCell(win, cell);
      }
    }
  } catch {
    // If Zotero's native tag data changes, preserve every native swatch.
  }
}

function addTitleRating(win: Window, item: Zotero.Item, cell: any) {
  if (!ratingTitleDisplayEnabled() || !item.isRegularItem()) return;
  const rating = getRating(item);
  if (!rating) return; // no empty stars in the Title cell
  const doc = cell.ownerDocument as Document | undefined;
  if (!doc?.createElement) return;
  const box = doc.createElement("span");
  box.className = "zest-title-rating";
  box.title = getString("rating-title-tip", { args: { rating } });
  box.setAttribute("aria-hidden", "true");
  const mark = (getPref("rating.mark") as string) || "★";
  const color = (getPref("rating.color") as string) || "";
  if (color) box.style.setProperty("--zest-star-color", color);
  for (let i = 0; i < rating; i++) {
    const star = doc.createElement("span");
    star.className = "zest-title-rating-star";
    star.textContent = mark;
    box.appendChild(star);
  }
  const text = cell.querySelector?.(".cell-text");
  cell.insertBefore(box, text || null);
  rememberCell(win, cell);
}

function decorate(win: Window, tree: any, index: number, cell: any) {
  cleanupCell(win, cell);
  const item = tree?.getRow?.(index)?.ref;
  if (!(item instanceof Zotero.Item)) return;
  if (isTrackedItem(item) && getPref("titleDecor.heat")) {
    const rec = readingStore.getForItem(item);
    const bg = rec ? cachedHeat(rec, heatColor(), heatOpacity()) : "";
    if (bg) {
      applyHeat(cell, bg);
      rememberCell(win, cell);
    }
  }
  if (isTrackedItem(item) && getPref("titleDecor.unreadBold")) {
    cell.classList.toggle("zest-unread", isUnread(item));
    if (cell.classList.contains("zest-unread")) rememberCell(win, cell);
  }
  addTitleRating(win, item, cell);
  if (ratingListDisplayEnabled() && item.isRegularItem())
    hideDuplicateStarTag(win, item, cell, getRating(item));
}

function tryPatch(win: Window): boolean {
  const view = (win as any).ZoteroPane?.itemsView;
  if (!view) return false;
  const proto = Object.getPrototypeOf(view);
  if (!proto || typeof proto._renderCell !== "function") return false;
  // A previous instance of OURS (hot reload) left its wrapper: unwrap first so
  // we never chain stale closures. Only when the function on top is actually
  // one of ours — unwinding over another plugin's wrapper would delete it.
  if (proto[MARK] && (proto._renderCell as any)?.__zestDecor) {
    try {
      proto._renderCell = proto[MARK];
      delete proto[MARK];
    } catch {
      return false;
    }
  }
  const orig = proto._renderCell;
  if (orig.length < 3) return false; // unexpected signature → stay off
  // the view's prototype (CollectionViewItemTree) inherits _renderCell from
  // ItemTree; remember that so teardown can delete our own property instead of
  // leaving a shadow copy behind
  const inherited = !Object.prototype.hasOwnProperty.call(proto, "_renderCell");
  const wrapped = function (
    this: any,
    index: number,
    data: any,
    column: any,
    ...rest: any[]
  ) {
    const cell = orig.call(this, index, data, column, ...rest);
    try {
      if (
        // set when we had to leave the chain in place (see uninstall)
        !(wrapped as any).__zestOff &&
        column?.primary &&
        cell
      ) {
        decorate(win, this, index, cell);
      }
    } catch {
      // decoration must never break rendering
    }
    return cell;
  };
  (wrapped as any).__zestDecor = true;
  Object.defineProperty(proto, MARK, {
    value: orig,
    configurable: true,
    writable: true,
  });
  proto._renderCell = wrapped;
  patched.set(win, { proto, inherited, wrapped });
  return true;
}

/** Install after the item tree exists (polls briefly; UI ready ≠ tree ready). */
export function installTitleDecor(win: Window) {
  if (patched.has(win)) return;
  let attempts = 0;
  const attempt = () => {
    waiters.delete(win);
    if (tryPatch(win)) return;
    if (++attempts < 40) waiters.set(win, setTimeout(attempt, 250));
  };
  attempt();
}

export function uninstallTitleDecor(win?: Window) {
  const wins = win ? [win] : [...patched.keys()];
  for (const w of wins) {
    clearTimeout(waiters.get(w));
    waiters.delete(w);
    const p = patched.get(w);
    patched.delete(w);
    for (const cell of decoratedCells.get(w) || []) cleanupCell(w, cell);
    decoratedCells.delete(w);
    if (!p) continue;
    try {
      const orig = p.proto[MARK];
      // Restore only while OUR wrapper is the one on top; another plugin
      // wrapping after us would lose its hook. When we cannot unwind we
      // switch our own wrapper off instead, so it keeps forwarding and
      // stops decorating.
      if (orig && p.proto._renderCell === p.wrapped) {
        if (p.inherited) delete p.proto._renderCell;
        else p.proto._renderCell = orig;
        delete p.proto[MARK];
      } else if (p.wrapped) {
        p.wrapped.__zestOff = true;
        ztoolkit.log(
          "[titleDecor] another wrapper sits on ours — left in place, disabled",
        );
      }
    } catch (e) {
      ztoolkit.log("[titleDecor] restore failed", e);
    }
  }
}

export function titleDecorActive(win: Window): boolean {
  return patched.has(win);
}
