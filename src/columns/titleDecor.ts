import { getPref } from "../utils/prefs";
import { readingStore } from "../reading/store";
import { cachedHeat } from "../reading/heat";
import { effectiveStatus } from "../reading/status";
import { isTrackedItem } from "../utils/items";
import { heatColor, heatOpacity } from "./reading";
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

/** unread = effective status New / To Read (set or derived); items with no
 *  status at all only if opted in, otherwise a fresh install would bold every
 *  item that has nothing to read */
function isUnread(item: Zotero.Item): boolean {
  if (!item.isRegularItem()) return false;
  const eff = effectiveStatus(item);
  if (eff.source === "none") return !!getPref("titleDecor.unreadIncludesEmpty");
  return eff.status === "New" || eff.status === "To Read";
}

function decorate(tree: any, index: number, cell: any) {
  const item = tree?.getRow?.(index)?.ref;
  if (!(item instanceof Zotero.Item) || !isTrackedItem(item)) {
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
    cell.classList.toggle("zest-unread", isUnread(item));
  } else {
    cell.classList.remove("zest-unread");
  }
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
