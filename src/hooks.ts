import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import {
  registerPrefsScripts,
  onPrefsCommand,
} from "./modules/preferenceScript";
import {
  registerDevEval,
  installStartupConsoleProbe,
  devMark,
} from "./modules/devEval";
import { registerMenus, unregisterMenus, setPrefPaneID } from "./modules/menus";
import {
  installExportPatch,
  uninstallExportPatch,
} from "./modules/exportPatch";
import {
  registerStyles,
  unregisterStyles,
  applyRootFlags,
  syncAccent,
} from "./ui/styles";
import {
  restoreGraphPane,
  hideGraphPane,
  showGraphPane,
  isGraphVisible,
  refreshGraphPanes,
  uninstallGraphPanes,
} from "./graph/pane";
import {
  installTagTree,
  uninstallTagTree,
  uninstallAllTagTrees,
  isTreeShown,
  setTreeShown,
  refreshAllTagTrees,
} from "./tags/nestedTree";
import { clearItemFilters, clearWindowFilters } from "./views/itemFilter";
import {
  installRevealGuard,
  uninstallRevealGuard,
  uninstallAllRevealGuards,
} from "./views/reveal";
import {
  installViewMenu,
  uninstallViewMenu,
  uninstallAllViewMenus,
  installViewShortcuts,
  uninstallViewShortcuts,
  uninstallAllViewShortcuts,
} from "./views/viewGroups";
import {
  installCollectionCounts,
  uninstallCollectionCounts,
  uninstallAllCollectionCounts,
  syncCollectionCounts,
  sweepBadgesIn as sweepCollectionBadgesIn,
} from "./views/collectionCounts";
import { resetTypeFilter } from "./views/typeFilter";
import { installColorSchemes } from "./reader/colorSchemes";
import {
  restoreSidebar,
  showSidebar,
  hideSidebar,
  isSidebarOpen,
  syncNativeBarVisibility,
  uninstallSidebars,
} from "./tabs/sidebar";
import {
  registerAnnotSection,
  unregisterAnnotSection,
} from "./panes/annotSection";
import {
  registerInfoSection,
  unregisterInfoSection,
} from "./panes/infoSection";
import { closeStatsDialog } from "./panes/statsDialog";
import { closeMatrix } from "./panes/annotMatrix";
import { getPref } from "./utils/prefs";
import { zestDB } from "./core/db";
import { cache } from "./core/storage";
import { zestConfig } from "./core/config";
import { readingStore } from "./reading/store";
import { readingTracker } from "./reading/tracker";
import {
  registerAllColumns,
  unregisterAll as unregisterColumns,
  installTitleDecor,
  uninstallTitleDecor,
  refreshAllRows,
} from "./columns";

let prefObservers: symbol[] = [];

