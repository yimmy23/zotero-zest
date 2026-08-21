import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { getExtraBlock, setExtraBlock } from "../utils/extra";
import { itemIsEditable } from "../utils/items";

/**
 * "Title translation" / "Abstract translation" rows in the native Info box.
 *
 * zotero-pdf-translate has nowhere else to put a translation, so it appends
 * `titleTranslation:` / `abstractTranslation:` lines to Extra — which is why
 * Extra ends up reading like a log file. Zotero cannot hide those lines from
 * the Extra row, but `ItemPaneManager.registerInfoRow` can show the same text
 * as two proper labelled rows, so the translation is where you look for it
 * instead of buried in "Other".
 *
 * The rows are a view over Extra, not a second copy: editing one rewrites the
 * Extra line, and clearing it removes the line. Rows with nothing to show are
 * hidden by CSS on the reflected `value` attribute (see `ui/styles.ts`) rather
 * than by `setEnabled`, because `onItemChange` only runs when the *displayed
 * item* changes — a translation added to the item already on screen would
 * otherwise stay hidden until the user clicked away and back.
 */

export const TITLE_TRANSLATION_KEYS = ["titleTranslation"];
export const ABSTRACT_TRANSLATION_KEYS = ["abstractTranslation"];

interface RowSpec {
  rowID: string;
  keys: string[];
  l10n: "inforow-title-translation" | "inforow-abstract-translation";
  multiline: boolean;
}

/**
 * Registration order is display order: `position: "end"` inserts each new row
 * just above "Date Added", so the first registered row ends up on top.
 */
const ROWS: RowSpec[] = [
  {
    rowID: "zestTitleTranslation",
    keys: TITLE_TRANSLATION_KEYS,
    l10n: "inforow-title-translation",
    multiline: false,
  },
  {
    rowID: "zestAbstractTranslation",
    keys: ABSTRACT_TRANSLATION_KEYS,
    l10n: "inforow-abstract-translation",
    multiline: true,
  },
];

/** namespaced IDs handed back by Zotero — the only ones unregister accepts */
let registered: string[] = [];

/**
 * Row IDs are namespaced with the plugin ID, so an in-place upgrade gives both
 * copies the same handles: the outgoing copy's teardown would otherwise strip
 * the rows the incoming copy just registered (invariant 5). Same claim shape as
 * `columns/registry.ts`.
 */
const OWNER_KEY = "__zestInfoRowOwner";
const INSTANCE_ID = (((Zotero as any)[OWNER_KEY]?.instance as number) ?? 0) + 1;

function ownsRows(): boolean {
  const owner = (Zotero as any)[OWNER_KEY];
  return !owner || owner.instance === INSTANCE_ID;
}

export function registerTranslationRows() {
  if (registered.length) return;
  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerInfoRow) {
    ztoolkit.log("[translations] registerInfoRow unavailable");
    return;
  }
  for (const spec of ROWS) {
    const id = manager.registerInfoRow({
      rowID: spec.rowID,
      pluginID: config.addonID,
      label: { l10nID: getLocaleID(spec.l10n) },
      position: "end",
      multiline: spec.multiline,
      editable: true,
      onGetData: ({ item }: { item: Zotero.Item }) => valueOf(item, spec.keys),
      onSetData: ({ item, value }: { item: Zotero.Item; value: string }) => {
        if (!(item instanceof Zotero.Item) || !itemIsEditable(item)) return;
        const next = (value || "").trim();
        if (next === valueOf(item, spec.keys)) return;
        void setExtraBlock(item, spec.keys, next || null).catch((e) =>
          ztoolkit.log("[translations] save failed", e),
        );
      },
    });
    if (typeof id === "string") registered.push(id);
    else ztoolkit.log(`[translations] ${spec.rowID} rejected`);
  }
  if (registered.length) (Zotero as any)[OWNER_KEY] = { instance: INSTANCE_ID };
}

export function unregisterTranslationRows() {
  const ids = registered;
  registered = [];
  if (!ids.length) return;
  if (!ownsRows()) {
    // a newer copy of the plugin holds these row IDs; removing them now would
    // take the rows out from under the running Zotero
    ztoolkit.log("[translations] skipping unregister: newer instance owns it");
    return;
  }
  const manager = (Zotero as any).ItemPaneManager;
  for (const id of ids) {
    try {
      manager?.unregisterInfoRow?.(id);
    } catch (e) {
      ztoolkit.log("[translations] unregister failed", e);
    }
  }
}

/** Register or drop the rows to match the pref; safe to call repeatedly. */
export function syncTranslationRows() {
  if (getPref("info.translations")) registerTranslationRows();
  else unregisterTranslationRows();
}

function valueOf(item: Zotero.Item | undefined, keys: string[]): string {
  if (!(item instanceof Zotero.Item) || !item.isRegularItem()) return "";
  return getExtraBlock(item, keys)?.value || "";
}
