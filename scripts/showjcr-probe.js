/** Explicit ShowJCR download, offline lookup and rendering in the isolated profile. */
if (
  !Services.dirsvc
    .get("ProfD", Components.interfaces.nsIFile)
    .path.endsWith("/source/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data")
)
  throw new Error("Isolated profile required");
const out = { ok: [], fail: [], notes: [] };
const check = (name, pass, note) => {
  (pass ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const pref = "extensions.zotero.zest.rank.autoFetch";
const before = {
  user: Services.prefs.prefHasUserValue(pref),
  value: Zotero.Prefs.get(pref, true),
};
let item;
try {
  Zotero.Prefs.set(pref, false, true);
  const start = Date.now();
  const meta = await dev.showjcrDownload.downloadShowJCR();
  check(
    "completeTableDownloaded",
    meta.rows === 22643,
    `${meta.rows} rows, ${Date.now() - start} ms`,
  );
  check("managedID", meta.id === "showjcr-jcr");
  check("metricYear", meta.name.includes("2025"));
  dev.rank.clearRankCache();
  item = new Zotero.Item("journalArticle");
  item.setField("title", "Zest ShowJCR acceptance fixture");
  item.setField("publicationTitle", "Cancer Immunology, Immunotherapy : CII");
  item.setField("ISSN", "0340-7004, 1432-0851");
  item.setField("extra", "Custom: preserved\n");
  await item.saveTx();
  const extra = item.getField("extra");
  const record = dev.rank.getJournalRecord(item);
  const metric = dev.impactFactor.resolveImpactFactor(record, "sciif");
  check("offlineImmediateIF", metric?.value === 5.8);
  check(
    "offlineSourceAttribution",
    metric?.jcr?.provider === "showjcr" &&
      metric?.jcr?.percentileMethod === "rank",
  );
  check("allCategories", metric?.jcr?.categories.length === 2);
  check(
    "immunologyP784",
    Math.abs(metric?.jcr?.categories[0]?.percentile - 78.41530054644808) <
      0.00001,
  );
  check(
    "oncologyP800",
    Math.abs(metric?.jcr?.categories[1]?.percentile - 80.03003003003003) <
      0.00001,
  );
  check(
    "qAndRank",
    metric?.jcr?.categories.every(
      (c) => c.quartile === "Q1" && c.rank.includes("/"),
    ),
  );
  const t = Date.now();
  for (let i = 0; i < 1000; i++) dev.rank.getJournalRecord(item);
  out.notes.push(`1000 offline reads: ${Date.now() - t} ms`);
  await dev.dataset.loadDatasets();
  const reloaded = dev.impactFactor.resolveImpactFactor(
    dev.rank.getJournalRecord(item),
    "sciif",
  );
  check("savedFileReload", JSON.stringify(metric) === JSON.stringify(reloaded));
  check(
    "singleDatasetEntry",
    dev.zestConfig.get().datasets.filter((d) => d.id === meta.id).length === 1,
  );
  check("extraUntouched", extra === item.getField("extra"));
  out.notes.push(JSON.stringify(reloaded));
  dev.columns.refreshAllRows();
} catch (e) {
  out.fail.push(String(e));
} finally {
  if (item?.id) await Zotero.Items.erase(item.id);
  if (before.user) Zotero.Prefs.set(pref, before.value, true);
  else Services.prefs.clearUserPref(pref);
}
return out;
