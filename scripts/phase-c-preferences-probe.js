/**
 * Phase C native preferences acceptance; run sequentially in the isolated DEV:
 *   scripts/dev-eval.sh -f scripts/phase-c-preferences-probe.js
 * Only opens preferences and activates local section jumps. No field edits,
 * provider actions, network calls or preference writes. Layout overrides,
 * disclosure state, focus and scroll positions are restored in finally.
 */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const check = (name, condition, note) => {
  (condition ? out.ok : out.fail).push(name);
  if (note !== undefined) out.notes.push(`${name}: ${JSON.stringify(note)}`);
};
const delay = (ms) => Zotero.Promise.delay(ms);
let isolated = false;
try {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  isolated =
    /[\\/]\.scaffold[\\/]dev-profile$/.test(profile) &&
    /[\\/]\.scaffold[\\/]dev-data$/.test(Zotero.DataDirectory.dir);
} catch {
  // Refuse to operate when the profile cannot be verified.
}
check("preferences.isolatedDevelopmentProfile", isolated);
if (!isolated) return JSON.stringify(out, null, 2);

let win;
let root;
let doc;
let originalRootStyle;
let originalDocumentStyle;
let originalFocus;
const scrollPositions = [];
const disclosures = [];
const restoreStyle = (element, value) => {
  if (value === null) element.removeAttribute("style");
  else element.setAttribute("style", value);
};
const labelFor = (control) =>
  String(control.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc.getElementById(id));
const idOf = (element) =>
  element.id || element.getAttribute("data-l10n-id") || element.localName;
const visible = (element) => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};
const inside = (child, parent, vertical = false) => {
  const a = child.getBoundingClientRect();
  const b = parent.getBoundingClientRect();
  return (
    a.left >= b.left - 2 &&
    a.right <= b.right + 2 &&
    (!vertical || (a.top >= b.top - 2 && a.bottom <= b.bottom + 2))
  );
};
const outsideText = (element, parent) => {
  const bounds = parent.getBoundingClientRect();
  const range = doc.createRange();
  range.selectNodeContents(element);
  return Array.from(range.getClientRects()).some(
    (box) => box.left < bounds.left - 2 || box.right > bounds.right + 2,
  );
};

