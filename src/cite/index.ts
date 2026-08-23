import { cache } from "../core/storage";
import { http } from "../core/http";
import { getPref, getNumPref } from "../utils/prefs";
import {
  readCitations,
  formatCitationLine,
  withCitationLine,
  todayISO,
  type CitationInfo,
} from "./extraFormat";
import {
  fetchCrossref,
  fetchOpenAlexCitations,
  fetchSemanticScholar,
  hasIdentifier,
  type CiteResult,
} from "./sources";

/**
 * Citation counts.
 *
 * The number lives in the item's Extra field, not in a plugin database: it is
 * a fact about the paper, it syncs, other plugins read it, and it survives
 * uninstalling Zest. The column therefore reads Extra (O(1), no cache to go
 * stale) and only the FETCH is asynchronous.
 *
 * Nothing is fetched automatically: a count that silently changes under the
 * user is worse than a stale one, and auto-fetching a 5000-item library would
 * hammer three public APIs. The user asks for it per selection, or for
 * everything that is older than `cite.staleDays`.
 */

const NS = "cite-fail";
/** how long a failed lookup is left alone */
const FAILURE_TTL = 6 * 3600 * 1000;

export interface UpdateOutcome {
  item: Zotero.Item;
  info?: CitationInfo;
  status:
    "updated" | "unchanged" | "no-id" | "not-found" | "failed" | "throttled";
}

export function citationOf(item: Zotero.Item): CitationInfo | undefined {
  return readCitations(item);
}

/** true when the recorded count is older than the staleness threshold */
export function isStale(item: Zotero.Item): boolean {
  const info = readCitations(item);
  if (!info) return true;
  if (!info.date) return true;
  const days = Math.max(1, getNumPref("cite.staleDays", 90));
  const age = Date.now() - new Date(info.date).getTime();
  return !Number.isFinite(age) || age > days * 24 * 3600 * 1000;
}

type CiteSource = (
  item: Zotero.Item,
  force?: boolean,
) => Promise<CiteResult | null>;

function sourceChain(): CiteSource[] {
  const chain: CiteSource[] = [];
  if (getPref("cite.useCrossref") !== false) chain.push(fetchCrossref);
  if (getPref("cite.useOpenAlex") !== false) chain.push(fetchOpenAlexCitations);
  if (getPref("cite.useSemanticScholar")) chain.push(fetchSemanticScholar);
  return chain;
}

function failKey(item: Zotero.Item): string {
  return `${item.libraryID}/${item.key}`;
}

/** fetch one item's count and write it into Extra */
export async function updateCitations(
  item: Zotero.Item,
  force = false,
): Promise<UpdateOutcome> {
  if (!hasIdentifier(item)) return { item, status: "no-id" };
  if (!force) {
    const age = cache.ageOf(NS, failKey(item));
    if (age !== undefined && age < FAILURE_TTL) {
      return { item, info: readCitations(item), status: "failed" };
    }
  }
  let result: CiteResult | null = null;
  for (const fetchOne of sourceChain()) {
    try {
      result = await fetchOne(item, force);
    } catch (e) {
      ztoolkit.log("[cite] source failed", e);
      result = null;
    }
    if (result) break;
  }
  if (!result) {
    // "nobody knows this item" and "nobody could be asked" are different
    // answers: a throttled or unreachable source must not be remembered as a
    // miss for six hours, and a batch should stop on it instead of spending
    // the rest of the selection on refusals
    if (sourcesThrottled()) return { item, status: "throttled" };
    cache.set(NS, failKey(item), { t: Date.now() });
    return { item, status: "not-found" };
  }
  cache.remove(NS, failKey(item));

  const previous = readCitations(item);
  const line = formatCitationLine({
    count: result.count,
    source: result.source,
    date: todayISO(),
  });
  if (previous?.count === result.count && previous.date === todayISO()) {
    return { item, info: previous, status: "unchanged" };
  }
  try {
    const extra = (item.getField("extra") as string) || "";
    item.setField("extra", withCitationLine(extra, line));
    await item.saveTx();
  } catch (e) {
    ztoolkit.log("[cite] could not write Extra", e);
    return { item, status: "failed" };
  }
  return {
    item,
    info: { count: result.count, source: result.source, date: todayISO() },
    status: "updated",
  };
}

/** items of a selection that are worth asking about */
export function citableItems(
  items: Zotero.Item[],
  onlyStale: boolean,
): Zotero.Item[] {
  return items.filter((item) => {
    try {
      if (!item.isRegularItem() || !item.isEditable()) return false;
      if (!hasIdentifier(item)) return false;
      return onlyStale ? isStale(item) : true;
    } catch {
      return false;
    }
  });
}

/** true when a citation source has just told us to back off, or the network is down */
export function sourcesThrottled(): boolean {
  return (
    http.recentlyUnreachable() ||
    http.throttledFor("https://api.crossref.org/") > 0 ||
    http.throttledFor("https://api.openalex.org/") > 0 ||
    http.throttledFor("https://api.semanticscholar.org/") > 0
  );
}
