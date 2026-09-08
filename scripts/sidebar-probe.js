/** Native sidebar acceptance: existing isolated fixture 1 only; no library writes. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated development profile and data directory required");
const host = Zotero.getMainWindow(),
  doc = host.document,
  pane = host.ZoteroPane;
const details = doc.querySelector("#zotero-item-details");
const nav = doc.querySelector("#zotero-view-item-sidenav");
const itemPane = doc.querySelector("#zotero-item-pane");
if (!details || !nav || !itemPane || !dev.sidebarSections)
  throw Error("Native sidebar containers unavailable");
const fixture = Zotero.Items.get(1);
if (!fixture?.isRegularItem() || fixture.deleted)
  throw Error("Verified isolated fixture 1 unavailable");
const report = { ok: [], screenshots: [], notes: [] },
  delay = (ms) => Zotero.Promise.delay(ms);
const check = (name, value) => {
  if (!value) throw Error(name);
  report.ok.push(name);
};
async function until(name, read) {
  for (let i = 0; i < 120; i++) {
    const value = read();
    if (value) return value;
    await delay(40);
  }
  throw Error(name + " did not become ready");
}
const oldLocale = addon.data.locale.current,
  oldRequested = [...Services.locale.requestedLocales];
const hadTheme = Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme");
const oldTheme = Services.prefs.getIntPref("ui.systemUsesDarkTheme", 0);
const oldSelection = pane.getSelectedItems().map((item) => item.id),
  oldView = pane.itemsView.getSortedItems;
const oldTab = host.Zotero_Tabs.selectedID,
  oldTabs = host.Zotero_Tabs._tabs.map((tab) => tab.id);
const oldCollapsed = nav._collapsed,
  scroll = doc.querySelector("#zotero-view-item");
const oldScroll = scroll?.scrollTop || 0,
  oldOpen = new Map();
for (const section of details.querySelectorAll("item-pane-custom-section")) {
  if (section.paneID?.includes("workspace-"))
    oldOpen.set(
      section.paneID,
      section.querySelector("collapsible-section")?.open,
    );
}
const styles = new Map(),
  popouts = new Set();
const sections = () => [
  ...details.querySelectorAll("item-pane-custom-section"),
];
const q = (root, selector) => root.querySelector(selector);
function style(node, key, value) {
  if (!styles.has(node)) styles.set(node, node.getAttribute("style"));
  node.style.setProperty(key, value, "important");
}
const rows = dev.matrix.collectMatrix([fixture]);
check("fixture has annotated content", rows.length > 0);
const signature = () =>
  JSON.stringify(
    rows.map((row) => [
      row.key,
      row.annotation.annotationText,
      row.annotation.annotationComment,
    ]),
  );
const before = signature();
const reading = () =>
  JSON.stringify([...dev.readingStore.entries()], (_key, value) =>
    value instanceof Map ? [...value] : value,
  );
const readingBefore = reading();
const windows = () => [...Services.wm.getEnumerator("")];
const standalone = (kind) =>
  windows().find((win) => {
    const root = win.document?.querySelector(
      kind === "stats" ? ".zest-stats-standalone" : ".zest-matrix",
    );
    return root && !root.classList.contains("zest-matrix-embedded");
  });
async function resetSections() {
  dev.sidebarSections.unregisterSidebarSections();
  details.renderCustomSections();
  dev.sidebarSections.registerSidebarSections();
  await details.render();
  nav.render();
}
async function show(kind) {
  const section = await until(kind + " section", () =>
    sections().find((node) => node.paneID?.endsWith("workspace-" + kind)),
  );
  const button = [...nav.querySelectorAll(".btn[data-pane]")].find(
    (node) => node.dataset.pane === section.paneID,
  );
  check(
    kind + " native navigation entry",
    button && !button.hasAttribute("disabled"),
  );
  button.dispatchEvent(
    new host.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    }),
  );
  const content = await until(kind + " content", () =>
    section.querySelector(".zest-sidebar-content"),
  );
  const frame =
    kind === "graph"
      ? null
      : await until(kind + " frame", () => section.querySelector("iframe"));
  if (frame)
    await until(
      kind + " loaded frame",
      () =>
        frame.contentWindow?.location.href ===
          "chrome://zest/content/panel.xhtml" &&
        frame.contentDocument?.readyState === "complete",
    );
  const win = frame?.contentWindow || host,
    d = win.document;
  const ready = () =>
    kind === "matrix"
      ? d.querySelector(".zest-matrix-list")?.getAttribute("aria-busy") ===
        "false"
      : kind === "stats"
        ? d.querySelector(".zest-stats")
        : content.querySelector(".zest-sidebar-graph-canvas svg") &&
          content
            .querySelector(".zest-sidebar-graph-canvas")
            ?.getAttribute("aria-busy") === "false";
  await until(kind + " render", ready);
  await delay(150);
  return { kind, section, content, frame, win, d, ready };
}
function change(win, node, value) {
  check("change control exists", !!node);
  node.value = value;
  node.dispatchEvent(new win.Event("change", { bubbles: true }));
}
async function screenshot(
  win,
  file,
  rect = [win.scrollX, win.scrollY, win.innerWidth, win.innerHeight],
) {
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas"),
    scale = 1.5;
  canvas.width = Math.ceil(rect[2] * scale);
  canvas.height = Math.ceil(rect[3] * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawWindow(win, ...rect, "rgb(255,255,255)");
  const path = PathUtils.join(
    PathUtils.parent(Zotero.DataDirectory.dir),
    file + ".png",
  );
  await IOUtils.write(
    path,
    Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (char) =>
      char.charCodeAt(0),
    ),
  );
  report.screenshots.push(path);
}
try {
  host.Zotero_Tabs.select("zotero-pane");
  await pane.selectItem(fixture.id);
  pane.itemsView.getSortedItems = () => [fixture];
  style(itemPane, "min-width", "0");
  style(itemPane, "max-width", "none");
  style(itemPane, "flex", "0 0 auto");
  // Zotero's native content pane has a 320px minimum. Lower it only in this
  // restored test fixture to exercise plugin content below the native limit.
  style(doc.querySelector("#zotero-item-pane-content"), "min-width", "0");
  style(itemPane, "--zotero-font-size", "20px");
  for (const locale of ["zh-CN", "en-US"]) {
    Services.locale.requestedLocales = [locale];
    await delay(120);
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
    await resetSections();
    for (const kind of ["matrix", "stats", "graph"]) {
      const ui = await show(kind),
        chinese = locale === "zh-CN";
      // Frames are recreated with their sections, so no dead-document restore handles.
      if (ui.frame) ui.d.documentElement.style.fontSize = "20px";
      if (kind === "matrix") {
        const scope = q(ui.d, ".zest-matrix-scope");
        const count = () => ui.d.querySelectorAll(".zest-matrix-row").length;
        const expected = Math.min(100, rows.length);
        check(
          locale + " matrix current paper scope",
          scope.value === "selected" && count() === expected,
        );
        check(
          locale + " current paper labels",
          scope.selectedOptions[0].textContent ===
            (chinese ? "当前文献" : "This paper"),
        );
        pane.itemsView.getSortedItems = () => [];
        change(ui.win, scope, "view");
        await until("empty view", ui.ready);
        check(locale + " empty view does not borrow paper", count() === 0);
        pane.itemsView.getSortedItems = () => [fixture];
        ui.d.querySelector(".zest-matrix-refresh").click();
        await until("view refresh", ui.ready);
        check(
          locale + " view refresh restores annotations",
          count() === expected,
        );
        change(ui.win, scope, "selected");
        await until("current paper", ui.ready);
      } else if (kind === "stats") {
        check(
          locale + " stats action language",
          q(ui.d, ".zest-stats-refresh").textContent ===
            (chinese ? "刷新" : "Refresh"),
        );
        for (const days of [7, 90, 30]) {
          q(ui.d, `[data-range="${days}"]`).click();
          check(
            locale + " stats range " + days,
            q(ui.d, `[data-period-days="${days}"]`),
          );
        }
      } else {
        const modes = ui.content.querySelector("select");
        for (const mode of ["author", "tag", "collection", "related"]) {
          change(host, modes, mode);
          await until("graph mode " + mode, ui.ready);
          check(locale + " graph mode " + mode, modes.value === mode);
        }
        check(
          locale + " graph action language",
          q(ui.content, ".zest-sidebar-graph-open").textContent ===
            (chinese ? "打开文献" : "Open paper"),
        );
      }
      for (const theme of ["light", "dark"]) {
        Services.prefs.setIntPref(
          "ui.systemUsesDarkTheme",
          theme === "dark" ? 1 : 0,
        );
        for (const width of [280, 320, 420]) {
          style(itemPane, "width", width + 100 + "px");
          for (let attempt = 0; attempt < 3; attempt++) {
            await delay(80);
            const gap = width - ui.content.getBoundingClientRect().width;
            if (Math.abs(gap) <= 1) break;
            style(
              itemPane,
              "width",
              itemPane.getBoundingClientRect().width + gap + "px",
            );
          }
          await details.scrollToPane(ui.section.paneID, "instant");
          await delay(120);
          const name = `${kind}-${theme}-${locale}-${width}`;
          check(
            name + " actual content width",
            Math.abs(ui.content.getBoundingClientRect().width - width) <= 1,
          );
          check(
            name + " no sidebar horizontal overflow",
            ui.content.scrollWidth <= ui.content.clientWidth + 1,
          );
          if (ui.frame)
            check(
              name + " no frame horizontal overflow",
              ui.d.documentElement.scrollWidth <=
                ui.d.documentElement.clientWidth + 1,
            );
          if (kind === "matrix") {
            const tag = ui.d.querySelector(".zest-matrix-tag-chip");
            check(
              name + " tag labels do not collapse into vertical letters",
              !tag || tag.getBoundingClientRect().width >= 80,
            );
          }
          const r = itemPane.getBoundingClientRect();
          await screenshot(host, "sidebar-" + name, [
            r.x,
            r.y,
            r.width,
            Math.min(r.height, host.innerHeight - r.y),
          ]);
          if (ui.frame) await screenshot(ui.win, "sidebar-" + name + "-frame");
        }
      }
    }
  }
  for (const kind of ["stats", "matrix"]) {
    if (standalone(kind)) {
      report.notes.push(kind + " popout already open; preserved");
      continue;
    }
    const ui = await show(kind);
    if (kind === "stats") dev.stats.openStatsDialog(host);
    else
      dev.matrix.openMatrix(
        host,
        dev.sidebarSections.sidebarMatrixSource(fixture, "library", host),
      );
    const win = await until(kind + " standalone", () => standalone(kind));
    popouts.add(win);
    if (kind === "stats") dev.stats.closeStatsDialog();
    else dev.matrix.closeMatrix();
    check(
      kind + " standalone closes without closing library or sidebar",
      win.closed && !host.closed && ui.frame.isConnected,
    );
  }
  check("fixture annotations unchanged", signature() === before);
  check("reading history unchanged", reading() === readingBefore);
  check(
    "reader tabs unchanged",
    JSON.stringify(host.Zotero_Tabs._tabs.map((tab) => tab.id)) ===
      JSON.stringify(oldTabs),
  );
  report.checks = report.ok.length;
  return report;
} finally {
  for (const win of popouts) if (!win.closed) win.close();
  pane.itemsView.getSortedItems = oldView;
  for (const [node, value] of styles) {
    if (value === null) node.removeAttribute("style");
    else node.setAttribute("style", value);
  }
  addon.data.locale.current = oldLocale;
  Services.locale.requestedLocales = oldRequested;
  if (hadTheme) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
  await resetSections();
  for (const section of details.querySelectorAll("item-pane-custom-section")) {
    if (oldOpen.has(section.paneID))
      section.querySelector("collapsible-section").open = oldOpen.get(
        section.paneID,
      );
  }
  await pane.selectItems(oldSelection);
  nav._collapsed = oldCollapsed;
  scroll?.scrollTo(0, oldScroll);
  if (host.Zotero_Tabs._tabs.some((tab) => tab.id === oldTab))
    host.Zotero_Tabs.select(oldTab);
}
