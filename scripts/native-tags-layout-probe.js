/** Native tag geometry, using temporary in-memory data in the isolated profile. */
if (!Zotero.DataDirectory.dir.endsWith("/source/.scaffold/dev-data"))
  throw new Error("Isolated development library required");
const win = Zotero.getMainWindow(),
  doc = win.document,
  pane = win.ZoteroPane,
  selector = pane.tagSelector,
  container = doc.getElementById("zotero-tag-selector-container"),
  sidebar = doc.getElementById("zotero-collections-pane"),
  native = doc.getElementById("zotero-tag-selector");
const out = { ok: [], fail: [], cases: [], screenshots: [] };
const check = (name, ok) => (ok ? out.ok : out.fail).push(name);
const delay = (ms = 150) => Zotero.Promise.delay(ms);
const prefix = "extensions.zotero.zest.";
const keys = [
  prefix + "nestedTags.show",
  prefix + "nestedTags.tab",
  "extensions.zotero.fontSize",
];
const saved = keys.map((key) => ({
  key,
  had: Services.prefs.prefHasUserValue(key),
  value: Zotero.Prefs.get(key, true),
}));
const styles = [container, sidebar, native].map((el) => ({
  el,
  style: el.getAttribute("style"),
}));
const themeKey = "ui.systemUsesDarkTheme",
  themeHad = Services.prefs.prefHasUserValue(themeKey),
  themeBefore = Services.prefs.getIntPref(themeKey, 0),
  stateBefore = { ...selector.state, tags: [...selector.state.tags] },
  selectionBefore = new Set(selector.selectedTags);
