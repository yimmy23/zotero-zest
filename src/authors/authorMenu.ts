import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import {
  activeItemFilters,
  refreshItemView,
  setItemFilter,
} from "../views/itemFilter";
import { buildAuthorResolverAsync } from "../graph/authorIdentity";
import type { AuthorResolver } from "../graph/authorIdentity";
import type { AuthorLookupRef } from "../graph/authorIdentity";

/**
 * The one author menu every surface opens: clicking a name in the Zest
 * panel's author line, or an author node in the graph. Two families of
 * actions on the same person:
 *   - filter the LIBRARY down to their items — identity comes from the same
 *     clustering the author graph uses (Wang Lei stays separate from
 *     Wang Li), not from a string search;
 *   - online lookups (Google Scholar, PubMed, OpenAlex, Semantic Scholar) —
 *     with a cached OpenAlex id the OpenAlex entry opens the author's
 *     disambiguated profile directly.
 *
 * The filter rides the shared getItems pipeline (views/itemFilter) under the
 * name "author"; it clears itself when the user changes collections, from
 * the menu, or with the toast still explaining the state.
 */

export interface AuthorRef extends AuthorLookupRef {
  /** display name for headers and toasts */
  label: string;
}

const FILTER_NAME = "author";

/** per-window auto-clear: the filter dies with the next collection switch */
const watchers = new Map<Window, { target: any; listener: () => void }>();

function armAutoClear(win: Window) {
  if (watchers.has(win)) return;
  try {
    const target = (win as any).ZoteroPane?.collectionsView?.onSelect;
    if (!target?.addListener) return;
    const armedAt = Date.now();
    const listener = guard("author filter auto-clear", () => {
      // the collection switch WE made (over to the library root) can settle
      // after the fixed post-switch delay on a slow library — its own
      // onSelect must not wipe the filter that was just applied
      if (Date.now() - armedAt < 1000) return;
      clearAuthorFilter(win);
    });
    target.addListener(listener);
    watchers.set(win, { target, listener });
  } catch {
    // no listener API — the menu's clear entry still works
  }
}

/** every window's filter and watcher — plugin shutdown */
export function clearAllAuthorFilters() {
  for (const win of [...watchers.keys()]) clearAuthorFilter(win);
  resolverCache = null;
  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch {
      // already gone
    }
    notifierID = null;
  }
}

export function clearAuthorFilter(win: Window) {
  const w = watchers.get(win);
  if (w) {
    try {
      w.target.removeListener?.(w.listener);
    } catch {
      // ignore
    }
    watchers.delete(win);
  }
  if (activeItemFilters(win).includes(FILTER_NAME)) {
    setItemFilter(win, FILTER_NAME, null);
    void refreshItemView(win);
  }
}

function toast(text: string) {
  try {
    const pw = new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: false,
    });
    pw.createLine({ text, type: "default" });
    pw.show();
    pw.startCloseTimer(4000);
  } catch {
    // cosmetic only
  }
}

/**
 * Show the whole library filtered down to this author's items.
 * Returns how many items matched (0 = nothing found, no filter applied).
 */
/**
 * The library-wide resolver is expensive on big libraries, so it is built
 * chunked (yielding to the event loop) and cached for a couple of minutes —
 * repeated clicks in the same session are instant, and a just-changed
 * creator is at worst two minutes late.
 */
let resolverCache: {
  libraryID: number;
  builtAt: number;
  resolver: AuthorResolver;
} | null = null;
const RESOLVER_TTL_MS = 2 * 60 * 1000;

/** any item change invalidates the cached clustering — a freshly added
 *  paper must be filterable immediately, not after the TTL runs out */
let notifierID: string | null = null;
function armCacheInvalidation() {
  if (notifierID) return;
  try {
    notifierID = Zotero.Notifier.registerObserver(
      {
        notify: () => {
          resolverCache = null;
        },
      },
      ["item"],
      "zest-author-filter",
    ) as unknown as string;
  } catch {
    notifierID = null;
  }
}

async function libraryResolver(libraryID: number): Promise<AuthorResolver> {
  if (
    resolverCache &&
    resolverCache.libraryID === libraryID &&
    Date.now() - resolverCache.builtAt < RESOLVER_TTL_MS
  ) {
    return resolverCache.resolver;
  }
  const all = (await Zotero.Items.getAll(
    libraryID,
    true,
    false,
  )) as Zotero.Item[];
  const resolver = await buildAuthorResolverAsync(
    all.filter((i) => i.isRegularItem()),
  );
  resolverCache = { libraryID, builtAt: Date.now(), resolver };
  armCacheInvalidation();
  return resolver;
}

