/**
 * Isolated native sidebar loading regression. Never run against a daily profile.
 * Existing local PDF fixtures only; no item/annotation/reading-record writes.
 * Uses native navigation and collapse/tab actions, never calls asyncRender()
 * or invokes a plugin rendering callback to make a failed assertion pass.
 */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated development profile and data directory required");
const host = Zotero.getMainWindow(),
  doc = host.document,
  pane = host.ZoteroPane,
  libraryDetails = doc.querySelector("#zotero-item-details"),
  contextPane = doc.querySelector("context-pane"),
  kinds = ["matrix", "stats"],
  prefix = "extensions.zotero.zest.",
  report = { ok: [], notes: [], screenshots: [], passed: false },
  delay = (ms) => Zotero.Promise.delay(ms);
if (!libraryDetails || !contextPane || !dev.sidebarSections || !dev.matrix)
  throw Error("Native sidebar development API unavailable");
const check = (name, value) => {
  if (!value) throw Error(name);
  report.ok.push(name);
};
async function until(name, read, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(40);
  }
  throw Error(name + " did not become ready");
}
const sectionIn = (details, kind) =>
    [...details.querySelectorAll("item-pane-custom-section")].find((node) =>
      node.paneID?.endsWith("-workspace-" + kind),
    ),
  shellOf = (section) => section?.querySelector(".zest-sidebar-shell"),
  stateOf = (section) => shellOf(section)?.dataset.loadState,
  frameOf = (section) => section?.querySelector("iframe"),
  contentReady = (kind, section) => {
    const inner = frameOf(section)?.contentDocument;
    return (
      stateOf(section) === "ready" &&
      (kind === "stats"
        ? !!inner?.querySelector(".zest-stats-open-details")
        : inner
            ?.querySelector(".zest-matrix-list")
            ?.getAttribute("aria-busy") === "false")
    );
  },
  prefs = new Map(),
  savedTab = host.Zotero_Tabs.selectedID,
  savedTabs = new Set(host.Zotero_Tabs._tabs.map((tab) => tab.id)),
  savedSelection = pane.getSelectedItems().map((item) => item.id),
  savedContextMode = contextPane.mode,
  savedContextCollapsed = contextPane.collapsed,
  savedLibraryCollapsed = libraryDetails._collapsed,
  layouts = new Map(),
  hooked = [],
  interceptors = new Set();
function rememberLayout(details) {
  if (layouts.has(details)) return;
  layouts.set(details, {
    collapsed: details._collapsed,
    scroll: details.querySelector(".zotero-view-item")?.scrollTop || 0,
    open: new Map(
      [...details.querySelectorAll("item-pane-custom-section")].map(
        (section) => [
          section.paneID,
          section.querySelector("collapsible-section")?.open,
        ],
      ),
    ),
  });
}
function setPref(key, value) {
  const name = prefix + key;
  if (!prefs.has(name))
    prefs.set(name, {
      had: Services.prefs.prefHasUserValue(name),
      value: Zotero.Prefs.get(name, true),
    });
  Zotero.Prefs.set(name, value, true);
}
const readingSnapshot = () =>
  JSON.stringify([...dev.readingStore.entries()], (_key, value) =>
    value instanceof Map ? [...value] : value,
  );
