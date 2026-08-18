import { config } from "../../package.json";
import { getLocaleID, getString } from "../utils/locale";
import { READ_STATUSES, setReadStatus } from "../reading/status";
import { setRating } from "../columns/rating";
import { readingStore } from "../reading/store";
import {
  exportReadingDataUI,
  importReadingDataUI,
} from "../reading/exportImport";
import { migrateLegacyUI } from "../reading/migrate";
import { runBatch } from "../ui/batch";
import { toggleGraphPane } from "../graph/pane";
import { toggleTagTree } from "../tags/nestedTree";
import { openStatsDialog } from "../panes/statsDialog";
import { openMatrix } from "../panes/annotMatrix";
import { toggleSidebar } from "../tabs/sidebar";
import { importBetterAuthors } from "../columns/authors";
import { rankSourceThrottled, refreshJournal } from "../rank";
import { updateCitations, citableItems } from "../cite";
import {
  typesInView,
  toggleType,
  clearTypeFilter,
  activeTypes,
  canTypeFilter,
} from "../views/typeFilter";

/**
 * Menus via the official `Zotero.MenuManager` (Zotero 8+; this plugin
 * requires 9+, so no DOM fallback):
 *  - item context menu → "Zest" submenu: status, rating, clear reading data
 *  - Tools menu → "Zest" submenu: import legacy data, export/import reading data
 */

const registered: string[] = [];

/** the pane id returned by PreferencePanes.register (set from hooks) */
export let prefPaneID = "";
export function setPrefPaneID(id: string) {
  prefPaneID = id;
}
export function openZestPreferences() {
  try {
    (Zotero.Utilities.Internal as any).openPreferences(prefPaneID || undefined);
  } catch (e) {
    ztoolkit.log("[menus] openPreferences failed", e);
  }
}

function regularItems(context: any): Zotero.Item[] {
  return ((context?.items || []) as any[]).filter(
    (i) => i instanceof Zotero.Item && i.isRegularItem(),
  );
}