export async function applyAuthorFilter(
  win: Window,
  ref: AuthorRef,
): Promise<number> {
  const zp = (win as any).ZoteroPane;
  // Zotero 10 replaced getSelectedLibraryID() with the plural form
  let libraryID: number = Zotero.Libraries.userLibraryID;
  try {
    const ids = zp?.getSelectedLibraryIDs?.();
    if (Array.isArray(ids) && ids.length) libraryID = ids[0];
  } catch {
    // keep the user library
  }
  const resolver = await libraryResolver(libraryID);
  const ids = resolver.memberItemIDs(ref);
  if (!ids.size) {
    toast(getString("author-filter-none", { args: { name: ref.label } }));
    return 0;
  }
  // whole library first ("all their items", not "their items in this
  // folder") — and only THEN arm the auto-clear, or the switch itself
  // would wipe the filter we are about to set
  try {
    await zp?.collectionsView?.selectLibrary?.(libraryID);
    await Zotero.Promise.delay(300);
  } catch {
    // stay on the current view
  }
  setItemFilter(win, FILTER_NAME, (rows) => rows.filter((i) => ids.has(i.id)));
  armAutoClear(win);
  await refreshItemView(win);
  toast(
    getString("author-filter-toast", {
      args: { name: ref.label, count: ids.size },
    }),
  );
  return ids.size;
}

// ------------------------------------------------------------ online links

function scholarURL(ref: AuthorRef): string {
  const name = [ref.given, ref.family].filter(Boolean).join(" ") || ref.label;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(`author:"${name}"`)}`;
}

function pubmedURL(ref: AuthorRef): string {
  const term = [ref.family, ref.given].filter(Boolean).join(" ") || ref.label;
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`${term}[Author]`)}`;
}

function openAlexURL(ref: AuthorRef): string {
  if (ref.oaId) return `https://openalex.org/${ref.oaId}`;
  const name = [ref.given, ref.family].filter(Boolean).join(" ") || ref.label;
  return `https://openalex.org/authors?filter=${encodeURIComponent(`display_name.search:${name}`)}`;
}

function semanticURL(ref: AuthorRef): string {
  const name = [ref.given, ref.family].filter(Boolean).join(" ") || ref.label;
  return `https://www.semanticscholar.org/search?q=${encodeURIComponent(name)}&sort=relevance`;
}

// ------------------------------------------------------------------- menu

/** fill an existing XUL menupopup with the author actions */
export function appendAuthorMenuItems(
  win: Window,
  popup: Element,
  ref: AuthorRef,
) {
  const doc = win.document;
  const xul = (name: string) => (doc as any).createXULElement(name) as Element;
  const add = (label: string, fn: () => void) => {
    const mi = xul("menuitem");
    mi.setAttribute("label", label);
    mi.addEventListener("command", guard("author menu", fn));
    popup.appendChild(mi);
    return mi;
  };

  const header = xul("menuitem");
  header.setAttribute("label", ref.label);
  header.setAttribute("disabled", "true");
  popup.appendChild(header);
  popup.appendChild(xul("menuseparator"));

  add(getString("author-menu-filter"), () => {
    void applyAuthorFilter(win, ref);
  });
  if (activeItemFilters(win).includes(FILTER_NAME)) {
    add(getString("author-menu-clear"), () => clearAuthorFilter(win));
  }
  popup.appendChild(xul("menuseparator"));
  add(getString("author-menu-scholar"), () =>
    Zotero.launchURL(scholarURL(ref)),
  );
  add(getString("author-menu-pubmed"), () => Zotero.launchURL(pubmedURL(ref)));
  add(getString("author-menu-openalex"), () =>
    Zotero.launchURL(openAlexURL(ref)),
  );
  add(getString("author-menu-s2"), () => Zotero.launchURL(semanticURL(ref)));
}

const POPUPSET_ID = "zest-popupset";

/** standalone popup (panel author names); graph reuses its own popup */
export function openAuthorMenu(
  win: Window,
  ref: AuthorRef,
  at: { screenX: number; screenY: number },
): boolean {
  const doc = win.document;
  let set = doc.getElementById(POPUPSET_ID);
  if (!set) {
    try {
      set = (doc as any).createXULElement("popupset");
      set!.id = POPUPSET_ID;
      doc.documentElement?.appendChild(set!);
    } catch {
      return false;
    }
  }
  const popup = (doc as any).createXULElement("menupopup") as any;
  popup.addEventListener("popuphidden", () => popup.remove());
  appendAuthorMenuItems(win, popup, ref);
  set!.appendChild(popup);
  try {
    popup.openPopupAtScreen(at.screenX + 1, at.screenY + 1, false);
  } catch (e) {
    ztoolkit.log("[author] menu failed", e);
    popup.remove();
    return false;
  }
  return true;
}
