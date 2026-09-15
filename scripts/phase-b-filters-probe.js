/**
 * Native Phase B regression: quick-search child hits, Trash, and view cycling.
 * Run with scripts/dev-eval.sh -f scripts/phase-b-filters-probe.js.
 * Creates only synthetic fixtures under .scaffold/dev-data and removes them.
 * Native API contracts: Zotero 10.0.2 collectionTreeRow.js and collectionTree.jsx.
 */
if (!/[\\/]\.scaffold[\\/]dev-data$/.test(Zotero.DataDirectory.dir))
  throw new Error(
    "This probe requires the isolated scaffold dev-data directory",
  );
const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
if (!/[\\/]\.scaffold[\\/]dev-profile$/.test(profile))
  throw new Error("This probe requires the isolated scaffold dev-profile");

const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const check = (name, condition, note) => {
  (condition ? out.ok : out.fail).push(name);
  if (note !== undefined) out.notes.push(`${name}: ${JSON.stringify(note)}`);
};
const win = Zotero.getMainWindow();
const zp = win.ZoteroPane;
const cv = zp.collectionsView;
const initialRows = zp.getCollectionTreeRows();
// Do not discard pre-existing filters or multi-selection that we cannot restore.
if (initialRows.length !== 1 || dev.itemFilter.activeItemFilters(win).length) {
  check("precondition.singleCollectionWithoutZestFilters", false, {
    rows: initialRows.map((row) => row.id),
    filters: dev.itemFilter.activeItemFilters(win),
  });
  return JSON.stringify(out, null, 2);
}
const initialRow = initialRows[0];
const searchBox =
  win.document.getElementById("zotero-tb-search")?.searchTextbox;
const initialSearch = {
  text: initialRow.searchText,
  mode: initialRow.searchMode,
  tags: new Set(initialRow.tags || []),
  advanced: initialRow.advancedSearch,
  box: searchBox?.value,
};
const initialSelected = zp.getSelectedItems(true);
const initialLayout = dev.viewGroups.captureView(win, "Before Phase B probe");
const initialColumnPrefs = JSON.parse(
  JSON.stringify(zp.itemsView._getColumnPrefs() || {}),
);
const savedPrefs = new Map();
const rememberPref = (key) => {
  if (!savedPrefs.has(key)) {
    savedPrefs.set(key, {
      has: Services.prefs.prefHasUserValue(key),
      value: Zotero.Prefs.get(key, true),
    });
  }
};
rememberPref("extensions.zotero.lastViewedFolder");
rememberPref("extensions.zotero.search.quicksearch-mode");
const nonce = Zotero.randomString(10).toLowerCase();
const token = `zestfulltext${nonce}`;
const noteToken = `zestnote${nonce}`;
const ownItems = [];
const ownViews = new Set();
const filterTag = `phase-b-tags-${nonce}`;
const filterAuthor = `phase-b-author-${nonce}`;
const sourcePath = `${Zotero.DataDirectory.dir}/phase-b-filter-${nonce}.html`;
let collection;
const ids = (items) => items.map((item) => item.id);
const equalIDs = (left, right) =>
  JSON.stringify(ids(left)) === JSON.stringify(ids(right));
const removeFilters = () => {
  dev.itemFilter.setItemFilter(win, filterTag, null);
  dev.itemFilter.setItemFilter(win, filterAuthor, null);
};
const selectRow = async (id) => {
  if (!(await cv.selectByID(id))) throw new Error(`Could not select ${id}`);
  await zp.itemsView.waitForLoad();
  const row = zp.getCollectionTreeRows()[0];
  if (row?.id !== id) throw new Error(`Native row did not switch to ${id}`);
  return row;
};
const search = async (row, text) => {
  row.setSearch(text, "everything");
  if (searchBox) searchBox.value = text;
  await dev.itemFilter.refreshItemView(win);
  return row.getItems();
};
const makeParent = async (title, given, tag) => {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setCreators([
    { firstName: given, lastName: "Probe", creatorType: "author" },
  ]);
  item.setCollections([collection.id]);
  item.addTag(tag);
  ownItems.push(item);
  await item.saveTx({ skipSelect: true });
  return item;
};

