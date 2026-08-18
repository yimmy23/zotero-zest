import { config } from "../../package.json";
import { readingStore, splitKey } from "../reading/store";
import { readingColumn } from "./reading";
import { statusColumn } from "./status";
import { ratingColumn } from "./rating";
import { tagsColumn } from "./tags";
import { textTagsColumn } from "./textTags";
import {
  registerColumn,
  unregisterColumn,
  unregisterAllColumns,
  refreshItems,
  refreshAllRows,
  isRegistered,
  type ColumnSpec,
} from "./registry";
import { installTitleDecor, uninstallTitleDecor } from "./titleDecor";

/**
 * Column layer entry point: registers the Phase-B columns, wires the
 * reading store → row refresh, and reacts to prefs (enable/disable a
 * column = register/unregister; display prefs = repaint).
 */

const SPECS: Array<() => ColumnSpec> = [
  readingColumn,
  statusColumn,
  ratingColumn,
  tagsColumn,
  textTagsColumn,
];

const prefObservers: symbol[] = [];
let unsubStore: (() => void) | undefined;
let notifierID: string | undefined;

export function registerAllColumns() {
  for (const make of SPECS) {
    try {
      registerColumn(make());
    } catch (e) {
      ztoolkit.log("[columns] register failed", e);
    }
  }
  // reading data changed → refresh those rows
  unsubStore = readingStore.onChange((keys) => {
    const ids: number[] = [];
    for (const key of keys) {
      const [lib, itemKey] = splitKey(key);
      try {
        const id = Zotero.Items.getIDFromLibraryAndKey(lib, itemKey);
        if (id) ids.push(id as number);
      } catch {
        // unknown key (deleted item)
      }
    }
    if (ids.length > 400) refreshAllRows();
    else if (ids.length) refreshItems(ids);
  });
  // tag colours live in the SyncedSetting `tagColors`; Zotero only repaints
  // rows on change (dataProvider output stays cached) → recompute ourselves.
  // priority 101 = after Zotero.Tags refreshed its colour cache (100).
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (_event: string, type: string, ids: any[]) => {
        if (type !== "setting") return;
        if (ids.some((id) => String(id).endsWith("/tagColors")))
          refreshAllRows();
      },
    },
    ["setting"],
    `${config.addonRef}-columns`,
    101,
  );
  // prefs
  const P = config.prefsPrefix;
  const watchEnable = (specMake: () => ColumnSpec, pref: string) => {
    prefObservers.push(
      Zotero.Prefs.registerObserver(
        `${P}.${pref}`,
        () => {
          const spec = specMake();
          const on = !!Zotero.Prefs.get(`${P}.${pref}`, true);
          if (on && !isRegistered(spec.key)) registerColumn(spec);
          else if (!on && isRegistered(spec.key)) unregisterColumn(spec.key);
        },
        true,
      ),
    );
  };
  watchEnable(readingColumn, "column.reading.enable");
  watchEnable(statusColumn, "column.status.enable");
  watchEnable(ratingColumn, "column.rating.enable");
  watchEnable(tagsColumn, "column.tags.enable");
  watchEnable(textTagsColumn, "column.textTags.enable");
  for (const p of [
    "textTags.match",
    "textTags.color",
    "heat.color",
    "heat.opacity",
    "titleDecor.heat",
    "titleDecor.unreadBold",
  ]) {
    prefObservers.push(
      Zotero.Prefs.registerObserver(`${P}.${p}`, () => refreshAllRows(), true),
    );
  }
}

export function unregisterAll() {
  unsubStore?.();
  unsubStore = undefined;
  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch {
      // ignore
    }
    notifierID = undefined;
  }
  for (const s of prefObservers) {
    try {
      Zotero.Prefs.unregisterObserver(s);
    } catch {
      // ignore
    }
  }
  prefObservers.length = 0;
  unregisterAllColumns();
  uninstallTitleDecor();
}

export { installTitleDecor, uninstallTitleDecor, refreshAllRows };
