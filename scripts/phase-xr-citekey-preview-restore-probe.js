/** Restore the screenshot fixture and locale in the isolated dev profile. */
if (!String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data"))
  throw new Error("Isolated profile required");
const win = Zotero.getMainWindow();
const state = win.__zestXRPreview;
if (!state) throw new Error("No preview to restore");
if (state.previousRank)
  dev.cache.set("rank", state.rankKey, state.previousRank);
else if (state.rankKey) dev.cache.remove("rank", state.rankKey);
const item = state.itemID && Zotero.Items.get(state.itemID);
if (item) await item.eraseTx();
for (const [name, value] of state.prefs) {
  if (value === undefined) Zotero.Prefs.clear(name, true);
  else Zotero.Prefs.set(name, value, true);
}
if (state.locale) Object.defineProperty(Zotero, "locale", state.locale);
else delete Zotero.locale;
Services.locale.requestedLocales = state.locales;
await Zotero.Promise.delay(500);
addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
delete win.__zestXRPreview;
return {
  restored: true,
  locale: Zotero.locale,
  requested: [...Services.locale.requestedLocales],
};
