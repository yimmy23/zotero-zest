import { zestDB } from "../core/db";
import { migrateLegacyUI } from "../reading/migrate";
import {
  exportReadingDataUI,
  importReadingDataUI,
} from "../reading/exportImport";
import { getString } from "../utils/locale";
import { exportBundle, importBundle, zestConfig } from "../core/config";
import {
  parseDataset,
  saveDataset,
  removeDataset,
} from "../rank/sources/localDataset";
import { clearRankCache } from "../rank";
import { getSecret, setSecret, secretIsInPrefs } from "../core/secrets";
import { installPresets, removePresets } from "../reader/themes";
import { views, removeView, renameView } from "../views/viewGroups";

/**
 * Preference pane logic. The pane itself is declarative (preference="…"
 * bindings); this module fills the dynamic parts (database path, stored key,
 * dataset and view lists) and handles the buttons, which call back through
 * `Zotero.Zest.hooks.onPrefsEvent(type, { window })` because pane scripts run
 * in a sandbox since Zotero 8.
 */

const IDS = {
  dbPath: "zest-pref-dbpath",
  key: "zest-pref-eskey",
  keyStatus: "zest-pref-keystatus",
  datasets: "zest-pref-datasets",
  viewsList: "zest-pref-views",
};

let paneWindow: Window | undefined;

export async function registerPrefsScripts(_window: Window) {
  paneWindow = _window;
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window } as any;
  } else {
    addon.data.prefs.window = _window;
  }
  try {
    const el = _window.document.getElementById(IDS.dbPath);
    if (el) el.textContent = zestDB.path || "";
  } catch {
    // cosmetic
  }
  await refreshKeyField();
  refreshDatasetList();
  refreshViewList();
  const unsub = zestConfig.onChange(() => {
    refreshDatasetList();
    refreshViewList();
  });
  _window.addEventListener("unload", () => {
    unsub();
    if (paneWindow === _window) paneWindow = undefined;
  });
}

function doc(): Document | undefined {
  try {
    return paneWindow?.document;
  } catch {
    return undefined;
  }
}

async function refreshKeyField() {
  const d = doc();
  if (!d) return;
  const input = d.getElementById(IDS.key) as HTMLInputElement | null;
  const status = d.getElementById(IDS.keyStatus);
  if (input) {
    const key = await getSecret("easyscholar");
    // never show the key itself back to the screen
    input.value = key ? "••••••••" : "";
    input.dataset.hasKey = key ? "1" : "";
  }
  if (status) {
    status.textContent = secretIsInPrefs("easyscholar")
      ? getString("pref-key-plaintext")
      : "";
  }
}

function refreshDatasetList() {
  const d = doc();
  const list = d?.getElementById(IDS.datasets);
  if (!d || !list) return;
  list.textContent = "";
  const datasets = zestConfig.get().datasets;
  if (!datasets.length) {
    const empty = d.createElement("div");
    empty.className = "zest-pref-hint";
    empty.textContent = getString("pref-datasets-empty");
    list.appendChild(empty);
    return;
  }
  for (const ds of datasets) {
    const row = d.createElement("div");
    row.className = "zest-pref-row";
    const label = d.createElement("span");
    label.textContent = `${ds.name} — ${ds.rows} · ${ds.fields.slice(0, 6).join(", ")}`;
    row.appendChild(label);
    const del = d.createElement("button");
    del.textContent = getString("pref-dataset-remove");
    del.addEventListener("click", () => {
      void removeDataset(ds.id).then(() => {
        clearRankCache();
        refreshDatasetList();
      });
    });
    row.appendChild(del);
    list.appendChild(row);
  }
}

function refreshViewList() {
  const d = doc();
  const list = d?.getElementById(IDS.viewsList);
  if (!d || !list) return;
  list.textContent = "";
  const all = views();
  if (!all.length) {
    const empty = d.createElement("div");
    empty.className = "zest-pref-hint";
    empty.textContent = getString("pref-views-empty");
    list.appendChild(empty);
    return;
  }
  for (const view of all) {
    const row = d.createElement("div");
    row.className = "zest-pref-row";
    const label = d.createElement("span");
    const shown = view.columns.filter((c) => !c.hidden).length;
    label.textContent = `${view.name} — ${shown}`;
    row.appendChild(label);
    const rename = d.createElement("button");
    rename.textContent = getString("pref-view-rename");
    rename.addEventListener("click", () => {
      const out = { value: view.name };
      const ok = Services.prompt.prompt(
        paneWindow as any,
        getString("pref-view-rename"),
        view.name,
        out,
        null as any,
        { value: false },
      );
      if (ok) {
        renameView(view.id, out.value);
        refreshViewList();
      }
    });
    row.appendChild(rename);
    const del = d.createElement("button");
    del.textContent = getString("pref-view-remove");
    del.addEventListener("click", () => {
      removeView(view.id);
      refreshViewList();
    });
    row.appendChild(del);
    list.appendChild(row);
  }
}

