/** Real native-popup acceptance. Open the matrix and activate the isolated process first. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !Zotero.DataDirectory.dir.endsWith("/.scaffold/dev-data")
)
  throw Error("isolated development instance required");
const host = Zotero.getMainWindow();
const delay = (ms) => Zotero.Promise.delay(ms);
const report = { ok: [] };
const check = (name, condition) => {
  if (!condition) throw Error(name);
  report.ok.push(name);
};
const oldLocale = addon.data.locale.current;
const oldRequested = [...Services.locale.requestedLocales];
const hadTheme = Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme");
const oldTheme = Services.prefs.getIntPref("ui.systemUsesDarkTheme", 0);
let matrix, stats;
async function windowFor(selector) {
  for (let i = 0; i < 80; i++) {
    const win = [...Services.wm.getEnumerator("")].find((w) =>
      w.document?.querySelector(selector),
    );
    if (win) return win;
    await delay(50);
  }
  throw Error("window did not open: " + selector);
}
async function settled() {
  for (let i = 0; i < 80; i++) {
    if (
      matrix.document
        .querySelector(".zest-matrix-list")
        ?.getAttribute("aria-busy") === "false"
    )
      return;
    await delay(40);
  }
  throw Error("matrix did not settle");
}
async function openPopup(win, select, name) {
  for (let i = 0; i < 60 && !win.document.hasFocus(); i++) {
    win.focus();
    await delay(50);
  }
  select.focus();
  if (!win.document.hasFocus())
    throw Error(
      `activate the isolated Zotero process before ${name}; ${report.ok.length} checks completed`,
    );
  check(name + " HTML select", select instanceof win.HTMLSelectElement);
  const activation = win.windowUtils.setHandlingUserInput(true);
  try {
    select.showPicker();
  } finally {
    activation.destruct();
  }
  let popup;
  for (let i = 0; i < 30; i++) {
    popup = win.document.querySelector("#ContentSelectDropdownPopup");
    if (popup?.state === "open") break;
    await delay(30);
  }
  check(name + " native popup opens", popup?.state === "open");
  const style = win.getComputedStyle(popup);
  const rect = popup.getOuterScreenRect();
  check(
    name + " native popup has surface and bounds",
    style.appearance !== "none" &&
      !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) &&
      rect.width > 0 &&
      rect.height > 0,
  );
  check(
    name + " one menu entry per option",
    popup.querySelectorAll("menuitem").length === select.options.length,
  );
  return popup;
}
async function closePopup(win, select, popup, name) {
  popup.hidePopup();
  await delay(100);
  check(
    name + " dismisses without residue",
    popup.state === "closed" &&
      !select.matches(":open") &&
      win.document.querySelector("#ContentSelectDropdown").hidden,
  );
}
try {
  dev.stats.closeStatsDialog();
  dev.matrix.openMatrix(host);
  matrix = await windowFor(".zest-matrix");
  await settled();
  for (const lang of ["zh-CN", "en-US"]) {
    Services.locale.requestedLocales = [lang];
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
    dev.matrix.render(matrix);
    await settled();
    for (const dark of [false, true]) {
      Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
      for (const width of [360, 1100]) {
        matrix.resizeTo(width, 800);
        const doc = matrix.document;
        doc.documentElement.style.fontSize = "20px";
        const filters = doc.querySelector(".zest-matrix-filters");
        if (filters.hidden)
          doc.querySelector(".zest-matrix-filter-toggle").click();
        await delay(100);
        const selects = [...doc.querySelectorAll(".zest-matrix select")];
        check("six matrix selectors", selects.length === 6);
        for (const select of selects) {
          select.scrollIntoView({ block: "nearest" });
          const name = `${lang} ${dark ? "dark" : "light"} ${width} ${select.className}`;
          const original = select.value;
          const popup = await openPopup(matrix, select, name);
          // Use the real XUL popup activation path, not a synthetic change.
          const index = select.options.length > 1 ? 1 : 0;
          const expected = select.options[index].value;
          popup.activateItem(popup.querySelectorAll("menuitem")[index]);
          for (let i = 0; i < 30 && select.value !== expected; i++)
            await delay(40);
          await settled();
          check(
            name + " selection reaches HTML control",
            select.value === expected,
          );
          await closePopup(matrix, select, popup, name);
          select.value = original;
          select.dispatchEvent(new matrix.Event("change", { bubbles: true }));
          await settled();
        }
        check(
          `${lang} ${dark} ${width} no document overflow`,
          doc.documentElement.scrollWidth <=
            doc.documentElement.clientWidth + 1,
        );
      }
    }
  }
  dev.stats.openStatsDialog(host);
  stats = await windowFor(".zest-stats");
  for (const dark of [false, true]) {
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
    const selects = [
      ...stats.document.querySelectorAll(".zest-goal-controls select"),
    ];
    check("two statistics selectors", selects.length === 2);
    for (const select of selects) {
      const original = select.value;
      const name = `statistics ${dark} ${select.dataset.focus}`;
      const popup = await openPopup(stats, select, name);
      await closePopup(stats, select, popup, name);
      check(name + " goal unchanged", select.value === original);
    }
  }
  check(
    "statistics keeps rem baseline",
    stats.getComputedStyle(stats.document.documentElement).fontSize === "16px",
  );
  return report;
} finally {
  matrix?.close();
  stats?.close();
  Services.locale.requestedLocales = oldRequested;
  addon.data.locale.current = oldLocale;
  if (hadTheme) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
}
