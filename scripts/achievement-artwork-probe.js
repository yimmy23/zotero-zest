// Local, in-memory demonstration data only; never persist reading records.
if (
  !PathUtils.profileDir.endsWith("/.scaffold/dev-profile") ||
  !Zotero.DataDirectory.dir.endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated profile required");
const host = Zotero.getMainWindow();
if (
  [...Services.wm.getEnumerator("")].some((w) =>
    w.document?.querySelector(".zest-stats-standalone"),
  )
)
  throw Error("Close existing dev statistics before this probe");
const report = { checks: [], screenshots: [] };
const check = (name, value) => {
  if (!value) throw Error(name);
  report.checks.push(name);
};
const delay = (ms) => Zotero.Promise.delay(ms);
const oldEntries = dev.readingStore.entries;
const oldLocale = addon.data.locale.current;
const oldRequested = [...Services.locale.requestedLocales];
const themeKey = "ui.systemUsesDarkTheme";
const hadTheme = Services.prefs.prefHasUserValue(themeKey),
  oldTheme = Services.prefs.getIntPref(themeKey, 0);
let win;
const day = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
const records = Array.from({ length: 12 }, (_, i) => {
  const days = new Map();
  for (let j = 0; j < 7; j++) {
    const d = new Date();
    d.setDate(d.getDate() - j);
    days.set(day(d), 600);
  }
  return [`1/ARTDEMO${i}`, { total: 4200, days, page: new Map([[0, 4200]]) }];
});
try {
  dev.stats.openStatsDialog(host);
  for (let i = 0; i < 60; i++) {
    await delay(50);
    win = [...Services.wm.getEnumerator("")].find((w) =>
      w.document?.querySelector(".zest-stats-standalone"),
    );
    if (win) break;
  }
  check("standalone opened", !!win);
  for (const language of ["zh-CN", "en-US"]) {
    Services.locale.requestedLocales = [language];
    await delay(150);
    addon.data.locale.current = new Localization(["zest-addon.ftl"], true);
    for (const theme of ["light", "dark"]) {
      Services.prefs.setIntPref(themeKey, theme === "dark" ? 1 : 0);
      win.resizeTo(1060, 800);
      try {
        dev.readingStore.entries = () => records[Symbol.iterator]();
        dev.stats.renderStats(win);
      } finally {
        dev.readingStore.entries = oldEntries;
      }
      const doc = win.document,
        grid = doc.querySelector(".zest-achievements");
      grid.scrollIntoView();
      await Promise.all(
        [...grid.querySelectorAll("img")].map(async (img) => {
          // Ensure all demonstration art loads for the screenshot; production
          // retains lazy loading for off-screen medals.
          img.loading = "eager";
          try {
            await img.decode();
          } catch (error) {
            throw Error(`${img.src}: ${error}`);
          }
        }),
      );
      await delay(180);
      check(
        `${language} ${theme} nine loaded 192px medals`,
        [...grid.querySelectorAll("img")].length === 9 &&
          [...grid.querySelectorAll("img")].every(
            (img) => img.naturalWidth === 192 && img.naturalHeight === 192,
          ),
      );
      check(
        `${language} ${theme} three local assets`,
        new Set([...grid.querySelectorAll("img")].map((img) => img.src))
          .size === 3,
      );
      check(
        `${language} ${theme} locked and unlocked styles`,
        !!grid.querySelector(".is-unlocked") &&
          !!grid.querySelector(".is-next"),
      );
      check(
        `${language} ${theme} semantic image decoration`,
        [...grid.querySelectorAll("img")].every(
          (img) =>
            img.alt === "" &&
            img.parentElement.getAttribute("aria-hidden") === "true",
        ),
      );
      const rect = grid.getBoundingClientRect(),
        canvas = doc.createElement("canvas"),
        scale = 2;
      canvas.width = Math.ceil(rect.width * scale);
      canvas.height = Math.ceil(rect.height * scale);
      const context = canvas.getContext("2d");
      context.scale(scale, scale);
      context.drawWindow(
        win,
        rect.x + win.scrollX,
        rect.y + win.scrollY,
        rect.width,
        rect.height,
        "rgb(255,255,255)",
      );
      const path = PathUtils.join(
        PathUtils.parent(Zotero.DataDirectory.dir),
        `achievement-artwork-${language}-${theme}.png`,
      );
      await IOUtils.write(
        path,
        Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
          c.charCodeAt(0),
        ),
      );
      report.screenshots.push(path);
      win.resizeTo(420, 800);
      await delay(150);
      check(
        `${language} ${theme} narrow medals do not clip`,
        doc.documentElement.scrollWidth <=
          doc.documentElement.clientWidth + 1 &&
          [
            ...grid.querySelectorAll(
              ".zest-achievement-heading,.zest-achievement-rule",
            ),
          ].every((node) => node.scrollWidth <= node.clientWidth + 1),
      );
    }
  }
  check("reading source restored", dev.readingStore.entries === oldEntries);
  return report;
} finally {
  dev.readingStore.entries = oldEntries;
  if (win && !win.closed) win.close();
  Services.locale.requestedLocales = oldRequested;
  addon.data.locale.current = oldLocale;
  if (hadTheme) Services.prefs.setIntPref(themeKey, oldTheme);
  else Services.prefs.clearUserPref(themeKey);
}
