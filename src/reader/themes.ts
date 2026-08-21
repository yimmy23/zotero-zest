/**
 * Cleanup for the reader background presets Zest used to ship.
 *
 * The feature itself is gone: Zotero 8+ already lets you build reader themes in
 * its own Appearance popup, and three presets from a plugin were not worth a
 * second place to manage them. Presets a user installed stay in their library —
 * they are ordinary Zotero themes and can be deleted from that popup.
 *
 * What has to stay is the repair below. The removal path used to write
 * `readerCustomThemes: []` when the last preset went away, and the sync API
 * answers an empty array with a 400 that fails the whole `POST /settings`, so
 * the library stops syncing with nothing in the UI to explain why. Deleting the
 * feature does not undo the value it left behind, so Zest keeps clearing it.
 */

/**
 * Remove a `readerCustomThemes` setting that is an empty array.
 *
 * Zotero never writes that value — `xpcom/reader.js` clears the setting instead
 * (`if (customThemes?.length) set(…) else await SyncedSettings.clear(…)`) — so
 * an empty array can only be ours to clean up. Absent or non-empty values are
 * left completely alone.
 */
export async function repairEmptyThemeSetting(): Promise<boolean> {
  const settings = (Zotero as any).SyncedSettings;
  if (typeof settings?.get !== "function") return false;
  if (typeof settings.clear !== "function") return false;
  const libraryID = Zotero.Libraries.userLibraryID;
  let value: unknown;
  try {
    value = settings.get(libraryID, "readerCustomThemes");
  } catch {
    return false; // unloaded data — nothing to repair yet
  }
  if (!Array.isArray(value) || value.length > 0) return false;
  await settings.clear(libraryID, "readerCustomThemes");
  ztoolkit.log(
    "[reader] removed an empty readerCustomThemes setting (it makes POST /settings fail with 400)",
  );
  return true;
}
