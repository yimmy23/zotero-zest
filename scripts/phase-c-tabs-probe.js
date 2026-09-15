/**
 * Vertical-tab keyboard/focus acceptance probe. Isolated scaffold profile only.
 * Copies one existing local fixture PDF into three probe-owned documents, then
 * removes only those copies. Existing tabs, groups, sessions and prefs survive.
 * Run: ZEST_DEV_PORT=23134 scripts/dev-eval.sh -f scripts/phase-c-tabs-probe.js
 */
if (!/[\\/]\.scaffold[\\/]dev-data$/.test(Zotero.DataDirectory.dir))
  throw new Error(
    "This probe requires the isolated scaffold dev-data directory",
  );

const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const check = (name, condition, note) => {
  (condition ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const win = Zotero.getMainWindow();
const doc = win.document;
const tabs = win.Zotero_Tabs;
const delay = (ms) => Zotero.Promise.delay(ms);
const copy = (value) => JSON.parse(JSON.stringify(value));
const prefKey = (name) => `extensions.zotero.zest.${name}`;
const prefNames = ["tabs.sidebar", "tabs.hideNative", "tabs.width"];
const savedPrefs = prefNames.map((name) => ({
  name,
  value: Zotero.Prefs.get(prefKey(name), true),
  hadUserValue: Services.prefs.prefHasUserValue(prefKey(name)),
}));
const previousOpen = dev.tabsSidebar.isSidebarOpen(win);
const previousQuery = doc.querySelector(".zest-tabbar-search")?.value || "";
const previousSelected = tabs.selectedID;
const previousFocus = doc.activeElement;
const previousTabs = tabs._tabs.map((tab) => tab.id);
const previousGroups = copy(dev.tabsModel.groups());
const previousSessions = copy(dev.tabsModel.sessions());
const previousNativeHidden = doc.documentElement.classList.contains(
  "zest-hide-native-tabs",
);
const ownedItems = [];
const ownedAttachmentIDs = new Set();
const fixtures = [];
const prefix = `Phase C keyboard ${Date.now()}`;
let groupID;

const focusButton = (key) =>
  [...doc.querySelectorAll("[data-focus-key]")].find(
    (button) => button.getAttribute("data-focus-key") === key,
  );
const tabButton = (id) => focusButton(`tab:${id}`);
const libraryButton = () => doc.querySelector(".zest-tabbar-library");
const key = (element, value) => {
  if (!element) throw new Error(`Missing keyboard target for ${value}`);
  const event = new win.KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
};
const filter = (query) => {
  const search = doc.querySelector(".zest-tabbar-search");
  if (!search) throw new Error("Sidebar search missing");
  search.value = query;
  search.dispatchEvent(new win.Event("input", { bubbles: true }));
};
const waitFor = async (predicate, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (!predicate() && Date.now() < end) await delay(50);
  return !!predicate();
};

try {
  check("tabs.nativeProbe", dev.tabsSidebar.probeTabs(win));
  let localPDF;
  for (const item of await Zotero.Items.getAll(
    Zotero.Libraries.userLibraryID,
  )) {
    if (!item.isPDFAttachment?.()) continue;
    const path = await item.getFilePathAsync();
    if (
      path?.startsWith(Zotero.DataDirectory.dir + "/storage/") &&
      (await IOUtils.exists(path))
    ) {
      localPDF = path;
      break;
    }
  }
  if (!localPDF)
    throw new Error("Seed a synthetic local PDF in the dev profile first");

  // Separate parents make grouping meaningful, while the source PDF stays intact.
  for (const suffix of ["A", "B", "C"]) {
    const parent = new Zotero.Item("journalArticle");
    parent.libraryID = Zotero.Libraries.userLibraryID;
    parent.setField("title", `${prefix} ${suffix}`);
    await parent.saveTx();
    ownedItems.push(parent);
    const attachment = await Zotero.Attachments.importFromFile({
      file: localPDF,
      parentItemID: parent.id,
    });
    ownedItems.push(attachment);
    ownedAttachmentIDs.add(attachment.id);
    attachment.setField("title", `${prefix} ${suffix}`);
    await attachment.saveTx();
    await Zotero.Reader.open(attachment.id, undefined, {
      openInBackground: true,
    });
    const opened = await waitFor(() =>
      tabs._tabs.some((tab) => tab.data?.itemID === attachment.id),
    );
    if (!opened) throw new Error(`Fixture reader ${suffix} did not open`);
    const tab = tabs._tabs.find(
      (entry) => entry.data?.itemID === attachment.id,
    );
    fixtures.push({ parent, attachment, tabID: tab.id });
  }
  check("tabs.threeLocalPDFReaders", fixtures.length === 3);
  out.notes.push(
    "KeyboardEvent exercises plugin handlers in native Gecko; native button activation uses click(), because synthetic keys do not invoke trusted default actions.",
  );

  dev.tabsSidebar.hideSidebar(win, false);
  Zotero.Prefs.set(prefKey("tabs.hideNative"), true, true);
  dev.tabsSidebar.showSidebar(win);
  await delay(250);
  filter(prefix);
  check(
    "tabs.hiddenNativeBar",
    doc.documentElement.classList.contains("zest-hide-native-tabs"),
  );
  check(
    "tabs.libraryFixedOutsideScroll",
    libraryButton()?.parentElement?.id === "zest-tabbar" &&
      !libraryButton().disabled,
  );
  check(
    "tabs.documentListSemantics",
    doc.querySelector(".zest-tabbar-list")?.getAttribute("role") === "list",
  );
  check(
    "tabs.threeFilteredRows",
    doc.querySelectorAll(".zest-tabbar-row").length === 3,
  );

  const [first, second, third] = fixtures;
  filter("no matching document " + prefix);
  check(
    "tabs.librarySurvivesEmptyFilter",
    !!libraryButton()?.getClientRects().length &&
      !libraryButton().disabled &&
      doc.querySelectorAll(".zest-tabbar-row").length === 0,
  );
  libraryButton().click();
  await delay(200);
  const nativeLibrary = tabs._tabs.find((tab) => tab.type === "library");
  check(
    "tabs.libraryActivatesNativeID",
    !!nativeLibrary &&
      tabs.selectedID === nativeLibrary.id &&
      libraryButton().getAttribute("aria-current") === "page",
  );
  filter(prefix);

  libraryButton().focus();
  key(libraryButton(), "ArrowDown");
  check("tabs.libraryArrowDown", doc.activeElement === tabButton(first.tabID));
  const selectedBeforeArrows = tabs.selectedID;
  key(doc.activeElement, "End");
  check(
    "tabs.endFocusesLastDocument",
    doc.activeElement === tabButton(third.tabID),
  );
  key(doc.activeElement, "Home");
  check(
    "tabs.homeFocusesFirstDocument",
    doc.activeElement === tabButton(first.tabID),
  );
  key(doc.activeElement, "ArrowDown");
  check(
    "tabs.arrowDownFocusesNext",
    doc.activeElement === tabButton(second.tabID),
  );
  key(doc.activeElement, "ArrowUp");
  check(
    "tabs.arrowUpFocusesPrevious",
    doc.activeElement === tabButton(first.tabID),
  );
  key(doc.activeElement, "ArrowUp");
  check("tabs.arrowUpReturnsLibrary", doc.activeElement === libraryButton());
  check(
    "tabs.navigationDoesNotActivate",
    tabs.selectedID === selectedBeforeArrows,
  );

  tabButton(second.tabID).focus();
  check("tabs.enterHandled", key(doc.activeElement, "Enter"));
  await delay(250);
  check("tabs.enterActivatesReader", tabs.selectedID === second.tabID);
  check(
    "tabs.activationRestoresStableFocus",
    doc.activeElement === tabButton(second.tabID),
  );
  check(
    "tabs.selectedDocumentExposed",
    tabButton(second.tabID)?.getAttribute("aria-current") === "page",
  );
  const currentButton = tabButton(second.tabID);
  const close = currentButton.parentElement.querySelector(".zest-tabbar-close");
  check(
    "tabs.buttonsAreSiblings",
    currentButton.localName === "button" &&
      close?.parentElement === currentButton.parentElement &&
      !currentButton.querySelector("button"),
  );
  check(
    "tabs.rovingRowAndClose",
    currentButton.tabIndex === 0 &&
      close?.tabIndex === 0 &&
      tabButton(first.tabID).tabIndex === -1,
  );
  close.focus();
  dev.tabsSidebar.renderList(win);
  check(
    "tabs.repaintPreservesCloseFocus",
    doc.activeElement ===
      tabButton(second.tabID)?.parentElement.querySelector(
        ".zest-tabbar-close",
      ),
  );

  const group = dev.tabsModel.addGroup(`${prefix} group`);
  groupID = group.id;
  for (const fixture of fixtures.slice(0, 2))
    dev.tabsModel.assignToGroup(
      dev.tabsModel.itemKeyOf(fixture.parent),
      groupID,
    );
  dev.tabsSidebar.renderList(win);
  focusButton(`group:${groupID}`).focus();
  key(doc.activeElement, " ");
  check(
    "tabs.groupSpaceCollapses",
    focusButton(`group:${groupID}`)?.getAttribute("aria-expanded") ===
      "false" && !tabButton(first.tabID),
  );
  check(
    "tabs.collapseKeepsGroupFocus",
    doc.activeElement === focusButton(`group:${groupID}`),
  );
  key(doc.activeElement, "ArrowRight");
  check(
    "tabs.groupRightExpands",
    focusButton(`group:${groupID}`)?.getAttribute("aria-expanded") === "true",
  );
  key(doc.activeElement, "ArrowRight");
  check(
    "tabs.groupRightEntersMembers",
    doc.activeElement === tabButton(first.tabID),
  );
  key(doc.activeElement, "ArrowLeft");
  check(
    "tabs.memberLeftReturnsGroup",
    doc.activeElement === focusButton(`group:${groupID}`),
  );
  dev.tabsModel.removeGroup(groupID);
  groupID = undefined;
  dev.tabsSidebar.renderList(win);
  check(
    "tabs.removedGroupRestoresAdjacentFocus",
    doc.activeElement === tabButton(first.tabID),
  );

  // Only the three owned readers close. Other pre-existing tabs remain open,
  // outside the fixture filter; the last visible document returns focus to Library.
  for (const [fixture, expected] of [
    [second, third],
    [third, first],
    [first, null],
  ]) {
    const button = tabButton(fixture.tabID)?.parentElement.querySelector(
      ".zest-tabbar-close",
    );
    if (!button) throw new Error(`Missing close control for ${fixture.tabID}`);
    button.focus();
    button.click();
    await waitFor(() => !tabs._tabs.some((tab) => tab.id === fixture.tabID));
    await delay(150);
    check(
      `tabs.close${fixture === second ? "Middle" : fixture === third ? "Last" : "Final"}RestoresFocus`,
      doc.activeElement ===
        (expected ? tabButton(expected.tabID) : libraryButton()),
    );
  }
  check(
    "tabs.existingTabsRemainOpen",
    previousTabs.every((id) => tabs._tabs.some((tab) => tab.id === id)),
  );
  dev.tabsSidebar.hideSidebar(win, false);
  check(
    "tabs.unloadRemovesOwnedDOM",
    !doc.getElementById("zest-tabbar") &&
      !doc.getElementById("zest-tabbar-splitter"),
  );
  check(
    "tabs.unloadRestoresNativeBar",
    !doc.documentElement.classList.contains("zest-hide-native-tabs"),
  );
} catch (error) {
  check("tabs.probeCompleted", false, String(error));
} finally {
  for (const tab of [...tabs._tabs]) {
    if (!ownedAttachmentIDs.has(tab.data?.itemID)) continue;
    try {
      tabs.close(tab.id);
    } catch (error) {
      check("tabs.cleanupClose", false, String(error));
    }
  }
  await delay(200);
  dev.tabsSidebar.hideSidebar(win, false);
  for (const item of [...ownedItems].reverse()) {
    try {
      if (Zotero.Items.exists(item.id)) await item.eraseTx();
    } catch (error) {
      check("tabs.cleanupOwnedItem", false, String(error));
    }
  }
  // Restore hideNative/width before enabling the old sidebar so its baseline
  // ownership captures the same native visibility as before this probe.
  for (const saved of [...savedPrefs].sort(
    (a, b) =>
      Number(a.name === "tabs.sidebar") - Number(b.name === "tabs.sidebar"),
  )) {
    if (saved.hadUserValue)
      Zotero.Prefs.set(prefKey(saved.name), saved.value, true);
    else Zotero.Prefs.clear(prefKey(saved.name), true);
  }
  if (previousOpen) {
    dev.tabsSidebar.showSidebar(win);
    filter(previousQuery);
  } else dev.tabsSidebar.hideSidebar(win, false);
  // showSidebar prunes stale group members; restore the exact original model
  // after mounting so this probe does not incidentally retain that cleanup.
  dev.zestConfig.update((draft) => {
    draft.tabGroups = copy(previousGroups);
    draft.tabSessions = copy(previousSessions);
  });
  if (previousOpen) dev.tabsSidebar.renderList(win);
  if (tabs._tabs.some((tab) => tab.id === previousSelected))
    tabs.select(previousSelected);
  await delay(200);
  if (previousFocus?.isConnected && typeof previousFocus.focus === "function")
    previousFocus.focus();
  await dev.zestConfig.flush();
  check(
    "tabs.cleanupRestoresGroups",
    JSON.stringify(dev.tabsModel.groups()) === JSON.stringify(previousGroups),
  );
  check(
    "tabs.cleanupRestoresSessions",
    JSON.stringify(dev.tabsModel.sessions()) ===
      JSON.stringify(previousSessions),
  );
  check(
    "tabs.cleanupRestoresSidebar",
    dev.tabsSidebar.isSidebarOpen(win) === previousOpen,
  );
  check(
    "tabs.cleanupRestoresPreferences",
    savedPrefs.every(
      (saved) =>
        Zotero.Prefs.get(prefKey(saved.name), true) === saved.value &&
        Services.prefs.prefHasUserValue(prefKey(saved.name)) ===
          saved.hadUserValue,
    ),
  );
  check(
    "tabs.cleanupRemovesOnlyOwnedItems",
    ownedItems.every((item) => !Zotero.Items.exists(item.id)),
  );
  check(
    "tabs.cleanupRestoresNativeVisibility",
    doc.documentElement.classList.contains("zest-hide-native-tabs") ===
      previousNativeHidden,
  );
  check(
    "tabs.cleanupKeepsOriginalTabOrder",
    JSON.stringify(
      tabs._tabs
        .filter((tab) => previousTabs.includes(tab.id))
        .map((tab) => tab.id),
    ) === JSON.stringify(previousTabs),
  );
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 2);