async function setStatusForAll(items: Zotero.Item[], status: string | null) {
  const editable = items.filter((i) => i.isEditable());
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

async function setRatingForAll(items: Zotero.Item[], n: number) {
  const editable = items.filter((i) => i.isEditable());
  if (!editable.length) return;
  if (editable.length <= 5) {
    for (const it of editable) await setRating(it, n);
    return;
  }
  await runBatch(
    getString("menu-rating", "label"),
    editable,
    async (item) => setRating(item, n),
    {
      confirmMessage: getString("batch-confirm-count", {
        args: { count: editable.length },
      }),
    },
  );
}

async function refreshJournalsFor(items: Zotero.Item[]) {
  if (!items.length) return;
  // one request per JOURNAL, not per item — dedupe before the batch
  const byJournal = new Map<string, Zotero.Item>();
  for (const it of items) {
    let key: string;
    try {
      key = String(
        it.getField("publicationTitle") || it.getField("ISSN") || "",
      );
    } catch {
      key = "";
    }
    if (!key || byJournal.has(key)) continue;
    byJournal.set(key, it);
  }
  const targets = [...byJournal.values()];
  if (!targets.length) return;
  await runBatch(
    getString("rank-menu-refresh", "label"),
    targets,
    async (item) => {
      // once the rank service is throttled, every further journal in this batch
      // would get the same "too fast" answer and be recorded as a miss — stop
      // instead of spending the rest of the batch on refusals
      if (rankSourceThrottled()) throw new Error("rank source throttled");
      await refreshJournal(item);
    },
    {
      confirmMessage: getString("batch-confirm-count", {
        args: { count: targets.length },
      }),
    },
  );
}

async function updateCitationsFor(items: Zotero.Item[], onlyStale: boolean) {
  const targets = citableItems(items, onlyStale);
  const win = Zotero.getMainWindow();
  if (!targets.length) {
    Services.prompt.alert(
      win as any,
      getString("menu-citations-update", "label"),
      getString("citations-none"),
    );
    return;
  }
  const tally = { updated: 0, unchanged: 0, missing: 0, failed: 0 };
  await runBatch(
    getString("menu-citations-update", "label"),
    targets,
    async (item) => {
      const outcome = await updateCitations(item, !onlyStale);
      if (outcome.status === "updated") tally.updated++;
      else if (outcome.status === "unchanged") tally.unchanged++;
      else if (outcome.status === "no-id") tally.missing++;
      else tally.failed++;
    },
    {
      confirmMessage: getString("batch-confirm-count", {
        args: { count: targets.length },
      }),
    },
  );
  Services.prompt.alert(
    win as any,
    getString("menu-citations-update", "label"),
    getString("citations-done", { args: tally }),
  );
}

async function clearReadingData(items: Zotero.Item[]) {
  if (!items.length) return;
  const win = Zotero.getMainWindow();
  const ok = Services.prompt.confirm(
    win as any,
    getString("menu-clear-reading", "label"),
    getString("clear-reading-confirm", { args: { count: items.length } }),
  );
  if (!ok) return;
  try {
    for (const it of items) await readingStore.clearItem(it.libraryID, it.key);
  } catch (e) {
    ztoolkit.log("[menus] clear reading data failed", e);
    Services.prompt.alert(
      win as any,
      getString("menu-clear-reading", "label"),
      String(e),
    );
  }
}

/**
 * The type submenu is rebuilt on every popup: MenuManager keeps our array by
 * reference, so we return live-computed children through a getter-ish factory
 * that Zotero calls when the menu is shown.
 */
function typeFilterMenus(): any[] {
  const win = Zotero.getMainWindow() as unknown as Window;
  const items: any[] = [];
  if (!win) return items;
  for (const { type, label, count } of typesInView(win).slice(0, 20)) {
    items.push({
      menuType: "menuitem",
      label: count ? `${label} (${count})` : label,
      isChecked: () => activeTypes(win).includes(type),
      onCommand: () => void toggleType(win, type),
    });
  }
  items.push({ menuType: "separator" });
  items.push({
    menuType: "menuitem",
    l10nID: getLocaleID("typefilter-clear"),
    onCommand: () => void clearTypeFilter(win),
  });
  return items;
}

export function registerMenus() {
  const mm = (Zotero as any).MenuManager;
  if (!mm?.registerMenu) {
    ztoolkit.log("[menus] MenuManager unavailable");
    return;
  }
  const statusItems = READ_STATUSES.map((s) => ({
    menuType: "menuitem",
    l10nID: getLocaleID(
      `status-menu-${s.toLowerCase().replace(/\s+/g, "-")}` as any,
    ),
    onCommand: (_ev: any, ctx: any) =>
      void setStatusForAll(regularItems(ctx), s),
  }));
  const ratingItems = [5, 4, 3, 2, 1].map((n) => ({
    menuType: "menuitem",
    l10nID: getLocaleID(`rating-menu-${n}` as any),
    onCommand: (_ev: any, ctx: any) =>
      void setRatingForAll(regularItems(ctx), n),
  }));

  const id1 = mm.registerMenu({
    menuID: `${config.addonRef}-item-menu`,
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-root"),
        icon: `chrome://${config.addonRef}/content/icons/menu.svg`,
        onShowing: (_ev: any, ctx: any) => {
          ctx.setVisible?.(regularItems(ctx).length > 0);
        },
        menus: [
          {
            menuType: "submenu",
            l10nID: getLocaleID("menu-status"),
            menus: [
              ...statusItems,
              { menuType: "separator" },
              {
                menuType: "menuitem",
                l10nID: getLocaleID("status-menu-clear"),
                onCommand: (_ev: any, ctx: any) =>
                  void setStatusForAll(regularItems(ctx), null),
              },
            ],
          },
          {
            menuType: "submenu",
            l10nID: getLocaleID("menu-rating"),
            menus: [
              ...ratingItems,
              { menuType: "separator" },
              {
                menuType: "menuitem",
                l10nID: getLocaleID("rating-menu-clear"),
                onCommand: (_ev: any, ctx: any) =>
                  void setRatingForAll(regularItems(ctx), 0),
              },
            ],
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-citations-update"),
            onCommand: (_ev: any, ctx: any) =>
              void updateCitationsFor(regularItems(ctx), false),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-citations-update-stale"),
            onCommand: (_ev: any, ctx: any) =>
              void updateCitationsFor(regularItems(ctx), true),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("rank-menu-refresh"),
            onCommand: (_ev: any, ctx: any) =>
              void refreshJournalsFor(regularItems(ctx)),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-clear-reading"),
            onCommand: (_ev: any, ctx: any) =>
              void clearReadingData(regularItems(ctx)),
          },
        ],
      },
    ],
  });
  if (id1) registered.push(id1);

  const id2 = mm.registerMenu({
    menuID: `${config.addonRef}-tools-menu`,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-root"),
        icon: `chrome://${config.addonRef}/content/icons/menu.svg`,
        menus: [
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-settings"),
            onCommand: () => openZestPreferences(),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tabs"),
            onCommand: () => {
              const win = Zotero.getMainWindow();
              if (win) toggleSidebar(win as unknown as Window);
            },
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-matrix"),
            onCommand: () => {
              const win = Zotero.getMainWindow();
              if (win) openMatrix(win as unknown as Window);
            },
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-stats"),
            onCommand: () => {
              const win = Zotero.getMainWindow();
              if (win) openStatsDialog(win as unknown as Window);
            },
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-tagtree"),
            onCommand: () => {
              const win = Zotero.getMainWindow();
              if (win) toggleTagTree(win as unknown as Window);
            },
          },
          {
            menuType: "submenu",
            l10nID: getLocaleID("menu-typefilter"),
            getVisibility: () => canTypeFilter(),
            menus: typeFilterMenus(),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-graph"),
            onCommand: () => {
              const win = Zotero.getMainWindow();
              if (win) toggleGraphPane(win as unknown as Window);
            },
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-authors-import"),
            onCommand: () => {
              const report = importBetterAuthors();
              Services.prompt.alert(
                Zotero.getMainWindow() as any,
                getString("menu-authors-import", "label"),
                getString("authors-import-done", {
                  args: {
                    applied: report.applied.join(", ") || "—",
                    skipped: report.skipped.join(", ") || "—",
                  },
                }),
              );
            },
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-migrate"),
            onCommand: () => void migrateLegacyUI(),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-export-json"),
            onCommand: () => void exportReadingDataUI("json"),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-export-csv"),
            onCommand: () => void exportReadingDataUI("csv"),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-import"),
            onCommand: () => void importReadingDataUI(),
          },
        ],
      },
    ],
  });
  if (id2) registered.push(id2);
}

export function unregisterMenus() {
  const mm = (Zotero as any).MenuManager;
  for (const id of registered.splice(0)) {
    try {
      mm?.unregisterMenu?.(id);
    } catch (e) {
      ztoolkit.log("[menus] unregister failed", e);
    }
  }
}