let beforeReading;
const artifactDir = PathUtils.join(
  PathUtils.parent(Zotero.DataDirectory.dir),
  "sidebar-loading-" + Date.now(),
);
await IOUtils.makeDirectory(artifactDir);
async function screenshot(kind, section, name) {
  const frame = frameOf(section),
    win = frame?.contentWindow;
  if (!win || !contentReady(kind, section)) throw Error(name + " is not ready");
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = win.innerWidth;
  canvas.height = win.innerHeight;
  canvas
    .getContext("2d")
    .drawWindow(win, 0, 0, win.innerWidth, win.innerHeight, "rgb(242,242,242)");
  const path = PathUtils.join(artifactDir, name + ".png");
  await IOUtils.write(
    path,
    Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
      c.charCodeAt(0),
    ),
  );
  report.screenshots.push(path);
}
async function navigate(details, kind, wait = true) {
  rememberLayout(details);
  details._collapsed = false;
  const section = await until(kind + " native section", () =>
    sectionIn(details, kind),
  );
  const collapsible = section.querySelector("collapsible-section");
  collapsible.open = true;
  const nav = details.sidenav;
  const button = await until(kind + " native navigation", () =>
    [...(nav?.querySelectorAll(".btn[data-pane]") || [])].find(
      (entry) =>
        entry.dataset.pane === section.paneID &&
        !entry.hasAttribute("disabled"),
    ),
  );
  button.dispatchEvent(
    new host.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }),
  );
  // A synthetic native click may still be smooth-scrolling. Use the same
  // native instant scroll as other acceptance probes; do not force rendering.
  await details.scrollToPane(section.paneID, "instant");
  section
    .querySelector(".zest-sidebar-content")
    ?.scrollIntoView({ block: "start", behavior: "instant" });
  if (wait)
    await until(kind + " visible loaded content", () =>
      contentReady(kind, section),
    );
  return section;
}
let prototype, originalRegister;
// Native itemDetails registers callbacks before connecting/rendering a section.
// Intercept that registration so even the very first callback is controlled.
function registerHook(options) {
  const kind = kinds.find((value) =>
    this.paneID?.endsWith("-workspace-" + value),
  );
  if (kind && options.type === "asyncRender" && options.callback) {
    const record = {
      section: this,
      original: options.callback,
      calls: 0,
      forwarded: 0,
      released: false,
      kind,
    };
    record.wrapper = function (...args) {
      record.calls++;
      // Withhold every initial native delivery until the independent observer
      // has demonstrably mounted the content. A second native scroll callback
      // must not accidentally rescue the old broken implementation.
      if (!record.released) return false;
      record.forwarded++;
      return record.original.apply(this, args);
    };
    hooked.push(record);
    return originalRegister.call(this, {
      ...options,
      callback: record.wrapper,
    });
  }
  return originalRegister.call(this, options);
}
let failure;
try {
  check("foreground native window available", !doc.hidden);
  rememberLayout(libraryDetails);
  // Opening reader tabs must not create reading records during the test.
  setPref("tracker.enable", false);
  setPref("statusAuto.enable", false);
  setPref("rank.autoFetch", false);
  setPref("info.affiliations.autoFetch", false);
  beforeReading = readingSnapshot();
  const papers = (await Zotero.Items.getAll(1, true, false)).filter(
    (item) => item.isRegularItem() && !item.deleted,
  );
  const fixtures = [];
  for (const paper of papers) {
    for (const attachment of Zotero.Items.get(paper.getAttachments())) {
      if (
        attachment.isFileAttachment() &&
        attachment.attachmentContentType === "application/pdf" &&
        (await attachment.getFilePathAsync())
      ) {
        fixtures.push({ paper, attachment });
        break;
      }
    }
    if (fixtures.length === 2) break;
  }
  check("two existing local PDF papers available", fixtures.length === 2);
  const annotationSnapshot = () =>
    JSON.stringify(
      fixtures.flatMap(({ paper }) =>
        dev.matrix
          .collectMatrix([paper])
          .map((row) => [
            row.key,
            row.annotation.annotationText,
            row.annotation.annotationComment,
          ]),
      ),
    );
  const beforeAnnotations = annotationSnapshot();
  host.Zotero_Tabs.select("zotero-pane");
  await pane.selectItem(fixtures[0].paper.id);
  // Zotero lazily defines custom-section elements. Creating an unconnected
  // native element loads its definition without mounting any plugin content.
  doc.createXULElement("item-pane-custom-section");
  prototype = host.customElements.get("item-pane-custom-section")?.prototype;
  originalRegister = prototype?.registerHook;
  check(
    "native custom-section hook registration available",
    typeof originalRegister === "function",
  );
  for (const kind of kinds) setPref("sidebar." + kind, false);
  await until("old tools removed", () =>
    kinds.every((kind) => !sectionIn(doc, kind)),
  );
  prototype.registerHook = registerHook;
  libraryDetails._collapsed = true;
  for (const kind of kinds) setPref("sidebar." + kind, true);
  await until("hidden tools registered", () =>
    kinds.every((kind) => sectionIn(libraryDetails, kind)),
  );
  await delay(200);
  for (const kind of kinds)
    check(
      kind + " hidden shell creates no iframe",
      !frameOf(sectionIn(libraryDetails, kind)),
    );
  for (const kind of kinds) {
    const section = await navigate(libraryDetails, kind);
    const record = hooked.find((entry) => entry.section === section);
    check(
      kind + " mounts independently while native callbacks are withheld",
      record && record.forwarded === 0 && contentReady(kind, section),
    );
    record.released = true;
    const frame = frameOf(section);
    section.querySelector("collapsible-section").open = false;
    await delay(100);
    section.querySelector("collapsible-section").open = true;
    await until(kind + " collapse/reopen retains ready content", () =>
      contentReady(kind, section),
    );
    check(
      kind + " collapse/reopen keeps one frame",
      frameOf(section) === frame &&
        section.querySelectorAll("iframe").length === 1,
    );
    await screenshot(kind, section, "library-" + kind);
  }
  await pane.selectItem(fixtures[1].paper.id);
  for (const kind of kinds) await navigate(libraryDetails, kind);
  check(
    "library paper switch does not strand either tool",
    kinds.every((kind) => stateOf(sectionIn(libraryDetails, kind)) === "ready"),
  );

  // Each reader owns item-details, not the hidden library's item selection.
  const readerTabs = [];
  for (const { attachment } of fixtures) {
    await Zotero.Reader.open(attachment.id, undefined, {
      openInBackground: false,
    });
    const tab = await until("PDF reader tab", () =>
      host.Zotero_Tabs._tabs.find(
        (entry) =>
          entry.type !== "library" && entry.data?.itemID === attachment.id,
      ),
    );
    readerTabs.push(tab.id);
  }
  contextPane.mode = "item";
  for (const [index, tabID] of [
    readerTabs[0],
    readerTabs[1],
    readerTabs[0],
  ].entries()) {
    host.Zotero_Tabs.select(tabID);
    const details = await until("selected reader item-details", () =>
      [...contextPane.querySelectorAll("item-details")].find(
        (entry) => entry.tabID === tabID,
      ),
    );
    rememberLayout(details);
    check(
      "reader " + index + " owns its source context",
      details.tabType === "reader",
    );
    for (const kind of kinds) {
      const section = await navigate(details, kind);
      check(
        "reader " + index + " " + kind + " ready",
        contentReady(kind, section),
      );
      if (index < 2) {
        const record = hooked.find((entry) => entry.section === section);
        check(
          "reader " +
            index +
            " " +
            kind +
            " starts independently of native async hook",
          record && record.forwarded === 0,
        );
        record.released = true;
      }
      if (kind === "matrix") {
        const scope = frameOf(section).contentDocument.querySelector("select");
        check(
          "reader " + index + " excludes library view scope",
          scope &&
            ![...scope.options].some((option) => option.value === "view"),
        );
      }
      if (index < 2)
        await screenshot(kind, section, "reader-" + index + "-" + kind);
    }
  }

  // Hold only the next newly created matrix iframe on about:blank. A local
  // synthetic frame error exercises failure/retry without a network request.
  const details = contextPane.sidenav.container;
  setPref("sidebar.matrix", false);
  await until(
    "reader matrix removed before failure injection",
    () => !sectionIn(details, "matrix"),
  );
  let broken;
  const observer = new host.MutationObserver(() => {
    const candidate = frameOf(sectionIn(details, "matrix"));
    if (!candidate || broken) return;
    broken = candidate;
    candidate.src = "about:blank";
    observer.disconnect();
  });
  interceptors.add(observer);
  observer.observe(details, { childList: true, subtree: true });
  setPref("sidebar.matrix", true);
  const section = await navigate(details, "matrix", false);
  await until("probe-owned frame intercepted", () => broken);
  check(
    "error injected before matrix renderer mounts",
    !broken.contentDocument?.querySelector(".zest-matrix"),
  );
  broken.dispatchEvent(new host.Event("error"));
  await until(
    "failed load exposes retry",
    () =>
      stateOf(section) === "failed" &&
      section.querySelector(".zest-sidebar-retry"),
  );
  check(
    "failed load is no longer an endless spinner",
    !broken.isConnected && !frameOf(section),
  );
  section.querySelector("collapsible-section").open = false;
  section.querySelector("collapsible-section").open = true;
  await delay(150);
  check(
    "visibility does not cause an unbounded failed-load retry loop",
    stateOf(section) === "failed" && !frameOf(section),
  );
  section.querySelector(".zest-sidebar-retry").click();
  await until("explicit retry recovers matrix", () =>
    contentReady("matrix", section),
  );
  const recovered = frameOf(section);
  for (const event of ["load", "error"])
    broken.dispatchEvent(new host.Event(event));
  await delay(150);
  check(
    "late failed-frame callbacks cannot replace recovered content",
    frameOf(section) === recovered && contentReady("matrix", section),
  );
  await screenshot("matrix", section, "reader-matrix-retry");
  setPref("sidebar.matrix", false);
  await until("recovered matrix disposed", () => !sectionIn(details, "matrix"));
  for (const event of ["load", "error"])
    recovered.dispatchEvent(new host.Event(event));
  await delay(150);
  check(
    "late callbacks cannot resurrect a disabled section",
    !recovered.isConnected && !sectionIn(details, "matrix"),
  );
  check(
    "annotation content unchanged",
    annotationSnapshot() === beforeAnnotations,
  );
  check("reading records unchanged", readingSnapshot() === beforeReading);
  report.notes.push(
    "Native event-driven error/retry and late-frame cleanup checked; watchdog timer accounting is covered by unit tests.",
  );
} catch (error) {
  failure = error;
  report.error = String(error);
} finally {
  for (const observer of interceptors) observer.disconnect();
  if (prototype?.registerHook === registerHook)
    prototype.registerHook = originalRegister;
  for (const { section, wrapper, original } of hooked)
    if (section._hooks?.asyncRender === wrapper)
      section._hooks.asyncRender = original;
  try {
    for (const [name, saved] of [...prefs].reverse()) {
      if (
        name === prefix + "tracker.enable" ||
        name === prefix + "statusAuto.enable"
      )
        continue;
      if (saved.had) Zotero.Prefs.set(name, saved.value, true);
      else Zotero.Prefs.clear(name, true);
    }
    if (kinds.every((kind) => prefs.has(prefix + "sidebar." + kind)))
      await until("original sidebar preferences restored", () =>
        kinds.every(
          (kind) =>
            !!sectionIn(libraryDetails, kind) ===
            (prefs.get(prefix + "sidebar." + kind)?.value !== false),
        ),
      );
    for (const [details, saved] of layouts) {
      if (!details.isConnected) continue;
      for (const section of details.querySelectorAll(
        "item-pane-custom-section",
      )) {
        if (saved.open.has(section.paneID))
          section.querySelector("collapsible-section").open = saved.open.get(
            section.paneID,
          );
      }
      details._collapsed = saved.collapsed;
      details.querySelector(".zotero-view-item")?.scrollTo(0, saved.scroll);
    }
    contextPane.mode = savedContextMode;
    for (const tab of [...host.Zotero_Tabs._tabs])
      if (!savedTabs.has(tab.id)) host.Zotero_Tabs.close(tab.id);
    await pane.selectItems(savedSelection);
    if (host.Zotero_Tabs._tabs.some((tab) => tab.id === savedTab))
      host.Zotero_Tabs.select(savedTab);
    libraryDetails._collapsed = savedLibraryCollapsed;
    contextPane.collapsed = savedContextCollapsed;
    check(
      "native callback interceptors restored",
      (!prototype || prototype.registerHook === originalRegister) &&
        hooked.every(
          ({ section, wrapper }) => section._hooks?.asyncRender !== wrapper,
        ),
    );
  } catch (error) {
    failure ||= error;
    report.restorationError = String(error);
  } finally {
    // Re-enable tracking only after reader tabs and the selected item have
    // been restored, even if another UI restoration failed.
    for (const key of ["statusAuto.enable", "tracker.enable"]) {
      const name = prefix + key,
        saved = prefs.get(name);
      if (!saved) continue;
      if (saved.had) Zotero.Prefs.set(name, saved.value, true);
      else Zotero.Prefs.clear(name, true);
    }
  }
  report.passed = !failure;
  report.checks = report.ok.length;
  report.suppressedCallbacks = hooked.filter(
    (record) => record.calls > 0,
  ).length;
  report.artifactDir = artifactDir;
  await IOUtils.writeUTF8(
    PathUtils.join(artifactDir, "result.json"),
    JSON.stringify(report, null, 2),
  );
}
return report;