try {
  const pane = Zotero.PreferencePanes.pluginPanes.find(
    (entry) => entry.pluginID === "zest@zotero-zest.app",
  );
  if (!pane) throw new Error("Zest preference pane is not registered");
  Zotero.Utilities.Internal.openPreferences(pane.id);
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(100);
    win = Array.from(Services.wm.getEnumerator("zotero:pref")).find(
      (candidate) => candidate.document.getElementById("zest-prefs"),
    );
    root = win?.document.getElementById("zest-prefs");
    if (
      root?.querySelector(".button-box") &&
      root.querySelectorAll(".zest-pref-jump").length === 19
    )
      break;
  }
  if (!root) throw new Error("Zest preferences did not load");
  doc = win.document;
  await doc.l10n?.ready;
  await delay(150);
  originalRootStyle = root.getAttribute("style");
  originalDocumentStyle = doc.documentElement.getAttribute("style");
  originalFocus = doc.activeElement;
  for (let element = root; element; element = element.parentElement) {
    scrollPositions.push([element, element.scrollLeft, element.scrollTop]);
  }
  for (const element of root.querySelectorAll("details")) {
    disclosures.push([element, element.open]);
  }

  const inputs = Array.from(root.querySelectorAll("input"));
  const menus = Array.from(root.querySelectorAll("menulist"));
  const controls = [...inputs, ...menus];
  check(
    "preferences.allAuthoredControlsPresent",
    inputs.length === 35 && menus.length === 11,
    {
      inputs: inputs.length,
      menus: menus.length,
    },
  );
  const invalidLabels = controls.filter((control) => {
    const labels = labelFor(control);
    return (
      !labels.length ||
      labels.some((label) => !label || !label.textContent.trim()) ||
      (control.localName === "input" &&
        !labels.some((label) => label.getAttribute("for") === control.id))
    );
  });
  check(
    "preferences.associatedLocalizedLabels",
    invalidLabels.length === 0,
    invalidLabels.map(idOf),
  );

  // Gecko's native accessibility tree supplies the name exposed to assistive
  // technology; matching DOM IDs alone is not reported as native verification.
  let accessibility;
  try {
    accessibility = Cc["@mozilla.org/accessibilityService;1"].getService(
      Ci.nsIAccessibilityService,
    );
    await delay(150);
  } catch (error) {
    out.notes.push(
      `Native accessibility service unavailable: ${String(error)}`,
    );
  }
  check("preferences.nativeAccessibilityServiceAvailable", !!accessibility);
  if (accessibility) {
    const missingNames = [];
    const wrongNames = [];
    for (const control of controls) {
      let name = "";
      try {
        name = String(
          accessibility.getAccessibleFor(control)?.name || "",
        ).trim();
      } catch {
        // Record the control ID, never its input value or stored API key.
      }
      if (!name) missingNames.push(idOf(control));
      else if (
        !labelFor(control).some(
          (label) => label && name.includes(label.textContent.trim()),
        )
      ) {
        wrongNames.push(idOf(control));
      }
    }
    check(
      "preferences.allControlsHaveNativeAccessibleNames",
      missingNames.length === 0,
      missingNames,
    );
    check(
      "preferences.nativeNamesUseAssociatedLabels",
      wrongNames.length === 0,
      wrongNames,
    );
  }

  const groups = Array.from(root.querySelectorAll(".zest-pref-nav-group"));
  const jumps = Array.from(root.querySelectorAll(".zest-pref-jump"));
  const headings = Array.from(root.querySelectorAll(":scope > groupbox h2"));
  check(
    "preferences.fiveNamedNavigationGroups",
    groups.length === 5 &&
      groups.every((group) =>
        labelFor(group).some((label) => label?.textContent.trim()),
      ),
    groups.length,
  );
  const headingIDs = headings.map((heading) =>
    heading.getAttribute("data-l10n-id"),
  );
  const jumpIDs = jumps.map((jump) => jump.getAttribute("data-l10n-id"));
  check(
    "preferences.nineteenUniqueSectionLinks",
    headings.length === 19 &&
      jumps.length === 19 &&
      new Set(jumpIDs).size === 19 &&
      headingIDs.every((id) => jumpIDs.includes(id)),
    {
      headings: headings.length,
      links: jumps.length,
    },
  );
  const focusFailures = [];
  for (const jump of jumps) {
    const heading = headings.find(
      (candidate) =>
        candidate.getAttribute("data-l10n-id") ===
        jump.getAttribute("data-l10n-id"),
    );
    jump.focus({ preventScroll: true });
    jump.click();
    await delay(15);
    if (!heading || doc.activeElement !== heading || heading.tabIndex !== -1)
      focusFailures.push(idOf(jump));
  }
  check(
    "preferences.sectionJumpsMoveKeyboardFocus",
    focusFailures.length === 0,
    focusFailures,
  );

  for (const [disclosure] of disclosures) disclosure.open = true;
  check(
    "preferences.syntaxHelpRemainsDiscoverable",
    disclosures.length === 2 &&
      disclosures.every(
        ([element]) =>
          element.querySelector("summary")?.textContent.trim() &&
          element.querySelector("description")?.textContent.trim() &&
          !element.querySelector("[preference]"),
      ),
  );

  const nativeButtons = Array.from(
    root.querySelectorAll("groupbox button"),
  ).filter((button) => button.querySelector(".button-box"));
  const nativeCheckboxes = Array.from(
    root.querySelectorAll(":scope > groupbox > checkbox"),
  );
  const nativeBoxes = Array.from(
    root.querySelectorAll(".button-box, .checkbox-label-box"),
  );
  const rowChildren = Array.from(
    root.querySelectorAll(
      ":scope > groupbox > hbox > input, :scope > groupbox > hbox > menulist, :scope > groupbox > hbox > button, :scope > groupbox > hbox > label",
    ),
  );
  const labels = Array.from(
    root.querySelectorAll(":scope > groupbox > hbox > label"),
  );

  for (const font of ["default", "20px"]) {
    restoreStyle(doc.documentElement, originalDocumentStyle);
    for (const width of [320, 420]) {
      restoreStyle(root, originalRootStyle);
      root.style.setProperty("box-sizing", "border-box", "important");
      root.style.setProperty("width", `${width}px`, "important");
      root.style.setProperty("max-width", `${width}px`, "important");
      root.style.setProperty("min-width", "0", "important");
      if (font === "20px") {
        doc.documentElement.style.setProperty("font-size", font, "important");
        doc.documentElement.style.setProperty(
          "--zotero-font-size",
          font,
          "important",
        );
        root.style.setProperty("font-size", font, "important");
      }
      await delay(100);
      const scenario = `preferences.${width}px.${font}`;
      const bounds = root.getBoundingClientRect();
      check(
        `${scenario}.requestedContentWidth`,
        Math.abs(bounds.width - width) <= 2,
        {
          requested: width,
          actual: bounds.width,
          viewport: win.innerWidth,
          font: win.getComputedStyle(root).fontSize,
        },
      );
      check(
        `${scenario}.noHorizontalOverflow`,
        root.scrollWidth <= root.clientWidth + 2,
        { client: root.clientWidth, scroll: root.scrollWidth },
      );
      const escapedControls = rowChildren.filter(
        (element) =>
          visible(element) && !inside(element, element.parentElement),
      );
      check(
        `${scenario}.controlsStayInsideRows`,
        escapedControls.length === 0,
        escapedControls.map(idOf),
      );
      const escapedLabels = labels.filter(
        (label) => visible(label) && outsideText(label, label.parentElement),
      );
      check(
        `${scenario}.labelTextStaysInsideRows`,
        escapedLabels.length === 0,
        escapedLabels.map(idOf),
      );
      const escapedJumps = jumps.filter(
        (jump) =>
          visible(jump) && (!inside(jump, root) || outsideText(jump, root)),
      );
      check(
        `${scenario}.navigationTextStaysInsidePane`,
        escapedJumps.length === 0,
        escapedJumps.map(idOf),
      );
      const buttonLabelFailures = nativeButtons.filter((button) => {
        const label = button.querySelector(".button-text");
        return visible(button) && (!label || !inside(label, button, true));
      });
      check(
        `${scenario}.nativeButtonLabelsInsideControls`,
        buttonLabelFailures.length === 0,
        buttonLabelFailures.map(idOf),
      );
      const checkboxLabelFailures = nativeCheckboxes.filter((checkbox) => {
        const label = checkbox.querySelector(".checkbox-label-box");
        return (
          visible(checkbox) &&
          (!label || !inside(label, checkbox, true) || !inside(label, root))
        );
      });
      check(
        `${scenario}.nativeCheckboxLabelsInsideControls`,
        nativeCheckboxes.length > 0 && checkboxLabelFailures.length === 0,
        checkboxLabelFailures.map(idOf),
      );
      const pollutedBoxes = nativeBoxes.filter((box) => {
        const style = win.getComputedStyle(box);
        return (
          parseFloat(style.marginTop) !== 0 ||
          parseFloat(style.marginBottom) !== 0 ||
          style.flexWrap !== "nowrap"
        );
      });
      check(
        `${scenario}.nativeXULInternalRowsUntouched`,
        nativeBoxes.length > 0 && pollutedBoxes.length === 0,
        {
          checked: nativeBoxes.length,
          failed: pollutedBoxes.map((box) =>
            idOf(box.closest("button, checkbox") || box),
          ),
        },
      );
    }
  }
} catch (error) {
  check("preferences.probeCompleted", false, String(error));
} finally {
  if (root && originalRootStyle !== undefined)
    restoreStyle(root, originalRootStyle);
  if (doc && originalDocumentStyle !== undefined)
    restoreStyle(doc.documentElement, originalDocumentStyle);
  for (const [element, open] of disclosures) element.open = open;
  try {
    if (originalFocus?.isConnected)
      originalFocus.focus({ preventScroll: true });
    for (const [element, left, top] of scrollPositions) {
      element.scrollLeft = left;
      element.scrollTop = top;
    }
  } catch (error) {
    out.notes.push(`Focus/scroll restoration: ${String(error)}`);
  }
  if (root && originalRootStyle !== undefined) {
    check(
      "preferences.layoutOverridesRestored",
      root.getAttribute("style") === originalRootStyle &&
        doc.documentElement.getAttribute("style") === originalDocumentStyle,
    );
  }
}
return JSON.stringify(out, null, 2);