const names = [
  "★must-read",
  "⭐⭐⭐⭐⭐",
  "🧠免疫治疗",
  "📖Reading",
  "Cancer Immunology, Immunotherapy",
  "研究设计/随机对照试验",
  "Perioperative immune checkpoint inhibitors",
  "Methods",
  "Results",
  "术后并发症",
  "Survival analysis",
  "A very long tag that must be truncated within a narrow native tag pane",
  "🔥重点",
  "待整理",
  "Review",
];
const setMode = async (mode) => {
  Zotero.Prefs.set(prefix + "nestedTags.tab", mode, true);
  // The hand-back uses a window timer. Drain that queue before the global
  // Promise delay so background-window throttling cannot outrun the repair.
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  await delay();
};
const geometry = () => {
  const rect = native.getBoundingClientRect();
  const tags = [...native.querySelectorAll(".tag-selector-item")]
    .map((el) => {
      const b = el.getBoundingClientRect();
      return {
        name: el.textContent,
        x: b.x - rect.x,
        y: b.y - rect.y,
        width: b.width,
        height: b.height,
      };
    })
    .filter((r) => r.width > 0 && r.height > 0);
  const overlaps = [];
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i],
        b = tags[j];
      if (
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
      )
        overlaps.push([a.name, b.name]);
    }
  return {
    tags,
    overlaps,
    widths: selector.tagListRef.current.props.tags.map((t) => t.width),
    paneWidth: rect.width,
    fontSize: selector.state.fontSize,
  };
};
async function shot(name) {
  const r = container.getBoundingClientRect(),
    scale = win.devicePixelRatio || 1,
    canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = Math.round(r.width * scale);
  canvas.height = Math.round(r.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawWindow(win, r.x, r.y, r.width, r.height, "rgb(255,255,255)");
  const path = PathUtils.join(
    PathUtils.parent(Zotero.DataDirectory.dir),
    `native-tags-${name}.png`,
  );
  await IOUtils.write(
    path,
    Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
      c.charCodeAt(0),
    ),
  );
  out.screenshots.push(path);
}
async function poisonHiddenMeasurements() {
  await setMode("tree");
  selector.handleUIPropertiesChange({});
  selector.forceUpdate();
  await delay();
  // On HiDPI Zotero measures the first 200 tags through its hidden DOM div.
  // On other screens inject the same cache values to exercise the hand-back.
  if (!selector.state.isHighDensity) {
    for (const [key] of selector.widths) selector.widths.set(key, 0);
    for (const [key] of selector.widthsBold) selector.widthsBold.set(key, 0);
    selector.forceUpdate();
    await delay();
  }
  check(
    "hidden measurements reproduce zero-width tags",
    selector.tagListRef.current.props.tags.every((t) => t.width === 0),
  );
}
try {
  Zotero.Prefs.set(prefix + "nestedTags.show", true, true);
  await setMode("native");
  container.style.height = container.style.minHeight = "330px";
  selector.selectedTags = new Set();
  selector.setState({
    tags: names.map((tag) => ({ tag, type: 0 })),
    tagColors: new Map([[names[0], { color: "#e0ac36", position: 0 }]]),
    scope: new Set(names),
    searchString: "",
    loaded: true,
  });
  await delay();
  for (const dark of [false, true]) {
    Services.prefs.setIntPref(themeKey, dark ? 1 : 0);
    await delay();
    for (const width of [240, 200]) {
      sidebar.style.width =
        sidebar.style.minWidth =
        sidebar.style.maxWidth =
          width + "px";
      await delay();
      pane.updateLayoutConstraints();
      await delay();
      selector.handleUIPropertiesChange({});
      selector.handleResize();
      selector.forceUpdate();
      await delay();
      await poisonHiddenMeasurements();
      await setMode("native");
      const result = geometry(),
        name = `${dark ? "dark" : "light"}-${width}`;
      out.cases.push({ name, ...result });
      check(
        name + " measures every tag",
        result.widths.every((n) => n > 0),
      );
      check(name + " renders fixture tags", result.tags.length >= 8);
      check(name + " has no overlapping labels", result.overlaps.length === 0);
      check(
        name + " stays inside the pane",
        result.tags.every((r) => r.x + r.width <= result.paneWidth + 1),
      );
      await shot(name);
    }
  }
  Zotero.Prefs.set("fontSize", "1.50");
  await delay();
  selector.handleUIPropertiesChange({});
  selector.forceUpdate();
  await delay();
  await poisonHiddenMeasurements();
  await setMode("native");
  const large = geometry();
  out.cases.push({ name: "large-font", ...large });
  check("large font applied", parseFloat(large.fontSize) >= 18);
  check(
    "large font has no overlapping labels",
    large.overlaps.length === 0 && large.widths.every((n) => n > 0),
  );
  await shot("large-font-dark");
  Zotero.Prefs.set(
    "fontSize",
    saved.find((p) => p.key === "extensions.zotero.fontSize").value,
  );
  await delay();
  selector.handleUIPropertiesChange({});
  selector.forceUpdate();
  await delay();
  // Returning through the master switch uses the same native hand-back path.
  await poisonHiddenMeasurements();
  Zotero.Prefs.set(prefix + "nestedTags.show", false, true);
  await delay();
  const restored = geometry();
  check(
    "master off restores readable native tags",
    restored.widths.every((n) => n > 0) && restored.overlaps.length === 0,
  );
  // The native list must keep its normal selection and filtering behavior.
  selector.selectedTags.add(names[2]);
  selector.forceUpdate();
  await delay();
  Zotero.Prefs.set(prefix + "nestedTags.show", true, true);
  await setMode("native");
  check(
    "remeasure preserves native selected tags",
    selector.selectedTags.has(names[2]),
  );
  selector.setState({ searchString: "immune" });
  await delay();
  check(
    "native search still filters tags",
    selector.tagListRef.current.props.tags.length === 1 &&
      selector.tagListRef.current.props.tags[0].name === names[6],
  );
} catch (e) {
  out.fail.push(String(e));
  out.stack = String(e.stack);
} finally {
  for (const { el, style } of styles) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  if (themeHad) Services.prefs.setIntPref(themeKey, themeBefore);
  else Services.prefs.clearUserPref(themeKey);
  for (const { key, had, value } of saved) {
    if (had) Zotero.Prefs.set(key, value, true);
    else Services.prefs.clearUserPref(key);
  }
  await delay();
  pane.updateLayoutConstraints();
  selector.selectedTags = selectionBefore;
  selector.setState(stateBefore);
  selector.handleUIPropertiesChange({});
  selector.handleResize();
  selector.forceUpdate();
  await delay();
}
out.passed = out.fail.length === 0;
return out;
