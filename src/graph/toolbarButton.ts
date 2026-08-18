import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import {
  isGraphVisible,
  toggleGraphPane,
  onGraphVisibilityChange,
} from "./pane";

/**
 * A toolbar button that opens and closes the graph.
 *
 * The graph already has a menu entry and a keyboard route, but it is the one
 * panel people flip on and off constantly, and a menu is two clicks away. The
 * button sits with Zotero's own item-tree buttons (same `zotero-tb-button`
 * class, same `context-fill` icon), so it inherits Zotero's toolbar metrics
 * and both themes for free — and it is removed again on teardown.
 */

const BUTTON_ID = `${config.addonRef}-tb-graph`;
const buttons = new Map<Window, Element>();

export function installGraphButton(win: Window) {
  onGraphVisibilityChange(syncGraphButtons);
  if (buttons.has(win)) return;
  const doc = win.document;
  doc.getElementById(BUTTON_ID)?.remove(); // leftover from a hot reload
  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (!toolbar) {
    ztoolkit.log("[graph] item toolbar not found — no button");
    return;
  }
  const button = doc.createXULElement("toolbarbutton");
  button.id = BUTTON_ID;
  button.className = "zotero-tb-button";
  button.setAttribute(
    "image",
    `chrome://${config.addonRef}/content/icons/graph.svg`,
  );
  button.setAttribute("tooltiptext", getString("graph-toggle-tip"));
  button.addEventListener(
    "command",
    guard("graph button", () => toggleGraphPane(win)),
  );
  // before the spacer, so it stays with the item buttons rather than drifting
  // over to the search box
  const spacer = toolbar.querySelector("spacer");
  toolbar.insertBefore(button, spacer);
  buttons.set(win, button);
  syncGraphButton(win);
}

/** reflect the pane's state, however it was toggled */
export function syncGraphButton(win: Window) {
  const button = buttons.get(win);
  if (!button) return;
  const on = isGraphVisible(win);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  (button as HTMLElement).classList.toggle("zest-tb-on", on);
}

export function syncGraphButtons() {
  for (const win of buttons.keys()) syncGraphButton(win);
}

export function uninstallGraphButton(win: Window) {
  const button = buttons.get(win);
  buttons.delete(win);
  try {
    button?.remove();
    win.document.getElementById(BUTTON_ID)?.remove();
  } catch {
    // window gone
  }
}

export function uninstallAllGraphButtons() {
  for (const win of [...buttons.keys()]) uninstallGraphButton(win);
}
