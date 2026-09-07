/** Isolated Zotero UI acceptance. In-memory fixtures; never writes library data. */
if (!Zotero.DataDirectory.dir.endsWith("/.scaffold/dev-data"))
  throw new Error("This probe requires the isolated development library");
const host = Zotero.getMainWindow();
const pane = host.ZoteroPane;
const oldView = pane.itemsView.getSortedItems;
const oldSelection = pane.getSelectedItems;
const oldLookup = Zotero.Items.get;
const oldCopy = Zotero.Utilities.Internal.copyTextToClipboard;
const oldLocale = addon.data.locale.current;
const oldRequested = [...Services.locale.requestedLocales];
const hadTheme = Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme");
const oldTheme = hadTheme
  ? Services.prefs.getIntPref("ui.systemUsesDarkTheme")
  : 0;
const report = { ok: [], timings: {}, screenshots: [] };
const copies = [];
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  report.ok.push(name);
};
const delay = (ms) => Zotero.Promise.delay(ms);
const digits = (text) => text.replace(/\D/g, "");
const map = new Map();
const parents = [],
  attachments = [];
let scans = 0;
for (let i = 0; i < 25; i++) {
  const base = 800000 + i * 200;
  const paper = {
    id: base,
    key: "M" + String(i).padStart(7, "0"),
    libraryID: 1,
    isRegularItem: () => true,
    isAttachment: () => false,
    isAnnotation: () => false,
    getAttachments: () => [base + 1],
    getField: () =>
      [
        "围术期免疫治疗的证据整理（演示）",
        "Reading complex trial reports: a structured approach (demo)",
        "从标注到写作：研究设计与结果解读（演示）",
      ][i % 3] + (i > 2 ? " " + i : ""),
  };
  const marks = [];
  const attachment = {
    id: base + 1,
    key: "A" + String(i).padStart(7, "0"),
    libraryID: 1,
    parentItemID: base,
    isRegularItem: () => false,
    isAttachment: () => true,
    isAnnotation: () => false,
    getField: () => (i % 2 ? "Supplementary appendix" : "Full text · PDF"),
    getAnnotations: () => {
      scans++;
      return marks;
    },
  };
  for (let j = 0; j < 104; j++) {
    const annotation = {
      id: base + 2 + j,
      key: "N" + String(i * 104 + j).padStart(7, "0"),
      libraryID: 1,
      parentItemID: attachment.id,
      isRegularItem: () => false,
      isAttachment: () => false,
      isAnnotation: () => true,
      annotationText:
        j === 3
          ? ""
          : [
              "Define the study population, treatment strategy and time zero before comparing outcomes. Keep the estimand consistent with the question being asked. [Demonstration text]",
              "Read the confidence interval alongside the point estimate. A non-significant result alone does not establish equivalence. [Demonstration text]",
              "在整理文献时，同时记录研究设计、分析人群和随访窗口。将作者的结论与数据支持的范围分开，以便回到原文核对。（演示文本）",
            ][j % 3] +
            (j === 2
              ? " 补充长标注演示，用于验证折叠与完整展开，不代表研究结果。".repeat(
                  40,
                )
              : ""),
      annotationComment:
        j % 3 === 0
          ? "写作要点：保留这段用于 Methods 的研究设计说明；引用前复核原文、页码与适用范围。（演示批注）"
          : "",
      annotationColor: ["#ffd400", "#a28ae5", "#2ea8e5", "#f19837"][j % 4],
      annotationType: j === 3 ? "image" : j % 2 ? "underline" : "highlight",
      annotationPageLabel: String(j + 1),
      annotationPosition: JSON.stringify({ pageIndex: j }),
      getTags: () => [{ tag: ["研究设计", "结果解读", "写作线索"][j % 3] }],
    };
    marks.push(annotation);
    map.set(annotation.id, annotation);
  }
  map.set(paper.id, paper);
  map.set(attachment.id, attachment);
  parents.push(paper);
  attachments.push(attachment);
}
let view = [...parents, ...attachments];
let selected = [attachments[1]];
let w, d;
async function settled() {
  for (let i = 0; i < 120; i++) {
    if (
      d?.querySelector(".zest-matrix-list")?.getAttribute("aria-busy") ===
      "false"
    )
      return;
    await delay(40);
  }
  throw new Error("Matrix did not settle");
}
function change(selector, value, type = "change") {
  const node = d.querySelector(selector);
  node.value = value;
  node.dispatchEvent(new w.Event(type, { bubbles: true }));
}
async function shot(name, dark) {
  Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
  await delay(150);
  const canvas = d.createElement("canvas");
  canvas.width = w.innerWidth * 1.5;
  canvas.height = w.innerHeight * 1.5;
  const ctx = canvas.getContext("2d");
  ctx.scale(1.5, 1.5);
  ctx.drawWindow(
    w,
    w.scrollX,
    w.scrollY,
    w.innerWidth,
    w.innerHeight,
    "rgb(255,255,255)",
  );
  const path = PathUtils.join(
    PathUtils.parent(Zotero.DataDirectory.dir),
    "matrix-refined-" + name + ".png",
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
  dev.matrix.closeMatrix();
  // Capture text at the native API boundary; do not disturb the system clipboard.
  Zotero.Utilities.Internal.copyTextToClipboard = (text) => copies.push(text);
  pane.itemsView.getSortedItems = () => view;
  pane.getSelectedItems = () => selected;
  Zotero.Items.get = function (id, ...args) {
    return map.get(id) || oldLookup.call(this, id, ...args);
  };
  Services.locale.requestedLocales = ["zh-CN"];
  await delay(150);
  addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
  const start = Date.now();
  dev.matrix.openMatrix(host);
  for (let i = 0; i < 100 && !w; i++) {
    await delay(50);
    w = [...Services.wm.getEnumerator("")].find((w) =>
      w.document?.querySelector(".zest-matrix"),
    );
  }
  check("dialog loaded", !!w);
  d = w.document;
  await settled();
  report.timings.collectAndRenderMs = Date.now() - start;
  check(
    "2600 annotations deduplicated",
    digits(d.querySelector(".zest-matrix-count").textContent) === "26002600",
  );
  check(
    "bounded 100-row DOM",
    d.querySelectorAll(".zest-matrix-row").length === 100,
  );
  check("each attachment scanned once", scans === 25);
  const copyMD = d.querySelector(".zest-matrix-copy-md");
  check("Markdown copy available", copyMD && !copyMD.disabled);
  const copyStart = Date.now();
  copyMD.click();
  report.timings.copyMarkdownMs = Date.now() - copyStart;
  check(
    "Markdown copies 2600 source links, not current 100 rows",
    (copies[0].match(/annotation=/g) || []).length === 2600 &&
      copies[0].includes("annotation=N0002599"),
  );
  check("Markdown copy does not rescan", scans === 25);
  const exportDetails = d.querySelector(".zest-matrix-export");
  exportDetails.open = true;
  await shot("copy-light", false);
  await shot("copy-dark", true);
  exportDetails.open = false;
  await shot("light", false);
  await shot("dark", true);
  d.querySelector(".zest-matrix-expand").click();
  check(
    "full text expands",
    d.querySelector('.zest-matrix-expand[aria-expanded="true"]') &&
      [...d.querySelectorAll(".zest-matrix-text")].some(
        (n) => n.textContent.length > 650,
      ),
  );
  for (let i = 0; i < 25; i++) d.querySelector(".zest-matrix-next").click();
  check(
    "last page beyond old 2000 limit",
    digits(d.querySelector(".zest-matrix-range").textContent).endsWith(
      "26002600",
    ) && d.querySelector(".zest-matrix-next").disabled,
  );
  check("pagination did not rescan", scans === 25);
  const search = d.querySelector(".zest-matrix-search");
  search.focus();
  change(".zest-matrix-search", '"time zero" | "结果解读"', "input");
  await delay(250);
  check("search preserves focused input", d.activeElement === search);
  check("search queries cached snapshot", scans === 25);
  check(
    "search filters result count",
    digits(d.querySelector(".zest-matrix-count").textContent) !== "26002600",
  );
  d.querySelector(".zest-matrix-reset").click();
  d.querySelector(".zest-matrix-comments").click();
  check(
    "comments-only filter",
    [...d.querySelectorAll(".zest-matrix-row")].every((n) =>
      n.querySelector(".zest-matrix-comment"),
    ),
  );
  d.querySelector(".zest-matrix-reset").click();
  change(".zest-matrix-scope", "selected");
  await settled();
  check(
    "selected attachment only",
    digits(d.querySelector(".zest-matrix-count").textContent) === "104104",
  );
  check("selected does not scan sibling papers", scans === 26);
  change(".zest-matrix-scope", "view");
  await settled();
  d.querySelector(".zest-matrix-filter-toggle").click();
  await shot("filters", false);
  d.querySelector(".zest-matrix-filter-toggle").click();
  for (const lang of ["zh-CN", "en-US"]) {
    Services.locale.requestedLocales = [lang];
    await delay(120);
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
    dev.matrix.render(w);
    await settled();
    // Exercise labels updated after initial render, not just static translations.
    d.querySelector(".zest-matrix-refresh").click();
    await settled();
    d.querySelector(".zest-matrix-next").click();
    d.querySelector(".zest-matrix-copy-md").click();
    await delay(100);
    const chinese = lang === "zh-CN";
    const text = (selector) => d.querySelector(selector).textContent.trim();
    check(
      lang + " static controls retain the selected language",
      text(".zest-matrix-refresh") === (chinese ? "刷新" : "Refresh") &&
        text(".zest-matrix-filter-toggle") === (chinese ? "筛选" : "Filters") &&
        text(".zest-matrix-next") === (chinese ? "下一页" : "Next"),
    );
    check(
      lang + " refresh and pagination retain the selected language",
      (chinese ? /条标注$/ : /annotations$/).test(text(".zest-matrix-count")) &&
        (chinese ? /^第 101–200 条 · 共/ : /^101–200 of/).test(
          text(".zest-matrix-range"),
        ),
    );
    check(
      lang + " copy feedback retains the selected language",
      text(".zest-matrix-copy-md") ===
        (chinese ? "复制为 Markdown" : "Copy as Markdown") &&
        (chinese ? /^已复制 / : /^Copied /).test(text(".zest-matrix-status")),
    );
    d.querySelector(".zest-matrix-previous").click();
    for (const width of [360, 480, 720, 1100]) {
      w.resizeTo(width, 800);
      d.documentElement.style.fontSize = "20px";
      await delay(120);
      check(
        lang + " " + width + " no horizontal document overflow",
        d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1,
      );
      const content = [
        ...d.querySelectorAll(
          ".zest-matrix-content,.zest-matrix-text,.zest-matrix-comment,.zest-matrix-source,.zest-matrix-row-actions",
        ),
      ];
      check(
        lang + " " + width + " readable content",
        content.every((n) => n.scrollWidth <= n.clientWidth + 1),
      );
      const exportDetails = d.querySelector(".zest-matrix-export");
      exportDetails.open = true;
      const menu = d
        .querySelector(".zest-matrix-export-menu")
        .getBoundingClientRect();
      check(
        lang + " " + width + " export menu within viewport",
        menu.left >= 0 && menu.right <= w.innerWidth,
      );
      exportDetails.open = false;
      d.querySelector(".zest-matrix-filter-toggle").click();
      const heights = [...d.querySelectorAll(".zest-matrix-field select")].map(
        (n) => n.getBoundingClientRect().height,
      );
      check(
        lang + " " + width + " consistent filter controls",
        Math.max(...heights) - Math.min(...heights) <= 1,
      );
      d.querySelector(".zest-matrix-filter-toggle").click();
      if (width === 480) await shot("narrow-" + lang, true);
      d.documentElement.style.fontSize = "";
    }
  }
  view = [];
  d.querySelector(".zest-matrix-refresh").click();
  await settled();
  check(
    "empty scope",
    !!d.querySelector(".zest-matrix-empty") &&
      d.querySelector(".zest-matrix-export-csv").disabled &&
      d.querySelector(".zest-matrix-copy-md").disabled,
  );
  await shot("empty", false);
  view = [...parents];
  d.querySelector(".zest-matrix-refresh").click();
  dev.matrix.closeMatrix();
  await delay(200);
  check("close cancels pending collection", w.closed);
  return report;
} finally {
  dev.matrix.closeMatrix();
  pane.itemsView.getSortedItems = oldView;
  pane.getSelectedItems = oldSelection;
  Zotero.Items.get = oldLookup;
  Zotero.Utilities.Internal.copyTextToClipboard = oldCopy;
  addon.data.locale.current = oldLocale;
  Services.locale.requestedLocales = oldRequested;
  if (hadTheme) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
}
