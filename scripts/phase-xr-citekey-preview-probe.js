/** Synthetic screenshot fixture; run only in the isolated dev profile. */
if (!String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data"))
  throw new Error("Isolated profile required");
const win = Zotero.getMainWindow();
if (win.__zestXRPreview) throw new Error("Restore the previous preview first");
const state = {
  prefs: [],
  locales: [...Services.locale.requestedLocales],
  locale: Object.getOwnPropertyDescriptor(Zotero, "locale"),
};
win.__zestXRPreview = state;
for (const [key, value] of Object.entries({
  "info.enable": true,
  "info.abstract": false,
  "info.affiliations.autoFetch": false,
  "rank.autoFetch": false,
  "rank.fields": "xr, sci, sciif",
  "rank.map": "",
})) {
  const name = `extensions.zotero.zest.${key}`;
  state.prefs.push([name, Zotero.Prefs.get(name, true)]);
  Zotero.Prefs.set(name, value, true);
}
const item = new Zotero.Item("journalArticle");
item.libraryID = Zotero.Libraries.userLibraryID;
item.setField(
  "title",
  "Perioperative immunotherapy and nodal evaluation in resectable NSCLC",
);
item.setField("publicationTitle", "Journal of Thoracic Oncology");
item.setField("citationKey", "Wang2025NSCLC");
item.setField(
  "extra",
  "Remark: Synthetic UI preview; journal metrics are test values.",
);
item.setCreators([
  { firstName: "Ming", lastName: "Wang", creatorType: "author" },
  { firstName: "Wei", lastName: "Zhang", creatorType: "author" },
]);
await item.saveTx();
state.itemID = item.id;
state.rankKey = dev.rank.journalKeyOf(item).key;
state.previousRank = dev.rank.getJournalRecord(item);
dev.cache.set("rank", state.rankKey, {
  key: state.rankKey,
  name: "Journal of Thoracic Oncology",
  updated: Date.now(),
  values: [
    { field: "xr", value: "医学1区", source: "easyscholar", rank: 1 },
    { field: "sciUp", value: "医学2区", source: "easyscholar", rank: 2 },
    { field: "sci", value: "Q1", source: "easyscholar", rank: 1 },
    { field: "sciif", value: "12.3", source: "easyscholar" },
  ],
});
for (const prefWindow of Services.wm.getEnumerator("zotero:pref"))
  prefWindow.close();
await win.ZoteroPane.collectionsView.selectLibrary(item.libraryID);
await win.ZoteroPane.selectItem(item.id);
dev.infoSection.refreshInfoSections(item.id);
await Zotero.Promise.delay(500);
win.document
  .querySelector(".zest-info-bibliography")
  ?.scrollIntoView({ block: "start" });
return {
  itemID: item.id,
  locale: Zotero.locale,
  key: item.getField("citationKey"),
  badges: [
    ...win.document.querySelectorAll(".zest-info-ranks > .zest-rank-badge"),
  ].map((el) => el.textContent),
};
