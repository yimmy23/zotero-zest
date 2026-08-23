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
 * lines from the exported copy only. Feature-detected. On shutdown the
 * original goes back ONLY while our wrapper is still the function on the
 * object: Reading List wraps the very same method, and if it wrapped after us,
 * putting the original back would delete its hook (invariant 5) — then our
 * wrapper is switched off and left in the chain as a pass-through instead.
 *
 * Scope note: this covers translator exports. Citations and bibliographies
 * (word-processor plugins, Create Bibliography, CSL Quick Copy) are built from
 * `Zotero.Utilities.Item.itemToCSLJSON`, which reads Extra directly and is not
 * wrapped here; a CSL style that prints the `note` variable can still show
 * the lines.
 */

const MARK = "__zestOrigItemToExportFormat";
/** the exact function we put on the object (per copy of the plugin) */
let wrapped: ((...args: any[]) => any) | undefined;
let disabled = false;
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
  // a previous copy of ours still on top (hot reload): unwind it, but only
  // when it really is the function on the object — otherwise leave the chain
  if (ZUI[MARK] && (ZUI.itemToExportFormat as any)?.__zestExport) {
    ZUI.itemToExportFormat = ZUI[MARK];
    delete ZUI[MARK];
  }
  if (ZUI[MARK]) return; // someone else sits on a stale wrapper; do nothing
  const orig = ZUI.itemToExportFormat;
  disabled = false;
  wrapped = function (this: any, ...args: any[]) {
    const out = orig.apply(this, args);
    try {
      if (
        !disabled &&
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
  (wrapped as any).__zestExport = true;
  Object.defineProperty(ZUI, MARK, {
    value: orig,
    configurable: true,
    writable: true,
  });
  ZUI.itemToExportFormat = wrapped;
}

export function uninstallExportPatch() {
  const ZUI = (Zotero.Utilities as any).Internal;
  if (!ZUI || !ZUI[MARK] || !wrapped) return;
  try {
    if (ZUI.itemToExportFormat === wrapped) {
      ZUI.itemToExportFormat = ZUI[MARK];
      delete ZUI[MARK];
    } else {
      // another plugin (or a newer copy of this one) wrapped on top of us:
      // leave the chain intact and make our link a pass-through
      disabled = true;
      ztoolkit.log(
        "[exportPatch] another wrapper sits on ours — left in place, disabled",
      );
    }
  } catch (e) {
    ztoolkit.log("[exportPatch] restore failed", e);
  }
  wrapped = undefined;
}
