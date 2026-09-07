/** Isolated, in-memory acceptance; no tag or library writes. */
if (!Zotero.DataDirectory.dir.endsWith("/.scaffold/dev-data"))
  throw Error("isolated development library required");
const win = Zotero.getMainWindow(),
  doc = win.document,
  pane = win.ZoteroPane;
const delay = (ms) => Zotero.Promise.delay(ms);
const report = { ok: [], timings: {}, screenshots: [] };
const check = (name, condition) => {
  if (!condition) throw Error(name);
  report.ok.push(name);
};
const oldView = pane.itemsView.getSortedItems,
  oldGet = Zotero.Items.get,
  oldAll = Zotero.Tags.getAll,
  oldColors = Zotero.Tags.getColors;
const oldLocale = addon.data.locale.current,
  oldRequested = [...Services.locale.requestedLocales];
const prefs = [
  "extensions.zotero.zest.nestedTags.show",
  "extensions.zotero.zest.nestedTags.tab",
  "extensions.zotero.zest.nestedTags.linkSymbol",
  "extensions.zotero.zest.nestedTags.sort",
  "extensions.zotero.zest.textTags.match",
  "extensions.zotero.zest.nestedTags.matchChildTags",
  "extensions.zotero.tagSelector.displayAllTags",
  "extensions.zotero.tagSelector.showAutomatic",
];
const saved = prefs.map((key) => ({
  key,
  had: Services.prefs.prefHasUserValue(key),
  value: Zotero.Prefs.get(key, true),
}));
const themeKeys = [
  "ui.systemUsesDarkTheme",
  "browser.theme.toolbar-theme",
  "browser.theme.content-theme",
];
const themeSaved = themeKeys.map((key) => ({
  key,
  had: Services.prefs.prefHasUserValue(key),
  value: Services.prefs.getIntPref(key, 0),
}));
const container = doc.getElementById("zotero-tag-selector-container"),
  sidebar = doc.getElementById("zotero-collections-pane");
const styleBefore = [container, sidebar].map((el) => ({
  el,
  style: el.getAttribute("style"),
}));
const map = new Map();
let reads = 0,
  allCalls = 0;
