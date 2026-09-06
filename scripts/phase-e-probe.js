/**
 * Phase E regression probe — run inside the DEV Zotero instance:
 *   scripts/dev-eval.sh -f scripts/phase-e-probe.js
 *
 * One assertion per defect the Phase E audit confirmed. It creates and deletes
 * its own probe items, restores every preference it touches, and never talks to
 * the network.
 */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const win = Zotero.getMainWindow();
const doc = win.document;
const delay = (ms) => Zotero.Promise.delay(ms);
const check = (name, cond, note) => {
  (cond ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const prefKey = (name) => `extensions.zotero.zest.${name}`;
const saved = new Map();
const setPref = (name, value) => {
  if (!saved.has(name)) saved.set(name, Zotero.Prefs.get(prefKey(name), true));
  Zotero.Prefs.set(prefKey(name), value, true);
};

const mk = async (fields, creators) => {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = 1;
  for (const [k, v] of Object.entries(fields)) item.setField(k, v);
  if (creators) item.setCreators(creators);
  await item.saveTx();
  return item;
};
const trash = [];

/* ---------- 0. app shutdown disables delayed sweep recovery ---------- */
// Running APP_SHUTDOWN would destroy this probe's own transport, so pin the
// two guards non-destructively here. The real close path is exercised by the
// isolated-profile shutdown smoke test during release validation.
const appShutdownSource = String(addon.hooks.onAppShutdown);
check(
  "lifecycle.appShutdownStopsSweepRecovery",
  /addon\.data\.alive\s*=\s*false/.test(appShutdownSource) &&
    /stopPluginSweep\(\)/.test(appShutdownSource),
);

/* ---------- 0b. the recommended layout is the production default ---------- */
check(
  "layout.recommendedMatchesProduction",
  JSON.stringify(dev.viewGroups.RECOMMENDED_LAYOUT) ===
    JSON.stringify({
      columns: [
        "title",
        "remark",
        "year",
        "authors",
        "reading",
        "status",
        "rating",
        "publicationTitle",
        "pubtags",
        "if",
        "citations",
        "dateAdded",
        "hasAttachment",
      ],
      sortField: "dateAdded",
      sortDirection: -1,
    }),
);

/* ---------- 1. collection counts never suppress selection events ---------- */
setPref("collectionCounts.enable", true);
setPref("collectionCounts.mode", 2);
await delay(2600);
const cv = win.ZoteroPane.collectionsView;
check("counts.badges", doc.querySelectorAll(".zest-count").length > 0);
check(
  "counts.selectionNotSuppressed",
  cv.selection?.selectEventsSuppressed === false,
  String(cv.selection?.selectEventsSuppressed),
);
const collectionRows = [...Array(cv.rowCount).keys()].filter((i) =>
  cv.getRow(i)?.isCollection?.(),
);
if (collectionRows.length) {
  const seen = [];
  for (const row of collectionRows.slice(0, 2)) {
    cv.selection.select(row);
    await delay(1200);
    seen.push({
      name: cv.getRow(row)?.ref?.name,
      rows: win.ZoteroPane.itemsView?.rowCount ?? -1,
      suppressed: cv.selection?.selectEventsSuppressed,
    });
  }
  check(
    "counts.collectionClickStillLoads",
    seen.every((s) => s.suppressed === false && s.rows >= 0),
    JSON.stringify(seen),
  );
}

/* ---------- 2. reveal wins over a Zest filter ---------- */
check("reveal.guardInstalled", dev.reveal.revealGuardInstalled(win));
check("reveal.selectItemsWrapped", !!win.ZoteroPane.selectItems.__zestOriginal);

/* ---------- 3. Extra belongs to the user ---------- */
const foreign =
  "GSCC: 0001719 2025-04-25T18:45:33.000Z 2.34\n" +
  "openalex.cit_count: 88\n" +
  "Citation Key: smith2020\n" +
  "my note\n" +
  "Citations: 1 (Crossref) [2026-01-01]";
const rewritten = dev.citeExtra.withCitationLine(
  foreign,
  "Citations: 7 (OpenAlex) [2026-08-18]",
);
check(
  "extra.foreignCitationRecordsSurvive",
  rewritten.includes("GSCC: 0001719") &&
    rewritten.includes("openalex.cit_count: 88") &&
    rewritten.includes("Citation Key: smith2020") &&
    rewritten.includes("my note") &&
    rewritten.split("\n").filter((l) => /^Citations:/i.test(l)).length === 1 &&
    rewritten.includes("Citations: 7"),
  rewritten.replace(/\n/g, " | "),
);
const bothSpellings = dev.extra.upsertExtraText(
  "rate: 4\nRating: 5\nmy note",
  ["rate", "Rating"],
  "3",
);
check(
  "extra.otherSpellingSurvives",
  bothSpellings === "rate: 3\nRating: 5\nmy note",
  bothSpellings?.replace(/\n/g, " | "),
);

/* ---------- 4. CSV exports are inert in a spreadsheet ---------- */
const csvLine = dev.csv.csvRow(['=HYPERLINK("http://x","c")', "plain, text"]);
check("csv.formulaDefused", csvLine.startsWith(`"'=`), csvLine);

/* ---------- 5. authors: memo, preset, Zotero parity ---------- */
const probeItem = await mk({ title: "phase-e authors" }, [
  { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  { firstName: "Alan", lastName: "Turing", creatorType: "author" },
  { firstName: "Grace", lastName: "Hopper", creatorType: "author" },
]);
trash.push(probeItem);
// the default preset (first N + et al.) lists every author up to N and only
// then abbreviates — the "creator-like" copy of Zotero's own column is gone
const firstN = (item, n) =>
  dev.authors
    .formatAuthors(item, {
      policy: { kind: "first", n, etAl: "append" },
      rules: { order: "auto", given: "none", initialsDot: true },
      etAlText: Zotero.getString("general.etAl"),
    })
    .parts.map((p) => p.text)
    .join("");
check(
  "authors.firstN.three",
  /Lovelace.*Turing.*Hopper/.test(firstN(probeItem, 3)) &&
    !firstN(probeItem, 3).includes(Zotero.getString("general.etAl")),
  firstN(probeItem, 3),
);
check(
  "authors.firstN.etAl",
  firstN(probeItem, 2).includes(Zotero.getString("general.etAl")),
  firstN(probeItem, 2),
);
const pair = await mk({ title: "phase-e pair" }, [
  { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  { firstName: "Alan", lastName: "Turing", creatorType: "author" },
]);
trash.push(pair);
// the memo must notice an edited item
const before = dev.authors
  .formatAuthors(probeItem, {
    policy: { kind: "all" },
    rules: { order: "auto", given: "full", initialsDot: true },
  })
  .parts.map((p) => p.text)
  .join("");
probeItem.setCreators([
  { firstName: "Ada", lastName: "Byron", creatorType: "author" },
]);
await probeItem.saveTx();
await delay(400);
const after = dev.authors
  .formatAuthors(probeItem, {
    policy: { kind: "all" },
    rules: { order: "auto", given: "full", initialsDot: true },
  })
  .parts.map((p) => p.text)
  .join("");
check(
  "authors.memoFollowsEdits",
  before !== after && after.includes("Byron"),
  `${before} -> ${after}`,
);

/* ---------- 6. tag tree keyboard contract ---------- */
setPref("nestedTags.show", true);
await delay(2500);
const body = doc.querySelector(".zest-tagtree-body");
const rows = [...(body ? body.querySelectorAll(".zest-tagtree-row") : [])];
check(
  "tagtree.aria",
  body?.getAttribute("role") === "tree" &&
    rows.every((r) => r.getAttribute("role") === "treeitem") &&
    rows.every((r) => r.hasAttribute("aria-selected")),
  `${rows.length} rows`,
);
check(
  "tagtree.singleTabStop",
  rows.filter((r) => r.tabIndex === 0).length === 1,
  String(rows.filter((r) => r.tabIndex === 0).length),
);
if (rows.length > 1) {
  rows[0].focus();
  body.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await delay(250);
  check(
    "tagtree.arrowMovesFocus",
    doc.activeElement?.getAttribute("data-tag") ===
      rows[1].getAttribute("data-tag"),
    String(doc.activeElement?.getAttribute("data-tag")),
  );
}
// the predicate must not clear the tag cache on every pass
check(
  "tagtree.filterKeepsCache",
  typeof dev.tagScope?.invalidateTagCache === "function",
);
setPref("nestedTags.show", false);
await delay(600);
check(
  "tagtree.nativeSelectorRestored",
  doc.getElementById("zotero-tag-selector")?.hidden === false,
);

/* ---------- 6b. the two tag-pane tabs, and the idle guard behind them ------- */
// The tree stops rebuilding while the "All" tab is up. Both failure modes of
// that saving are silent: either it keeps walking the whole library to fill a
// hidden element, or it comes back from the All tab showing yesterday's tags.
// Nothing throws in either case, so both directions are pinned here.
setPref("textTags.match", "#"); // display path drops the rule's prefix
setPref("nestedTags.show", true);
setPref("nestedTags.tab", "tree");
// the tree follows Zotero's own "Display All Tags in This Library" switch
const NATIVE_SHOW_ALL = "extensions.zotero.tagSelector.displayAllTags";
const nativeShowAllBefore = Zotero.Prefs.get(NATIVE_SHOW_ALL, true);
Zotero.Prefs.set(NATIVE_SHOW_ALL, true, true);
await delay(2500);
const paneBody = doc.querySelector(".zest-tagtree-body");
const paneStrip = doc.querySelector(".zest-tagtree-tabs");
const paneTabs = [...doc.querySelectorAll(".zest-tagtree-tab")];
const paneTags = () =>
  [...(paneBody ? paneBody.querySelectorAll(".zest-tagtree-row") : [])].map(
    (r) => r.getAttribute("data-tag"),
  );
const probeTags = () => paneTags().filter((t) => /ZestTab/.test(String(t)));
check("tagpane.tabs", !!paneStrip && paneTabs.length === 2);

const tabbed = await mk({ title: "Zest tab probe" });
trash.push(tabbed);
tabbed.addTag("#ZestTabAlpha");
await tabbed.saveTx();
await delay(2000);
check(
  "tagpane.treeSeesNewTag",
  paneTags().includes("ZestTabAlpha"),
  probeTags().join("|"),
);

setPref("nestedTags.tab", "native");
await delay(800);
tabbed.addTag("#ZestTabGamma");
await tabbed.saveTx();
await delay(2000);
check(
  "tagpane.idleWhileHidden",
  !paneTags().includes("ZestTabGamma"),
  "no rebuild behind the All tab",
);
check(
  "tagpane.nativeGetsTheRoom",
  paneBody &&
    win.getComputedStyle(paneBody).display === "none" &&
    doc.getElementById("zotero-tag-selector")?.hidden === false &&
    [...doc.querySelectorAll(".zest-tagtree-bar > *")].filter(
      (e) => win.getComputedStyle(e).display !== "none",
    ).length === 1,
);

// a roving tabindex parks the inactive tab at -1, so Tab alone can never
// reach the other view: the arrows have to work
paneTabs[1].focus();
paneStrip.dispatchEvent(
  new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
);
await delay(2000);
check(
  "tagpane.arrowSwitchesTab",
  Zotero.Prefs.get(prefKey("nestedTags.tab"), true) === "tree" &&
    doc.activeElement === paneTabs[0],
  String(Zotero.Prefs.get(prefKey("nestedTags.tab"), true)),
);
check(
  "tagpane.catchUpOnReturn",
  paneTags().includes("ZestTabGamma"),
  probeTags().join("|"),
);
setPref("nestedTags.show", false);
await delay(600);

/* ---------- 6c. settings controls actually reach the item tree ------------- */
// Zotero fires a pref observer on an EXACT name only — a prefix registration
// never fires — so columns/index.ts carries a hand-written list of every pref
// a column reads while drawing. Nothing couples that list to the drawing code,
// and a pref missing from it produces a settings control that silently does
// nothing. One representative pref stands in for the list.
setPref("column.rating.enable", true);
setPref("rating.mark", "★");
await delay(2500);
const repaintItem = await mk({ title: "Zest repaint probe", extra: "rate: 4" });
trash.push(repaintItem);
await delay(500);
win.ZoteroPane.collectionsView.selectByID("L1");
await delay(2500);
const itemsView = win.ZoteroPane.itemsView;
let ratedRow = -1;
for (let i = 0; i < itemsView.rowCount; i++) {
  if (itemsView.getRow(i)?.ref?.id === repaintItem.id) {
    ratedRow = i;
    break;
  }
}
const starText = () =>
  doc.querySelector(`#item-tree-main-default-row-${ratedRow} .zest-stars`)
    ?.textContent ?? "NOCELL";
const starsBefore = starText();
setPref("rating.mark", "✦");
await delay(1500);
check(
  "settings.reachesTheTree",
  starsBefore !== "NOCELL" && starText() !== starsBefore,
  `${starsBefore} -> ${starText()} (no manual repaint in between)`,
);

/* ---------- 6d. teardown never removes another plugin's hook -------------- */
// Both prototype hooks used to put Zotero's own function back unconditionally,
// which deletes the wrapper of any plugin that wrapped after us — invariant 1.
{
  const p = Zotero.CollectionTreeRow.prototype;
  const zotOriginal = p.getItems.__zestOriginal || p.getItems;
  dev.itemFilter.setItemFilter(win, "phase-e-foreign", (items) => items);
  await delay(300);
  const ours = p.getItems;
  const foreign = async function (...a) {
    return await ours.apply(this, a);
  };
  foreign.__foreignMark = true;
  p.getItems = foreign;
  dev.itemFilter.setItemFilter(win, "phase-e-foreign", null);
  await delay(300);
  check("teardown.keepsForeignGetItems", !!p.getItems.__foreignMark);
  p.getItems = zotOriginal;
}
{
  setPref("titleDecor.unreadBold", true);
  const proto = Object.getPrototypeOf(win.ZoteroPane.itemsView);
  dev.columns.uninstallTitleDecor(win);
  await delay(200);
  const zotOriginal = proto._renderCell;
  dev.columns.installTitleDecor(win);
  await delay(900);
  const ours = proto._renderCell;
  const foreign = function (...a) {
    return ours.apply(this, a);
  };
  foreign.__foreignMark = true;
  proto._renderCell = foreign;
  dev.columns.uninstallTitleDecor(win);
  await delay(300);
  check("teardown.keepsForeignRenderCell", !!proto._renderCell.__foreignMark);
  proto._renderCell = zotOriginal;
  dev.columns.installTitleDecor(win);
  await delay(500);
}

/* ---------- 6e. the public API is safe for a template to interpolate ------- */
// Zotero.Zest.api is called from Better Notes templates and Actions & Tags
// scripts. A throw from any one field aborts the caller's whole template, and
// a Map or a class instance renders as "[object Object]" in a note — so the
// contract is: never throw, only interpolation-safe values.
{
  const api = Zotero.Zest?.api;
  check("api.published", !!api && typeof api.readingTime === "function");
  if (api) {
    const probeItem = await mk({
      title: "Zest api probe",
      extra:
        "rate: 4\nRead_Status: In Progress\nCitations: 42 (Crossref) [2026-08-20]",
    });
    trash.push(probeItem);
    await delay(500);
    check(
      "api.readsWhatTheColumnsShow",
      api.rating(probeItem) === 4 &&
        api.readStatus(probeItem) === "In Progress" &&
        api.citations(probeItem) === 42,
      `${api.rating(probeItem)} / ${api.readStatus(probeItem)} / ${api.citations(probeItem)}`,
    );
    // a template's `item` is often the PDF, not the parent
    check(
      "api.acceptsIdsAndChildren",
      api.rating(probeItem.id) === 4 &&
        api.readStatus(probeItem.id) === "In Progress",
    );
    const threw = [];
    for (const [name, fn] of Object.entries(api)) {
      if (typeof fn !== "function") continue;
      for (const junk of [null, undefined, 0, -1, 999999, "nope", {}, []]) {
        try {
          const v = fn(junk);
          if (v instanceof Map || v instanceof Set)
            threw.push(name + ": returned a " + v.constructor.name);
        } catch (e) {
          threw.push(name + "(" + JSON.stringify(junk) + "): " + e);
        }
      }
    }
    check("api.neverThrows", threw.length === 0, threw.slice(0, 3).join(" | "));
    // the marks have to differ in plain text even when the prefs collide,
    // because a note has no CSS to tell a filled star from an empty one
    setPref("rating.mark", "★");
    setPref("rating.option", "★");
    check(
      "api.ratingStarsReadableAsText",
      api.ratingStars(probeItem) === "★★★★☆",
      api.ratingStars(probeItem),
    );
  }
}

/* ---------- 7. accent is one knob, and legible in both themes ---------- */
const rootStyle = win.getComputedStyle(doc.documentElement);
check(
  "accent.tokenFromPref",
  rootStyle.getPropertyValue("--zest-accent").trim().toLowerCase() ===
    String(Zotero.Prefs.get(prefKey("ui.accent"), true) || "").toLowerCase(),
  rootStyle.getPropertyValue("--zest-accent").trim(),
);
const probeEl = doc.createElement("div");
doc.documentElement.appendChild(probeEl);
const resolve = (value) => {
  probeEl.style.backgroundColor = value;
  return win.getComputedStyle(probeEl).backgroundColor;
};
// Zotero decides light/dark from three prefs together; flipping only one of
// them does nothing, and the repaint lands a tick later than the write
const themePrefs = [
  "browser.theme.toolbar-theme",
  "browser.theme.content-theme",
  "ui.systemUsesDarkTheme",
];
const themeBefore = themePrefs.map((p) => {
  try {
    return Services.prefs.prefHasUserValue(p)
      ? Services.prefs.getIntPref(p)
      : null;
  } catch {
    return null;
  }
});
const setTheme = async (dark) => {
  Services.prefs.setIntPref("browser.theme.toolbar-theme", dark ? 0 : 1);
  Services.prefs.setIntPref("browser.theme.content-theme", dark ? 0 : 1);
  Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
  const want = dark;
  for (let i = 0; i < 20; i++) {
    await delay(250);
    const fill = win
      .getComputedStyle(doc.documentElement)
      .getPropertyValue("--fill-primary");
    // dark theme = light text
    if (/rgba?\(\s*255/.test(fill) === want) return;
  }
};
await setTheme(false);
const light = resolve("var(--zest-accent-strong)");
await setTheme(true);
const dark = resolve("var(--zest-accent-strong)");
themePrefs.forEach((p, i) => {
  try {
    if (themeBefore[i] === null) Services.prefs.clearUserPref(p);
    else Services.prefs.setIntPref(p, themeBefore[i]);
  } catch {
    // restoring a pref must not fail the probe
  }
});
await delay(1200);
probeEl.remove();
check("accent.strongFollowsTheme", light !== dark, `${light} | ${dark}`);

/* ---------- 8. rating prefs reach both surfaces ---------- */
setPref("rating.mark", "♥");
setPref("rating.color", "#E0245E");
await delay(400);
const rated = await mk({ title: "phase-e rating", extra: "Rating: 3" });
trash.push(rated);
await win.ZoteroPane.selectItem(rated.id);
await delay(1600);
const panelStar = doc.querySelector(".zest-info-star.on");
check(
  "rating.panelUsesPrefs",
  !!panelStar && panelStar.textContent === "♥",
  panelStar ? panelStar.textContent : "no star",
);

/* ---------- 9. an empty readerCustomThemes is always cleaned up ---------- */
/* The sync API answers `readerCustomThemes: []` with a 400, and one rejected
   setting fails the whole POST /settings, so the library silently stops
   syncing. Zest's reader presets are gone, but the value older builds left
   behind is still cleared at startup. */
{
  const LIB = Zotero.Libraries.userLibraryID;
  const SS = Zotero.SyncedSettings;
  const backup = SS.get(LIB, "readerCustomThemes");
  const mine = {
    id: "custom-mine",
    label: "Mine",
    background: "#fff",
    foreground: "#000",
  };
  try {
    await SS.set(LIB, "readerCustomThemes", []);
    const repaired = await dev.readerThemes.repairEmptyThemeSetting();
    check(
      "readerThemes.repairsEmptyArray",
      repaired === true && SS.get(LIB, "readerCustomThemes") === null,
    );

    await SS.set(LIB, "readerCustomThemes", [mine]);
    const noop = await dev.readerThemes.repairEmptyThemeSetting();
    check(
      "readerThemes.repairLeavesRealThemesAlone",
      noop === false &&
        JSON.stringify(SS.get(LIB, "readerCustomThemes")) ===
          JSON.stringify([mine]),
    );

    await SS.clear(LIB, "readerCustomThemes");
    const absent = await dev.readerThemes.repairEmptyThemeSetting();
    check(
      "readerThemes.repairLeavesAbsentSettingAlone",
      absent === false && SS.get(LIB, "readerCustomThemes") === null,
    );
  } finally {
    if (backup === null) await SS.clear(LIB, "readerCustomThemes");
    else await SS.set(LIB, "readerCustomThemes", backup);
  }
}

/* ---------- 10. easyScholar rank labels follow the Zotero locale ---------- */
{
  const shortJournal = "European Journal of Cardio-Thoracic Surgery";
  const longJournal =
    `${shortJournal}: Official Journal of the European Association ` +
    "for Cardio-Thoracic Surgery";
  check(
    "rank.lookupStripsOfficialJournalDescriptor",
    dev.rankNormalize.journalLookupName(longJournal) === shortJournal &&
      dev.rankNormalize.journalLookupName(
        `${shortJournal}： THE OFFICIAL PUBLICATION OF Example Society`,
      ) === shortJournal &&
      dev.rankNormalize.journalLookupName(
        "Journal X: Series A: An Official Organ of Example Society",
      ) === "Journal X: Series A" &&
      dev.rankNormalize.journalLookupName(
        "Medicine (Baltimore): Official Journal of Example Society",
      ) === "Medicine (Baltimore)",
  );
  const realColonTitles = [
    "CA: A Cancer Journal for Clinicians",
    "Circulation: Cardiovascular Imaging",
    "Journal of Physics A: Mathematical and Theoretical",
    "Chemistry: A European Journal",
    "Title: Official Journal",
    "Title: Official Journal of",
  ];
  check(
    "rank.lookupPreservesRealColonTitles",
    realColonTitles.every(
      (title) => dev.rankNormalize.journalLookupName(title) === title,
    ),
  );
  const longJournalItem = await mk({
    title: "phase-e long journal title",
    publicationTitle: longJournal,
  });
  const shortJournalItem = await mk({
    title: "phase-e short journal title",
    publicationTitle: shortJournal,
  });
  trash.push(longJournalItem, shortJournalItem);
  const longIdentity = dev.rank.journalKeyOf(longJournalItem);
  const shortIdentity = dev.rank.journalKeyOf(shortJournalItem);
  check(
    "rank.officialJournalDescriptorSharesCacheIdentity",
    longIdentity.name === longJournal &&
      longIdentity.queryName === shortJournal &&
      longIdentity.key === shortIdentity.key &&
      longIdentity.key ===
        `name:${dev.rankNormalize.normalizeJournal(shortJournal)}`,
    JSON.stringify(longIdentity),
  );

  const baltimore = await mk({
    title: "phase-e journal identity Baltimore",
    publicationTitle: "Medicine (Baltimore)",
    ISSN: "0025-7974",
  });
  const abingdon = await mk({
    title: "phase-e journal identity Abingdon",
    publicationTitle: "Medicine (Abingdon)",
    ISSN: "1357-3039",
  });
  trash.push(baltimore, abingdon);
  check(
    "rank.distinctISSNsNeverShareIdentity",
    dev.rank.journalKeyOf(baltimore).key === "issn:0025-7974" &&
      dev.rank.journalKeyOf(abingdon).key === "issn:1357-3039" &&
      dev.rankNormalize.normalizeJournal("Medicine (Baltimore)") !==
        dev.rankNormalize.normalizeJournal("Medicine (Abingdon)"),
  );

  const medicine = {
    field: "sciUp",
    value: "医学1区",
    source: "easyscholar",
  };
  const multidisciplinary = {
    field: "sciUp",
    value: "综合性期刊1区",
    source: "easyscholar",
  };
  const medDisplay = dev.rankDisplay.rankValueDisplay(medicine);
  const multiDisplay = dev.rankDisplay.rankValueDisplay(multidisciplinary);
  const chineseUI = /^zh(?:-|$)/i.test(String(Zotero.locale || ""));
  check(
    "rank.displayFollowsLocale",
    chineseUI
      ? medDisplay.text === "医学1区" && multiDisplay.text === "综合性期刊1区"
      : medDisplay.text === "CAS Z1 · Med." &&
          multiDisplay.text === "CAS Z1 · Multidisc." &&
          medDisplay.description ===
            "CAS Journal Ranking (Upgraded) — Medicine, Zone 1" &&
          multiDisplay.description ===
            "CAS Journal Ranking (Upgraded) — Multidisciplinary, Zone 1",
    `${Zotero.locale}: ${medDisplay.text} / ${multiDisplay.text}`,
  );
  const unknown = dev.rankDisplay.rankValueDisplay({
    field: "custom",
    value: "用户自定义分级",
    source: "easyscholar",
  });
  const collidingCustom = dev.rankDisplay.rankValueDisplay({
    field: "myCustom",
    value: "医学1区",
    source: "easyscholar",
  });
  const dataset = dev.rankDisplay.rankValueDisplay({
    field: "sciUp",
    value: "医学1区",
    source: "dataset",
  });
  setPref("rank.map", "sciUp=CAS");
  const mapped = dev.rank.displayValuesForUI(
    {
      key: "rank-display-fixture",
      name: "Rank display fixture",
      values: [medicine],
      updated: Date.now(),
    },
    ["sciUp"],
  )[0];
  const mappedDisplay = dev.rankDisplay.rankValueDisplay(
    mapped,
    mapped.sourceField,
  );
  check(
    "rank.displayPreservesUnknownAndHandlesMigratedCache",
    unknown.text === "用户自定义分级" &&
      collidingCustom.text === "医学1区" &&
      dataset.text === (chineseUI ? "医学1区" : "CAS Z1 · Med."),
  );
  check(
    "rank.displayKeepsFieldMapAndLocalization",
    mapped.field === "CAS" &&
      mappedDisplay.text === (chineseUI ? "医学1区" : "CAS Z1 · Med."),
  );
  check(
    "rank.displayDoesNotMutateSourceValue",
    medicine.value === "医学1区" && multidisciplinary.value === "综合性期刊1区",
  );
  const legacyDefaultFields = dev.rankDisplay.rankFieldsForDisplay([
    "sciUp",
    "sciif",
    "sci",
  ]);
  const defaultFields = dev.rankDisplay.rankFieldsForDisplay([
    "sciUp",
    "sci",
    "sciif",
  ]);
  const customFields = dev.rankDisplay.rankFieldsForDisplay(["sciUp", "sci"]);
  const expectedDefaultFields = chineseUI
    ? "sciUp,sci,sciif"
    : "sci,sciUp,sciif";
  check(
    "rank.displayOrderFollowsLocale",
    legacyDefaultFields.join(",") === expectedDefaultFields &&
      defaultFields.join(",") === expectedDefaultFields &&
      customFields.join(",") === "sciUp,sci",
    `${Zotero.locale}: legacy=${legacyDefaultFields.join(" ")} current=${defaultFields.join(" ")}`,
  );
}

/* ---------- visible panel: offline by default and reversible ---------- */
// Rendering the default panel must remain offline; the manual control is the
// explicit network action. Stub the transport so this probe never sends a DOI.
{
  setPref("info.enable", true);
  setPref("info.affiliations.autoFetch", false);
  setPref("rank.autoFetch", false);
  const item = await mk({
    title: "phase-e manual affiliations",
    DOI: "10.0000/zest-affiliation-probe",
  });
  trash.push(item);
  const request = dev.httpMod.http.requestResult;
  let requests = 0;
  dev.httpMod.http.requestResult = async () => {
    requests++;
    return {
      kind: "ok",
      status: 200,
      value: {
        authorships: [
          {
            author: {
              id: "https://openalex.org/A0000000001",
              display_name: "Zest Probe",
            },
            institutions: [{ display_name: "Zest Probe Institute" }],
          },
        ],
      },
    };
  };
  try {
    await dev.reveal.clearZestFilters(win);
    await win.ZoteroPane.selectItem(item.id);
    await delay(900);
    setPref("info.enable", false);
    await delay(150);
    check(
      "info.disabledPanelHidden",
      ![...doc.querySelectorAll(".zest-info")].some(
        (el) => el.getClientRects().length,
      ),
    );
    setPref("info.enable", true);
    await delay(250);
    const button = doc.querySelector(".zest-affiliations-fetch");
    check("info.sameItemCanReopen", !!button?.getClientRects().length);
    check("info.affiliationsDefaultOffline", requests === 0 && !!button);
    const link = doc.querySelector(".zest-info-link");
    const linkStyle = link && win.getComputedStyle(link);
    check(
      "info.linkSpacingAndSubtleBorder",
      linkStyle?.margin === "0px" &&
        linkStyle.borderTopWidth === "1px" &&
        linkStyle.borderTopColor !== linkStyle.color,
    );
    const input = doc.querySelector(".zest-info-input");
    const inputStyle = input && win.getComputedStyle(input);
    check(
      "info.remarkAlignedToContentColumn",
      inputStyle?.margin === "0px" &&
        input.getBoundingClientRect().right <=
          input.parentElement.getBoundingClientRect().right + 1,
    );
    button?.click();
    await delay(600);
    check(
      "info.affiliationsManualFetch",
      requests === 1 &&
        doc
          .querySelector(".zest-info")
          ?.textContent.includes("Zest Probe Institute"),
    );
  } finally {
    dev.httpMod.http.requestResult = request;
    dev.cache.remove("oaAuthors", `${item.libraryID}/${item.key}`);
    dev.cache.remove("oaAuthorsMiss", `${item.libraryID}/${item.key}`);
  }
}

/* ---------- graph controls: layout and keyboard interaction ---------- */
{
  const wasVisible = dev.graphPane.isGraphVisible(win);
  setPref("graph.mode", "related");
  const first = await mk({ title: "phase-e graph keyboard first" });
  const second = await mk({ title: "phase-e graph keyboard second" });
  trash.push(first, second);
  first.addRelatedItem(second);
  await first.saveTx();
  await dev.reveal.clearZestFilters(win);
  await win.ZoteroPane.selectItem(first.id);
  dev.graphPane.hideGraphPane(win);
  dev.graphPane.showGraphPane(win);
  await delay(1200);
  const pane = doc.querySelector(".zest-graph-pane");
  check(
    "graph.statusHasOwnRow",
    !!pane?.querySelector(".zest-graph-footer .zest-graph-status"),
  );
  const modes = pane?.querySelector(".zest-graph-modes");
  check(
    "graph.selectedModeAccessible",
    modes?.querySelectorAll('[aria-pressed="true"]').length === 1,
  );
  const activeMode = modes?.querySelector('[aria-pressed="true"]');
  const inactiveMode = modes?.querySelector('[aria-pressed="false"]');
  check(
    "graph.segmentedControlsHaveOwnSpacing",
    !!activeMode &&
      !!inactiveMode &&
      win.getComputedStyle(activeMode).margin === "0px" &&
      win.getComputedStyle(activeMode).backgroundColor !==
        win.getComputedStyle(inactiveMode).backgroundColor,
  );
  const nodes = [...(pane?.querySelectorAll(".zest-graph-node") || [])];
  check(
    "graph.singleKeyboardEntry",
    nodes.length > 1 &&
      nodes.filter((node) => node.getAttribute("tabindex") === "0").length ===
        1,
  );
  const initial = nodes.find((node) => node.getAttribute("tabindex") === "0");
  initial?.focus({ preventScroll: true });
  initial?.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  check(
    "graph.keyboardMovesFocus",
    !!initial &&
      doc.activeElement !== initial &&
      nodes.includes(doc.activeElement),
  );
  if (!wasVisible) dev.graphPane.hideGraphPane(win);
}

/* ---------- real sqlite: failed imports do not poison a retry ---------- */
{
  setPref("tracker.enable", false);
  await dev.readingStore.flush();
  const item = await mk({ title: "phase-e atomic reading import" });
  trash.push(item);
  const incoming = {
    libraryID: item.libraryID,
    itemKey: item.key,
    pages: 4,
    page: { 0: 25, 1: 35 },
    days: { "2026-09-06": 60 },
  };
  const writeBatch = dev.zestDB.writeBatch;
  let rejected = false;
  dev.zestDB.writeBatch = function (batch, mode) {
    if (batch.meta?.some((row) => row.itemKey === item.key)) {
      return Promise.reject(new Error("phase-e injected write failure"));
    }
    return writeBatch.call(this, batch, mode);
  };
  try {
    await dev.readingStore.mergeRecord(incoming, "max").catch(() => {
      rejected = true;
    });
    check(
      "reading.failedImportLeavesMemoryUntouched",
      rejected && !dev.readingStore.getForItem(item),
    );
  } finally {
    dev.zestDB.writeBatch = writeBatch;
  }
  try {
    await dev.readingStore.mergeRecord(incoming, "max");
    await dev.readingStore.mergeRecord(incoming, "max");
    const persisted = (await dev.zestDB.loadAll()).pages.filter(
      (row) => row.itemKey === item.key,
    );
    check(
      "reading.retryPersistsExactlyOnce",
      dev.readingStore.getForItem(item)?.total === 60 &&
        persisted.reduce((n, row) => n + row.seconds, 0) === 60,
    );
    const exported = dev.exportImport
      .collectExport()
      .filter((row) => row.itemKey === item.key);
    const json = dev.exportImport.fromJSON(dev.exportImport.toJSON(exported));
    json[0].libraryID += 9000;
    const csv = dev.exportImport.fromCSV(dev.exportImport.toCSV(exported));
    csv[0].libraryID += 9000;
    const jsonResult = await dev.exportImport.importItems(json, "max");
    const csvResult = await dev.exportImport.importItems(csv, "max");
    check(
      "reading.portableJSONAndCSVResolveIdentity",
      jsonResult.items === 1 &&
        csvResult.items === 1 &&
        dev.readingStore.getForItem(item)?.total === 60,
    );
  } finally {
    await dev.readingStore.clearItem(item.libraryID, item.key);
  }
}

check(
  "extra.appendPreservesUserWhitespace",
  dev.extra.upsertExtraText("my note\r\n\r\n  \r\n", ["Remark"], "value") ===
    "my note\r\n\r\n  \r\n\r\nRemark: value",
);

/* ---------- cleanup ---------- */
if (nativeShowAllBefore === undefined || nativeShowAllBefore === null)
  Zotero.Prefs.clear(NATIVE_SHOW_ALL, true);
else Zotero.Prefs.set(NATIVE_SHOW_ALL, nativeShowAllBefore, true);
for (const [name, value] of saved) {
  if (value === undefined) Zotero.Prefs.clear(prefKey(name), true);
  else Zotero.Prefs.set(prefKey(name), value, true);
}
for (const item of trash) {
  try {
    await item.eraseTx();
  } catch {
    // already gone
  }
}
await delay(600);
const errors = Zotero.getErrors(true).filter(
  (e) => /zest/i.test(String(e)) && !/already installed/i.test(String(e)),
);
check("noPluginErrors", errors.length === 0, errors.slice(0, 2).join(" | "));

out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 1);
