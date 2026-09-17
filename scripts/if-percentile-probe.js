/** Native IF layout probe: synthetic data, isolated profile, no network. */
if (
  !Services.dirsvc
    .get("ProfD", Components.interfaces.nsIFile)
    .path.endsWith("/source/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data")
)
  throw new Error("Isolated profile required");
const outputPath =
  typeof probeOutputPath === "string"
    ? probeOutputPath
    : PathUtils.join(PathUtils.tempDir, "zest-if-percentile-probe");
await IOUtils.makeDirectory(outputPath, { ignoreExisting: true });
const out = { ok: [], fail: [], notes: [] };
const check = (name, pass, note) => {
  (pass ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const win = Zotero.getMainWindow();
const doc = win.document;
const pane = win.ZoteroPane;
const layout = dev.viewGroups.captureView(win, "Before IF probe");
const prefs = new Map();
const set = (name, value) => {
  const key = `extensions.zotero.zest.${name}`;
  prefs.set(key, {
    user: Services.prefs.prefHasUserValue(key),
    value: Zotero.Prefs.get(key, true),
  });
  Zotero.Prefs.set(key, value, true);
};
const themeKey = "ui.systemUsesDarkTheme";
const themeUser = Services.prefs.prefHasUserValue(themeKey);
const theme = Services.prefs.getIntPref(themeKey, 0);
const keys = [];
const items = [];
const extraBefore = [];
let collection;
const delay = (ms = 200) => Zotero.Promise.delay(ms);
try {
  set("rank.autoFetch", false);
  set("column.if.enable", true);
  set("if.field", "sciif");
  set("if.style", "percentile");
  set("info.affiliations.autoFetch", false);
  collection = new Zotero.Collection();
  collection.name = "Zest IF layout fixtures (synthetic)";
  await collection.saveTx();
  const samples = [
    ["A · P0 endpoint", 0, [0]],
    ["B · P96 top 10%", 12.3, [96]],
    ["C · Multiple categories", 6.4, [40, 82]],
    ["D · Missing percentile", 5.8, []],
    ["E · P100 endpoint", 25, [100]],
  ];
  for (const [title, value, points] of samples) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", title);
    item.setField("publicationTitle", `Zest IF probe ${Date.now()} ${title}`);
    item.setField("extra", "Custom: retained\n");
    item.setCollections([collection.id]);
    await item.saveTx();
    items.push(item);
    extraBefore.push(item.getField("extra"));
    const key = dev.rank.journalKeyOf(item).key;
    keys.push(key);
    dev.cache.set("rank", key, {
      key,
      name: item.getField("publicationTitle"),
      updated: Date.now(),
      values: [{ field: "sciif", value: String(value), source: "dataset" }],
      ...(points.length
        ? {
            jcr: {
              year: 2024,
              impactFactor: value,
              source: "dataset",
              categories: points.map((percentile, i) => ({
                name: `Example subject ${i + 1}`,
                percentile,
              })),
            },
          }
        : {}),
    });
  }
  await pane.collectionsView.selectCollection(collection.id);
  await delay();
  const ifKey = pane.itemsView._columns.find((c) =>
    c.dataKey.endsWith("-if"),
  )?.dataKey;
  if (!ifKey) throw new Error("IF column did not register");
  await dev.viewGroups.applyView(win, {
    id: "if-probe",
    name: "IF probe",
    columns: [
      {
        dataKey: "title",
        hidden: false,
        ordinal: 0,
        width: Math.max(
          300,
          doc.querySelector("#zotero-items-tree").clientWidth - 105,
        ),
      },
      { dataKey: ifKey, hidden: false, ordinal: 1, width: 80 },
    ],
    sortField: "title",
    sortDirection: 1,
  });
  await pane.selectItem(items[1].id);
  await delay();
  const cells = () => [...doc.querySelectorAll(".cell.zest-if")];
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      cells().length === 5 &&
      cells().filter((c) => c.querySelector(".zest-if-percentile")).length === 4
    )
      break;
    await delay(50);
  }
  check("nativeRowsRendered", cells().length === 5, String(cells().length));
  check(
    "fourGraphsOneNumberOnly",
    cells().filter((c) => c.querySelector(".zest-if-percentile")).length === 4,
  );
  check(
    "multipleCategoriesNeutral",
    cells()[2]?.querySelector(".zest-if-range") &&
      !cells()[2]?.querySelector(".zest-if-top"),
  );
  check("topTenRing", !!cells()[1]?.querySelector(".zest-if-top"));
  check(
    "noExtraHoverPopup",
    cells().every((cell) => !cell.title && !cell.hasAttribute("tooltip")),
  );
  check(
    "yearHasNoThousandsSeparator",
    cells()[1]?.getAttribute("aria-label").includes("2024") &&
      !cells()[1]?.getAttribute("aria-label").includes("2,024"),
    cells()[1]?.getAttribute("aria-label"),
  );
  check(
    "zeroVisible",
    cells()[0]?.querySelector(".cell-text")?.textContent === "0.0",
  );
  check(
    "extraUnchanged",
    items.every((item, i) => item.getField("extra") === extraBefore[i]),
  );
  for (const dark of [0, 1]) {
    Services.prefs.setIntPref(themeKey, dark);
    await delay(600);
    const boundsOK = cells().every((cell) => {
      const box = cell.getBoundingClientRect();
      const text = cell.querySelector(".cell-text").getBoundingClientRect();
      const graph = cell.querySelector(".zest-if-percentile");
      if (!graph) return true;
      const line = graph.getBoundingClientRect();
      return (
        text.bottom <= line.top + 0.5 &&
        line.bottom <= box.bottom + 0.5 &&
        text.top >= box.top - 0.5 &&
        [...graph.children].every((point) => {
          const b = point.getBoundingClientRect();
          const style = win.getComputedStyle(point);
          const ring =
            style.outlineStyle === "none"
              ? 0
              : parseFloat(style.outlineWidth) +
                Math.max(0, parseFloat(style.outlineOffset));
          const row = cell.closest(".row")?.getBoundingClientRect() || box;
          return (
            b.left - ring >= box.left &&
            b.right + ring <= box.right &&
            b.top - ring >= Math.max(box.top, row.top) - 0.1 &&
            b.bottom + ring <= Math.min(box.bottom, row.bottom) + 0.1
          );
        })
      );
    });
    check(
      `${dark ? "dark" : "light"}.nativeBounds`,
      boundsOK,
      JSON.stringify(
        cells().map((cell) => ({
          height: cell.getBoundingClientRect().height,
          width: cell.getBoundingClientRect().width,
        })),
      ),
    );
    const region = doc
      .querySelector("#zotero-items-tree")
      .getBoundingClientRect();
    const canvas = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    const scale = win.devicePixelRatio || 1;
    canvas.width = Math.round(region.width * scale);
    canvas.height = Math.round(Math.min(region.height, 245) * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawWindow(
      win,
      region.left,
      region.top,
      region.width,
      Math.min(region.height, 245),
      "rgb(255,255,255)",
    );
    await IOUtils.write(
      PathUtils.join(outputPath, `if-native-${dark ? "dark" : "light"}.png`),
      Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
        c.charCodeAt(0),
      ),
    );
  }
  // Outline paint extends outside getBoundingClientRect(). Test the full
  // visible marker vertically as well as horizontally, including compact rows.
  for (const [height, font] of [
    [20, 12],
    [23, 13],
    [28, 17],
  ]) {
    for (const width of [80, 48]) {
      const beforeStyles = cells().map((cell) => cell.style.cssText);
      for (const cell of cells()) {
        cell.style.height = `${height}px`;
        cell.style.maxHeight = `${height}px`;
        cell.style.fontSize = `${font}px`;
        cell.style.maxWidth = `${width}px`;
      }
      const markers = cells().flatMap((cell) =>
        [...cell.querySelectorAll(".zest-if-point")].map((point) => {
          const b = point.getBoundingClientRect(),
            box = cell.getBoundingClientRect();
          const style = win.getComputedStyle(point);
          const ring =
            style.outlineStyle === "none"
              ? 0
              : parseFloat(style.outlineWidth) +
                parseFloat(style.outlineOffset);
          return {
            top: b.top - ring - box.top,
            bottom: box.bottom - b.bottom - ring,
            left: b.left - ring - box.left,
            right: box.right - b.right - ring,
          };
        }),
      );
      check(
        `height${height}.width${width}.wholeMarkerContained`,
        markers.every(
          (b) => Math.min(b.top, b.bottom, b.left, b.right) >= -0.1,
        ),
        JSON.stringify(markers),
      );
      cells().forEach((cell, i) => {
        cell.style.cssText = beforeStyles[i];
      });
    }
  }
  for (const width of [80, 48]) {
    const originalStyles = cells().map((cell) => cell.style.cssText);
    for (const cell of cells()) cell.style.maxWidth = `${width}px`;
    check(
      `width${width}.endpointsContained`,
      cells().every((cell) => {
        const box = cell.getBoundingClientRect();
        return [...cell.querySelectorAll(".zest-if-point")].every((point) => {
          const b = point.getBoundingClientRect();
          const ring = point.classList.contains("zest-if-top") ? 2 : 0;
          return b.left - ring >= box.left && b.right + ring <= box.right;
        });
      }),
    );
    cells().forEach((cell, i) => {
      cell.style.cssText = originalStyles[i];
    });
  }
  Zotero.Prefs.set("extensions.zotero.zest.if.style", "none", true);
  await delay();
  check(
    "noneRedrawsImmediately",
    cells().length === 5 &&
      cells().every(
        (c) =>
          !c.querySelector(".zest-if-percentile") &&
          c.querySelector(".cell-text").textContent,
      ),
  );
} finally {
  if (layout) await dev.viewGroups.applyView(win, layout);
  for (const key of keys) dev.cache.remove("rank", key);
  for (const item of items) await item.eraseTx();
  if (collection) await collection.eraseTx();
  for (const [key, previous] of prefs) {
    if (previous.user) Zotero.Prefs.set(key, previous.value, true);
    else Services.prefs.clearUserPref(key);
  }
  if (themeUser) Services.prefs.setIntPref(themeKey, theme);
  else Services.prefs.clearUserPref(themeKey);
}
return JSON.stringify(out, null, 2);
