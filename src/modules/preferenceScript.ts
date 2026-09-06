import { zestDB } from "../core/db";
import { migrateLegacyUI } from "../reading/migrate";
import {
  exportReadingDataUI,
  importReadingDataUI,
} from "../reading/exportImport";
import { getString } from "../utils/locale";
import type { FluentMessageId } from "../../typings/i10n";
import { exportBundle, importBundle, zestConfig } from "../core/config";
import {
  parseDataset,
  saveDataset,
  removeDataset,
} from "../rank/sources/localDataset";
import { clearRankCache } from "../rank";
import { fetchEasyScholar } from "../rank/sources/easyscholar";
import { http } from "../core/http";
import { getSecret, setSecret, secretIsInPrefs } from "../core/secrets";
import { views, removeView, renameView } from "../views/viewGroups";
import { setPref } from "../utils/prefs";
import { setTimeout } from "../utils/timers";
import { accentColor, syncAccent, ACCENT_FALLBACK } from "../ui/styles";
import { HEAT_COLOR_DEFAULT, BADGE_COLOR_DEFAULT } from "../ui/palette";
import { DEFAULT_RANK_COLOR } from "../rank/rank";
import { refreshAllRows } from "../columns";

/**
 * Preference pane logic. The pane itself is declarative (preference="…"
 * bindings); this module fills the dynamic parts (database path, stored key,
 * dataset and view lists) and handles the buttons, which call back through
 * `Zotero.Zest.hooks.onPrefsEvent(type, { window })` because pane scripts run
 * in a sandbox since Zotero 8.
 */

const IDS = {
  accentPresets: "zest-pref-accent-presets",
  dbPath: "zest-pref-dbpath",
  key: "zest-pref-eskey",
  keyStatus: "zest-pref-keystatus",
  s2Key: "zest-pref-s2key",
  s2KeyStatus: "zest-pref-s2keystatus",
  datasets: "zest-pref-datasets",
  viewsList: "zest-pref-views",
};

let paneWindow: Window | undefined;

export async function registerPrefsScripts(_window: Window) {
  paneWindow = _window;
  buildPrefNavigation(_window.document);
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
  buildAccentPresets();
  // Zotero binds the controls to their prefs after this load handler, and an
  // empty colour pref lands as #000000 — show the effective colour once that
  // has happened
  syncAutoColorPickers();
  setTimeout(() => syncAutoColorPickers(), 500);
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

/** One local jump list, using the existing Fluent section headings. */
function buildPrefNavigation(d: Document) {
  const root = d.getElementById("zest-prefs");
  const navigation = d.getElementById(
    "zest-pref-navigation",
  ) as HTMLElement | null;
  if (!root || !navigation || navigation.dataset.zestBuilt) return;
  navigation.dataset.zestBuilt = "true";
  for (const heading of root.querySelectorAll<HTMLElement>("groupbox h2")) {
    const stringID = heading.getAttribute("data-l10n-id");
    if (!stringID) continue;
    heading.tabIndex = -1;
    const button = d.createElement("button");
    button.type = "button";
    button.className = "zest-pref-jump";
    button.setAttribute("data-l10n-id", stringID);
    // The document owns preferences.ftl; getString() owns addon.ftl and
    // would add a second prefix to these already-resolved message IDs.
    button.textContent = heading.textContent;
    button.addEventListener("click", () => {
      heading.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
    });
    navigation.appendChild(button);
  }
}

/**
 * Accent presets — one click each, plus the colour picker beside them for
 * anything else. Blue is deliberately absent: Zotero paints the selected row
 * with the system selection blue, so a blue accent disappears into it.
 */
const ACCENT_PRESETS: Array<[string, FluentMessageId]> = [
  ["#40C463", "pref-accent-preset-green"],
  ["#59ADC4", "pref-accent-preset-teal"],
  ["#8A7BE0", "pref-accent-preset-violet"],
  ["#CC7A52", "pref-accent-preset-wood"],
  ["#8C8C8C", "pref-accent-preset-grey"],
];

function buildAccentPresets() {
  const d = doc();
  const host = d?.getElementById(IDS.accentPresets);
  if (!d || !host) return;
  host.textContent = "";
  for (const [color, stringID] of ACCENT_PRESETS) {
    const b = d.createElement("button");
    b.type = "button";
    b.className = "zest-pref-swatch";
    b.style.backgroundColor = color;
    b.title = `${getString(stringID)} · ${color}`;
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => {
      setPref("ui.accent", color);
      syncAccent();
      // the picker beside the swatches is bound to the pref, but XUL only
      // syncs it on its own input events
      const picker = d.querySelector(
        'input[preference$="ui.accent"]',
      ) as HTMLInputElement | null;
      if (picker) picker.value = color;
    });
    host.appendChild(b);
  }
}

