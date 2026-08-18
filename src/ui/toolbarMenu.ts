import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import {
  isGraphVisible,
  toggleGraphPane,
  onGraphVisibilityChange,
} from "../graph/pane";
import { openStatsDialog } from "../panes/statsDialog";
import { openMatrix } from "../panes/annotMatrix";
import { openZestPreferences } from "../modules/menus";
import { applyRecommendedLayout } from "../views/viewGroups";

/**
 * The Zest button in Zotero's item toolbar.
 *
 * Everything Zest opens as a window or a panel used to live in Tools ▸ Zest,
 * which is three clicks away from the item list where you actually are. The
 * button carries the plugin's mark (the only coloured icon in that toolbar, so
 * it is findable) and drops a short menu: graph, reading statistics,
 * annotation matrix, the recommended column layout, settings.
 *
 * It is a plain XUL toolbarbutton with a menupopup child, so keyboard access,
 * theming and the popup arrow are Zotero's, not ours.
 */

const BUTTON_ID = `${config.addonRef}-tb-menu`;
const buttons = new Map<Window, Element>();

function addItem(
  doc: Document,
  popup: Element,
  label: string,
  onCommand: () => void,
  opts: { checked?: boolean } = {},
) {
  const item = doc.createXULElement("menuitem");
  item.setAttribute("label", label);
  if (opts.checked !== undefined) {
    item.setAttribute("type", "checkbox");
    if (opts.checked) item.setAttribute("checked", "true");
  }
  item.addEventListener("command", guard("zest menu", onCommand));
  popup.appendChild(item);
  return item;
}

export function installToolbarMenu(win: Window) {
  onGraphVisibilityChange(syncToolbarMenus);
  if (buttons.has(win)) return;
  const doc = win.document;
  doc.getElementById(BUTTON_ID)?.remove(); // leftover from a hot reload
  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (!toolbar) {
    ztoolkit.log("[toolbar] item toolbar not found — no Zest button");
    return;
  }

  const button = doc.createXULElement("toolbarbutton");
  button.id = BUTTON_ID;
  button.className = "zotero-tb-button";
  button.setAttribute("type", "menu");
  button.setAttribute(
    "image",
    `chrome://${config.addonRef}/content/icons/zest.svg`,
  );
  button.setAttribute("tooltiptext", config.addonName);

  const popup = doc.createXULElement("menupopup");
  popup.id = `${BUTTON_ID}-popup`;
  // rebuilt on every open: the graph's checkbox state and the labels have to
  // be current, and the menu is small enough that rebuilding is free
  popup.addEventListener(
    "popupshowing",
    guard("zest menu build", () => {
      popup.textContent = "";
      addItem(
        doc,
        popup,
        getString("menu-graph", "label"),
        () => toggleGraphPane(win),
        {
          checked: isGraphVisible(win),
        },
      );
      addItem(doc, popup, getString("menu-stats", "label"), () =>
        openStatsDialog(win),
      );
      addItem(doc, popup, getString("menu-matrix", "label"), () =>
        openMatrix(win),
      );
      popup.appendChild(doc.createXULElement("menuseparator"));
      addItem(doc, popup, getString("menu-layout", "label"), () =>
        applyRecommendedLayout(win),
      );
      addItem(doc, popup, getString("menu-settings", "label"), () =>
        openZestPreferences(),
      );
    }),
  );
  button.appendChild(popup);

  // before the spacer, so it stays with the item buttons rather than drifting
  // over to the search box
  const spacer = toolbar.querySelector("spacer");
  toolbar.insertBefore(button, spacer);
  buttons.set(win, button);
}

/** the graph can be toggled from elsewhere; keep the pressed state honest */
export function syncToolbarMenus() {
  for (const [win, button] of buttons) {
    try {
      (button as HTMLElement).classList.toggle(
        "zest-tb-on",
        isGraphVisible(win),
      );
    } catch {
      // window gone
    }
  }
}

export function uninstallToolbarMenu(win: Window) {
  const button = buttons.get(win);
  buttons.delete(win);
  try {
    button?.remove();
    win.document.getElementById(BUTTON_ID)?.remove();
  } catch {
    // window gone
  }
}

export function uninstallAllToolbarMenus() {
  for (const win of [...buttons.keys()]) uninstallToolbarMenu(win);
}

/** exported for the probe */
export function toolbarMenuInstalled(win: Window): boolean {
  return buttons.has(win);
}
