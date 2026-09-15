/** Phase C UI checks. Only run in the isolated scaffold profile. */
if (!String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile"))
  throw Error("Isolated dev profile required");
const win = Zotero.getMainWindow(),
  doc = win.document;
const out = { ok: [], fail: [], notes: [] };
const check = (name, yes, note) => {
  (yes ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const delay = (ms) => Zotero.Promise.delay(ms);
const saved = new Map();
function pref(name, value) {
  const key = "extensions.zotero.zest." + name;
  if (!saved.has(key)) saved.set(key, Zotero.Prefs.get(key, true));
  Zotero.Prefs.set(key, value, true);
}
const themeHad = Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme");
const oldTheme = Services.prefs.getIntPref("ui.systemUsesDarkTheme", 0);
const nativeStyle = doc.documentElement.getAttribute("style");
const graphWasVisible = dev.graphPane.isGraphVisible(win);
let matrixWin, demo;
try {
  pref("graph.visible", graphWasVisible);
  dev.graphPane.hideGraphPane(win, false);
  pref("graph.mode", "author");
  pref("graph.height", 160);
  dev.graphPane.showGraphPane(win);
  await delay(500);
  const pane = doc.querySelector(".zest-graph-pane"),
    options = pane.querySelector("details"),
    body = options.querySelector(".zest-graph-options-body"),
    summary = options.querySelector("summary");
  check(
    "graph.closedOptionsHaveNoLayout",
    !options.open && body.getClientRects().length === 0,
  );
  for (const font of [13, 20]) {
    doc.documentElement.style.setProperty("--zotero-font-size", font + "px");
    for (const width of [320, 420]) {
      pane.style.setProperty("--zotero-font-size", font + "px");
      pane.style.width = width + "px";
      pane.style.maxWidth = width + "px";
      options.open = true;
      await delay(50);
      const r = body.getBoundingClientRect(),
        p = pane.getBoundingClientRect();
      check(
        `graph.optionsContained.${width}.${font}`,
        r.bottom <= p.bottom + 1 &&
          r.right <= p.right + 1 &&
          r.left >= p.left - 1 &&
          body.scrollWidth <= body.clientWidth + 1,
        `${Math.round(r.width)}x${Math.round(r.height)}, scroll ${body.scrollHeight}`,
      );
      const last = body.querySelector(".zest-graph-fit");
      last.focus();
      last.scrollIntoView({ block: "nearest" });
      check(
        `graph.lastActionReachable.${width}.${font}`,
        doc.activeElement === last &&
          last.getBoundingClientRect().bottom <= p.bottom + 1,
      );
      options.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      check(
        `graph.escapeRestoresSummary.${width}.${font}`,
        !options.open &&
          doc.activeElement === summary &&
          body.getClientRects().length === 0,
      );
    }
  }
  dev.graphPane.hideGraphPane(win, false);
  if (nativeStyle === null) doc.documentElement.removeAttribute("style");
  else doc.documentElement.setAttribute("style", nativeStyle);
  const items = win.ZoteroPane.itemsView
    .getSortedItems()
    .filter((i) => i.isRegularItem());
  const item = items.find((i) => dev.annotSection.collectAnnotations(i).length);
  await win.ZoteroPane.selectItem(item.id);
  dev.annotSection.refreshAnnotSections();
  await delay(400);
  const section = doc.querySelector(".zest-annot-cards");
  section?.closest("collapsible-section")?.setAttribute("open", "true");
  section?.scrollIntoView({ block: "start" });
  await delay(150);
  const card = doc.querySelector(".zest-annot-card");
  check(
    "annotations.explicitNativeActions",
    !!card &&
      card.querySelectorAll("button.zest-annotation-action").length === 2,
  );
  if (card) {
    const text = card.querySelector(".zest-annot-text"),
      copy = card.querySelector("button.zest-annot-copy");
    check(
      "annotations.selectableText",
      !!text && win.getComputedStyle(text).userSelect !== "none",
    );
    let copied = "";
    const oldCopy = Zotero.Utilities.Internal.copyTextToClipboard;
    try {
      Zotero.Utilities.Internal.copyTextToClipboard = (value) => {
        copied = value;
      };
      copy?.click();
      check(
        "annotations.copyExactText",
        copied ===
          dev.annotationActions.annotationCopyText(
            dev.annotSection.collectAnnotations(item)[0],
          ),
      );
    } finally {
      Zotero.Utilities.Internal.copyTextToClipboard = oldCopy;
    }
  }
  // Real badge elements under the native stylesheet. All samples are synthetic.
  demo = doc.createElement("div");
  demo.style.cssText =
    "position:fixed;left:10px;top:50px;padding:12px;z-index:9999;background-color:var(--material-background);";
  doc.documentElement.appendChild(demo);
  const samples = [];
  for (const rgb of [
    [128, 128, 128],
    [255, 221, 0],
    [0, 180, 90],
    [255, 102, 102],
  ])
    for (const opacity of [0, 0.16, 1]) {
      const el = doc.createElement("span");
      el.className = "zest-badge";
      el.textContent = "Badge";
      dev.uiColor.setSemanticBadge(el, rgb, opacity);
      demo.appendChild(el);
      samples.push(el);
    }
  const rgba = (v) => {
    const x = v.match(/[\d.]+/g)?.map(Number);
    if (!x || x.length < 3) throw Error("Unexpected computed colour " + v);
    return [
      ...x.slice(0, 3).map((n) => (v.startsWith("color(srgb ") ? n * 255 : n)),
      x[3] ?? 1,
    ];
  };
  const lum = (c) =>
    c
      .slice(0, 3)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const dark of [0, 1]) {
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark);
    await delay(500);
    const ratios = [];
    for (const state of ["plain", "selected", "hover"]) {
      demo.className =
        state === "selected" ? "selected" : state === "hover" ? "hover" : "";
      for (const el of samples) {
        const s = win.getComputedStyle(el),
          bg = rgba(s.backgroundColor),
          fg = rgba(s.color);
        if (bg[3] !== 1)
          throw Error("Auto badge requires opaque native surface");
        const actual = fg
          .slice(0, 3)
          .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
        const a = lum(actual),
          b = lum(bg);
        ratios.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      }
    }
    check(
      `badges.nativeContrast.${dark ? "dark" : "light"}`,
      ratios.every((x) => x >= 4.5),
      `36 samples, min ${Math.min(...ratios).toFixed(2)}:1`,
    );
  }
  demo.remove();
  demo = null;
  const nativePane = doc.querySelector("#zotero-pane");
  const paneStyle = nativePane.getAttribute("style");
  const frame = doc.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
  frame.src = "about:blank";
  doc.documentElement.appendChild(frame);
  await delay(100);
  const binding = dev.dialogTheme.bindSidebarTheme(
    frame.contentWindow,
    nativePane,
  );
  try {
    check(
      "theme.defaultFontMatchesNativePixels",
      frame.contentDocument.documentElement.style.getPropertyValue(
        "--zest-body-font",
      ) === win.getComputedStyle(nativePane).fontSize,
    );
    nativePane.style.setProperty("--zotero-font-size", "20px");
    nativePane.style.fontSize = "20px";
    await delay(50);
    check(
      "theme.visibleNativeFontChange",
      frame.contentDocument.documentElement.style.getPropertyValue(
        "--zest-body-font",
      ) === "20px",
    );
    binding.setActive(false);
    nativePane.style.setProperty("--zotero-font-size", "18px");
    nativePane.style.fontSize = "18px";
    await delay(50);
    check(
      "theme.hiddenFrameDoesNotRefresh",
      frame.contentDocument.documentElement.style.getPropertyValue(
        "--zest-body-font",
      ) === "20px",
    );
    binding.setActive(true);
    check(
      "theme.reactivationUsesCurrentFont",
      frame.contentDocument.documentElement.style.getPropertyValue(
        "--zest-body-font",
      ) === "18px",
    );
  } finally {
    binding.dispose();
    frame.remove();
    if (paneStyle === null) nativePane.removeAttribute("style");
    else nativePane.setAttribute("style", paneStyle);
  }
  dev.matrix.openMatrix(win);
  await delay(1800);
  matrixWin = [...Services.wm.getEnumerator(null)].find((w) =>
    w.document?.querySelector?.(".zest-matrix"),
  );
  const md = matrixWin.document,
    root = md.querySelector(".zest-matrix"),
    filters = md.querySelector(".zest-matrix-filters"),
    toggle = md.querySelector('[aria-controls="matrix-filters"]'),
    comments = md.querySelector(".zest-matrix-comments");
  check(
    "matrix.secondaryControlsInitiallyFolded",
    filters.hidden &&
      filters.contains(comments) &&
      filters.contains(md.querySelector(".zest-matrix-sort")),
  );
  toggle.click();
  comments.checked = true;
  comments.dispatchEvent(new matrixWin.Event("change", { bubbles: true }));
  toggle.click();
  check(
    "matrix.foldedCommentsFilterCounted",
    filters.hidden && toggle.textContent.includes("1"),
  );
  md.querySelector(".zest-matrix-reset").click();
  check(
    "matrix.resetClearsFoldedControls",
    !comments.checked && !toggle.textContent.includes("1"),
  );
  const old = md.documentElement.getAttribute("style");
  for (const font of [14, 20]) {
    md.documentElement.style.setProperty("--zest-body-font", font + "px");
    for (const width of [420, 800]) {
      matrixWin.resizeTo(width, 650);
      await delay(150);
      check(
        `matrix.noHorizontalOverflow.${width}.${font}`,
        root.scrollWidth <= root.clientWidth + 1 &&
          md.documentElement.scrollWidth <= md.documentElement.clientWidth + 1,
        `${root.clientWidth}/${root.scrollWidth}, font ${matrixWin.getComputedStyle(md.querySelector("button")).fontSize}`,
      );
    }
  }
  if (old === null) md.documentElement.removeAttribute("style");
  else md.documentElement.setAttribute("style", old);
} catch (e) {
  check("ui.probeCompleted", false, String(e) + "\n" + e.stack);
} finally {
  demo?.remove();
  matrixWin?.close();
  dev.graphPane.hideGraphPane(win, false);
  for (const [key, value] of saved) {
    if (value === undefined) Zotero.Prefs.clear(key, true);
    else Zotero.Prefs.set(key, value, true);
  }
  if (nativeStyle === null) doc.documentElement.removeAttribute("style");
  else doc.documentElement.setAttribute("style", nativeStyle);
  if (themeHad) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
  if (graphWasVisible) dev.graphPane.showGraphPane(win);
}
return JSON.stringify(out, null, 2);
