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
import { isTreeShown, toggleTagTree } from "../tags/nestedTree";
import { getPref, setPref } from "../utils/prefs";

/**
 * The Zest button in Zotero's item toolbar.
 *
 * Everything Zest opens as a window or a panel used to live in Tools ▸ Zest,
 * which is three clicks away from the item list where you actually are. The
 * button drops a short menu: graph, reading statistics, annotation matrix, the
 * recommended column layout, settings.
 *
 * The icon is the 20px line mark, drawn in Zotero's own toolbar idiom (1.25
 * stroke, `context-fill`) so it inherits the toolbar's colour in both themes
 * instead of sitting there as the one coloured thing in the row.
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
  // Zotero's own menu buttons in this toolbar carry the drop marker; without it
  // the Zest button is the one that does not look clickable-into
  button.setAttribute("wantdropmarker", "true");
  // 20px like Zotero's own item-toolbar icons; the colour comes from
  // `-moz-context-properties` in our stylesheet, not from the file
  button.setAttribute(
    "image",
    `chrome://${config.addonRef}/content/icons/20/zest.svg`,
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
      // the journal columns are empty until Zest may go online, and Settings
      // is the one place a user who just noticed the empty column will not
      // look — so the switch lives next to the layout that shows them
      addItem(
        doc,
        popup,
        getString("menu-rank-fetch", "label"),
        () => setPref("rank.autoFetch", !getPref("rank.autoFetch")),
        { checked: !!getPref("rank.autoFetch") },
      );
      addItem(
        doc,
        popup,
        getString("menu-tagtree", "label"),
        () => toggleTagTree(win),
        { checked: isTreeShown() },
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