/**
 * Three colour preferences mean "automatic" when empty (`rank.defaultColor`,
 * `if.color`, `annots.color` — the badge default, the accent, per-annotation
 * colours). An <input type=color> cannot show "empty": it renders black, and
 * once touched it cannot be emptied again. So the pickers are shown with the
 * colour that is in effect, and an "Auto" button beside each one clears the
 * preference (the picker writes only on its own input events, so setting its
 * value here does not write anything).
 */
const AUTO_COLOR_PREFS = [
  "rank.defaultColor",
  "if.color",
  "annots.color",
] as const;
type AutoColorPref = (typeof AUTO_COLOR_PREFS)[number];

function effectiveColor(pref: AutoColorPref): string {
  const raw = String(Zotero.Prefs.get(`${prefsPrefix()}.${pref}`, true) || "");
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return pref === "rank.defaultColor" ? DEFAULT_RANK_COLOR : accentColor();
}

function prefsPrefix(): string {
  return addon.data.config.prefsPrefix;
}

function syncAutoColorPickers(only?: AutoColorPref) {
  const d = doc();
  if (!d) return;
  for (const pref of AUTO_COLOR_PREFS) {
    if (only && pref !== only) continue;
    // the build prefixes `preference="if.color"` with the pref branch, so
    // match on the suffix (works for both spellings)
    const picker = d.querySelector(
      `input[preference$="${pref}"]`,
    ) as HTMLInputElement | null;
    if (picker) picker.value = effectiveColor(pref).toLowerCase();
  }
}

function resetAutoColor(pref: string) {
  if (!(AUTO_COLOR_PREFS as readonly string[]).includes(pref)) return;
  Zotero.Prefs.clear(`${prefsPrefix()}.${pref}`, true);
  syncAutoColorPickers(pref as AutoColorPref);
  refreshAllRows();
}

function doc(): Document | undefined {
  try {
    return paneWindow?.document;
  } catch {
    return undefined;
  }
}

/** the two API keys the settings pane can hold, and where each one lives */
const KEY_FIELDS = {
  easyscholar: { input: IDS.key, status: IDS.keyStatus },
  semanticscholar: { input: IDS.s2Key, status: IDS.s2KeyStatus },
} as const;

type KeyField = keyof typeof KEY_FIELDS;

/**
 * The key fields never hold the stored key. A stored key shows as a row of
 * bullets (a plain-text sentinel, so nothing secret is in the DOM and no
 * "reveal" button can expose anything); clicking in clears the row and turns
 * the box into a password field for the new entry; leaving it untouched puts
 * the bullets back. Only a field the user actually typed in (or emptied on
 * purpose) is saved. Whether a key is stored is also said in words underneath.
 */
const MASK = "••••••••";

function idleKeyField(input: HTMLInputElement) {
  input.type = "text";
  input.value = input.dataset.hasKey === "1" ? MASK : "";
  input.dataset.zestDirty = "";
  input.dataset.zestEditing = "";
}

/** true while the field holds a real (or deliberately cleared) user entry */
function keyFieldEdited(input: HTMLInputElement): boolean {
  return input.dataset.zestEditing === "1" && input.dataset.zestDirty === "1";
}

function bindKeyField(input: HTMLInputElement) {
  if (input.dataset.zestBound) return;
  input.dataset.zestBound = "1";
  const beginEdit = () => {
    if (input.dataset.zestEditing === "1") return;
    input.type = "password";
    input.value = "";
    input.dataset.zestEditing = "1";
    input.dataset.zestDirty = "";
  };
  // focus for keyboard and click alike; the click handler covers the case
  // where the field already had focus when the bullets were put back
  input.addEventListener("focus", beginEdit);
  input.addEventListener("click", beginEdit);
  input.addEventListener("input", () => {
    input.dataset.zestDirty = "1";
  });
  input.addEventListener("blur", () => {
    // an accidental click into the box must not read as "delete my key";
    // only a field the user actually typed in (or emptied on purpose) is kept
    if (input.dataset.zestDirty !== "1") idleKeyField(input);
  });
}