try {
  collection = new Zotero.Collection();
  collection.libraryID = Zotero.Libraries.userLibraryID;
  collection.name = `Phase B filter fixture ${nonce}`;
  await collection.saveTx({ skipSelect: true });
  const keepTag = `#PhaseB${nonce}/Keep`;
  const parentA = await makeParent("Phase B alpha", "Ada", keepTag);
  const parentB = await makeParent(
    "Phase B beta",
    "Bob",
    `#PhaseB${nonce}/Other`,
  );
  await IOUtils.writeUTF8(
    sourcePath,
    `<!doctype html><meta charset="utf-8"><title>Phase B contents</title><body><p>${token}</p></body>`,
  );
  const attachments = [];
  for (const parent of [parentA, parentB]) {
    const attachment = await Zotero.Attachments.importFromFile({
      file: sourcePath,
      parentItemID: parent.id,
    });
    ownItems.push(attachment);
    attachments.push(attachment);
    attachment.setField("title", "Phase B attachment");
    await attachment.saveTx();
  }
  // Real text extraction/indexing; no substitution of native query results.
  await Zotero.Fulltext.indexItems(
    attachments.map((item) => item.id),
    { complete: true },
  );
  const note = new Zotero.Item("note");
  note.libraryID = parentA.libraryID;
  note.parentID = parentA.id;
  note.setNote(`<p>Phase B note ${noteToken}</p>`);
  ownItems.push(note);
  await note.saveTx({ skipSelect: true });

  let row = await selectRow(`C${collection.id}`);
  const native = await search(row, token);
  check(
    "search.nativeFulltextReturnsChildrenOnly",
    native.length === 2 &&
      attachments.every((a) => native.includes(a)) &&
      native.every((item) => !item.isTopLevelItem()),
    ids(native),
  );
  const seenOwners = new Set();
  const tagPredicate = (items) =>
    items.filter((item) => {
      seenOwners.add(item.id);
      return item.getTags().some((tag) => tag.tag === keepTag);
    });
  dev.itemFilter.setItemFilter(win, filterTag, tagPredicate);
  const filtered = await row.getItems();
  check(
    "search.missingOwnersAreEvaluated",
    seenOwners.has(parentA.id) && seenOwners.has(parentB.id),
    [...seenOwners],
  );
  check(
    "search.tagFilterKeepsOnlyNativeMatchingChild",
    equalIDs(
      filtered,
      native.filter((item) => item.topLevelItem.id === parentA.id),
    ) &&
      filtered.length === 1 &&
      filtered[0] === attachments[0],
    ids(filtered),
  );
  await dev.itemFilter.refreshItemView(win);
  const visible = zp.itemsView.getSortedItems();
  check(
    "search.nativeTreeReinstatesOnlyKeptOwner",
    visible.some((item) => item.id === parentA.id) &&
      !visible.some((item) => item.id === parentB.id),
    ids(visible),
  );
  dev.itemFilter.setItemFilter(win, filterAuthor, (items) =>
    items.filter((item) =>
      item.getCreators().some((creator) => creator.firstName === "Bob"),
    ),
  );
  check(
    "search.tagAndAuthorFiltersCompose",
    (await row.getItems()).length === 0,
  );
  const unfiltered = await row.getItems({ unfiltered: true });
  check(
    "search.unfilteredKeepsNativeScope",
    unfiltered.includes(parentA) && unfiltered.includes(parentB),
    ids(unfiltered),
  );
  removeFilters();
  check(
    "search.clearRestoresNativeResultShape",
    equalIDs(await row.getItems(), native),
  );

  const noteResults = await search(row, noteToken);
  check(
    "search.nativeNoteReturnsChildOnly",
    noteResults.length === 1 && noteResults[0] === note,
    ids(noteResults),
  );
  dev.itemFilter.setItemFilter(win, filterTag, () => []);
  check(
    "search.noteChildCannotBypassOwnerFilter",
    (await row.getItems()).length === 0,
  );
  removeFilters();

  attachments[0].deleted = true;
  await attachments[0].saveTx();
  row = await selectRow(`T${parentA.libraryID}`);
  const trashed = await search(row, token);
  check(
    "trash.nativeDeletedChildHasLiveAbsentParent",
    trashed.length === 1 &&
      trashed[0] === attachments[0] &&
      !parentA.deleted &&
      !trashed.includes(parentA),
    ids(trashed),
  );
  dev.itemFilter.setItemFilter(win, filterTag, tagPredicate);
  check(
    "trash.keptOwnerDoesNotEnterNativeResult",
    equalIDs(await row.getItems(), trashed),
  );
  dev.itemFilter.setItemFilter(win, filterAuthor, () => []);
  check(
    "trash.rejectedAbsentOwnerRemovesChild",
    (await row.getItems()).length === 0,
  );
  removeFilters();
  check(
    "trash.clearRestoresNativeResultShape",
    equalIDs(await row.getItems(), trashed),
  );
  await search(row, `${token}nomatch`);
  dev.itemFilter.setItemFilter(win, filterTag, tagPredicate);
  check(
    "trash.filterNeverAddsRowsToEmptyNativeQuery",
    (await row.getItems()).length === 0,
  );
  removeFilters();

  // Same visible columns, distinct sort and widths. Only inserted probe views
  // are removed on cleanup; any other saved views remain in their own order.
  row = await selectRow(`C${collection.id}`);
  await search(row, "");
  if (!initialLayout || !dev.viewGroups.canApplyViews(win))
    throw new Error("Native column view APIs unavailable");
  const layout = dev.viewGroups.captureView(win, "Phase B baseline");
  if (!layout.columns.some((column) => column.dataKey === "dateAdded"))
    throw new Error("Native dateAdded column unavailable");
  const views = [1, 2, 3].map((number) => {
    const copy = JSON.parse(JSON.stringify(layout));
    copy.id = `phase-b-view-${nonce}-${number}`;
    copy.name = `Phase B ${number}`;
    copy.sortField = number === 2 ? "dateAdded" : "title";
    copy.sortDirection = number === 1 ? 1 : -1;
    const title = copy.columns.find((column) => column.dataKey === "title");
    if (title?.width) title.width += number * 31;
    ownViews.add(copy.id);
    return copy;
  });
  dev.zestConfig.update((draft) => {
    draft.viewGroups.unshift(...views);
  });
  await dev.viewGroups.applyView(win, views[1]);
  await dev.viewGroups.cycleView(win, 1);
  let current = dev.viewGroups.captureView(win, "C");
  check(
    "views.sameColumnsCycleForwardUsesSavedIdentity",
    current.sortField === "title" && current.sortDirection === -1,
    current,
  );
  await dev.viewGroups.cycleView(win, -1);
  current = dev.viewGroups.captureView(win, "B");
  check(
    "views.sameColumnsCycleBackward",
    current.sortField === "dateAdded" && current.sortDirection === -1,
  );
  // A native manual width change must invalidate the last applied view id.
  const iv = zp.itemsView;
  const manual = iv._getColumnPrefs() || {};
  const title = current.columns.find((column) => column.dataKey === "title");
  manual.title = {
    ...(manual.title || {}),
    dataKey: "title",
    width: (title?.width || 200) + 79,
  };
  iv._storeColumnPrefs(manual);
  await iv._resetColumns();
  await iv.sort();
  await dev.viewGroups.cycleView(win, 1);
  current = dev.viewGroups.captureView(win, "A");
  check(
    "views.manualNativeResizeInvalidatesIdentity",
    current.sortField === "title" && current.sortDirection === 1,
    current,
  );
} catch (error) {
  check("probe.completed", false, String(error));
} finally {
  removeFilters();
  const cleanup = async (name, action) => {
    try {
      await action();
    } catch (error) {
      check(`cleanup.${name}`, false, String(error));
    }
  };
  await cleanup("views", async () => {
    dev.zestConfig.update((draft) => {
      draft.viewGroups = draft.viewGroups.filter(
        (view) => !ownViews.has(view.id),
      );
    });
    await dev.zestConfig.flush();
  });
  // Leave Trash/our temporary collection before deleting fixtures.
  await cleanup("collection", async () => {
    await selectRow(initialRow.id);
  });
  await cleanup("nativeSearch", async () => {
    const row = zp.getCollectionTreeRows()[0];
    if (row?.id !== initialRow.id)
      throw new Error("Original collection was not restored");
    row.setSearch(initialSearch.text, initialSearch.mode);
    row.setTags(initialSearch.tags);
    row.setAdvancedSearch?.(initialSearch.advanced);
    if (searchBox) searchBox.value = initialSearch.box;
    await dev.itemFilter.refreshItemView(win);
  });
  for (const item of ownItems.reverse()) {
    await cleanup(`item.${item.id}`, async () => {
      if (item.id && Zotero.Items.exists(item.id)) await item.eraseTx();
    });
  }
  await cleanup("fixtureCollection", async () => {
    if (collection?.id && Zotero.Collections.exists(collection.id))
      await collection.eraseTx();
  });
  await cleanup("fixtureFile", async () => {
    await IOUtils.remove(sourcePath, { ignoreAbsent: true });
  });
  await cleanup("nativeColumns", async () => {
    const iv = zp.itemsView;
    iv._storeColumnPrefs(initialColumnPrefs);
    await iv._writeColumnPrefsToFile?.(true);
    await iv._resetColumns();
    await iv.sort();
    iv.tree?.invalidate?.();
  });
  await cleanup("selection", async () => {
    await zp.itemsView.selectItems(initialSelected);
  });
  await cleanup("prefs", async () => {
    for (const [key, saved] of savedPrefs) {
      if (saved.has) Zotero.Prefs.set(key, saved.value, true);
      else Services.prefs.clearUserPref(key);
    }
  });
  check(
    "cleanup.noProbeFiltersRemain",
    !dev.itemFilter
      .activeItemFilters(win)
      .some((name) => name === filterTag || name === filterAuthor),
  );
  check(
    "cleanup.noFixtureItemsRemain",
    ownItems.every((item) => !item.id || !Zotero.Items.exists(item.id)),
  );
  check(
    "cleanup.noProbeViewsRemain",
    !dev.zestConfig.get().viewGroups.some((view) => ownViews.has(view.id)),
  );
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 2);