function paper(id, tags) {
  const item = Object.create(Zotero.Item.prototype);
  const values = {
    id,
    key: "T" + String(id).slice(-7),
    libraryID: Zotero.Libraries.userLibraryID,
    parentItemID: false,
    deleted: false,
    isRegularItem: () => true,
    isAttachment: () => false,
    isAnnotation: () => false,
    getTags: () => {
      reads++;
      return tags.map((tag) => ({ tag, type: 0 }));
    },
    getAttachments: () => [],
    getNotes: () => [],
    getField: () => "Isolated tag UI demonstration",
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(item, key, { value, configurable: true });
  Object.defineProperty(item, "topLevelItem", { get: () => item });
  map.set(id, item);
  return item;
}
const headings = [
  "研究主题",
  "研究设计",
  "治疗策略",
  "结局指标",
  "证据质量",
  "待办与写作",
];
const labels = [
  ["淋巴结评估", "淋巴结清扫", "微小残留病灶", "病理完全缓解"],
  ["随机对照试验", "队列研究", "倾向评分", "敏感性分析"],
  ["围术期免疫治疗", "新辅助治疗", "辅助治疗", "手术方式"],
  ["无事件生存", "总生存", "术后并发症", "生活质量"],
  ["偏倚风险", "证据不足", "值得精读", "结果待核"],
  ["纳入研究笔记", "提取数据", "补查原文", "讨论中引用"],
];
let tags = headings.flatMap((group, i) =>
  labels[i].map((label) => "#" + group + "/" + label),
);
tags.push(
  "#研究主题/淋巴结评估/纵隔与肺门/多层级示例/长标签的完整名称可以通过悬停查看",
);
let items = tags.flatMap((tag, i) =>
  Array.from({ length: 1 + (i % 5) }, (_, j) =>
    paper(90000000 + i * 10 + j, [tag]),
  ),
);
const roots = () => doc.querySelector(".zest-tagtree");
const body = () => doc.querySelector(".zest-tagtree-body");
const rows = () => [...doc.querySelectorAll(".zest-tagtree-row")];
const row = (name) => rows().find((r) => r.getAttribute("data-tag") === name);
async function settle() {
  await dev.tagTreeUI.refreshTagTree(win);
  for (let i = 0; i < 40; i++) {
    await delay(50);
    if (body().getAttribute("aria-busy") !== "true") return;
  }
  throw Error("tree still loading");
}
async function shot(name, dark) {
  Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
  Services.prefs.setIntPref("browser.theme.toolbar-theme", dark ? 0 : 1);
  Services.prefs.setIntPref("browser.theme.content-theme", dark ? 0 : 1);
  await delay(400);
  const rect = container.getBoundingClientRect(),
    canvas = doc.createElement("canvas");
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.drawWindow(
    win,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    "rgb(255,255,255)",
  );
  const path = PathUtils.join(
    PathUtils.parent(Zotero.DataDirectory.dir),
    "tags-" + name + ".png",
  );
  await IOUtils.write(
    path,
    Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
      c.charCodeAt(0),
    ),
  );
  report.screenshots.push(path);
}
try {
  dev.tagTreeUI.clearSelection(win);
  pane.itemsView.getSortedItems = () => items;
  Zotero.Items.get = function (id, ...args) {
    return map.get(id) || oldGet.call(this, id, ...args);
  };
  Zotero.Tags.getAll = async () => {
    allCalls++;
    return tags.map((tag) => ({ tag, type: 0 }));
  };
  Zotero.Tags.getColors = () =>
    new Map([
      [tags[0], { color: "#a28ae5", position: 0 }],
      [tags[4], { color: "#2ea8e5", position: 1 }],
    ]);
  for (const [key, value] of [
    ["nestedTags.show", true],
    ["nestedTags.tab", "tree"],
    ["nestedTags.linkSymbol", "/"],
    ["nestedTags.sort", "az"],
    ["textTags.match", "#"],
    ["nestedTags.matchChildTags", true],
  ])
    Zotero.Prefs.set("extensions.zotero.zest." + key, value, true);
  Zotero.Prefs.set("extensions.zotero.tagSelector.displayAllTags", true, true);
  Zotero.Prefs.set("extensions.zotero.tagSelector.showAutomatic", true, true);
  Services.locale.requestedLocales = ["zh-CN"];
  addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
  // Re-mount only this isolated UI to apply its locale, then restore at exit.
  dev.tagTreeUI.uninstallTagTree(win);
  dev.tagTreeUI.installTagTree(win);
  sidebar.style.width = "300px";
  sidebar.style.minWidth = "300px";
  sidebar.style.maxWidth = "300px";
  container.style.height = "470px";
  container.style.minHeight = "470px";
  container.style.maxHeight = "470px";
  await settle();
  await delay(400);
  check("six top-level groups", rows().length === 6);
  const methodTotal = Number(
    row("研究设计").querySelector(".zest-tagtree-num").textContent,
  );
  check(
    "current-view counts",
    methodTotal ===
      items.filter((i) =>
        i.getTags().some((t) => t.tag.startsWith("#研究设计/")),
      ).length,
  );
  roots().querySelector(".zest-collapse").click();
  check("expand all", rows().length > 30);
  row("研究主题/淋巴结评估").click();
  await settle();
  check(
    "selected branch chip",
    roots().querySelector(".zest-tagtree-chip span").textContent ===
      "研究主题/淋巴结评估",
  );
  await shot("rich-light", false);
  await shot("rich-dark", true);
  const target = row("研究设计");
  target.focus();
  await settle();
  check("focus survives refresh", doc.activeElement === row("研究设计"));
  const before = allCalls;
  const search = roots().querySelector(".zest-tagtree-search");
  search.focus();
  search.value = "淋巴结";
  search.dispatchEvent(new win.Event("input"));
  await delay(200);
  check("search does not query library", allCalls === before);
  check("search keeps focus", doc.activeElement === search);
  check(
    "search retains matching ancestry",
    rows().some((r) => r.getAttribute("data-tag") === "研究主题") &&
      rows().every((r) => r.getAttribute("data-tag").startsWith("研究主题")),
  );
  search.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  check("escape clears search", search.value === "");
  roots().querySelector(".zest-tagtree-chip").click();
  await settle();
  check(
    "chip clears only tag filter",
    dev.tagTreeUI.selectedTagNames(win).length === 0,
  );
  for (const width of [200, 240, 320]) {
    sidebar.style.width =
      sidebar.style.minWidth =
      sidebar.style.maxWidth =
        width + "px";
    await delay(150);
    const root = roots(),
      input = root.querySelector(".zest-tagtree-search");
    check(
      width + " no horizontal overflow",
      root.scrollWidth <= root.clientWidth + 1 &&
        root.querySelector(".zest-tagtree-scroll").scrollWidth <=
          root.clientWidth + 1,
    );
    check(
      width + " usable search",
      input.getBoundingClientRect().width >= width - 75,
    );
    if (width === 200) await shot("narrow-light", false);
  }
  // Changing the pref directly uses the same cleanup as clicking the tab.
  row("研究主题").click();
  await settle();
  Zotero.Prefs.set("extensions.zotero.zest.nestedTags.tab", "native", true);
  await delay(200);
  check(
    "native preference clears selection",
    dev.tagTreeUI.selectedTagNames(win).length === 0 &&
      !doc.getElementById("zotero-tag-selector").hidden,
  );
  const hiddenCalls = allCalls;
  await dev.tagTreeUI.refreshTagTree(win);
  check("native tab skips scope work", allCalls === hiddenCalls);
  Zotero.Prefs.set("extensions.zotero.zest.nestedTags.tab", "tree", true);
  await settle();
  search.value = "no matching fixture";
  search.dispatchEvent(new win.Event("input"));
  await delay(200);
  check(
    "search empty state",
    rows().length === 0 && !!body().querySelector(".zest-tagtree-empty"),
  );
  await shot("empty-light", false);
  search.value = "";
  search.dispatchEvent(new win.Event("input"));
  await delay(200);
  dev.tagTreeUI.clearSelection(win);
  tags = Array.from(
    { length: 3000 },
    (_, i) => "#Group " + Math.floor(i / 50) + "/Tag " + i,
  );
  items = tags.map((tag, i) => paper(91000000 + i, [tag]));
  dev.tagScope.clearTagCache();
  reads = 0;
  let started = Date.now();
  await settle();
  report.timings.collect3000Ms = Date.now() - started;
  const firstReads = reads;
  check("3000 tags initially collapsed", rows().length === 60);
  started = Date.now();
  roots().querySelector(".zest-collapse").click();
  report.timings.expand3000Ms = Date.now() - started;
  check("all large-snapshot nodes retained", rows().length === 3060);
  const readsBefore = reads;
  search.value = "Tag 2999";
  search.dispatchEvent(new win.Event("input"));
  await delay(200);
  check(
    "large search reuses snapshot",
    reads === readsBefore && rows().length === 2,
  );
  search.value = "";
  search.dispatchEvent(new win.Event("input"));
  await delay(200);
  await settle();
  check("repeat collection uses tag cache", reads === firstReads);
  Services.locale.requestedLocales = ["en-US"];
  addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
  dev.tagTreeUI.uninstallTagTree(win);
  dev.tagTreeUI.installTagTree(win);
  sidebar.style.width =
    sidebar.style.minWidth =
    sidebar.style.maxWidth =
      "200px";
  await settle();
  await shot("english-narrow-light", false);
  roots().style.setProperty("--zotero-font-size", "20px");
  roots().style.fontSize = "20px";
  await delay(150);
  check(
    "large font no horizontal overflow",
    roots().scrollWidth <= roots().clientWidth + 1,
  );
  await shot("english-large-dark", true);
  return report;
} finally {
  dev.tagTreeUI.clearSelection(win);
  pane.itemsView.getSortedItems = oldView;
  Zotero.Items.get = oldGet;
  Zotero.Tags.getAll = oldAll;
  Zotero.Tags.getColors = oldColors;
  dev.tagScope.clearTagCache();
  Services.locale.requestedLocales = oldRequested;
  addon.data.locale.current = oldLocale;
  for (const p of saved) {
    if (p.had) Zotero.Prefs.set(p.key, p.value, true);
    else Services.prefs.clearUserPref(p.key);
  }
  for (const p of themeSaved) {
    if (p.had) Services.prefs.setIntPref(p.key, p.value);
    else Services.prefs.clearUserPref(p.key);
  }
  for (const { el, style } of styleBefore) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  dev.tagTreeUI.uninstallTagTree(win);
  dev.tagTreeUI.installTagTree(win);
  await delay(500);
}
