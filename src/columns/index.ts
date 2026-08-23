import { config } from "../../package.json";
import { readingStore, splitKey } from "../reading/store";
import { readingColumn } from "./reading";
import { statusColumn } from "./status";
import { ratingColumn } from "./rating";
import { tagsColumn } from "./tags";
import { textTagsColumn } from "./textTags";
import { annotationsColumn } from "./annotations";
import { citationsColumn } from "./citations";
import { remarkColumn } from "./remark";
import {
  authorsColumn,
  firstAuthorColumn,
  lastAuthorColumn,
  bumpAuthorsVersion,
} from "./authors";
import {
  publicationTagsColumn,
  impactFactorColumn,
  venueColumn,
} from "./pubTags";
import { startRankService, stopRankService } from "../rank";
import { loadDatasets } from "../rank/sources/localDataset";
import { startAnnotationWatch, stopAnnotationWatch } from "../annots/density";
import {
  registerColumn,
  unregisterColumn,
  unregisterAllColumns,
  refreshItems,
  refreshAllRows,
  redrawAll,
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
  annotationsColumn,
  publicationTagsColumn,
  impactFactorColumn,
  venueColumn,
  authorsColumn,
  firstAuthorColumn,
  lastAuthorColumn,
  citationsColumn,
  remarkColumn,
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
  // Child attachments carry Zotero's own last-read stamp, which feeds the
  // derived read status of the PARENT row: a modified attachment refreshes it.
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string, ids: any[]) => {
        if (type === "setting") {
          if (ids.some((id) => String(id).endsWith("/tagColors")))
            refreshAllRows();
          return;
        }
        if (type === "item" && event === "modify") {
          const parents: number[] = [];
          for (const id of ids) {
            try {
              const it = Zotero.Items.get(Number(id)) as Zotero.Item | false;
              if (it && it.isAttachment() && it.parentID)
                parents.push(it.parentID);
            } catch {
              // gone
            }
          }
          if (parents.length) refreshItems(parents);
        }
      },
    },
    ["setting", "item"],
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
  watchEnable(annotationsColumn, "column.annots.enable");
  watchEnable(publicationTagsColumn, "column.pubtags.enable");
  watchEnable(impactFactorColumn, "column.if.enable");
  watchEnable(venueColumn, "column.venue.enable");
  watchEnable(authorsColumn, "column.authors.enable");
  watchEnable(firstAuthorColumn, "column.firstAuthor.enable");
  watchEnable(lastAuthorColumn, "column.lastAuthor.enable");
  watchEnable(citationsColumn, "column.citations.enable");
  watchEnable(remarkColumn, "column.remark.enable");
  // journal ranks resolve in the background; repaint the rows that were
  // waiting, and re-sort once if the tree is sorted by one of these columns
  startRankService((ids) => refreshItems(ids, { resort: true }));
  void loadDatasets();
  // annotation summaries are computed lazily; when a batch finishes (or the
  // user annotates something) repaint exactly those rows
  startAnnotationWatch((ids) => refreshItems(ids, { resort: true }));
  // These two lists are the whole contract between the settings pane and the
  // item tree: Zotero fires pref observers on an EXACT name only — a
  // prefix/branch registration never fires (verified on 10.0) — so every
  // preference a column reads while drawing has to be named here or the
  // control is dead until something else happens to invalidate the tree.
  //   read in dataProvider → recompute (the row cache holds the old value)
  //   read in renderCell   → repaint
  // A colour-picker drag emits a stream of writes; both helpers are debounced.
  // author formatting changes both what is drawn AND the sort key, so the
  // memo has to be dropped before the rows are recomputed
  for (const p of [
    "authors.preset",
    "authors.count",
    "authors.order",
    "authors.given",
    "authors.initialsDot",
    "authors.markLast",
    "authors.lastMark",
    "authors.selfNames",
    "authors.separator",
    "authors.etAl",
    "authors.omitted",
  ]) {
    prefObservers.push(
      Zotero.Prefs.registerObserver(
        `${P}.${p}`,
        () => {
          bumpAuthorsVersion();
          refreshAllRows();
        },
        true,
      ),
    );
  }
  for (const p of [
    "textTags.match",
    // the Tags column hides what the #Tags column claims, so its cached rows
    // change when that column is switched on or off
    "column.textTags.enable",
    "rank.fields",
    "rank.sortBy",
    "rank.map",
    // toggling online lookups changes what dataProvider CAN return, so the
    // rows have to be recomputed — without this the toolbar switch looks dead
    // until something else happens to invalidate the tree
    "rank.autoFetch",
    // decides whether a cached record is still returned at all
    "rank.ttlDays",
    // picks which metric the IF column reads — dataProvider, so the cached
    // row value has to go, not just the paint
    "if.field",
    // the derived read status is computed in dataProvider
    "status.derive",
    "statusAuto.readThreshold",
    "statusAuto.minMinutes",
  ]) {
    prefObservers.push(
      Zotero.Prefs.registerObserver(`${P}.${p}`, () => refreshAllRows(), true),
    );
  }
  for (const p of [
    "rank.colors",
    "rank.defaultColor",
    "rank.textColor",
    "rank.opacity",
    "if.max",
    "if.style",
    "if.info",
    "if.color",
    // decides which citation counts are drawn dimmed
    "cite.staleDays",
    "annots.style",
    "annots.color",
    "textTags.color",
    "textTags.textColor",
    "heat.color",
    "heat.opacity",
    "titleDecor.heat",
    "titleDecor.unreadBold",
    "titleDecor.unreadIncludesEmpty",
    "rating.mark",
    "rating.option",
    "rating.color",
  ]) {
    prefObservers.push(
      Zotero.Prefs.registerObserver(`${P}.${p}`, () => redrawAll(), true),
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
  stopAnnotationWatch();
  stopRankService();
  unregisterAllColumns();
  uninstallTitleDecor();
}

export { installTitleDecor, uninstallTitleDecor, refreshAllRows };
