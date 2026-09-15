import { getPref } from "../utils/prefs";
import { upsertExtraText } from "../utils/extra";
import { STATUS_KEYS, STATUS_DATE_KEYS } from "../reading/status";
import { RATING_KEYS } from "../columns/rating";
import { createWrapGuard } from "../utils/wrap";

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

const ownership = createWrapGuard("__zestExportWrapAlive");
type ExportFunction = (...args: any[]) => any;
let installed:
  | {
      target: { itemToExportFormat: ExportFunction };
      original: ExportFunction;
      wrapper: ExportFunction;
      enabled: boolean;
    }
  | undefined;
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
  if (installed?.wrapper === ZUI.itemToExportFormat) return;
  // A foreign wrapper can keep an older installation in its closure. Leave
  // that chain intact and retire only our behavior before wrapping its head.
  uninstallExportPatch();
  const orig = ownership.stripStale(ZUI.itemToExportFormat) as ExportFunction;
  const state = {
    target: ZUI,
    original: orig,
    wrapper: undefined as unknown as ExportFunction,
    enabled: true,
  };
  state.wrapper = function (this: any, ...args: any[]) {
    const out = orig.apply(this, args);
    try {
      if (
        state.enabled &&
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
  ownership.mark(state.wrapper, orig);
  ZUI.itemToExportFormat = state.wrapper;
  installed = state;
}

export function uninstallExportPatch() {
  const state = installed;
  if (!state) return;
  state.enabled = false;
  installed = undefined;
  ownership.retire();
  try {
    if (state.target.itemToExportFormat === state.wrapper) {
      state.target.itemToExportFormat = ownership.stripStale(state.original);
    }
  } catch (e) {
    ztoolkit.log("[exportPatch] restore failed", e);
  }
}