function alertUser(title: string, message: string) {
  try {
    Services.prompt.alert(
      (paneWindow || Zotero.getMainWindow()) as any,
      title,
      message,
    );
  } catch (e) {
    ztoolkit.log("[prefs] alert failed", e);
  }
}

async function pickFile(
  mode: "open" | "save",
  title: string,
  filters: [string, string][],
  defaultName?: string,
): Promise<string | null> {
  const FilePicker = ztoolkit.FilePicker as any;
  const path = await new FilePicker(
    title,
    mode,
    filters,
    defaultName,
  ).open();
  return typeof path === "string" && path ? path : null;
}

async function exportConfiguration() {
  const path = await pickFile(
    "save",
    getString("pref-config-export"),
    [["JSON", "*.json"]],
    "zest-config.json",
  );
  if (!path) return;
  const bundle = exportBundle();
  await Zotero.File.putContentsAsync(path, JSON.stringify(bundle, null, 1));
  alertUser(
    getString("pref-config-export"),
    getString("pref-config-export-done", {
      args: {
        prefs: Object.keys(bundle.prefs).length,
        views: bundle.config.viewGroups.length,
        rules: bundle.config.tagRules.length,
      },
    }),
  );
}

async function importConfiguration() {
  const path = await pickFile("open", getString("pref-config-import"), [
    ["JSON", "*.json"],
  ]);
  if (!path) return;
  let report;
  try {
    const raw = (await Zotero.File.getContentsAsync(path)) as string;
    report = importBundle(JSON.parse(raw), false);
  } catch (e) {
    alertUser(getString("pref-config-import"), String(e));
    return;
  }
  await refreshKeyField();
  refreshDatasetList();
  refreshViewList();
  alertUser(
    getString("pref-config-import"),
    getString("pref-config-import-done", {
      args: {
        prefs: report.prefs,
        views: report.viewGroups,
        rules: report.tagRules,
        skipped: report.skipped,
      },
    }),
  );
}

async function importDatasetFile() {
  const path = await pickFile("open", getString("pref-dataset-import"), [
    ["JSON / CSV", "*.json;*.csv;*.tsv;*.txt"],
  ]);
  if (!path) return;
  try {
    const raw = (await Zotero.File.getContentsAsync(path)) as string;
    const kind = /\.(csv|tsv|txt)$/i.test(path) ? "csv" : "json";
    const parsed = parseDataset(raw, kind);
    if (!parsed.rows.length) {
      alertUser(
        getString("pref-dataset-import"),
        getString("pref-dataset-empty"),
      );
      return;
    }
    const name = PathUtils.filename(path).replace(/\.[^.]+$/, "");
    const meta = await saveDataset(name, parsed);
    clearRankCache();
    refreshDatasetList();
    alertUser(
      getString("pref-dataset-import"),
      getString("pref-dataset-import-done", {
        args: { name: meta.name, rows: meta.rows, fields: meta.fields.length },
      }),
    );
  } catch (e) {
    alertUser(getString("pref-dataset-import"), String(e));
  }
}

async function saveKey() {
  const d = doc();
  const input = d?.getElementById(IDS.key) as HTMLInputElement | null;
  if (!input) return;
  const value = input.value.trim();
  if (value === "••••••••") return; // unchanged placeholder
  const where = await setSecret("easyscholar", value);
  clearRankCache();
  await refreshKeyField();
  alertUser(
    getString("pref-key-save"),
    where === "login-manager"
      ? getString("pref-key-saved")
      : getString("pref-key-plaintext"),
  );
}

export async function onPrefsCommand(type: string) {
  switch (type) {
    case "migrate":
      await migrateLegacyUI();
      break;
    case "export-json":
      await exportReadingDataUI("json");
      break;
    case "export-csv":
      await exportReadingDataUI("csv");
      break;
    case "import":
      await importReadingDataUI();
      break;
    case "config-export":
      await exportConfiguration();
      break;
    case "config-import":
      await importConfiguration();
      break;
    case "dataset-import":
      await importDatasetFile();
      break;
    case "key-save":
      await saveKey();
      break;
    case "rank-clear":
      clearRankCache();
      alertUser(getString("pref-rank-clear"), getString("pref-rank-cleared"));
      break;
    case "themes-install": {
      const n = await installPresets();
      alertUser(
        getString("pref-themes-install"),
        getString("reader-themes-installed", { args: { count: n } }),
      );
      break;
    }
    case "themes-remove": {
      const n = await removePresets();
      alertUser(
        getString("pref-themes-install"),
        getString("reader-themes-removed", { args: { count: n } }),
      );
      break;
    }
  }
}
