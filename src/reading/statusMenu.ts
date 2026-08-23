import { getString } from "../utils/locale";
import { runBatch } from "../ui/batch";
import {
  READ_STATUSES,
  effectiveStatus,
  getReadStatus,
  setReadStatus,
  statusLabel,
} from "./status";

/**
 * The one status picker every surface opens: the Status column dot and the
 * item-pane section (which Zotero also shows beside an open reader). A native
 * XUL menupopup built on demand in the main window (the way Zotero builds its
 * own column picker): a header line saying what the current status is and
 * where it came from, one radio item per status, and "clear" to hand the item
 * back to the automatic reading.
 *
 * The popup is created per use and removed on `popuphidden`, so it never
 * outlives the cell or pane that asked for it — those are rebuilt on
 * selection and refresh.
 */

const POPUPSET_ID = "zest-popupset";

export interface StatusMenuOptions {
  /** the main window that owns the popup (for reader buttons: reader._window) */
  win: Window;
  /** regular items to change; more than one = the current selection */
  items: Zotero.Item[];
  /** element to hang the popup on (must be in `win`'s document tree, or a
   *  <browser> the anchor lives inside) */
  anchor?: Element | null;
  /** XUL popup position, default "after_start" */
  position?: string;
  /** offsets relative to the anchor (used with position "overlap") */
  x?: number;
  y?: number;
  /** screen coordinates, used when there is no usable anchor */
  screenX?: number;
  screenY?: number;
  /** called after a status was written (or cleared) */
  onDone?: () => void;
}

/**
 * Write one status to many items. Up to five items are written directly;
 * more go through the batch runner with its confirmation and cancel button,
 * because every write is an Extra edit that syncs.
 */
export async function setStatusForAll(
  items: Zotero.Item[],
  status: string | null,
): Promise<void> {
  const editable = items.filter((i) => i.isRegularItem() && i.isEditable());
  if (!editable.length) return;
  if (editable.length <= 5) {
    for (const it of editable) await setReadStatus(it, status);
    return;
  }
  await runBatch(
    getString("menu-status", "label"),
    editable,
    async (item) => setReadStatus(item, status),
    {
      confirmMessage: getString("batch-confirm-count", {
        args: { count: editable.length },
      }),
    },
  );
}

function popupSet(doc: Document): Element | null {
  let set = doc.getElementById(POPUPSET_ID);
  if (!set) {
    try {
      set = (doc as any).createXULElement("popupset");
      set!.id = POPUPSET_ID;
      doc.documentElement?.appendChild(set!);
    } catch {
      return null;
    }
  }
  return set;
}

/** the label the header shows for what the items currently carry */
function headerText(items: Zotero.Item[]): string {
  if (items.length !== 1) {
    return getString("status-menu-header-many", {
      args: { count: items.length },
    });
  }
  const eff = effectiveStatus(items[0]);
  if (eff.source === "none") return getString("status-menu-header-none");
  const label = statusLabel(eff.status);
  return eff.source === "auto"
    ? getString("status-menu-header-auto", { args: { status: label } })
    : getString("status-menu-header-manual", { args: { status: label } });
}

export function openStatusMenu(opts: StatusMenuOptions): boolean {
  const items = opts.items.filter(
    (i) => i instanceof Zotero.Item && i.isRegularItem(),
  );
  if (!items.length) return false;
  const doc = opts.win.document;
  const set = popupSet(doc);
  if (!set) return false;
  const xul = (name: string) => (doc as any).createXULElement(name) as Element;

  const popup = xul("menupopup");
  popup.setAttribute("id", `zest-status-popup-${Date.now()}`);
  popup.addEventListener("popuphidden", () => popup.remove());

  const header = xul("menuitem");
  header.setAttribute("label", headerText(items));
  header.setAttribute("disabled", "true");
  popup.appendChild(header);
  popup.appendChild(xul("menuseparator"));

  const single = items.length === 1 ? effectiveStatus(items[0]) : null;
  const editable = items.some((i) => i.isEditable());
  for (const status of READ_STATUSES) {
    const mi = xul("menuitem");
    mi.setAttribute("label", statusLabel(status));
    mi.setAttribute("type", "radio");
    mi.setAttribute("name", "zest-status");
    if (single && single.status === status) mi.setAttribute("checked", "true");
    if (!editable) mi.setAttribute("disabled", "true");
    mi.addEventListener("command", () => {
      void setStatusForAll(items, status).then(() => opts.onDone?.());
    });
    popup.appendChild(mi);
  }
  popup.appendChild(xul("menuseparator"));
  const clear = xul("menuitem");
  clear.setAttribute("label", getString("status-menu-clear", "label"));
  const anyManual = items.some((i) => !!getReadStatus(i));
  if (!anyManual || !editable) clear.setAttribute("disabled", "true");
  clear.addEventListener("command", () => {
    void setStatusForAll(items, null).then(() => opts.onDone?.());
  });
  popup.appendChild(clear);

  set.appendChild(popup);
  try {
    const p = popup as any;
    if (opts.anchor && (opts.anchor as any).isConnected !== false) {
      p.openPopup(
        opts.anchor,
        opts.position || "after_start",
        opts.x ?? 0,
        opts.y ?? 0,
        false,
        false,
      );
    } else if (opts.screenX !== undefined && opts.screenY !== undefined) {
      p.openPopupAtScreen(opts.screenX + 1, opts.screenY + 1, false);
    } else {
      popup.remove();
      return false;
    }
  } catch (e) {
    ztoolkit.log("[status] popup failed", e);
    popup.remove();
    return false;
  }
  return true;
}
