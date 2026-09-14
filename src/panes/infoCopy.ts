import { guard } from "../utils/guard";
import { getString } from "../utils/locale";

const COPYABLE = ".zest-info-copyable";
const NATIVE_CONTROL =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), button:not(.zest-info-author), a, summary';

type CopyPopup = Element & {
  openPopupAtScreen?: (x: number, y: number, contextMenu: boolean) => void;
  hidePopup?: () => void;
};

function elementOf(node: EventTarget | null): Element | null {
  const target = node as Node | null;
  return target?.nodeType === 1
    ? (target as Element)
    : target?.parentElement || null;
}

function nativeControl(node: EventTarget | null): boolean {
  return !!elementOf(node)?.closest(NATIVE_CONTROL);
}

/** Only a selection wholly owned by this pane can replace Zotero's copy. */
export function selectedInfoText(root: HTMLElement): string {
  try {
    const selection = root.ownerDocument?.defaultView?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const node of [range.startContainer, range.endContainer]) {
        if (!root.contains(node) || nativeControl(node)) return "";
      }
    }
    const text = selection.toString();
    return text.trim() ? text : "";
  } catch {
    // Selection can disappear while Zotero replaces or closes the pane.
    return "";
  }
}

function copyText(text: string): boolean {
  try {
    const internal = Zotero.Utilities?.Internal;
    if (typeof internal?.copyTextToClipboard !== "function") return false;
    internal.copyTextToClipboard(text);
    return true;
  } catch (error) {
    ztoolkit.log("[info] copy failed", error);
    return false;
  }
}

/** Owns only this render's handlers and popup; dispose before replacing it. */
export function installInfoCopy(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  if (!doc) return () => {};
  const previousTabIndex = root.getAttribute("tabindex");
  if (previousTabIndex === null) root.setAttribute("tabindex", "0");
  let active = true;
  let closeMenu: (() => void) | undefined;

  const onMouseDown = guard("info copy focus", (event: MouseEvent) => {
    if (
      !active ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      nativeControl(event.target)
    )
      return;
    const target = elementOf(event.target);
    // Prose has no native focus target. Focus the pane before the browser
    // starts selecting so Cmd/Ctrl+C cannot reach the previously focused tree.
    if (target?.closest(COPYABLE) && !target.closest("button")) {
      root.focus({ preventScroll: true });
    }
  });

  const onKeyDown = guard("info copy key", (event: KeyboardEvent) => {
    if (
      !active ||
      event.defaultPrevented ||
      event.key.toLowerCase() !== "c" ||
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      nativeControl(event.target)
    )
      return;
    const text = selectedInfoText(root);
    if (text && copyText(text)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const onContextMenu = guard("info copy menu", (event: MouseEvent) => {
    if (!active) return;
    closeMenu?.();
    if (event.defaultPrevented || nativeControl(event.target)) return;
    const selected = selectedInfoText(root);
    const field = elementOf(event.target)?.closest(
      COPYABLE,
    ) as HTMLElement | null;
    const text =
      selected ||
      (field && root.contains(field)
        ? (field.innerText ?? field.textContent ?? "")
        : "");
    if (
      !text.trim() ||
      typeof doc.createXULElement !== "function" ||
      !doc.documentElement
    )
      return;

    const set = doc.createXULElement("popupset");
    const popup = doc.createXULElement("menupopup") as CopyPopup;
    popup.classList.add("zest-info-copy-menu");
    const command = doc.createXULElement("menuitem");
    if (typeof popup.openPopupAtScreen !== "function") return;
    command.setAttribute(
      "label",
      getString(selected ? "info-copy-selected" : "info-copy-field", "label"),
    );
    popup.appendChild(command);
    set.appendChild(popup);
    let hidden = false;
    const onHidden = () => {
      hidden = true;
      popup.removeEventListener("popuphidden", onHidden);
      set.remove();
      // macOS native menus can hide before delivering the chosen command.
      // Keep that one pending command valid until it runs or its owner resets.
    };
    const cleanup = () => {
      if (closeMenu !== cleanup) return;
      closeMenu = undefined;
      command.removeEventListener("command", onCommand);
      popup.removeEventListener("popuphidden", onHidden);
      try {
        if (!hidden) popup.hidePopup?.();
      } catch (error) {
        ztoolkit.log("[info] copy menu close failed", error);
      } finally {
        set.remove();
      }
    };
    const onCommand = guard("info copy command", () => {
      if (active && closeMenu === cleanup && root.isConnected) copyText(text);
      cleanup();
    });
    command.addEventListener("command", onCommand);
    popup.addEventListener("popuphidden", onHidden);
    closeMenu = cleanup;
    try {
      doc.documentElement.appendChild(set);
      popup.openPopupAtScreen(event.screenX, event.screenY, true);
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      cleanup();
      ztoolkit.log("[info] copy menu failed", error);
    }
  });

  root.addEventListener("mousedown", onMouseDown, true);
  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    if (!active) return;
    active = false;
    closeMenu?.();
    root.removeEventListener("mousedown", onMouseDown, true);
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("contextmenu", onContextMenu, true);
    if (previousTabIndex === null && root.getAttribute("tabindex") === "0") {
      root.removeAttribute("tabindex");
    }
  };
}
