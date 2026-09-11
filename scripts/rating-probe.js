/** Native acceptance on disposable isolated fixtures only. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated development profile required");
const host = Zotero.getMainWindow(),
  doc = host.document,
  pane = host.ZoteroPane;
const out = { ok: [], fail: [], screenshots: [] };
const check = (name, pass) => (pass ? out.ok : out.fail).push(name);
const delay = (ms) => Zotero.Promise.delay(ms);
async function until(read, description) {
  for (let i = 0; i < 100; i++) {
    const v = read();
    if (v) return v;
    await delay(50);
  }
  throw Error("Timed out: " + description);
}
const prefs = new Map(),
  items = [],
  originalSelection = pane.getSelectedItems().map((i) => i.id);
const prefix = "extensions.zotero.zest.";
function pref(name, value, raw = false) {
  const key = raw ? name : prefix + name;
  if (!prefs.has(key))
    prefs.set(key, {
      had: Services.prefs.prefHasUserValue(key),
      value: Zotero.Prefs.get(key, true),
    });
  Zotero.Prefs.set(key, value, true);
}
const artifactDir = PathUtils.join(
  PathUtils.parent(Zotero.DataDirectory.dir),
  "rating-acceptance-" + Date.now(),
);
await IOUtils.makeDirectory(artifactDir);
async function shot(win, name, bounds) {
  const box = bounds || {
    x: 0,
    y: 0,
    width: win.innerWidth,
    height: win.innerHeight,
  };
  const canvas = win.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas",
  );
  canvas.width = Math.ceil(box.width);
  canvas.height = Math.ceil(box.height);
  canvas
    .getContext("2d")
    .drawWindow(win, box.x, box.y, box.width, box.height, "rgb(242,242,242)");
  const path = PathUtils.join(artifactDir, name + ".png");
  await IOUtils.write(
    path,
    Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
      c.charCodeAt(0),
    ),
  );
  out.screenshots.push(path);
}
function rowOf(item) {
  const index = pane.itemsView
    .getSortedItems()
    .findIndex((i) => i.id === item.id);
  return doc.querySelector(`#item-tree-main-default-row-${index}`);
}
function state(item) {
  const row = rowOf(item);
  return {
    title: row?.querySelector(".zest-title-rating")?.textContent || "",
    column: !!row?.querySelector(".zest-rating"),
    hidden: row?.querySelectorAll(".zest-title-rating-duplicate").length || 0,
    native: row?.querySelectorAll(".tag-swatch.emoji").length || 0,
  };
}
const importWindow = () =>
  [...Services.wm.getEnumerator(null)].find(
    (w) =>
      !w.closed &&
      w.innerWidth > 0 &&
      w.document.querySelector(".zest-rating-import"),
  );
try {
  pref("column.rating.enable", true);
  pref("rating.display", "column");
  pref("rating.mark", "★");
  pref("rating.color", "");
  pref("rating.extraKey", "rate");
  pref("titleDecor.hideNativeTags", false);
  const samples = [
    [
      "1 Import five stars",
      ["⭐⭐⭐⭐⭐"],
      "User note\r\nCustom: preserved\r\n",
    ],
    ["2 Matching rating", ["⭐⭐⭐"], "Rating: 3"],
    ["3 Conflicting existing rating", ["⭐⭐"], "rate: 4"],
    ["4 Semantic tag", ["⭐精读"], ""],
    ["5 Conflicting star tags", ["⭐", "⭐⭐"], ""],
    ["6 Malformed existing rating", ["⭐⭐⭐"], "Rating: 3 notes"],
  ];
  for (const [name, tags, extra] of samples) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Zest rating QA " + name);
    item.setField("extra", extra);
    item.setTags(tags.map((tag) => ({ tag })));
    await item.saveTx();
    items.push(item);
  }
  await pane.collectionsView.selectByID("L" + Zotero.Libraries.userLibraryID);
  await pane.selectItems(items.map((i) => i.id));
  await until(
    () => rowOf(items[1])?.querySelector(".zest-rating"),
    "rating column",
  );
  await delay(250);
  check(
    "column-only hides matching native star tag",
    state(items[1]).hidden === 1 && !state(items[1]).title,
  );
  check(
    "conflicting semantic and malformed stars stay native",
    [items[2], items[3], items[5]].every(
      (i) => state(i).native > 0 && state(i).hidden === 0,
    ),
  );
  const snapshots = items.map((i) => ({
    title: i.getField("title"),
    tags: JSON.stringify(i.getTags()),
    extra: i.getField("extra"),
  }));
  for (const mode of ["title", "both", "column"]) {
    pref("rating.display", mode);
    await until(() => {
      const s = state(items[1]);
      return (
        s.column === (mode !== "title") &&
        s.title === (mode === "column" ? "" : "★★★")
      );
    }, mode + " display");
    check(
      mode + " uses shared Extra rating",
      dev.rating.getRating(items[1]) === 3 && state(items[1]).hidden === 1,
    );
  }
  pref("rating.display", "both");
  await until(() => state(items[1]).title === "★★★", "both ready");
  for (const dark of [false, true]) {
    pref("browser.theme.toolbar-theme", dark ? 0 : 1, true);
    pref("browser.theme.content-theme", dark ? 0 : 1, true);
    pref("ui.systemUsesDarkTheme", dark ? 1 : 0, true);
    await delay(500);
    await shot(host, "rating-both-" + (dark ? "dark" : "light"));
  }
  // Exercise the actual rendered star event handler, not the setter directly.
  const secondStar = rowOf(items[1]).querySelectorAll(
    ".zest-rating .zest-star",
  )[1];
  secondStar.dispatchEvent(
    new host.MouseEvent("click", { bubbles: true, button: 0 }),
  );
  await until(
    () =>
      dev.rating.getRating(items[1]) === 2 && state(items[1]).title === "★★",
    "column click updates title",
  );
  check(
    "click updates both surfaces but retains conflicting native tag",
    state(items[1]).hidden === 0,
  );
  await dev.rating.setRating(items[1], 3);
  pref("column.rating.enable", false);
  await until(
    () => !state(items[1]).column && !state(items[1]).title,
    "master disabled",
  );
  check("master off restores native stars", state(items[1]).hidden === 0);
  pref("column.rating.enable", true);
  const preview = dev.ratingImport.collectRatingImportPreview(items);
  check(
    "only unrated unambiguous paper eligible",
    preview.eligible === 1 && preview.rows[0].candidateRating === 5,
  );
  check(
    "preview writes nothing",
    items.every((i, n) => i.getField("extra") === snapshots[n].extra),
  );
  dev.ratingImportUI.openRatingImport(host, items);
  const firstDialog = await until(importWindow, "preview dialog");
  check(
    "preview actual DOM has six safe rows",
    firstDialog.document.querySelectorAll("tbody tr").length === 6,
  );
  firstDialog.document
    .querySelector(".zest-rating-import-actions button")
    .click();
  await until(
    () => firstDialog.closed && !importWindow(),
    "cancelled window disposed",
  );
  check(
    "close cancels without writes",
    items[0].getField("extra") === snapshots[0].extra,
  );
  dev.ratingImportUI.openRatingImport(host, items);
  const dialog = await until(importWindow, "reopened preview");
  for (const dark of [false, true]) {
    pref("browser.theme.toolbar-theme", dark ? 0 : 1, true);
    pref("browser.theme.content-theme", dark ? 0 : 1, true);
    pref("ui.systemUsesDarkTheme", dark ? 1 : 0, true);
    await delay(400);
    await shot(dialog, "import-preview-" + (dark ? "dark" : "light"));
  }
  const confirm = dialog.document.querySelector(
    ".zest-rating-import-actions button:last-child",
  );
  confirm.click();
  confirm.click();
  await until(() => dev.rating.getRating(items[0]) === 5, "confirmed save");
  await delay(200);
  check(
    "confirmation preserves Extra CRLF and unrelated text",
    items[0].getField("extra") === snapshots[0].extra + "\r\nrate: 5",
  );
  check(
    "confirmation preserves every title and tag",
    items.every(
      (i, n) =>
        i.getField("title") === snapshots[n].title &&
        JSON.stringify(i.getTags()) === snapshots[n].tags,
    ),
  );
  check(
    "existing and conflicting records unchanged",
    items
      .slice(1)
      .every((i, n) => i.getField("extra") === snapshots[n + 1].extra),
  );
  check(
    "repeat import has no eligible paper",
    dev.ratingImport.collectRatingImportPreview(items).eligible === 0,
  );
  // An edit after preview is protected by optimistic concurrency.
  await dev.rating.setRating(items[0], 0);
  const stale = dev.ratingImport.collectRatingImportPreview([items[0]]);
  items[0].addTag("User changed since preview");
  await items[0].saveTx();
  const staleResult = await dev.ratingImport.commitRatingImport(stale);
  check(
    "changed preview skips without writing",
    staleResult.imported === 0 &&
      stale.rows[0].status === "changed" &&
      dev.rating.getRating(items[0]) === 0,
  );
} catch (e) {
  out.fail.push(String(e));
} finally {
  dev.ratingImportUI.closeAllRatingImports();
  for (const [key, old] of prefs) {
    if (old.had) Zotero.Prefs.set(key, old.value, true);
    else Zotero.Prefs.clear(key, true);
  }
  for (const item of items) await item.eraseTx();
  if (originalSelection.length) await pane.selectItems(originalSelection);
}
out.passed = out.fail.length === 0;
return out;