async function refreshKeyField(name?: KeyField) {
  const names = name ? [name] : (Object.keys(KEY_FIELDS) as KeyField[]);
  const d = doc();
  if (!d) return;
  for (const which of names) {
    const ids = KEY_FIELDS[which];
    const input = d.getElementById(ids.input) as HTMLInputElement | null;
    const status = d.getElementById(ids.status);
    if (input) {
      const key = await getSecret(which);
      input.dataset.hasKey = key ? "1" : "";
      idleKeyField(input);
      bindKeyField(input);
    }
    if (status) {
      const key = input?.dataset.hasKey === "1";
      status.textContent = secretIsInPrefs(which)
        ? getString("pref-key-plaintext")
        : key
          ? getString("pref-key-stored")
          : "";
    }
  }
}

/**
 * "Is this key valid?" — one real request per service, result in the status
 * line (no modal: a dialog from inside the settings pane is disruptive, and
 * the line is where the key state is described anyway).
 */
async function testKey(name: KeyField) {
  const d = doc();
  const status = d?.getElementById(KEY_FIELDS[name].status);
  if (!status) return;
  const key = await getSecret(name);
  if (!key) {
    status.textContent = getString("pref-key-none");
    return;
  }
  status.textContent = getString("pref-key-testing");
  try {
    if (name === "easyscholar") {
      // A journal every dataset knows; this key test still honours back-off.
      const r = await fetchEasyScholar("Nature");
      if (r.values.length) {
        status.textContent = getString("pref-key-valid", {
          args: { detail: `Nature · ${r.values.length}` },
        });
      } else if (r.error === "key") {
        status.textContent = getString("pref-key-invalid");
      } else if (r.error === "rate") {
        status.textContent = getString("pref-key-rate");
      } else {
        status.textContent = getString("pref-key-network");
      }
      return;
    }
    // Semantic Scholar: the key goes in a header; 403 = rejected, 429 = the
    // shared limit (which a valid key is meant to lift), 0 = unreachable
    const code = await http.probe(
      "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-020-2649-2?fields=citationCount",
      { "x-api-key": key },
    );
    if (code >= 200 && code < 300) {
      status.textContent = getString("pref-key-valid", {
        args: { detail: `HTTP ${code}` },
      });
    } else if (code === 401 || code === 403) {
      status.textContent = getString("pref-key-invalid");
    } else if (code === 429) {
      status.textContent = getString("pref-key-rate");
    } else {
      status.textContent = getString("pref-key-network");
    }
  } catch (e) {
    ztoolkit.log("[prefs] key test failed", e);
    status.textContent = getString("pref-key-network");
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
  const path = await new FilePicker(title, mode, filters, defaultName).open();
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

async function saveKey(name: KeyField = "easyscholar") {
  const d = doc();
  const input = d?.getElementById(
    KEY_FIELDS[name].input,
  ) as HTMLInputElement | null;
  if (!input) return;
  // untouched field (still showing the bullets, or clicked in and left):
  // nothing to save
  if (!keyFieldEdited(input)) return;
  const value = input.value.trim();
  const where = await setSecret(name, value);
  // a new easyScholar key can change the ranks themselves; a Semantic Scholar
  // key only lifts the rate limit, so the counts already fetched stay valid
  if (name === "easyscholar") clearRankCache();
  await refreshKeyField(name);
  alertUser(
    getString("pref-key-save"),
    where === "login-manager"
      ? getString("pref-key-saved")
      : getString("pref-key-plaintext"),
  );
}

export async function onPrefsCommand(
  type: string,
  data: { [key: string]: any } = {},
) {
  switch (type) {
    case "color-auto":
      resetAutoColor(String(data.pref || ""));
      break;
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
      await saveKey("easyscholar");
      break;
    case "s2key-save":
      await saveKey("semanticscholar");
      break;
    case "key-test":
      await testKey("easyscholar");
      break;
    case "s2key-test":
      await testKey("semanticscholar");
      break;
    case "accent-apply":
      // the heat map and the badges keep their own colours; this copies the
      // accent onto both in one step rather than making them silently follow
      setPref("heat.color", accentColor());
      setPref("textTags.color", accentColor());
      refreshAllRows();
      break;
    case "accent-reset":
      setPref("ui.accent", ACCENT_FALLBACK.toUpperCase());
      setPref("heat.color", HEAT_COLOR_DEFAULT);
      setPref("textTags.color", BADGE_COLOR_DEFAULT);
      syncAccent();
      refreshAllRows();
      buildAccentPresets();
      break;
    case "rank-clear":
      clearRankCache();
      alertUser(getString("pref-rank-clear"), getString("pref-rank-cleared"));
      break;
  }
}
