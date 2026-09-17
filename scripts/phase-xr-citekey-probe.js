/** Native regression probe; synthetic records and isolated dev profile only. */
if (!String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data"))
  throw new Error("This probe requires the isolated dev profile");
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const check = (name, condition, note) => {
  (condition ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const win = Zotero.getMainWindow();
const doc = win.document;
const pane = win.ZoteroPane;
const delay = (ms = 150) => Zotero.Promise.delay(ms);
const saved = new Map();
const pref = (key, value) => {
  const name = `extensions.zotero.zest.${key}`;
  if (!saved.has(name)) saved.set(name, Zotero.Prefs.get(name, true));
  Zotero.Prefs.set(name, value, true);
};
const body = () =>
  [...doc.querySelectorAll(".zest-info")].find(
    (el) => el.getClientRects().length,
  );
const row = () => body()?.querySelector(".zest-info-citation-key");
const keyValue = () => row()?.querySelector(".zest-info-citation-key-value");
const button = () => row()?.querySelector("button");
const badges = () => [
  ...(body()?.querySelectorAll(".zest-info-ranks > .zest-rank-badge") || []),
];
const isXRBadge = (el) => /\bxr\b/i.test(el.title);
const items = [];
const copies = [];
const copy = Zotero.Utilities.Internal.copyTextToClipboard;
const request = dev.httpMod.http.requestResult;
let requests = 0;
let cacheKey;
try {
  for (const [key, value] of Object.entries({
    "info.enable": true,
    "info.abstract": false,
    "info.affiliations.autoFetch": false,
    "rank.autoFetch": false,
    "rank.fields": "xr, sci, sciif",
    "rank.map": "",
  }))
    pref(key, value);
  Zotero.Utilities.Internal.copyTextToClipboard = (text) => copies.push(text);
  dev.httpMod.http.requestResult = async () => {
    requests++;
    return { kind: "cancelled", status: 0 };
  };
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", "Zest XR and Citation Key regression fixture");
  item.setField("publicationTitle", "Zest XR Native Probe Journal");
  item.setField("citationKey", "Wang2025NSCLC");
  item.setField("extra", "Citation Key: Legacy2020\r\nCustom_Field: untouched");
  await item.saveTx();
  items.push(item);
  const empty = new Zotero.Item("journalArticle");
  empty.libraryID = item.libraryID;
  empty.setField("title", "Zest empty citation key regression fixture");
  await empty.saveTx();
  items.push(empty);
  const emptyBefore = {
    citationKey: empty.getField("citationKey"),
    extra: empty.getField("extra"),
    key: empty.key,
  };
  const before = item.getField("extra");
  cacheKey = dev.rank.journalKeyOf(item).key;
  const xr = { field: "xr", value: "医学2区", source: "easyscholar", rank: 2 };
  const cas = {
    field: "sciUp",
    value: "医学1区",
    source: "easyscholar",
    rank: 1,
  };
  const jcr = { field: "sci", value: "Q1", source: "easyscholar", rank: 1 };
  const record = {
    key: cacheKey,
    name: item.getField("publicationTitle"),
    updated: Date.now(),
    values: [
      xr,
      cas,
      jcr,
      { field: "sciif", value: "12.3", source: "easyscholar" },
    ],
  };
  const paint = async (values = record.values) => {
    dev.cache.set("rank", cacheKey, { ...record, values });
    dev.infoSection.refreshInfoSections(item.id);
    await delay();
  };
  dev.cache.set("rank", cacheKey, record);
  await pane.collectionsView.selectLibrary(item.libraryID);
  await pane.selectItem(item.id);
  await delay(400);
  check(
    "nativeFieldAndSidebar",
    Zotero.ItemFields.getID("citationKey") > 0 &&
      keyValue()?.textContent === "Wang2025NSCLC",
  );
  check(
    "selectableAccessibleControl",
    win.getComputedStyle(keyValue()).userSelect === "text" &&
      !!button()?.getAttribute("aria-label") &&
      button()?.type === "button",
  );
  button()?.click();
  check(
    "copyExactNativeValue",
    copies.join(",") === "Wang2025NSCLC" &&
      !!row()?.querySelector('[role="status"]')?.textContent,
  );
  check(
    "copyPreservesBothFields",
    item.getField("citationKey") === "Wang2025NSCLC" &&
      item.getField("extra") === before,
  );
  check(
    "defaultOnlyXRInPanel",
    badges().some(isXRBadge) &&
      !badges().some((el) => /CAS|中科院/.test(el.textContent)),
    badges()
      .map((el) => el.textContent)
      .join(" | "),
  );
  const api = addon.api.journalRanks(item);
  check(
    "apiUsesXRRawValues",
    api.some(
      (v) =>
        v.field === "xr" && v.value === "医学2区" && v.source === "easyscholar",
    ) &&
      !api.some(
        (v) => v.field === "sciUp" || "sourceField" in v || "customized" in v,
      ),
  );
  await paint([cas, jcr]);
  check(
    "missingXRFallsBackToHistoricalCAS",
    badges().some(
      (el) =>
        /CAS|中科院/.test(el.textContent) && /historical|历史/.test(el.title),
    ) && !badges().some(isXRBadge),
  );
  await paint([{ ...xr, value: "N/A" }, cas, jcr]);
  check(
    "unknownXRDoesNotHideCAS",
    badges().some((el) => /CAS|中科院/.test(el.textContent)),
  );
  await paint([{ ...xr, value: "医学99区" }, cas, jcr]);
  check(
    "invalidXRDoesNotHideCAS",
    badges().some((el) => /CAS|中科院/.test(el.textContent)),
  );
  pref("rank.fields", "xr, sciUp, sciif");
  await paint();
  check(
    "explicitBothSchemesInPanel",
    badges().some(isXRBadge) &&
      badges().some((el) => /CAS|中科院/.test(el.textContent)),
  );
  pref("rank.fields", "xr, sci, sciif");
  pref("rank.map", "xr=");
  await paint();
  check(
    "mapHiddenXRDoesNotReviveCAS",
    !badges().some((el) => isXRBadge(el) || /CAS|中科院/.test(el.textContent)),
  );
  await paint([xr, cas]);
  check("apiDoesNotReviveHiddenXR", addon.api.journalRanks(item).length === 0);
  pref("rank.map", "");
  const stale = button();
  await pane.selectItem(empty.id);
  await delay(250);
  check(
    "emptyKeyShowsExplainedPlaceholder",
    !!row()?.getClientRects().length &&
      keyValue()?.classList.contains("zest-info-placeholder") &&
      !!keyValue()?.textContent.trim() &&
      !!keyValue()?.title &&
      !!keyValue()?.getAttribute("aria-label") &&
      button()?.disabled === true,
  );
  check(
    "emptyKeyRowHasNoEditor",
    !!row() &&
      !row().querySelector('input,textarea,[contenteditable="true"]') &&
      keyValue()?.textContent !== empty.key,
  );
  button()?.click();
  check(
    "emptyKeyDoesNotCopyOrGenerate",
    copies.length === 1 &&
      !dev.citationKey.citationKeyOf(empty) &&
      empty.getField("citationKey") === emptyBefore.citationKey &&
      empty.getField("extra") === emptyBefore.extra &&
      empty.key === emptyBefore.key,
  );
  stale?.click();
  check("oldItemButtonIsInert", copies.length === 1);
  await pane.selectItem(item.id);
  await delay(250);
  const oldRender = button();
  item.setField("citationKey", "Wang2025NSCLC_Updated");
  dev.infoSection.refreshInfoSections(item.id);
  await delay();
  oldRender?.click();
  check("oldRenderButtonIsInert", copies.length === 1);
  button()?.click();
  check("editedKeyCopiesCurrentValue", copies[1] === "Wang2025NSCLC_Updated");
  item.setField("citationKey", "");
  dev.infoSection.refreshInfoSections(item.id);
  await delay();
  check(
    "legacyExtraFallbackStaysReadOnly",
    keyValue()?.textContent === "Legacy2020" &&
      button()?.disabled === false &&
      !item.getField("citationKey") &&
      item.getField("extra") === before,
  );
  const longKey = "Wang2025NSCLC_" + "Long_Unbroken_Key_".repeat(10);
  item.setField("citationKey", longKey);
  dev.infoSection.refreshInfoSections(item.id);
  await delay();
  const container = body();
  const originalWidth = container.style.cssText;
  container.style.width = "240px";
  container.style.boxSizing = "border-box";
  await delay();
  check(
    "longKeyNarrowLayout",
    keyValue()?.textContent === longKey &&
      row().scrollWidth <= row().clientWidth + 1 &&
      button().getBoundingClientRect().right <=
        container.getBoundingClientRect().right + 1,
  );
  container.style.cssText = originalWidth;
  Zotero.Utilities.Internal.copyTextToClipboard = undefined;
  button()?.click();
  check(
    "clipboardUnavailableIsExplained",
    /failed|失败/.test(
      row()?.querySelector('[role="status"]')?.textContent || "",
    ),
  );
  check("browseAndCopyStayOffline", requests === 0);
  check(
    "rawCacheKeepsBothSchemes",
    dev.rank.getJournalRecord(item).values.some((v) => v.field === "xr") &&
      dev.rank.getJournalRecord(item).values.some((v) => v.field === "sciUp"),
  );
  check("extraUnchangedAfterAllOperations", item.getField("extra") === before);
} catch (error) {
  check("completed", false, String(error?.stack || error));
} finally {
  Zotero.Utilities.Internal.copyTextToClipboard = copy;
  dev.httpMod.http.requestResult = request;
  if (cacheKey) dev.cache.remove("rank", cacheKey);
  for (const item of items) await item.eraseTx();
  for (const [key, value] of saved) {
    if (value === undefined) Zotero.Prefs.clear(key, true);
    else Zotero.Prefs.set(key, value, true);
  }
}
return out;
