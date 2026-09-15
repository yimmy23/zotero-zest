import { cache } from "../core/storage";
import { getPref, getNumPref } from "../utils/prefs";
import { mutateExtraText } from "../utils/extra";
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
  cleanDOI,
  pmidOf,
  type CiteResult,
  type CiteFailure,
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
let stopped = false;
let serviceEpoch = 0;
const requests = new Map<string, symbol>();

export function startCitations(): void {
  stopped = false;
  serviceEpoch++;
  requests.clear();
}

/** Invalidate pending responses synchronously, before async shutdown work. */
export function stopCitations(): void {
  stopped = true;
  serviceEpoch++;
  requests.clear();
}

export interface UpdateOutcome {
  item: Zotero.Item;
  info?: CitationInfo;
  status:
    | "updated"
    | "unchanged"
    | "no-id"
    | "not-found"
    | "failed"
    | "throttled"
    | "cancelled";
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
  onFailure?: CiteFailure,
  shouldContinue?: () => boolean,
) => Promise<CiteResult | null>;

function sourceChain(): CiteSource[] {
  const chain: CiteSource[] = [];
  if (getPref("cite.useCrossref") !== false) chain.push(fetchCrossref);
  if (getPref("cite.useOpenAlex") !== false) chain.push(fetchOpenAlexCitations);
  if (getPref("cite.useSemanticScholar")) chain.push(fetchSemanticScholar);
  return chain;
}

function identityOf(item: Zotero.Item): string {
  return JSON.stringify([
    item.libraryID,
    item.key,
    cleanDOI(item).toLowerCase(),
    pmidOf(item),
  ]);
}

/** fetch one item's count and write it into Extra */
export async function updateCitations(
  item: Zotero.Item,
  force = false,
  shouldContinue: () => boolean = () => true,
): Promise<UpdateOutcome> {
  const epoch = serviceEpoch;
  const itemKey = `${item.libraryID}/${item.key}`;
  const identity = identityOf(item);
  const request = Symbol();
  requests.set(itemKey, request);
  const valid = () => {
    try {
      return (
        !stopped &&
        epoch === serviceEpoch &&
        requests.get(itemKey) === request &&
        !item.deleted &&
        item.isRegularItem() &&
        item.isEditable() &&
        identityOf(item) === identity &&
        shouldContinue()
      );
    } catch {
      return false;
    }
  };
  try {
    return await updateCurrentCitations(item, force, identity, valid);
  } finally {
    if (requests.get(itemKey) === request) requests.delete(itemKey);
  }
}

async function updateCurrentCitations(
  item: Zotero.Item,
  force: boolean,
  identity: string,
  valid: () => boolean,
): Promise<UpdateOutcome> {
  if (!valid()) return { item, status: "cancelled" };
  if (!hasIdentifier(item)) return { item, status: "no-id" };
  if (!force) {
    const age = cache.ageOf(NS, identity);
    if (age !== undefined && age < FAILURE_TTL) {
      return { item, info: readCitations(item), status: "failed" };
    }
  }
  let result: CiteResult | null = null;
  let failed = false;
  let throttled = false;
  const onFailure: CiteFailure = (failure) => {
    failed = true;
    if (failure.kind === "throttled" || failure.kind === "unreachable")
      throttled = true;
  };
  for (const fetchOne of sourceChain()) {
    if (!valid()) return { item, status: "cancelled" };
    try {
      result = await fetchOne(item, force, onFailure, valid);
    } catch (e) {
      ztoolkit.log("[cite] source failed", e);
      result = null;
      failed = true;
    }
    if (!valid()) return { item, status: "cancelled" };
    if (result) break;
  }
  if (!result) {
    // "nobody knows this item" and "nobody could be asked" are different
    // answers: a throttled or unreachable source must not be remembered as a
    // miss for six hours, and a batch should stop on it instead of spending
    // the rest of the selection on refusals
    if (throttled) return { item, status: "throttled" };
    if (failed) return { item, status: "failed" };
    cache.set(NS, identity, { t: Date.now() });
    return { item, status: "not-found" };
  }
  cache.remove(NS, identity);

  const info = {
    count: result.count,
    source: result.source,
    date: todayISO(),
  };
  const line = formatCitationLine(info);
  try {
    const changed = await mutateExtraText(
      item,
      (extra) => {
        const previous = readCitations(item);
        if (
          previous?.count === info.count &&
          previous.source === info.source &&
          previous.date === info.date
        )
          return null;
        return withCitationLine(extra, line);
      },
      valid,
    );
    if (!valid()) return { item, status: "cancelled" };
    return { item, info, status: changed ? "updated" : "unchanged" };
  } catch (e) {
    ztoolkit.log("[cite] could not write Extra", e);
    return { item, status: "failed" };
  }
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