async function onStartup() {
  installStartupConsoleProbe();
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  registerDevEval();

  // every startup step individually guarded: one failing registration must
  // not take the whole plugin down
  const step = (name: string, fn: () => void | Promise<void>) => {
    devMark(`step ${name} begin`);
    try {
      const r = fn();
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>)
          .then(() => devMark(`step ${name} done`))
          .catch((e) => fail(name, e));
      } else {
        devMark(`step ${name} done`);
      }
    } catch (e) {
      fail(name, e);
    }
  };
  const fail = (name: string, e: unknown) => {
    ztoolkit.log(`[startup] ${name} failed`, e);
    try {
      Zotero.logError(e as any);
    } catch {
      // ignore
    }
  };

  step("locale", () => initLocale());
  // config + derived-data cache: both are plain JSON files next to
  // zotero.sqlite. Steps run concurrently, so anything that READS them (the
  // columns, the tag rules) must await this promise rather than assume it
  // finished first.
  const configReady = Promise.all([zestConfig.init(), cache.init()]).catch(
    (e) => {
      ztoolkit.log("[startup] config failed", e);
    },
  );
  step("config", async () => {
    await configReady;
  });
  step("prefsPane", async () => {
    const id = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: config.addonName,
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    });
    if (typeof id === "string") setPrefPaneID(id);
  });
  // storage: open DB + load the in-memory index (async; columns refresh
  // themselves when the store reports the load)
  step("db", async () => {
    await zestDB.init();
    await readingStore.load();
  });
  // Register columns only once the main item tree is mounted: each
  // registerColumn() makes Zotero refresh every ItemTree instance, and an
  // instance without a rendered `tree` throws inside Zotero's notify handler
  // (observed on 10.0 at startup), which stalls the DB transaction queue.
  step("columns", async () => {
    await configReady;
    await whenItemTreeReady();
    registerAllColumns();
  });
  step("itemPane", () => {
    registerInfoSection();
    registerAnnotSection();
  });
  step("reader", () => installColorSchemes());
  step("menus", () => registerMenus());
  step("exportPatch", () => installExportPatch());
  step("tracker", () => {
    if (getPref("tracker.enable")) readingTracker.start();
  });
  step("prefObservers", () => {
    const P = config.prefsPrefix;
    prefObservers.push(
      Zotero.Prefs.registerObserver(
        `${P}.tracker.enable`,
        () => {
          if (getPref("tracker.enable")) readingTracker.start();
          else readingTracker.stop();
        },
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.tracker.sampleSeconds`,
        () => readingTracker.running && readingTracker.restartTimer(),
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.collectionCounts.enable`,
        () => syncCollectionCounts(),
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.collectionCounts.mode`,
        () => syncCollectionCounts(),
        true,
      ),
      // the tab sidebar, the tag tree and the graph read their prefs once, at
      // mount — without these the settings-pane checkboxes only take effect
      // after a restart
      Zotero.Prefs.registerObserver(`${P}.ui.accent`, () => syncAccent(), true),
      Zotero.Prefs.registerObserver(
        `${P}.tabs.sidebar`,
        () => {
          const want = !!getPref("tabs.sidebar");
          for (const win of Zotero.getMainWindows()) {
            const w = win as unknown as Window;
            if (want === isSidebarOpen(w)) continue;
            if (want) showSidebar(w);
            else hideSidebar(w, false);
          }
        },
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.tabs.hideNative`,
        () => syncNativeBarVisibility(),
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.nestedTags.show`,
        () => {
          const want = isTreeShown();
          for (const win of Zotero.getMainWindows()) {
            setTreeShown(win as unknown as Window, want);
          }
        },
        true,
      ),
      ...[
        "nestedTags.linkSymbol",
        "nestedTags.sort",
        "nestedTags.showAllTags",
        "nestedTags.matchChildTags",
      ].map((p) =>
        Zotero.Prefs.registerObserver(
          `${P}.${p}`,
          () => refreshAllTagTrees(),
          true,
        ),
      ),
      ...["graph.mode", "graph.height", "graph.maxNodes"].map((p) =>
        Zotero.Prefs.registerObserver(
          `${P}.${p}`,
          () => refreshGraphPanes(),
          true,
        ),
      ),
      Zotero.Prefs.registerObserver(
        `${P}.graph.visible`,
        () => {
          const want = !!getPref("graph.visible");
          for (const win of Zotero.getMainWindows()) {
            const w = win as unknown as Window;
            if (want === isGraphVisible(w)) continue;
            if (want) showGraphPane(w);
            else hideGraphPane(w, false);
          }
        },
        true,
      ),
      Zotero.Prefs.registerObserver(
        `${P}.tags.hideInTitle`,
        () => {
          for (const win of Zotero.getMainWindows()) {
            applyRootFlags(
              win as unknown as Window,
              !!getPref("tags.hideInTitle"),
            );
          }
        },
        true,
      ),
    );
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  devMark("windows loaded");
  addon.data.initialized = true;
}

/** Resolve when the main window's item tree (and its VirtualizedTable) exists, or after ~15 s. */
async function whenItemTreeReady(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const win = Zotero.getMainWindow() as any;
      if (win?.ZoteroPane?.itemsView?.tree) return;
    } catch {
      // window not ready
    }
    await Zotero.Promise.delay(250);
  }
}

/**
 * Resolve once THIS window's panes exist (or after ~15 s).
 *
 * `onMainWindowLoad` fires while a second window is still building: its
 * `ZoteroPane.itemsView` / `collectionsView` are undefined for a moment, and
 * every binding that needs them used to bail out silently — so a second window
 * came up with no tag tree, no counts, no graph and no tab sidebar until the
 * user restarted Zotero.
 */
async function whenPaneReady(win: Window): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (win.closed) return false;
    try {
      const pane = (win as any).ZoteroPane;
      if (pane?.itemsView && pane?.collectionsView) return true;
    } catch {
      // still building
    }
    await Zotero.Promise.delay(250);
  }
  return !win.closed;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
  const w = win as unknown as Window;
  registerStyles(w);
  applyRootFlags(w, !!getPref("tags.hideInTitle"));
  installTitleDecor(w);
  installViewMenu(w);
  installViewShortcuts(w);
  // everything below reads ZoteroPane's trees
  if (!(await whenPaneReady(w))) return;
  installTagTree(w);
  installRevealGuard(w);
  sweepCollectionBadgesIn(w);
  installCollectionCounts(w);
  restoreGraphPane(w);
  restoreSidebar(w);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  uninstallCollectionCounts(win);
  uninstallViewMenu(win);
  uninstallViewShortcuts(win);
  uninstallTagTree(win);
  uninstallRevealGuard(win);
  hideGraphPane(win, false);
  hideSidebar(win, false);
  clearWindowFilters(win);
  uninstallTitleDecor(win);
  unregisterStyles(win);
  addon.data.dialog?.window?.close();
}

async function onShutdown() {
  readingTracker.stop();
  unregisterAnnotSection();
  unregisterInfoSection();
  closeStatsDialog();
  closeMatrix();
  uninstallAllTagTrees();
  uninstallAllViewMenus();
  uninstallAllViewShortcuts();
  uninstallAllCollectionCounts();
  uninstallAllRevealGuards();
  resetTypeFilter();
  clearItemFilters();
  uninstallGraphPanes();
  uninstallSidebars();
  uninstallExportPatch();
  unregisterMenus();
  unregisterColumns();
  for (const s of prefObservers) {
    try {
      Zotero.Prefs.unregisterObserver(s);
    } catch {
      // ignore
    }
  }
  prefObservers = [];
  for (const win of Zotero.getMainWindows()) {
    unregisterStyles(win as unknown as Window);
  }
  refreshAllRows();
  try {
    await readingStore.shutdown();
  } catch (e) {
    ztoolkit.log("[shutdown] store flush failed", e);
  }
  await zestDB.close();
  await cache.shutdown();
  await zestConfig.shutdown();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

/** APP_SHUTDOWN: only persist — Zotero closes its DB right after us. */
async function onAppShutdown() {
  try {
    readingTracker.stop();
    await readingStore.shutdown();
  } catch (e) {
    ztoolkit.log("[appShutdown] flush failed", e);
  }
  await zestDB.close();
  await cache.shutdown();
  await zestConfig.shutdown();
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {
  // reserved (tracker and columns register their own observers)
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      await onPrefsCommand(type);
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onAppShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
