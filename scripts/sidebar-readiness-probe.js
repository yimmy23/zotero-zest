/** Native chrome iframe readiness regression, only in isolated development data.
 * Withhold completion callbacks to exercise recovery without the10s deadline.
 * Unsaved fixture, local frames and in-memory statistics; no library writes.
 * For full native navigation/collapse/reader coverage, run sidebar-loading-probe.
 */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated profile and data required");
const host = Zotero.getMainWindow(),
  doc = host.document;
if (doc.hidden) throw Error("Show the isolated test window before timing");
const report = { zotero: Zotero.version, cases: [], ok: [], fail: [] };
const wait = (ms) => Zotero.Promise.delay(ms);
const options = Zotero.ItemPaneManager.customSectionData.options;
const originalCreate = doc.createElementNS;
const paper = new Zotero.Item("journalArticle");
paper.libraryID = Zotero.Libraries.userLibraryID;
paper.setField("title", "Unsaved sidebar performance fixture");
const savedPrefs = new Map();
for (const name of [
  "tracker.enable",
  "statusAuto.enable",
  "rank.autoFetch",
  "info.affiliations.autoFetch",
]) {
  const key = "extensions.zotero.zest." + name;
  savedPrefs.set(key, {
    had: Services.prefs.prefHasUserValue(key),
    value: Zotero.Prefs.get(key, true),
  });
  Zotero.Prefs.set(key, false, true);
}
try {
  host.focus();
  for (const kind of ["stats", "matrix"])
    for (const missed of [false, true]) {
      const option = options.find((x) =>
        x.paneID.endsWith("-workspace-" + kind),
      );
      if (!option) throw Error(kind + " not registered");
      const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      body.style.cssText =
        "position:fixed;top:70px;right:20px;width:340px;height:600px;z-index:2147483640;background:var(--material-background);overflow:auto;";
      doc.documentElement.appendChild(body);
      const row = {
        kind,
        missedEvents: missed,
        events: [],
        frameCreatedMs: null,
        documentCompleteMs: null,
        readyMs: null,
      };
      const start = host.performance.now();
      let frame;
      doc.createElementNS = function (ns, name, ...args) {
        const node = originalCreate.call(this, ns, name, ...args);
        if (name === "iframe") {
          frame = node;
          row.frameCreatedMs = host.performance.now() - start;
          const add = node.addEventListener;
          for (const event of ["DOMContentLoaded", "load"])
            add.call(
              node,
              event,
              () =>
                row.events.push({
                  event,
                  ms: host.performance.now() - start,
                  ready: node.contentDocument?.readyState,
                  url: node.contentWindow?.location.href,
                }),
              true,
            );
          if (missed)
            node.addEventListener = function (type, fn, ...opts) {
              if (type === "load" || type === "DOMContentLoaded") return;
              return add.call(this, type, fn, ...opts);
            };
        }
        return node;
      };
      const props = {
        body,
        doc,
        item: paper,
        tabType: "reader",
        setEnabled() {},
      };
      try {
        option.onInit(props);
        option.onItemChange(props);
        option.onRender(props);
        while (host.performance.now() - start < 11500) {
          if (
            frame?.contentDocument?.readyState === "complete" &&
            frame.contentWindow.location.href ===
              "chrome://zest/content/panel.xhtml" &&
            row.documentCompleteMs === null
          )
            row.documentCompleteMs = host.performance.now() - start;
          const state = body.querySelector(".zest-sidebar-shell")?.dataset
            .loadState;
          if (state === "ready") {
            row.readyMs = host.performance.now() - start;
            break;
          }
          if (state === "failed") {
            row.failed = true;
            break;
          }
          await wait(20);
        }
        row.documentURL = frame?.contentWindow?.location.href;
        row.rendered = !!frame?.contentDocument?.querySelector(
          kind === "stats" ? ".zest-stats-open-details" : ".zest-matrix-list",
        );
        report.cases.push(row);
        const passed =
          row.rendered &&
          row.readyMs !== null &&
          row.documentCompleteMs !== null &&
          row.readyMs - row.documentCompleteMs < 1000;
        (passed ? report.ok : report.fail).push(
          kind +
            (missed
              ? " missed events recover promptly"
              : " normal local frame loads"),
        );
      } finally {
        doc.createElementNS = originalCreate;
        option.onDestroy(props);
        body.remove();
      }
    }
} finally {
  doc.createElementNS = originalCreate;
  for (const [key, saved] of savedPrefs) {
    if (!saved.had) Zotero.Prefs.clear(key, true);
    else Zotero.Prefs.set(key, saved.value, true);
  }
}
return report;
