import { getPref } from "../utils/prefs";
import { readingStore } from "../reading/store";
import { cachedHeat } from "../reading/heat";
import { getReadStatus } from "../reading/status";
import { heatColor, heatOpacity } from "./reading";
import { setTimeout, clearTimeout } from "../utils/window";

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
const patched = new Map<Window, { proto: any; own: boolean }>();
const waiters = new Map<Window, number>();

function isUnread(status: string): boolean {
  return status === "" || status === "New" || status === "To Read";
}

function decorate(tree: any, index: number, cell: any) {
  const item = tree?.getRow?.(index)?.ref;
  if (!(item instanceof Zotero.Item) || !item.isRegularItem()) {
    if (cell?.classList) cell.classList.remove("zest-unread");
    return;
  }
  if (getPref("titleDecor.heat")) {
    const rec = readingStore.getForItem(item);
    const bg = rec ? cachedHeat(rec, heatColor(), heatOpacity()) : "";
    if (bg) {
      cell.style.backgroundImage = bg;
      cell.classList.add("zest-heat-cell");
    } else {
      cell.style.backgroundImage = "";
      cell.classList.remove("zest-heat-cell");
    }
  }
  if (getPref("titleDecor.unreadBold")) {
    cell.classList.toggle("zest-unread", isUnread(getReadStatus(item)));
  } else {
    cell.classList.remove("zest-unread");
  }
}

function tryPatch(win: Window): boolean {
  const view = (win as any).ZoteroPane?.itemsView;
  if (!view) return false;
  const proto = Object.getPrototypeOf(view);
  if (!proto || typeof proto._renderCell !== "function") return false;
  if (proto[MARK]) {
    // a previous plugin instance (hot reload) left its wrapper: unwrap first
    // so we never chain stale closures
    try {
      proto._renderCell = proto[MARK];
      delete proto[MARK];
    } catch {
      return false;
    }
  }
  const orig = proto._renderCell;
  if (orig.length < 3) return false; // unexpected signature → stay off
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
        column?.primary &&
        cell &&
        (getPref("titleDecor.heat") || getPref("titleDecor.unreadBold"))
      ) {
        decorate(this, index, cell);
      }
    } catch {
      // decoration must never break rendering
    }
    return cell;
  };
  Object.defineProperty(proto, MARK, {
    value: orig,
    configurable: true,
    writable: true,
  });
  proto._renderCell = wrapped;
  patched.set(win, { proto, own: true });
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
    if (!p) continue;
    try {
      const orig = p.proto[MARK];
      if (orig) {
        p.proto._renderCell = orig;
        delete p.proto[MARK];
      }
    } catch (e) {
      ztoolkit.log("[titleDecor] restore failed", e);
    }
  }
}

export function titleDecorActive(win: Window): boolean {
  return patched.has(win);
}
