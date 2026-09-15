/** Rounded controls and citation-key discoverability in the isolated Zotero UI. */
if (!String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile"))
  throw Error("Isolated dev profile required");
const win = Zotero.getMainWindow();
const out = { ok: [], fail: [], notes: [] };
const delay = (ms) => Zotero.Promise.delay(ms);
const check = (name, condition, note) => {
  (condition ? out.ok : out.fail).push(name);
  if (note !== undefined) out.notes.push(`${name}: ${JSON.stringify(note)}`);
};
const rounded = (name, nodes) => {
  const controls = [...nodes];
  const wrong = controls.filter((node) =>
    [
      "borderTopLeftRadius",
      "borderTopRightRadius",
      "borderBottomLeftRadius",
      "borderBottomRightRadius",
    ].some(
      (corner) =>
        node.ownerDocument.defaultView.getComputedStyle(node)[corner] !== "8px",
    ),
  );
  check(name, controls.length > 0 && !wrong.length, {
    count: controls.length,
    wrong: wrong.map((node) => node.id || node.className || node.localName),
  });
};
let prefsWin;
let prefsStyle;
let ratingWin;
let statsWin;
const hadTheme = Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme");
const oldTheme = Services.prefs.getIntPref("ui.systemUsesDarkTheme", 0);
try {
  const pane = Zotero.PreferencePanes.pluginPanes.find(
    (p) => p.pluginID === "zest@zotero-zest.app",
  );
  Zotero.Utilities.Internal.openPreferences(pane.id);
  for (let i = 0; i < 50; i++) {
    await delay(100);
    prefsWin = [...Services.wm.getEnumerator("zotero:pref")].find((w) =>
      w.document.getElementById("zest-prefs")?.querySelector(".zest-pref-jump"),
    );
    if (prefsWin) break;
  }
  const root = prefsWin.document.getElementById("zest-prefs");
  prefsStyle = root.getAttribute("style");
  prefsWin.document
    .querySelector('link[href^="chrome://zest/content/preferences.css"]')
    .setAttribute(
      "href",
      "chrome://zest/content/preferences.css?journal-ui-probe",
    );
  await delay(250);
  for (const dark of [0, 1]) {
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark);
    await delay(250);
    for (const font of [13, 20]) {
      root.style.width = "320px";
      root.style.maxWidth = "320px";
      root.style.fontSize = font + "px";
      root.style.setProperty("--zotero-font-size", font + "px");
      rounded(
        `preferences.rounded.${dark}.${font}`,
        root.querySelectorAll("button, summary"),
      );
    }
  }
  rounded(
    "mainWindow.rounded",
    win.document.querySelectorAll(
      ".zest-info button, .zest-info summary, .zest-annot-cards button, #zest-tb-menu",
    ),
  );
  check(
    "citationKey.rowIsDiscoverable",
    !!win.document.querySelector(".zest-info-citation-key"),
  );

  dev.stats.openStatsDialog(win);
  await delay(1500);
  statsWin = [...Services.wm.getEnumerator(null)].find((w) =>
    w.document?.querySelector?.(".zest-stats"),
  );
  rounded(
    "readingStats.rounded",
    statsWin.document.querySelectorAll("button, summary"),
  );
  const goals = [
    ...statsWin.document.querySelectorAll(".zest-goal-controls select"),
  ];
  check(
    "readingStats.singleSelectArrow",
    goals.length === 2 &&
      goals.every((node) => {
        const style = statsWin.getComputedStyle(node);
        return (
          style.appearance === "none" &&
          style.paddingRight === "28px" &&
          !node.classList.contains("zest-flat-btn")
        );
      }),
  );

  dev.ratingImportUI.openRatingImport(win, [Zotero.Items.get(1)]);
  await delay(1000);
  ratingWin = [...Services.wm.getEnumerator(null)].find((w) =>
    w.document?.querySelector?.(".zest-rating-import"),
  );
  rounded(
    "ratingImport.rounded",
    ratingWin.document.querySelectorAll("button"),
  );
  check(
    "ratingImport.confirmUsesSharedControl",
    ratingWin.document.querySelectorAll(
      ".zest-rating-import-actions > .zest-flat-btn",
    ).length === 2,
  );
} catch (error) {
  check("probeCompleted", false, String(error) + "\n" + error.stack);
} finally {
  const root = prefsWin?.document.getElementById("zest-prefs");
  if (root && prefsStyle !== undefined) {
    if (prefsStyle === null) root.removeAttribute("style");
    else root.setAttribute("style", prefsStyle);
  }
  statsWin?.close();
  dev.ratingImportUI.closeRatingImport(win);
  if (hadTheme) Services.prefs.setIntPref("ui.systemUsesDarkTheme", oldTheme);
  else Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
}
return JSON.stringify(out, null, 2);
