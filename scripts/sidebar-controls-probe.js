/** Native preference/lifecycle acceptance; existing isolated fixture only. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated development profile and data directory required");
const host = Zotero.getMainWindow(),
  doc = host.document,
  pane = host.ZoteroPane,
  details = doc.querySelector("#zotero-item-details"),
  nav = doc.querySelector("#zotero-view-item-sidenav"),
  scroll = doc.querySelector("#zotero-view-item");
if (!details || !nav || !dev.sidebarSections || !dev.stats)
  throw Error("Native sidebar development API unavailable");
const fixture = Zotero.Items.get(1);
if (!fixture?.isRegularItem() || fixture.deleted)
  throw Error("Verified isolated fixture 1 unavailable");
const kinds = ["stats", "matrix", "graph"],
  prefix = "extensions.zotero.zest.sidebar.",
  report = { ok: [], notes: [] },
  delay = (ms) => Zotero.Promise.delay(ms),
  opened = new Set(),
  initialWindows = new Set(Services.wm.getEnumerator(""));
function check(name, value) {
  if (!value) throw Error(name);
  report.ok.push(name);
}
async function until(name, read) {
  for (let i = 0; i < 150; i++) {
    const value = read();
    if (value) return value;
    await delay(40);
  }
  throw Error(name + " did not become ready");
}
const options = () => Zotero.ItemPaneManager.customSectionData.options,
  isTool = (option) =>
    option.pluginID === "zest@zotero-zest.app" &&
    kinds.some((kind) => option.paneID.endsWith("-workspace-" + kind)),
  otherRegistrations = () =>
    JSON.stringify(
      options()
        .filter((option) => !isTool(option))
        .map((option) => option.paneID)
        .sort(),
    ),
  registered = (kind) =>
    options().filter(
      (option) =>
        isTool(option) && option.paneID.endsWith("-workspace-" + kind),
    ),
  nativeSection = (kind, win = host) =>
    [...win.document.querySelectorAll("item-pane-custom-section")].find(
      (node) => node.paneID?.endsWith("-workspace-" + kind),
    ),
  nativeNav = (kind, win = host) =>
    [...win.document.querySelectorAll(".btn[data-pane]")].filter((node) => {
      // Zotero retains a hidden reader sidenav after its final tab closes.
      // Its container then points at detached item-details with no notifier;
      // cached buttons there are not live registrations or visible entrances.
      const nav = node.closest("item-pane-sidenav");
      return (
        nav?.container?.isConnected &&
        node.dataset.pane?.endsWith("-workspace-" + kind)
      );
    }),
  statsWindow = () =>
    [...Services.wm.getEnumerator("")].find(
      (win) =>
        !win.closed &&
        !win.frameElement &&
        win.document?.querySelector(".zest-stats-standalone"),
    );
const savedPrefs = new Map(
    kinds.map((kind) => [
      kind,
      {
        hadUserValue: Services.prefs.prefHasUserValue(prefix + kind),
        value: Zotero.Prefs.get(prefix + kind, true),
      },
    ]),
  ),
  savedSelection = pane.getSelectedItems().map((item) => item.id),
  savedView = pane.itemsView.getSortedItems,
  savedTab = host.Zotero_Tabs.selectedID,
  savedTabs = host.Zotero_Tabs._tabs.map((tab) => tab.id),
  savedScroll = scroll?.scrollTop || 0,
  savedCollapsed = nav._collapsed,
  savedOpen = [],
  otherBefore = otherRegistrations();
for (const win of Zotero.getMainWindows()) {
  for (const section of win.document.querySelectorAll(
    "item-pane-custom-section",
  )) {
    if (section.paneID?.includes("-workspace-"))
      savedOpen.push({
        win,
        paneID: section.paneID,
        open: section.querySelector("collapsible-section")?.open,
      });
  }
}
const encode = (value) =>
    JSON.stringify(value, (_key, entry) =>
      entry instanceof Map ? [...entry] : entry,
    ),
  readingBefore = encode([...dev.readingStore.entries()]);
const set = (kind, value) => Zotero.Prefs.set(prefix + kind, value, true);
function contentReady(kind, section) {
  if (kind === "graph")
    return section?.querySelector(".zest-sidebar-graph-canvas svg");
  const inner = section?.querySelector("iframe")?.contentDocument;
  return kind === "stats"
    ? inner?.querySelector(".zest-stats-open-details")
    : inner?.querySelector(".zest-matrix-list")?.getAttribute("aria-busy") ===
        "false";
}
async function show(kind, waitForContent = true) {
  const section = await until(kind + " native section", () =>
    nativeSection(kind),
  );
  section.querySelector("collapsible-section").open = true;
  const button = await until(kind + " native navigation", () =>
    nativeNav(kind).find((entry) => !entry.hasAttribute("disabled")),
  );
  button.dispatchEvent(
    new host.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    }),
  );
  // Synthetic clicks need not finish native smooth scrolling before a newly
  // registered section is queried. Use the native instant-scroll API here;
  // the rapid-toggle case below deliberately does not call show().
  await details.scrollToPane(section.paneID, "instant");
  section
    .querySelector(".zest-sidebar-content")
    ?.scrollIntoView({ block: "start", behavior: "instant" });
  const frame =
    kind === "graph"
      ? null
      : await until(kind + " iframe", () => section.querySelector("iframe"));
  if (waitForContent)
    await until(kind + " visible content", () => contentReady(kind, section));
  return { section, frame };
}
async function assertOff(kind) {
  await until(kind + " removed in all native windows", () =>
    Zotero.getMainWindows().every(
      (win) => !nativeSection(kind, win) && nativeNav(kind, win).length === 0,
    ),
  );
  check(kind + " registration removed", registered(kind).length === 0);
  check(
    kind + " unrelated registrations preserved",
    otherRegistrations() === otherBefore,
  );
  check(
    kind + " native information remains",
    !!details.querySelector('[data-pane="info"]'),
  );
}
async function assertDetails(action, activate) {
  const existing = statsWindow();
  activate();
  const win = await until(action + " opens full statistics", statsWindow);
  if (!existing) opened.add(win);
  check(
    action + " full statistics and achievements",
    win.document.querySelector(".zest-stats-header") &&
      win.document.querySelector(".zest-achievements") &&
      win.document.querySelector(".zest-stats-refresh"),
  );
  check(action + " owning library stays open", !host.closed);
  if (!existing) {
    win.close();
    await until(action + " popout closes", () => win.closed);
  }
  return !existing;
}
try {
  host.Zotero_Tabs.select("zotero-pane");
  await pane.selectItem(fixture.id);
  pane.itemsView.getSortedItems = () => [fixture];
  for (const kind of kinds) set(kind, true);
  await until("all tools enabled by preference observers", () =>
    kinds.every((kind) => registered(kind).length === 1 && nativeSection(kind)),
  );
  for (const kind of kinds) {
    const current = await show(kind);
    set(kind, false);
    await assertOff(kind);
    check(kind + " old content detached", !current.section.isConnected);
    set(kind, true);
    await show(kind);
    check(kind + " re-enabled exactly once", registered(kind).length === 1);
    for (const other of kinds.filter((value) => value !== kind))
      check(
        kind + " preserves " + other,
        registered(other).length === 1 && !!nativeSection(other),
      );

    // Hold notification delivery until both changes have happened. The native
    // manager then retains the existing paneID and its same-item render cache.
    const before = nativeSection(kind);
    await Zotero.DB.executeTransaction(async () => {
      set(kind, false);
      set(kind, true);
    });
    await until(
      kind + " rapid cycle registration",
      () => registered(kind).length === 1,
    );
    check(
      kind + " rapid cycle retained native element",
      nativeSection(kind) === before,
    );
    // Do not click navigation or toggle the section here: either can force a
    // fresh native render and accidentally hide the same-item cache defect.
    await until(kind + " rapid cycle remounts without another gesture", () =>
      contentReady(kind, before),
    );
    check(
      kind + " rapid cycle has one content shell",
      nativeSection(kind).querySelectorAll(".zest-sidebar-shell").length === 1,
    );
  }
  for (const kind of ["stats", "matrix"]) {
    set(kind, false);
    await assertOff(kind);
    set(kind, true);
    const { frame } = await show(kind, false);
    const pending = frame.contentDocument?.readyState !== "complete";
    set(kind, false);
    await assertOff(kind);
    frame.dispatchEvent(new host.Event("load"));
    await delay(80);
    check(
      kind + " late load cannot reattach hidden iframe",
      !frame.isConnected && !nativeSection(kind),
    );
    if (!pending)
      report.notes.push(
        kind +
          " real iframe load finished before toggle; late-load teardown checked, pending-load timing not checked",
      );
    set(kind, true);
    await show(kind);
  }
  let ui = await show("stats"),
    inner = ui.frame.contentDocument,
    root = inner.querySelector(".zest-stats-embedded"),
    button = root?.querySelector(".zest-stats-open-details");
  check(
    "sidebar statistics contains only a ring button",
    root?.children.length === 1 &&
      root.firstElementChild === button &&
      button.children.length === 1 &&
      !!button.querySelector(".zest-rings"),
  );
  check(
    "sidebar statistics omits dashboard and achievements",
    !root.querySelector(
      ".zest-stats-header,.zest-achievements,.zest-stats-ranges,.zest-top-list",
    ),
  );
  check(
    "ring button exposes native keyboard semantics and label",
    button.localName === "button" &&
      button.type === "button" &&
      !!button.getAttribute("aria-label"),
  );
  const closed = await assertDetails("ring click", () => button.click());
  if (closed) {
    ui = await show("stats");
    const frameWin = ui.frame.contentWindow;
    button = frameWin.document.querySelector(".zest-stats-open-details");
    if (typeof frameWin.windowUtils?.sendKeyEvent === "function") {
      host.focus();
      frameWin.focus();
      button.focus();
      check(
        "ring receives keyboard focus",
        frameWin.document.activeElement === button,
      );
      await assertDetails("ring Enter", () => {
        for (const type of ["keydown", "keypress", "keyup"])
          frameWin.windowUtils.sendKeyEvent(type, 13, 0, 0, false);
      });
    } else
      report.notes.push(
        "Trusted Enter activation not checked: windowUtils.sendKeyEvent unavailable",
      );
  } else
    report.notes.push(
      "Trusted Enter activation not checked: pre-existing statistics window preserved",
    );
  check(
    "reading data unchanged",
    encode([...dev.readingStore.entries()]) === readingBefore,
  );
  check(
    "reader tabs unchanged",
    JSON.stringify(host.Zotero_Tabs._tabs.map((tab) => tab.id)) ===
      JSON.stringify(savedTabs),
  );
  if (Zotero.getMainWindows().length < 2)
    report.notes.push(
      "Only one native main window was open; multi-window removal still covered by unit regression",
    );
} catch (error) {
  error.message += " (last checks: " + report.ok.slice(-6).join("; ") + ")";
  throw error;
} finally {
  let restorationError;
  // Also catch a newly created popout whose loading failed before its root
  // marker appeared; never close a window that existed before this probe.
  for (const win of Services.wm.getEnumerator(""))
    if (
      !initialWindows.has(win) &&
      win.location?.href === "chrome://zest/content/panel.xhtml"
    )
      opened.add(win);
  for (const win of opened) if (!win.closed) win.close();
  pane.itemsView.getSortedItems = savedView;
  for (const [kind, saved] of savedPrefs) {
    if (saved.hadUserValue) Zotero.Prefs.set(prefix + kind, saved.value, true);
    else Zotero.Prefs.clear(prefix + kind, true);
  }
  try {
    await until("original registrations restored", () =>
      kinds.every(
        (kind) =>
          registered(kind).length ===
          (savedPrefs.get(kind).value === false ? 0 : 1),
      ),
    );
  } catch (e) {
    restorationError = e;
  }
  for (const saved of savedOpen) {
    if (saved.win.closed) continue;
    const section = [
      ...saved.win.document.querySelectorAll("item-pane-custom-section"),
    ].find((node) => node.paneID === saved.paneID);
    if (section && typeof saved.open === "boolean")
      section.querySelector("collapsible-section").open = saved.open;
  }
  await pane.selectItems(savedSelection);
  nav._collapsed = savedCollapsed;
  scroll?.scrollTo(0, savedScroll);
  if (host.Zotero_Tabs._tabs.some((tab) => tab.id === savedTab))
    host.Zotero_Tabs.select(savedTab);
  if (restorationError) throw restorationError;
}
report.checks = report.ok.length;
return report;
