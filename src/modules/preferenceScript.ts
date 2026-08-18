import { zestDB } from "../core/db";
import { migrateLegacyUI } from "../reading/migrate";
import {
  exportReadingDataUI,
  importReadingDataUI,
} from "../reading/exportImport";

/**
 * Preference pane logic. The pane is declarative (preference="…" bindings);
 * this only wires the buttons and shows the DB location. Note: since
 * Zotero 8 pane scripts run in a sandbox, inline `oncommand` handlers call
 * back into `Zotero.Zest.hooks.onPrefsEvent(type, {window})`.
 */
export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window } as any;
  } else {
    addon.data.prefs.window = _window;
  }
  try {
    const el = _window.document.getElementById("zest-pref-dbpath");
    if (el) el.textContent = zestDB.path || "";
  } catch {
    // cosmetic
  }
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
  }
}
