/** Compact JCR details: real isolated sidebar, no popup or network. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw new Error("Isolated profile required");
const out = { ok: [], fail: [], notes: [] };
const check = (name, pass, note) => {
  (pass ? out.ok : out.fail).push(name);
  if (note !== undefined) out.notes.push({ name, note });
};
const outputPath =
  typeof probeOutputPath === "string"
    ? probeOutputPath
    : PathUtils.join(PathUtils.tempDir, "zest-jcr-sidebar-probe");
await IOUtils.makeDirectory(outputPath, { ignoreExisting: true });
const win = Zotero.getMainWindow(),
  doc = win.document;
const stored = new Map(),
  items = [];
const selected = win.ZoteroPane.getSelectedItems().map((i) => i.id);
const scope = win.ZoteroPane.collectionsView?.selectedTreeRow?.id;
const locale = [...Services.locale.requestedLocales];
const set = (name, value) => {
  const key = `extensions.zotero.zest.${name}`;
  stored.set(key, {
    user: Services.prefs.prefHasUserValue(key),
    value: Zotero.Prefs.get(key, true),
  });
  Zotero.Prefs.set(key, value, true);
};
const themeKey = "ui.systemUsesDarkTheme";
const hadTheme = Services.prefs.prefHasUserValue(themeKey),
  theme = Services.prefs.getIntPref(themeKey, 0);
const request = dev.httpMod.http.requestResult;
let requests = 0;
const pause = (ms = 100) => Zotero.Promise.delay(ms);
const visible = () =>
  [...doc.querySelectorAll("details.zest-info-jcr")].find(
    (e) => e.getClientRects().length,
  );
const select = async (item, name) => {
  await win.ZoteroPane.selectItem(item.id);
  for (let i = 0; i < 50; i++) {
    const metrics = visible();
    if (
      metrics?.textContent.includes(name) &&
      metrics
        .closest(".zest-info-venue-block")
        ?.querySelector(".zest-info-venue-name")?.textContent ===
        item.getField("publicationTitle")
    )
      return metrics;
    await pause();
  }
  throw new Error(`No visible JCR details for ${name}`);
};
const shot = async (metrics, name) => {
  const block = metrics.closest(".zest-info-venue-block") || metrics;
  block.scrollIntoView({ block: "center" });
  await pause();
  const r = block.getBoundingClientRect(),
    scale = win.devicePixelRatio || 1;
  const c = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  c.width = Math.round((r.width + 12) * scale);
  c.height = Math.round((r.height + 12) * scale);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawWindow(
    win,
    r.left - 6,
    r.top - 6,
    r.width + 12,
    r.height + 12,
    "rgb(255,255,255)",
  );
  await IOUtils.write(
    PathUtils.join(outputPath, name + ".png"),
    Uint8Array.from(atob(c.toDataURL().split(",")[1]), (c) => c.charCodeAt(0)),
  );
};
try {
  set("info.enable", true);
  set("rank.autoFetch", false);
  set("info.affiliations.autoFetch", false);
  set("if.field", "sciif");
  dev.httpMod.http.requestResult = async () => {
    requests++;
    return { kind: "cancelled", status: 0 };
  };
  for (const [journal, issn] of [
    ["Cancer Immunology, Immunotherapy : CII", "0340-7004, 1432-0851"],
    ["Journal of Clinical Oncology", ""],
  ]) {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Zest compact JCR acceptance fixture");
    item.setField("publicationTitle", journal);
    item.setField("ISSN", issn);
    item.setField("extra", "Custom: retained");
    await item.saveTx();
    items.push(item);
  }
  await dev.reveal.clearZestFilters(win);
  let metrics = await select(items[0], "IMMUNOLOGY");
  check("defaultCollapsed", metrics.open === false);
  check(
    "yearAndCategoryCount",
    /2025/.test(metrics.firstElementChild.textContent) &&
      /2/.test(metrics.firstElementChild.textContent),
  );
  check("noRepeatedIFOrQuartile", !/IF|Q[1-4]|5\.8/.test(metrics.textContent));
  check(
    "allCategoriesPresent",
    metrics.querySelectorAll(".zest-info-jcr-category").length === 2,
  );
  check("noSidebarProvenance", !metrics.textContent.includes("ShowJCR"));
  check(
    "noHoverAttributes",
    metrics.querySelectorAll("[tooltip],[tooltiptext],[title]").length === 0,
  );
  metrics.querySelector("summary").click();
  await pause();
  check(
    "summaryClickExpands",
    metrics.open &&
      metrics.querySelector(".zest-info-jcr-values").getClientRects().length >
        0,
  );
  check(
    "twoMetricsPerCategory",
    [...metrics.querySelectorAll(".zest-info-jcr-values")].every(
      (e) =>
        e.querySelectorAll("dt").length === 2 &&
        e.querySelectorAll("dd").length === 2,
    ),
  );
  check(
    "allRanksVisible",
    /40\s*\/\s*183/.test(metrics.textContent) &&
      /67\s*\/\s*333/.test(metrics.textContent),
  );
  const before = metrics.style.cssText;
  metrics.style.width = "220px";
  metrics.style.maxWidth = "100%";
  check(
    "narrowSidebarWraps",
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${metrics.clientWidth}/${metrics.scrollWidth}`,
  );
  metrics.style.cssText = before;
  dev.infoSection.refreshInfoSections(items[0].id);
  await pause(200);
  check("expandedAfterRefresh", visible()?.open === true);
  metrics = await select(items[1], "ONCOLOGY");
  await pause(100);
  check("expandedAfterItemSwitch", metrics.open === true);
  metrics.querySelector("summary").click();
  await pause();
  metrics = await select(items[0], "IMMUNOLOGY");
  check("collapsedAfterItemSwitch", metrics.open === false);
  for (const lang of ["zh-CN", "en-US"]) {
    Services.locale.requestedLocales = [lang];
    await pause(300);
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
    dev.infoSection.refreshInfoSections(items[0].id);
    await pause(200);
    metrics = visible();
    const summary = metrics.querySelector("summary").textContent;
    check(
      `${lang}Summary`,
      summary.includes("2025") &&
        (lang === "zh-CN"
          ? summary.includes("2 个学科")
          : summary.includes("2 categories")),
      summary,
    );
    for (const dark of [false, true]) {
      Services.prefs.setIntPref(themeKey, dark ? 1 : 0);
      await pause(300);
      metrics.open = false;
      await pause();
      await shot(metrics, `jcr-${lang}-${dark ? "dark" : "light"}-collapsed`);
      metrics.open = true;
      await pause();
      await shot(metrics, `jcr-${lang}-${dark ? "dark" : "light"}-expanded`);
    }
  }
  metrics.open = false;
  await pause();
  check("noNetwork", requests === 0);
  check(
    "extraUntouched",
    items.every((i) => i.getField("extra") === "Custom: retained"),
  );
} catch (e) {
  out.fail.push(String(e));
  out.notes.push(String(e.stack));
} finally {
  const cleanup = async (name, action) => {
    try {
      await action();
    } catch (e) {
      out.fail.push(`Cleanup ${name}: ${e}`);
    }
  };
  dev.httpMod.http.requestResult = request;
  await cleanup("locale", () => {
    Services.locale.requestedLocales = locale;
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
  });
  await cleanup("fixtures", async () => {
    for (const item of items) if (item.id) await Zotero.Items.erase(item.id);
  });
  for (const [key, v] of stored)
    await cleanup(key, () => {
      if (v.user) Zotero.Prefs.set(key, v.value, true);
      else Services.prefs.clearUserPref(key);
    });
  await cleanup("theme", () => {
    if (hadTheme) Services.prefs.setIntPref(themeKey, theme);
    else Services.prefs.clearUserPref(themeKey);
  });
  await cleanup("scope", async () => {
    if (scope) await win.ZoteroPane.collectionsView.selectByID(scope);
  });
  await cleanup("selection", async () => {
    if (selected.length) await win.ZoteroPane.selectItems(selected);
  });
}
return out;
