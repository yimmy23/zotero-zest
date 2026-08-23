/**
 * Phase D acceptance probe — run inside the DEV Zotero instance:
 *   scripts/dev-eval.sh -f scripts/phase-d-probe.js
 *
 * Covers the author columns, citation counts, the info panel, the reading
 * statistics window, the annotation matrix and the vertical tab manager.
 * It creates and deletes its own probe items, and closes the windows it opens.
 */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const win = Zotero.getMainWindow();
const doc = win.document;
const delay = (ms) => Zotero.Promise.delay(ms);
const check = (name, cond, note) => {
  (cond ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};

// library scope, so counts are comparable
try {
  const cv = win.ZoteroPane.collectionsView;
  cv.selection?.select(0);
  await win.ZoteroPane.itemsView.changeCollectionTreeRow(cv.getRow(0));
  await delay(800);
} catch {
  // older layout
}

/* ---------- 1. authors pipeline ---------- */
const mk = async (type, creators, fields = {}) => {
  const item = new Zotero.Item(type);
  item.libraryID = 1;
  item.setField("title", "phase-d probe");
  for (const [k, v] of Object.entries(fields)) item.setField(k, v);
  item.setCreators(creators);
  await item.saveTx();
  return item;
};
const fmt = (item, policy, rules) =>
  dev.authors
    .formatAuthors(item, {
      policy,
      rules: rules || { order: "auto", given: "full", initialsDot: true },
      etAlText: "et al.",
    })
    .parts.map((p) => p.text)
    .join("");

const latin = await mk("journalArticle", [
  { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  { firstName: "Alan", lastName: "Turing", creatorType: "author" },
  { firstName: "Grace", lastName: "Hopper", creatorType: "author" },
]);
const cjk = await mk("journalArticle", [
  { firstName: "小明", lastName: "王", creatorType: "author" },
  { firstName: "雷", lastName: "李", creatorType: "author" },
]);
const film = await mk("film", [
  { firstName: "Akira", lastName: "Kurosawa", creatorType: "director" },
]);
check(
  "authors.all",
  fmt(latin, { kind: "all" }) === "Ada Lovelace, Alan Turing, Grace Hopper",
);
check(
  "authors.cjkSeparator",
  fmt(cjk, { kind: "all" }) === "王小明、李雷",
  fmt(cjk, { kind: "all" }),
);
check(
  "authors.roleFromItemType",
  fmt(film, { kind: "all" }) === "Akira Kurosawa",
);
const marked = dev.authors.formatAuthors(latin, {
  policy: { kind: "all" },
  rules: { order: "auto", given: "full", initialsDot: true },
  marks: { last: "†" },
});
check(
  "authors.markNotInSortKey",
  !marked.sortKey.includes("†"),
  marked.sortKey,
);

/* ---------- 2. citation counts ---------- */
const legacy = {
  ours: "Citations: 42 (Crossref) [2026-07-28]",
  gscc: "GSCC: 0001719 2025-04-25T18:45:33.000Z 2.34",
  zscc: "ZSCC: 0000123",
  eschnett: "42 citations (Crossref) [2026-07-28]",
  openalex: "openalex.cit_count: 42",
};
const parsed = {};
for (const [name, line] of Object.entries(legacy)) {
  latin.setField("extra", `${line}\nPublisher: X`);
  await latin.saveTx();
  parsed[name] = dev.citeExtra.readCitations(latin)?.count ?? null;
}
check(
  "citations.legacyFormats",
  Object.values(parsed).every((v) => typeof v === "number"),
  JSON.stringify(parsed),
);
latin.setField(
  "extra",
  "GSCC: 0000010\nPublisher: X\nCitations: 1 (Crossref) [2026-01-01]",
);
await latin.saveTx();
latin.setField(
  "extra",
  dev.citeExtra.withCitationLine(
    latin.getField("extra"),
    "Citations: 7 (Crossref) [2026-08-18]",
  ),
);
await latin.saveTx();
// our own line is replaced IN PLACE; another plugin's record is never deleted
check(
  "citations.replacesOwnLineOnly",
  latin.getField("extra").includes("GSCC: 0000010") &&
    latin.getField("extra").includes("Citations: 7") &&
    !latin.getField("extra").includes("Citations: 1"),
  latin.getField("extra").replace(/\n/g, " | "),
);

/* ---------- 3. info panel ---------- */
const withPdf = (await Zotero.Items.getAll(1)).find(
  (i) => i.isRegularItem?.() && i.getAttachments().length,
);
if (withPdf) {
  await win.ZoteroPane.selectItem(withPdf.id);
  await delay(1800);
  const panel = doc.querySelector(".zest-info");
  const rows = [...(panel?.querySelectorAll(".zest-info-row") || [])].length;
  check("infoPanel.rows", rows >= 4, `${rows} rows`);
  check(
    "infoPanel.heatStrip",
    doc.querySelectorAll(".zest-info-heat-seg").length > 0,
  );
  check(
    "infoPanel.icons",
    doc.querySelectorAll(".zest-info-btn .zest-icon").length > 0,
  );
}

/* ---------- 4. remark ---------- */
if (withPdf) {
  await dev.remark.setRemark(withPdf, "probe remark");
  await delay(400);
  check("remark.roundTrip", dev.remark.remarkOf(withPdf) === "probe remark");
  await dev.remark.setRemark(withPdf, "");
}

/* ---------- 5. reading statistics ---------- */
dev.stats.openStatsDialog(win);
await delay(2500);
const statsWin = [...Services.wm.getEnumerator(null)].find((w) =>
  w.document?.querySelector?.(".zest-stats"),
);
if (statsWin) {
  const d = statsWin.document;
  const cells = d.querySelectorAll(".zest-cal-cell").length;
  const coloured = [...d.querySelectorAll(".zest-cal-cell")].filter(
    (c) => c.style.backgroundColor,
  ).length;
  check(
    "stats.calendar",
    cells > 350,
    `${cells} cells, ${coloured} with reading`,
  );
  check("stats.cards", d.querySelectorAll(".zest-stats-card").length === 6);
  statsWin.close();
} else {
  out.fail.push("stats.window");
}

/* ---------- 6. annotation matrix ---------- */
dev.matrix.openMatrix(win);
await delay(2500);
const matrixWin = [...Services.wm.getEnumerator(null)].find((w) =>
  w.document?.querySelector?.(".zest-matrix"),
);
if (matrixWin) {
  const d = matrixWin.document;
  const rows = d.querySelectorAll(".zest-matrix-row").length;
  check("matrix.rows", rows > 0, `${rows} annotations`);
  const search = d.querySelector(".zest-matrix-search");
  if (search) {
    search.value = "text 1";
    search.dispatchEvent(new matrixWin.Event("input", { bubbles: true }));
    await delay(400);
    check(
      "matrix.search",
      d.querySelectorAll(".zest-matrix-row").length < rows,
      `${d.querySelectorAll(".zest-matrix-row").length} after search`,
    );
    search.value = "";
    search.dispatchEvent(new matrixWin.Event("input", { bubbles: true }));
  }
  check(
    "matrix.flatButtons",
    d.querySelectorAll(".zest-flat-btn").length === 2,
  );
  matrixWin.close();
} else {
  out.fail.push("matrix.window");
}

/* ---------- 7. vertical tabs ---------- */
check("tabs.probe", dev.tabsSidebar.probeTabs(win));
dev.tabsSidebar.showSidebar(win);
await delay(900);
check("tabs.sidebar", !!doc.getElementById("zest-tabbar"));
// the library tab is deliberately not listed, so the list is empty until a
// document tab exists — open one to exercise the rows
check(
  "tabs.emptyState",
  doc.querySelectorAll(".zest-tabbar-row").length === 0 &&
    !!doc.querySelector(".zest-tabbar-empty"),
);
let probeTabID;
if (withPdf) {
  const att = Zotero.Items.get(withPdf.getAttachments()[0]);
  await Zotero.Reader.open(att.id, undefined, { openInBackground: true });
  await delay(1500);
  probeTabID = (win.Zotero_Tabs._tabs || []).find(
    (t) => t.type !== "library",
  )?.id;
}
check(
  "tabs.rows",
  doc.querySelectorAll(".zest-tabbar-row").length > 0,
  `${doc.querySelectorAll(".zest-tabbar-row").length} rows`,
);
check(
  "tabs.sidebarSurvivesReaderTab",
  (() => {
    if (!probeTabID) return false;
    win.Zotero_Tabs.select(probeTabID);
    const bar = doc.getElementById("zest-tabbar");
    const r = bar?.getBoundingClientRect();
    return !!r && r.width > 0 && r.height > 0;
  })(),
);
if (probeTabID) {
  try {
    win.Zotero_Tabs.close(probeTabID);
  } catch {
    // already gone
  }
  await delay(400);
}
const group = dev.tabsModel.addGroup("probe group");
check(
  "tabs.groupPersists",
  dev.tabsModel.groups().some((g) => g.id === group.id),
);
dev.tabsModel.removeGroup(group.id);
dev.tabsSidebar.hideSidebar(win);
await delay(400);
check(
  "tabs.teardown",
  !doc.getElementById("zest-tabbar") &&
    !doc.documentElement.classList.contains("zest-hide-native-tabs"),
);

/* ---------- 8. icons everywhere ---------- */
check(
  "icons.present",
  doc.querySelectorAll(".zest-icon").length > 0,
  `${doc.querySelectorAll(".zest-icon").length} icons`,
);

/* ---------- cleanup + errors ---------- */
for (const item of [latin, cjk, film]) {
  try {
    await item.eraseTx();
  } catch {
    // already gone
  }
}
const errors = Zotero.getErrors(true).filter(
  (e) => /zest/i.test(String(e)) && !/already installed/i.test(String(e)),
);
check("noPluginErrors", errors.length === 0, errors.slice(0, 2).join(" | "));

out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 1);
