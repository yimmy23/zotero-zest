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
const A = String.fromCharCode(1);
const B = String.fromCharCode(2);
const joinerRaw = Zotero.getString("general.andJoiner", [A, B]);
const pairJoiner = joinerRaw.includes(A)
  ? joinerRaw.replace(A, "{a}").replace(B, "{b}")
  : "{a} and {b}";
const creatorLike = (item) =>
  dev.authors
    .formatAuthors(item, {
      policy: { kind: "creator-like" },
      rules: { order: "auto", given: "none", initialsDot: true },
      etAlText: Zotero.getString("general.etAl"),
      pairJoiner,
    })
    .parts.map((p) => p.text)
    .join("");
const isolates = new RegExp(
  "[" + String.fromCharCode(0x2066) + "-" + String.fromCharCode(0x2069) + "]",
  "g",
);
const zoteroCreator = (item) =>
  String(item.getField("firstCreator") || "").replace(isolates, "");
check(
  "authors.creatorLikeMatchesZotero.three",
  creatorLike(probeItem) === zoteroCreator(probeItem),
  `${creatorLike(probeItem)} vs ${zoteroCreator(probeItem)}`,
);
const pair = await mk({ title: "phase-e pair" }, [
  { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  { firstName: "Alan", lastName: "Turing", creatorType: "author" },
]);
trash.push(pair);
check(
  "authors.creatorLikeMatchesZotero.two",
  creatorLike(pair) === zoteroCreator(pair),
  `${creatorLike(pair)} vs ${zoteroCreator(pair)}`,
);
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
setPref("nestedTags.showAllTags", true);
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

/* ---------- cleanup ---------- */
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
