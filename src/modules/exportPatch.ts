import { getPref } from "../utils/prefs";
import { upsertExtraText } from "../utils/extra";
import { STATUS_KEYS, STATUS_DATE_KEYS } from "../reading/status";
import { RATING_KEYS } from "../columns/rating";

/**
 * Keep plugin bookkeeping out of bibliographies: Extra is exported by most
 * translators (BibTeX `note`, RIS `N1`, CSL `note`), so `Read_Status:` /
 * `Read_Status_Date:` / `Rating:` lines would leak into references. Like
 * Zotero Reading List we wrap `Zotero.Utilities.Internal.itemToExportFormat`
 * (the single funnel every translator export goes through) and strip our
 * lines from the exported copy only. Restored on shutdown; feature-detected.
 */

const MARK = "__zestOrigItemToExportFormat";
const STRIP: string[][] = [STATUS_KEYS, STATUS_DATE_KEYS, RATING_KEYS];

export function stripZestExtra(extra: string): string {
  let out = extra;
  for (const keys of STRIP) {
    const r = upsertExtraText(out, keys, null);
    if (r !== null) out = r;
  }
  return out;
}

export function installExportPatch() {
  const ZUI = (Zotero.Utilities as any).Internal;
  if (!ZUI || typeof ZUI.itemToExportFormat !== "function") return;
  if (ZUI[MARK]) return; // already installed (hot reload)
  const orig = ZUI.itemToExportFormat;
  const wrapped = function (this: any, ...args: any[]) {
    const out = orig.apply(this, args);
    try {
      if (
        out &&
        typeof out.extra === "string" &&
        out.extra &&
        getPref("extra.stripOnExport")
      ) {
        out.extra = stripZestExtra(out.extra);
      }
    } catch {
      // never break exports
    }
    return out;
  };
  Object.defineProperty(ZUI, MARK, {
    value: orig,
    configurable: true,
    writable: true,
  });
  ZUI.itemToExportFormat = wrapped;
}

export function uninstallExportPatch() {
  const ZUI = (Zotero.Utilities as any).Internal;
  if (!ZUI || !ZUI[MARK]) return;
  try {
    ZUI.itemToExportFormat = ZUI[MARK];
    delete ZUI[MARK];
  } catch (e) {
    ztoolkit.log("[exportPatch] restore failed", e);
  }
}
