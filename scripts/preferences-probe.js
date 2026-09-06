/** Run in the isolated DEV Zotero: scripts/dev-eval.sh -f scripts/preferences-probe.js.
 * Keep native XUL control internals outside our card/row layout rules. */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const check = (name, pass, note) => {
  (pass ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const pane = Zotero.PreferencePanes.pluginPanes.find(
  (entry) => entry.pluginID === "zest@zotero-zest.app",
);
Zotero.Utilities.Internal.openPreferences(pane.id);
let win;
let root;
for (let attempt = 0; attempt < 50; attempt++) {
  await Zotero.Promise.delay(100);
  win = Array.from(Services.wm.getEnumerator("zotero:pref"))[0];
  root = win?.document.getElementById("zest-prefs");
  if (root?.querySelector(".button-box")) break;
}
if (!root) throw new Error("Zest preferences did not load");
await Zotero.Promise.delay(100);
const buttons = Array.from(root.querySelectorAll("groupbox button")).filter(
  (button) => button.querySelector(".button-box") && button.clientWidth > 0,
);
check(
  "preferences.nativeButtonBoxesUntouched",
  buttons.length > 0 &&
    buttons.every((button) => {
      const style = win.getComputedStyle(button.querySelector(".button-box"));
      return (
        parseFloat(style.marginTop) === 0 &&
        parseFloat(style.marginBottom) === 0 &&
        style.flexWrap === "nowrap"
      );
    }),
  `${buttons.length} native buttons`,
);
check(
  "preferences.buttonLabelsInsideControls",
  buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    const text = button.querySelector(".button-text").getBoundingClientRect();
    return text.top >= bounds.top && text.bottom <= bounds.bottom;
  }),
);
const checkboxes = Array.from(root.querySelectorAll(".checkbox-label-box"));
check(
  "preferences.nativeCheckboxBoxesUntouched",
  checkboxes.length > 0 &&
    checkboxes.every((box) => {
      const style = win.getComputedStyle(box);
      return (
        parseFloat(style.marginTop) === 0 &&
        parseFloat(style.marginBottom) === 0 &&
        style.flexWrap === "nowrap"
      );
    }),
);
const headings = Array.from(root.querySelectorAll("groupbox h2"));
check(
  "preferences.cardHeadingsNoDoubleSpacing",
  headings.length > 0 &&
    headings.every((heading) => {
      const group = heading.closest("groupbox");
      return (
        parseFloat(win.getComputedStyle(heading).marginTop) === 0 &&
        heading.getBoundingClientRect().top -
          group.getBoundingClientRect().top <=
          18
      );
    }),
);
const originalStyle = root.getAttribute("style");
try {
  root.style.maxWidth = "420px";
  check(
    "preferences.narrowPaneNoOverflow",
    root.scrollWidth <= root.clientWidth + 1 &&
      buttons.every((button) => {
        const bounds = button.getBoundingClientRect();
        const row = button.parentElement.getBoundingClientRect();
        return bounds.left >= row.left - 1 && bounds.right <= row.right + 1;
      }),
    `${root.clientWidth}/${root.scrollWidth}px`,
  );
} finally {
  if (originalStyle === null) root.removeAttribute("style");
  else root.setAttribute("style", originalStyle);
}
return JSON.stringify(out, null, 2);
