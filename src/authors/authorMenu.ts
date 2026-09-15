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

interface FilterRequest {
  libraryID?: number;
  generation: number;
  scope?: string;
  expectedScope?: string;
  target?: any;
  listener?: () => void;
  unload: () => void;
}

/** Includes pending requests, so clearing before the resolver settles works. */
const requests = new Map<Window, FilterRequest>();
const generations = new WeakMap<Window, number>();
let stopped = false;

/** Zotero 10 exposes plural selection APIs; older hosts have a singular one. */
function collectionScope(win: Window): string | undefined {
  try {
    const zp = (win as any).ZoteroPane;
    const rows = zp?.getCollectionTreeRows
      ? zp.getCollectionTreeRows()
      : [zp?.getCollectionTreeRow?.()];
    if (!Array.isArray(rows) || !rows.length) return undefined;
    const ids = rows.map((row: any) => row?.id);
    if (ids.some((id) => typeof id !== "string" || !id)) return undefined;
    return ids.sort().join("|");
  } catch {
    return undefined;
  }
}

function currentRequest(win: Window, request: FilterRequest): boolean {
  if (
    requests.get(win) !== request ||
    generations.get(win) !== request.generation
  )
    return false;
  if (stopped || !addon.data.alive || win.closed) {
    clearAuthorFilter(win);
    return false;
  }
  const scope = collectionScope(win);
  if (scope !== undefined && scope !== request.scope) {
    if (scope === request.expectedScope) {
      request.scope = scope;
      request.expectedScope = undefined;
    } else {
      clearAuthorFilter(win);
      return false;
    }
  }
  return true;
}

function beginRequest(win: Window): FilterRequest {
  clearAuthorFilter(win);
  const request: FilterRequest = {
    generation: generations.get(win)!,
    scope: collectionScope(win),
    unload: () => clearAuthorFilter(win),
  };
  requests.set(win, request);
  win.addEventListener?.("unload", request.unload);
  try {
    const target = (win as any).ZoteroPane?.collectionsView?.onSelect;
    if (target?.addListener) {
      const listener = guard("author filter auto-clear", () => {
        // Suppress only a known transition to our library root. A user
        // collection switch cancels immediately, including while resolving.
        if (collectionScope(win) === undefined) clearAuthorFilter(win);
        else currentRequest(win, request);
      });
      request.target = target;
      request.listener = listener;
      target.addListener(listener);
    }
  } catch {
    // Scope is also checked after each await if notifications are unavailable.
  }
  return request;
}

/** every window's filter and watcher — plugin shutdown */
export function clearAllAuthorFilters() {
  stopped = true;
  for (const win of [...requests.keys()]) clearAuthorFilter(win);
  cacheRevision++;
  resolverCache.clear();
  resolverBuilds.clear();
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
  generations.set(win, (generations.get(win) ?? 0) + 1);
  const w = requests.get(win);
  if (w) {
    requests.delete(win);
    try {
      w.target?.removeListener?.(w.listener);
    } catch {
      // ignore
    }
    win.removeEventListener?.("unload", w.unload);
  }
  if (activeItemFilters(win).includes(FILTER_NAME)) {
    setItemFilter(win, FILTER_NAME, null);
    if (!stopped && addon.data.alive && !win.closed) void refreshItemView(win);
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
 * The library-wide resolver is expensive on big libraries, so it is built
 * chunked (yielding to the event loop) and cached for a couple of minutes —
 * repeated clicks in the same session are instant, and a just-changed
 * creator is at worst two minutes late.
 */
const resolverCache = new Map<
  number,
  {
    builtAt: number;
    resolver: AuthorResolver;
  }
>();
const resolverBuilds = new Map<number, Promise<AuthorResolver | null>>();
let cacheRevision = 0;
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
          cacheRevision++;
          resolverCache.clear();
          resolverBuilds.clear();
        },
      },
      ["item"],
      "zest-author-filter",
    ) as unknown as string;
  } catch {
    notifierID = null;
  }
}

async function libraryResolver(
  libraryID: number,
): Promise<AuthorResolver | null> {
  const cached = resolverCache.get(libraryID);
  if (cached && Date.now() - cached.builtAt < RESOLVER_TTL_MS) {
    return cached.resolver;
  }
  const pending = resolverBuilds.get(libraryID);
  if (pending) return pending;
  // Register before reading items: changes during a build must invalidate it.
  armCacheInvalidation();
  const revision = cacheRevision;
  const alive = () =>
    !stopped &&
    addon.data.alive &&
    revision === cacheRevision &&
    [...requests].some(
      ([win, request]) =>
        request.libraryID === libraryID && currentRequest(win, request),
    );
  const build = (async () => {
    const all = (await Zotero.Items.getAll(
      libraryID,
      true,
      false,
    )) as Zotero.Item[];
    if (!alive()) return null;
    const resolver = await buildAuthorResolverAsync(
      all.filter((i) => i.isRegularItem()),
      { shouldContinue: alive },
    );
    if (!alive()) return null;
    resolverCache.set(libraryID, { builtAt: Date.now(), resolver });
    return resolver;
  })();
  resolverBuilds.set(libraryID, build);
  try {
    return await build;
  } finally {
    if (resolverBuilds.get(libraryID) === build)
      resolverBuilds.delete(libraryID);
  }
}

/** Show this author's whole library; 0 means no match, cancelled or failed. */
export async function applyAuthorFilter(
  win: Window,
  ref: AuthorRef,
): Promise<number> {
  if (stopped || !addon.data.alive || win.closed) return 0;
  const request = beginRequest(win);
  const zp = (win as any).ZoteroPane;
  // Zotero 10 replaced getSelectedLibraryID() with the plural form
  let libraryID: number = Zotero.Libraries.userLibraryID;
  try {
    const ids = zp?.getSelectedLibraryIDs?.();
    if (Array.isArray(ids) && ids.length) libraryID = ids[0];
  } catch {
    // keep the user library
  }
  try {
    request.libraryID = libraryID;
    const resolver = await libraryResolver(libraryID);
    if (!currentRequest(win, request)) return 0;
    if (!resolver) {
      clearAuthorFilter(win);
      return 0;
    }
    const ids = resolver.memberItemIDs(ref);
    if (!ids.size) {
      clearAuthorFilter(win);
      toast(getString("author-filter-none", { args: { name: ref.label } }));
      return 0;
    }
    // Whole library first. The watcher accepts only this exact row identity,
    // never an arbitrary one-second period of unrelated collection changes.
    request.expectedScope = `L${libraryID}`;
    try {
      await zp?.collectionsView?.selectLibrary?.(libraryID);
      if (!currentRequest(win, request)) return 0;
      await Zotero.Promise.delay(300);
      if (!currentRequest(win, request)) return 0;
    } catch {
      if (!currentRequest(win, request)) return 0;
      // Stay on the current view if the native switch failed.
    }
    request.expectedScope = undefined;
    if (
      !setItemFilter(win, FILTER_NAME, (rows) =>
        rows.filter((i) => ids.has(i.id)),
      )
    ) {
      clearAuthorFilter(win);
      return 0;
    }
    await refreshItemView(win);
    if (!currentRequest(win, request)) return 0;
    toast(
      getString("author-filter-toast", {
        args: { name: ref.label, count: ids.size },
      }),
    );
    return ids.size;
  } catch (e) {
    if (currentRequest(win, request)) clearAuthorFilter(win);
    ztoolkit.log("[author] filter failed", e);
    return 0;
  }
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
