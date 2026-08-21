/**
 * Phase C acceptance probe — run inside the DEV Zotero instance:
 *   scripts/dev-eval.sh -f scripts/phase-c-probe.js
 *
 * Exercises every Phase C feature against the live app and returns a JSON
 * report. Safe to run repeatedly; it cleans up the reader tab and filters it
 * opens, and never touches anything outside the dev profile.
 */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const win = Zotero.getMainWindow();
const doc = win.document;
const check = (name, cond, note) => {
  (cond ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const delay = (ms) => Zotero.Promise.delay(ms);

// start from the library root so row counts are comparable
try {
  const zp = win.ZoteroPane;
  const cv = zp.collectionsView;
  cv.selection?.select(0);
  // a programmatic selection does not always propagate to the item view in a
  // headless run — switch the item view explicitly (Zotero 10 API)
  const libraryRow = cv.getRow?.(0);
  if (libraryRow && typeof zp.itemsView?.changeCollectionTreeRow === "function") {
    await zp.itemsView.changeCollectionTreeRow(libraryRow);
  }
  await delay(1000);
} catch {
  // older layout — carry on with whatever is selected
}

// ---------- 1. nested tag tree ----------
dev.tagTreeUI.setTreeShown(win, true);
await dev.tagTreeUI.refreshTagTree(win);
await delay(600);
const treeRoot = doc.getElementById("zest-tag-tree");
const nativeSelector = doc.getElementById("zotero-tag-selector");
check("tagtree.mounted", !!treeRoot && !treeRoot.hidden);
check("tagtree.nativeHidden", !!nativeSelector && nativeSelector.hidden);
const rootRows = [...doc.querySelectorAll(".zest-tagtree-row")].map((r) =>
  r.getAttribute("data-tag"),
);
check("tagtree.rows", rootRows.length > 0, rootRows.join(", "));

// pick a tag branch that covers SOME but not all of the visible rows, so the
// filter provably narrows the list whatever collection happens to be selected
const before = win.ZoteroPane.itemsView.rowCount;
const rowsNow = win.ZoteroPane.itemsView.getSortedItems();
// open every branch first so leaf rows exist
for (const tw of doc.querySelectorAll(".zest-tagtree-twisty")) {
  tw.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await delay(120);
}
const treeRows = [...doc.querySelectorAll(".zest-tagtree-row")];
const itemTags = rowsNow.map((i) => dev.tagScope.tagsOfItem(i, true));
let picked = null;
for (const row of treeRows) {
  const path = row.getAttribute("data-tag") || "";
  if (!path) continue;
  // the tree strips the match prefix ("#"), so compare on the suffix
  const n = itemTags.filter((tags) =>
    tags.some((t) => t === path || t.endsWith(path) || t.startsWith(path)),
  ).length;
  if (n > 0 && n < before) {
    picked = { row, path, n };
    break;
  }
}
if (picked) {
  picked.row.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await delay(1500);
  const filtered = win.ZoteroPane.itemsView.rowCount;
  check(
    "tagtree.branchFilter",
    filtered === picked.n,
    `${picked.path} covers ${picked.n} of ${before} → ${filtered}`,
  );
} else {
  out.notes.push("tagtree.branchFilter: no branch narrows the current view");
}
dev.tagTreeUI.clearSelection(win);
await delay(1200);
check("tagtree.clear", win.ZoteroPane.itemsView.rowCount === before);

// search box
const search = doc.querySelector(".zest-tagtree-search");
if (search) {
  const term = (rootRows[0] || "").slice(0, 3).toLowerCase();
  search.value = term;
  search.dispatchEvent(new win.Event("input", { bubbles: true }));
  await delay(300);
  check(
    "tagtree.search",
    doc.querySelectorAll(".zest-tagtree-row").length > 0,
    term,
  );
  search.value = "";
  search.dispatchEvent(new win.Event("input", { bubbles: true }));
}

// ---------- 2. annotation locator cards ----------
const items = await Zotero.Items.getAll(1);
const annotated = items.find((i) => {
  try {
    if (!i.isRegularItem?.()) return false;
    return i.getAttachments().some((id) => {
      const att = Zotero.Items.get(id);
      try {
        return att?.getAnnotations?.().length;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
});
if (annotated) {
  await win.ZoteroPane.selectItem(annotated.id);
  await delay(1500);
  const cards = doc.querySelectorAll(".zest-annot-card").length;
  check("annots.cards", cards > 0, `${cards} cards`);
} else {
  out.notes.push("annots.cards: no annotated item in this profile");
}

// ---------- 3. columns ----------
const registered = [
  "reading",
  "status",
  "rating",
  "tags",
  "texttags",
  "annots",
  "pubtags",
  "if",
  "venue",
].filter((k) => dev.registry.isRegistered(k));
check("columns.registered", registered.length >= 6, registered.join(", "));

// ---------- 4. journal rank chain ----------
const withJournal = items.find((i) => {
  try {
    return i.isRegularItem?.() && i.getField("publicationTitle");
  } catch {
    return false;
  }
});
if (withJournal) {
  const rec = await dev.rank.lookupJournal(withJournal, true);
  check(
    "rank.lookup",
    !!rec && Array.isArray(rec.values),
    rec
      ? `${rec.name}: ${rec.values.map((v) => v.field + "=" + v.value).join(", ") || "(no values)"}`
      : "null",
  );
}
check(
  "rank.inferRank",
  dev.rankRank.inferRank("sciif", "12.4") === 1 &&
    dev.rankRank.inferRank("sci", "2区") === 2,
);
check(
  "rank.sortMissingLast",
  dev.rankRank.sortKeyFor("sciif", "") >
    dev.rankRank.sortKeyFor("sciif", "0.1"),
);

// ---------- 5. view groups ----------
const canViews = dev.viewGroups.canApplyViews(win);
check("views.probe", canViews);
if (canViews) {
  const snapshot = dev.viewGroups.captureView(win, "probe");
  const minimal = {
    id: "probe-min",
    name: "probe",
    columns: [{ dataKey: "title", hidden: false, ordinal: 0, width: 300 }],
    sortField: "title",
    sortDirection: 1,
  };
  const applied = await dev.viewGroups.applyView(win, minimal);
  await delay(1200);
  const visible = dev.viewGroups
    .captureView(win, "after")
    .columns.filter((c) => !c.hidden).length;
  check("views.apply", applied && visible === 1, `${visible} visible`);
  await dev.viewGroups.applyView(win, snapshot);
  await delay(1200);
  const restored = dev.viewGroups
    .captureView(win, "restored")
    .columns.filter((c) => !c.hidden).length;
  check(
    "views.restore",
    restored === snapshot.columns.filter((c) => !c.hidden).length,
    `${restored} visible`,
  );
}

// ---------- 6. type filter ----------
const types = dev.typeFilter.typesInView(win);
if (types.length) {
  const rows0 = win.ZoteroPane.itemsView.rowCount;
  await dev.typeFilter.toggleType(win, types[0].type);
  await delay(1200);
  const rows1 = win.ZoteroPane.itemsView.rowCount;
  await dev.typeFilter.clearTypeFilter(win);
  await delay(1200);
  const rows2 = win.ZoteroPane.itemsView.rowCount;
  check(
    "typefilter",
    rows1 <= rows0 && rows2 === rows0,
    `${rows0} → ${rows1} → ${rows2}`,
  );
}

// ---------- 7. collection counts ----------
Zotero.Prefs.set("extensions.zotero.zest.collectionCounts.enable", true, true);
await delay(1800);
const badges = [...doc.querySelectorAll(".zest-count")].map(
  (b) => b.textContent,
);
Zotero.Prefs.set("extensions.zotero.zest.collectionCounts.enable", false, true);
await delay(1800);
check(
  "collectionCounts",
  doc.querySelectorAll(".zest-count").length === 0,
  badges.length
    ? `badges: ${badges.join(", ")}`
    : "no collections in this profile",
);

// ---------- 8. graph ----------
dev.graphPane.showGraphPane(win);
await delay(2500);
const nodes = doc.querySelectorAll(".zest-graph-canvas circle").length;
check("graph.render", nodes > 0, `${nodes} nodes`);
dev.graphPane.hideGraphPane(win);
check("graph.teardown", !doc.getElementById("zest-graph-pane"));

// ---------- 9. reader colour schemes ----------
const listeners = (Zotero.Reader._registeredListeners || []).filter((l) =>
  String(l.pluginID || "").includes("zest"),
);
check(
  "reader.menuHooks",
  listeners.length >= 2,
  listeners.map((l) => l.type).join(", "),
);

// ---------- 10. config bundle ----------
check("config.store", typeof dev.zestConfig?.get === "function");

// ---------- errors ----------
const errors = Zotero.getErrors(true).filter(
  (e) =>
    /zest/i.test(String(e)) &&
    // dev-loop noise: the scaffold reinstalls the temporary add-on
    !/already installed/i.test(String(e)),
);
check("noPluginErrors", errors.length === 0, errors.slice(0, 3).join(" | "));

out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 1);
