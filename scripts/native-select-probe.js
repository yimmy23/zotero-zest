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
let matrix, stats, frame, embedded;
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
async function settled(win = matrix) {
  for (let i = 0; i < 80; i++) {
    if (
      win.document
        .querySelector(".zest-matrix-list")
        ?.getAttribute("aria-busy") === "false"
    )
      return;
    await delay(40);
  }
  throw Error("matrix did not settle");
}
function popupWindow(win) {
  // Gecko creates HTML-select popups in the owning chrome window, including
  // when the select itself lives in a sidebar iframe.
  return win.browsingContext.topChromeWindow;
}
async function openPopup(win, select, name) {
  const chromeWin = popupWindow(win);
  for (let i = 0; i < 60 && !win.document.hasFocus(); i++) {
    chromeWin.focus();
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
    popup = chromeWin.document.querySelector("#ContentSelectDropdownPopup");
    if (popup?.state === "open") break;
    await delay(30);
  }
  check(name + " native popup opens", popup?.state === "open");
  const style = chromeWin.getComputedStyle(popup);
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
  // Zotero's main-window popup patch fades menus for 200 ms. Wait for the
  // actual native dismissal before inspecting state or removing an iframe.
  for (let i = 0; i < 60; i++) {
    if (popup.state === "closed" && !select.matches(":open")) break;
    await delay(25);
  }
  const menulist = popupWindow(win).document.querySelector(
    "#ContentSelectDropdown",
  );
  const state = {
    popup: popup.state,
    selectOpen: select.matches(":open"),
    menuHidden: menulist.hidden,
    hiddenAttribute: menulist.getAttribute("hidden"),
    menuDisplay: popupWindow(win).getComputedStyle(menulist).display,
    selectValue: select.value,
    selectedIndex: select.selectedIndex,
    selectFocused: win.document.activeElement === select,
    documentFocused: win.document.hasFocus(),
  };
  const dismissed =
    state.popup === "closed" && !state.selectOpen && state.menuHidden;
  check(
    name +
      " dismisses without residue" +
      (dismissed ? "" : " " + JSON.stringify(state)),
    dismissed,
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
          if (select.disabled) {
            check(
              name + " unavailable choices disabled",
              select.options.length === 1 ||
                select.classList.contains("zest-matrix-sort"),
            );
            continue;
          }
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
  // The issue was reported in the sidebar. A standalone-only popup check
  // misses Gecko's different chrome owner for HTML iframe documents.
  frame = host.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "iframe",
  );
  frame.style.cssText =
    "position:fixed;inset:40px 10px 10px auto;width:380px;z-index:2147483647;border:0";
  frame.src = "chrome://zest/content/panel.xhtml";
  host.document.documentElement.append(frame);
  for (let i = 0; i < 100; i++) {
    if (
      frame.contentWindow?.location.href === frame.src &&
      frame.contentDocument?.readyState === "complete"
    )
      break;
    await delay(40);
  }
  check(
    "embedded matrix host loaded",
    frame.contentDocument?.readyState === "complete",
  );
  const fixtures = [0, 1].map((index) => {
    const id = 900000001 + index * 10;
    const attachment = {
      id,
      key: `MXTEST0${index}`,
      libraryID: Zotero.Libraries.userLibraryID,
      isRegularItem: () => false,
      isAttachment: () => true,
      isAnnotation: () => false,
      getField: () => `Selector fixture ${index}`,
      getAnnotations: () =>
        [0, 1].map((mark) => ({
          id: id + mark + 1,
          key: `MXANN0${index}${mark}`,
          parentItemID: id,
          libraryID: Zotero.Libraries.userLibraryID,
          isAnnotation: () => true,
          annotationText: `Fixture ${index} mark ${mark}`,
          annotationComment: mark ? "Comment" : "",
          annotationType: mark ? "underline" : "highlight",
          annotationColor: mark ? "#a28ae5" : "#ffd400",
          annotationPageLabel: String(mark + 1),
          annotationPosition: JSON.stringify({ pageIndex: mark }),
          getTags: () => [{ tag: mark ? "Results" : "Methods" }],
        })),
    };
    return attachment;
  });
  const embeddedWin = frame.contentWindow;
  embedded = dev.matrix.mountMatrix(embeddedWin, host, {
    allowViewScope: true,
    getItems: () => fixtures,
  });
  await settled(embeddedWin);
  embeddedWin.document.querySelector(".zest-matrix-filter-toggle").click();
  for (const dark of [false, true]) {
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
    await delay(100);
    for (const select of embeddedWin.document.querySelectorAll(
      ".zest-matrix select",
    )) {
      select.scrollIntoView({ block: "nearest" });
      const name = `embedded ${dark ? "dark" : "light"} ${select.className}`;
      check(name + " has choices", select.options.length > 1);
      const original = select.value;
      const index = select.selectedIndex === 0 ? 1 : 0;
      const expected = select.options[index].value;
      const popup = await openPopup(embeddedWin, select, name);
      popup.activateItem(popup.querySelectorAll("menuitem")[index]);
      for (let i = 0; i < 30 && select.value !== expected; i++) await delay(40);
      await settled(embeddedWin);
      check(
        name + " selection reaches HTML control",
        select.value === expected,
      );
      await closePopup(embeddedWin, select, popup, name);
      if (
        ["item", "type", "color", "tag"].some((key) =>
          select.classList.contains(`zest-matrix-${key}`),
        )
      ) {
        check(
          name + " filters actual rows",
          embeddedWin.document.querySelectorAll(".zest-matrix-row").length ===
            2,
        );
      }
      embeddedWin.document.querySelector(".zest-matrix-reset").click();
      select.value = original;
      select.dispatchEvent(new embeddedWin.Event("change", { bubbles: true }));
      await settled(embeddedWin);
      check(
        name + " reset restores fixture rows",
        embeddedWin.document.querySelectorAll(".zest-matrix-row").length === 4,
      );
    }
  }
  embedded.dispose();
  embedded = undefined;
  frame.remove();
  frame = undefined;
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
  embedded?.dispose();
  frame?.remove();
  matrix?.close();
  stats?.close();
  Services.locale.requestedLocales = oldRequested;
  addon.data.locale.current = oldLocale;
  if (hadTheme) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
}
