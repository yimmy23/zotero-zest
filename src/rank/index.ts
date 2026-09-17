import { cache } from "../core/storage";
import { http } from "../core/http";
import { getPref, getNumPref } from "../utils/prefs";
import { setTimeout, clearTimeout } from "../utils/timers";
import {
  normalizeJournal,
  normalizeISSN,
  allISSNs,
  journalLookupName,
  journalCatalogIdentity,
  JOURNAL_LOOKUP_VERSION,
  legacyJournalNameKey,
  rankableVenueOf,
} from "./normalize";
import { validatedRank } from "./rank";
import { parseRewriteRules, applyRewrite } from "./map";
import type { JournalRecord, RankValue } from "./types";
import { matchingJCRMetadata, sanitizeJCRMetadata } from "./impactFactor";
import { datasetsLoaded, lookupDatasetRecord } from "./sources/localDataset";
import { fetchEasyScholar, easyScholarBlocked } from "./sources/easyscholar";
import {
  fetchOpenAlexByISSN,
  fetchOpenAlexByDOI,
  fetchOpenAlexByName,
  type OpenAlexJournal,
} from "./sources/openalex";

/**
 * Journal ranks, one record per JOURNAL (not per item).
 *
 * Identity chain: the item's ISSN → its DOI (free OpenAlex singleton) →
 * the normalised journal name.
 * Metric chain: local dataset (offline, user-owned) → easyScholar (needs a
 * key, only source for the Chinese systems) → OpenAlex (keyless, citation
 * average labelled as such).
 *
 * Everything is cached in zest-cache.json under the ISSN (or exact normalised
 * name when an ISSN is absent), so a
 * library with 400 papers in 60 journals does 60 lookups, not 400 — and none
 * at all on the next launch. Column dataProviders read the local dataset
 * index and memory cache; only remote cache misses depend on auto-fetch.
 */

const NS = "rank";
/** v1 separated verified aliases from requested IDs; newer lookup rules retain that evidence. */
const VERIFIED_ISSN_CACHE_VERSION = 1;
/** how long a "looked, found nothing" answer suppresses another lookup */
const MISS_TTL = 12 * 3600 * 1000;
/** how long a FAILED lookup (offline, rate limited) suppresses a retry */
const FAILURE_TTL = 10 * 60 * 1000;

let onReady: ((itemIDs: number[]) => void) | undefined;
/** cacheKey → epoch ms of the last attempt that failed for network reasons */
const failures = new Map<string, number>();
const queue = new Map<string, Set<number>>();
let queueTimer: number | undefined;
let fetching = false;
let serviceEpoch = 0;
let stopped = false;

export function startRankService(refresh: (itemIDs: number[]) => void) {
  stopped = false;
  onReady = refresh;
  cache.configure(NS, 4000);
}

export function stopRankService() {
  stopped = true;
  serviceEpoch++;
  onReady = undefined;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = undefined;
  }
  queue.clear();
  refreshPartial.clear();
}

function ttlMs(): number {
  return Math.max(1, getNumPref("rank.ttlDays", 30)) * 24 * 3600 * 1000;
}

function sanitizeRecord(raw: unknown): JournalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if (typeof r.key !== "string" || !r.key) return null;
  const values: RankValue[] = [];
  let jifSource: unknown;
  if (Array.isArray(r.values)) {
    for (const v of r.values.slice(0, 80)) {
      if (!v || typeof v.field !== "string" || typeof v.value !== "string")
        continue;
      if (v.field.length > 60 || v.value.length > 120) continue;
      if (
        v.field.toLowerCase() === "sciif" &&
        !values.some((entry) => entry.field.toLowerCase() === "sciif")
      )
        jifSource = v.source;
      values.push({
        field: v.field,
        value: v.value,
        rank: validatedRank(v.field, v.value, v.rank),
        source: ["dataset", "easyscholar", "openalex"].includes(v.source)
          ? v.source
          : "dataset",
      });
    }
  }
  const jcr = sanitizeJCRMetadata(r.jcr);
  return {
    key: r.key,
    name: typeof r.name === "string" ? r.name : r.key,
    issn: typeof r.issn === "string" ? r.issn : undefined,
    issns: Array.isArray(r.issns)
      ? ([
          ...new Set(
            r.issns
              .slice(0, 20)
              .map((id: unknown) =>
                typeof id === "string" ? normalizeISSN(id) : "",
              )
              .filter(Boolean),
          ),
        ] as string[])
      : undefined,
    values,
    // Legacy metrics may default an unknown source to dataset, but that does
    // not establish the provenance needed to attach JCR category percentiles.
    jcr:
      jcr?.source === jifSource ? matchingJCRMetadata(jcr, values) : undefined,
    updated: Number(r.updated) || 0,
    misses: Array.isArray(r.misses) ? r.misses.slice(0, 4) : undefined,
    partial: r.partial === true ? true : undefined,
    lookupVersion: Number.isInteger(r.lookupVersion) ? r.lookupVersion : 0,
    requestedISSNs: Array.isArray(r.requestedISSNs)
      ? ([
          ...new Set(
            r.requestedISSNs
              .slice(0, 20)
              .filter((id: unknown) => typeof id === "string")
              .map(normalizeISSN)
              .filter(Boolean),
          ),
        ] as string[])
      : undefined,
  };
}

/** identity of an item's journal, computed synchronously from its fields */
export function journalKeyOf(item: Zotero.Item): {
  key: string;
  nameKey: string;
  name: string;
  /** conservative name sent to external journal services */
  queryName: string;
  issn: string;
  issns: string[];
  catalogISSNs: string[];
  doi: string;
} {
  let name = "";
  let issn = "";
  let issns: string[] = [];
  let doi = "";
  try {
    name = rankableVenueOf(item);
    issns = allISSNs((item.getField("ISSN") as string) || "");
    issn = issns[0] || "";
    doi = String(item.getField("DOI") || "").trim();
  } catch {
    // unloaded item
  }
  let queryName = journalLookupName(name);
  const rawCatalog = journalCatalogIdentity(name);
  const catalog = journalCatalogIdentity(queryName);
  const catalogMatches =
    catalog && issns.every((id) => catalog.issns.includes(id));
  // A known title with contradictory identifiers cannot identify a journal:
  // neither its title's metrics nor the other ISSN's metrics are trustworthy.
  // An empty key blocks local/cache reads, remote requests and batch queues.
  const conflictingIdentity =
    (!!catalog && !catalogMatches) ||
    // Removing official-journal boilerplate is not evidence that a historical
    // raw title belongs to the current catalogue entry with that short name.
    (!!catalog && rawCatalog === undefined && !issns.length);
  if (conflictingIdentity) queryName = "";
  const nameKey = normalizeJournal(name);
  return {
    key: conflictingIdentity
      ? ""
      : issn
        ? `issn:${issn}`
        : nameKey
          ? `name:${nameKey}`
          : "",
    nameKey,
    name,
    queryName,
    issn,
    issns,
    catalogISSNs: catalogMatches ? [...catalog.issns] : [],
    doi,
  };
}

function requestCacheKey(identity: ReturnType<typeof journalKeyOf>) {
  const queryNameKey = normalizeJournal(identity.queryName) || identity.nameKey;
  return `query:${queryNameKey}:${[...identity.issns].sort().join(",")}`;
}

/** Identity used by queues and manual batches before source verification. */
export function journalRequestKeyOf(item: Zotero.Item): string {
  const identity = journalKeyOf(item);
  return identity.key ? requestCacheKey(identity) : "";
}

function cachedRecord(identity: ReturnType<typeof journalKeyOf>) {
  const { key, nameKey, issn, issns } = identity;
  if (!key) return undefined;
  const accepts = (raw: unknown) => {
    const record = sanitizeRecord(raw);
    if (!record) return null;
    // Legacy records and aliases can have come from the old name-first cache.
    // Reuse them only when their stored identity proves they are this journal.
    if (issn) {
      if ((record.lookupVersion || 0) >= VERIFIED_ISSN_CACHE_VERSION) {
        if (issns.every((id) => record.issns?.includes(id))) return record;
        // Reuse the same unverified input without treating its p/eISSNs as
        // proven aliases or assigning name-only ranks to a different title.
        return normalizeJournal(record.name) === nameKey &&
          issns.length === record.requestedISSNs?.length &&
          issns.every((id) => record.requestedISSNs?.includes(id))
          ? record
          : null;
      }
      const known = [normalizeISSN(record.issn), ...(record.issns || [])];
      // Legacy records did not distinguish input IDs from source evidence.
      // Their title must agree too; an old mistyped ISSN is not an alias proof.
      return normalizeJournal(record.name) === nameKey &&
        issns.every((id) => known.includes(id))
        ? record
        : null;
    }
    if (identity.catalogISSNs.length) {
      const explicitRecordIDs = [
        ...allISSNs(record.issn),
        ...(record.issns || []),
      ];
      const recordIDs = new Set(
        explicitRecordIDs.length
          ? explicitRecordIDs
          : journalCatalogIdentity(record.name)?.issns || [],
      );
      if (!identity.catalogISSNs.some((id) => recordIDs.has(id))) return null;
    }
    return normalizeJournal(record.name) === nameKey ? record : null;
  };
  const legacyKeys = [
    identity.name,
    ...(journalCatalogIdentity(identity.queryName)?.aliases || []),
  ]
    .map(legacyJournalNameKey)
    .filter(Boolean);
  const queryHit = cache.get<JournalRecord>(
    NS,
    requestCacheKey(identity),
    accepts,
    ttlMs(),
  );
  const keys = new Set([
    key,
    ...issns.map((id) => `issn:${id}`),
    ...(nameKey ? [`name:${nameKey}`, nameKey] : []),
    ...legacyKeys.flatMap((legacy) => [`name:${legacy}`, legacy]),
  ]);
  for (const candidate of keys) {
    const hit = cache.get<JournalRecord>(NS, candidate, accepts, ttlMs());
    if (hit)
      return !queryHit || hit.data.updated >= queryHit.data.updated
        ? hit
        : queryHit;
  }
  return queryHit;
}

/** Keep trustworthy old values visible while retrying old negative answers. */
function needsLookupUpgrade(record: JournalRecord): boolean {
  return (
    (record.lookupVersion || 0) < JOURNAL_LOOKUP_VERSION &&
    (!record.values.length ||
      !!record.partial ||
      !!record.misses?.length ||
      (!!getPref("rank.useEasyScholar") &&
        !record.values.some((value) => value.source !== "openalex")))
  );
}

/**
 * Local data is immediately available even when automatic network requests are
 * off. Both column callbacks use this view, so sorting, text and percentile
 * provenance agree without writing a cache entry during rendering.
 */
function withLocalDataset(
  identity: ReturnType<typeof journalKeyOf>,
  cached?: JournalRecord,
): JournalRecord | undefined {
  if (!identity.key) return cached;
  // Only catalogue/source evidence joins identifiers. An item's two ISSNs,
  // or the requestedISSNs echoed by an old lookup, do not establish aliases.
  const verifiedAliases = [
    ...new Set([
      ...identity.catalogISSNs,
      ...((cached?.lookupVersion || 0) >= VERIFIED_ISSN_CACHE_VERSION
        ? cached?.issns || []
        : []),
    ]),
  ];
  const local = lookupDatasetRecord(
    identity.nameKey,
    identity.issns.join(", "),
    verifiedAliases,
    !!identity.catalogISSNs.length,
  );
  if (!local.values.length) return cached;
  const values: RankValue[] = [];
  const seen = new Set<string>();
  for (const value of [...local.values, ...(cached?.values || [])]) {
    const key = value.field.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({
      ...value,
      rank: validatedRank(value.field, value.value, value.rank),
    });
  }
  // Replacing a JIF also replaces its metadata, even when the new number is
  // identical. A different local file cannot borrow old/remote percentiles.
  const localJIF = local.values.some(
    (value) => value.field.toLowerCase() === "sciif",
  );
  return {
    ...(cached || {
      key: identity.key,
      name: identity.name,
      issn: identity.issn || undefined,
      issns: verifiedAliases.length ? verifiedAliases : undefined,
      requestedISSNs: identity.issns,
      lookupVersion: JOURNAL_LOOKUP_VERSION,
      updated: 0,
    }),
    values,
    jcr: matchingJCRMetadata(localJIF ? local.jcr : cached?.jcr, values),
  };
}

/** Synchronous local index/cache read — safe in dataProvider/renderCell. */
export function getJournalRecord(item: Zotero.Item): JournalRecord | undefined {
  const identity = journalKeyOf(item);
  return withLocalDataset(identity, cachedRecord(identity)?.data);
}

/**
 * Return current local values over the cache. A remote miss queues a
 * background lookup only when auto-fetch is enabled and back-off permits it.
 */
export function requestJournalRecord(
  item: Zotero.Item,
): JournalRecord | undefined {
  const identity = journalKeyOf(item);
  const cached = cachedRecord(identity);
  const hit = cached?.data;
  const visible = withLocalDataset(identity, hit);
  if (!getPref("rank.autoFetch")) return visible;
  if (!identity.key) return visible;
  const cacheKey = requestCacheKey(identity);
  const age = cached?.age;
  if (hit) {
    // a record built while one source was throttled or offline is shown as
    // it is, and re-asked once the back-off is over — not after 30 days
    if (
      needsLookupUpgrade(hit) ||
      (age !== undefined &&
        ((hit.partial && age > FAILURE_TTL) ||
          (!hit.values.length && age > MISS_TTL)))
    ) {
      const failedAt = failures.get(cacheKey);
      if (failedAt === undefined || Date.now() - failedAt >= FAILURE_TTL) {
        refreshPartial.add(cacheKey);
        enqueue(cacheKey, item.id);
      }
    }
    return visible;
  }
  const failedAt = failures.get(cacheKey);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL) {
    return visible; // local values survive a previous network failure
  }
  if (stopped) return visible;
  enqueue(cacheKey, item.id);
  return visible;
}

/** journals whose cached record is partial and due for another try */
const refreshPartial = new Set<string>();

function enqueue(cacheKey: string, itemID: number) {
  let ids = queue.get(cacheKey);
  if (!ids) {
    ids = new Set();
    queue.set(cacheKey, ids);
  }
  ids.add(itemID);
  scheduleDrain();
}

function scheduleDrain() {
  if (queueTimer || fetching) return;
  queueTimer = setTimeout(() => {
    queueTimer = undefined;
    void drain();
  }, 400);
}

async function drain() {
  if (fetching) return;
  fetching = true;
  const epoch = serviceEpoch;
  const valid = () =>
    !stopped && epoch === serviceEpoch && !!getPref("rank.autoFetch");
  try {
    // a local dataset is the highest-priority source and loads asynchronously
    // at startup; fetching before it lands would cache "no Chinese ranking"
    // for 30 days on journals the user's own file answers
    await datasetsLoaded();
    while (queue.size && valid()) {
      const [cacheKey, itemIDs] = queue.entries().next().value as [
        string,
        Set<number>,
      ];
      queue.delete(cacheKey);
      const first = Zotero.Items.get([...itemIDs][0]) as Zotero.Item | false;
      if (!first) continue;
      try {
        const again = refreshPartial.delete(cacheKey);
        const rec = await lookupJournal(first, again, valid);
        if (rec && valid()) onReady?.([...itemIDs]);
      } catch (e) {
        ztoolkit.log("[rank] lookup failed", e);
      }
      // Local datasets stay available during an outage. Only remote lookups
      // need the pacing gap; a zero delay still yields for large local lists.
      const online =
        getPref("rank.useEasyScholar") || getPref("rank.useOpenAlex");
      await Zotero.Promise.delay(online && !rankSourceThrottled() ? 250 : 0);
    }
  } finally {
    fetching = false;
    // Rendering will enqueue the current selection again when it is wanted.
    // Stale or throttled work must not accumulate behind the user's next action.
    if (epoch === serviceEpoch && !valid()) {
      queue.clear();
      refreshPartial.clear();
    }
    if (queue.size && !stopped && getPref("rank.autoFetch")) scheduleDrain();
  }
}

/** the whole chain for one item's journal */
export async function lookupJournal(
  item: Zotero.Item,
  force = false,
  shouldContinue: () => boolean = () => true,
): Promise<JournalRecord | null> {
  const epoch = serviceEpoch;
  const valid = () => !stopped && epoch === serviceEpoch && shouldContinue();
  if (!valid()) return null;
  const identity = journalKeyOf(item);
  const {
    key: cacheKey,
    nameKey,
    name,
    queryName,
    issn,
    issns,
    catalogISSNs,
    doi,
  } = identity;
  if (!cacheKey) return null;
  const requestKey = requestCacheKey(identity);
  // Local imports may still be loading. Even the non-force cache fast path
  // must wait before overlaying their current values.
  await datasetsLoaded();
  if (!valid()) return null;
  let upgrade = false;
  if (!force) {
    const hit = cachedRecord(identity);
    if (hit) {
      upgrade = needsLookupUpgrade(hit.data);
      if (!upgrade) return withLocalDataset(identity, hit.data) || hit.data;
    }
  }

  const values: RankValue[] = [];
  const misses: JournalRecord["misses"] = [];
  // "the source said no" vs "we could not reach the source" — only the first
  // may be cached for the full TTL, otherwise one offline launch would hide
  // every journal badge for a month
  let unreachable = false;
  const seen = new Set<string>();
  const push = (list: RankValue[]) => {
    for (const v of list) {
      const k = v.field.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      values.push({ ...v, rank: validatedRank(v.field, v.value, v.rank) });
    }
  };

  // 1. the user's own dataset always wins
  const requiredISSNs = issns.join(", ");
  let local = lookupDatasetRecord(
    nameKey,
    requiredISSNs,
    catalogISSNs,
    !!catalogISSNs.length,
  );
  let es: Awaited<ReturnType<typeof fetchEasyScholar>> | undefined;

  // 2. easyScholar (needs a key; the only source for the Chinese systems)
  if (getPref("rank.useEasyScholar") && queryName) {
    if (rankSourceThrottled()) {
      // we did not even ask: the record must not be cached for 30 days as
      // "this journal has no Chinese ranking"
      misses.push("easyscholar");
      unreachable = true;
    } else {
      es = await fetchEasyScholar(queryName, valid);
      if (!valid()) return null;
    }
  }

  // 3. OpenAlex singleton lookups, then exact-name autocomplete if necessary.
  let resolvedISSN = issn;
  const verifiedISSNs = new Set(catalogISSNs);
  let oa: OpenAlexJournal | null = null;
  if (getPref("rank.useOpenAlex")) {
    const matches = (result: OpenAlexJournal) =>
      issns.length
        ? issns.every((id) => result.issns.includes(id))
        : normalizeJournal(result.name) === nameKey &&
          (!catalogISSNs.length ||
            catalogISSNs.some((id) => result.issns.includes(id)));
    const networkWanted = () => valid() && !rankSourceThrottled();
    const options = {
      noCache: force || upgrade,
      shouldContinue: networkWanted,
    };
    for (const id of new Set([...issns, ...catalogISSNs])) {
      if (!networkWanted()) break;
      const candidate = await fetchOpenAlexByISSN(id, options);
      if (!valid()) return null;
      if (candidate && matches(candidate)) {
        oa = candidate;
        break;
      }
    }
    if (!valid()) return null;
    if (!oa && doi && networkWanted()) {
      const byDoi = await fetchOpenAlexByDOI(doi, options);
      if (!valid()) return null;
      if (byDoi) {
        // Without an ISSN the DOI must corroborate the title. A mistyped DOI
        // must not move title-based rankings into an unrelated ISSN cache.
        if (matches(byDoi)) {
          oa = byDoi;
          resolvedISSN = issn || byDoi.issn || "";
        }
      }
    }
    if (!oa && queryName && networkWanted()) {
      // last resort, still free: exact-name autocomplete → ISSN → singleton
      const byName = await fetchOpenAlexByName(queryName, options);
      if (!valid()) return null;
      if (byName) {
        if (matches(byName)) {
          oa = byName;
          resolvedISSN = issn || byName.issn || "";
        }
      }
    }
    if (oa) {
      resolvedISSN = issn || oa.issn || "";
      for (const id of oa.issns) verifiedISSNs.add(id);
      const canonicalName = catalogISSNs.length
        ? queryName
        : journalLookupName(oa.name);
      // Resolve print/electronic dataset rows with IDs verified on the source.
      local = lookupDatasetRecord(
        normalizeJournal(canonicalName) || nameKey,
        requiredISSNs,
        oa.issns,
        !!catalogISSNs.length,
      );
      const differentTitle =
        canonicalName && normalizeJournal(canonicalName) !== nameKey;
      if (differentTitle && es) es = { ...es, values: [] };
      // One bounded retry after an identifier-verified canonical name resolves
      // an abbreviation/punctuation miss. Never retry on fuzzy suggestions.
      if (
        getPref("rank.useEasyScholar") &&
        canonicalName &&
        canonicalName !== queryName &&
        !es?.values.length &&
        !es?.error
      ) {
        if (networkWanted()) {
          es = await fetchEasyScholar(canonicalName, valid);
          if (!valid()) return null;
        } else {
          if (!misses.includes("easyscholar")) misses.push("easyscholar");
          unreachable = true;
        }
      }
    }
    if (!oa?.values.length) {
      misses.push("openalex");
      // a keyless OpenAlex miss can equally mean "offline"; only treat it as a
      // real miss when something else already answered
      if ((!local.values.length && !es?.values.length) || rankSourceThrottled())
        unreachable = true;
    }
  }

  if (es && !es.values.length) {
    if (!misses.includes("easyscholar")) misses.push("easyscholar");
    if (es.error === "network" || es.error === "rate") unreachable = true;
  }
  push(local.values);
  if (es) push(es.values);
  if (oa) push(oa.values);

  const rec: JournalRecord = {
    lookupVersion: JOURNAL_LOOKUP_VERSION,
    requestedISSNs: issns,
    key: cacheKey,
    name,
    issn: resolvedISSN || undefined,
    issns: verifiedISSNs.size ? [...verifiedISSNs] : undefined,
    values,
    jcr: matchingJCRMetadata(local.jcr, values),
    updated: Date.now(),
    misses: misses.length ? misses : undefined,
    // something answered while another source (easyScholar throttled, offline)
    // could not be asked: cache what we have, flagged, so it is re-asked after
    // the back-off instead of standing for 30 days as "no Chinese ranking"
    partial: values.length && unreachable ? true : undefined,
  };
  if (!valid()) return null;
  if (!values.length && unreachable) {
    // remember the failure in memory only: nothing is written to the cache, so
    // the next launch (or the next ten minutes) tries again
    failures.set(requestKey, Date.now());
    return rec;
  }
  if (rec.partial) failures.set(requestKey, Date.now());
  else failures.delete(requestKey);
  // Until a catalogue or source corroborates the title/ID relationship, keep
  // the result attached to this exact input. This also caches dual-ISSN misses
  // once without publishing their unverified IDs as journal aliases.
  const storageKey =
    issns.length && !issns.every((id) => verifiedISSNs.has(id))
      ? requestCacheKey(identity)
      : cacheKey;
  cache.set(NS, storageKey, rec);
  if (issns.length && storageKey !== requestKey) cache.remove(NS, requestKey);
  for (const id of verifiedISSNs) {
    if (cacheKey !== `issn:${id}`) cache.set(NS, `issn:${id}`, rec);
  }
  return rec;
}

/** force a refresh for one item (cell context menu) */
export async function refreshJournal(item: Zotero.Item) {
  const rec = await lookupJournal(item, true);
  onReady?.([item.id]);
  return rec;
}

/** Manual network batches stop on refusals from enabled rank sources only. */
export function rankSourceThrottled(): boolean {
  return (
    (!!getPref("rank.useEasyScholar") &&
      (easyScholarBlocked() ||
        http.recentlyUnreachable("https://www.easyscholar.cc/"))) ||
    (!!getPref("rank.useOpenAlex") &&
      (http.recentlyUnreachable("https://api.openalex.org/") ||
        http.throttledFor("https://api.openalex.org/") > 0))
  );
}

export function clearRankCache() {
  // A request that started before an import/clear must not refill the cache
  // with old local values when its remote response arrives later.
  serviceEpoch++;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = undefined;
  }
  queue.clear();
  refreshPartial.clear();
  cache.clear(NS);
  failures.clear();
  // Source/HTTP throttle state is deliberately untouched.
}

/**
 * Values to display for an item, after the Map rewrite and in the order the
 * user listed the fields.
 */
export function displayValues(
  rec: JournalRecord | undefined,
  fields: string[],
): RankValue[] {
  if (!rec) return [];
  const rules = parseRewriteRules(getPref("rank.map") as string);
  const out: RankValue[] = [];
  for (const field of fields) {
    const hit = rec.values.find(
      (v) => v.field.toLowerCase() === field.toLowerCase(),
    );
    if (!hit) continue;
    const label = rules.length ? applyRewrite(rules, hit.field) : hit.field;
    const value = rules.length ? applyRewrite(rules, hit.value) : hit.value;
    if (label === null || value === null) continue; // rewritten to empty = hide
    out.push({ ...hit, field: label, value });
  }
  return out;
}

/** A mapped UI value plus the canonical field that selected it. */
export interface UIJournalRankValue extends RankValue {
  sourceField: string;
  /** A Map rule changed the name or value: retain the user's exact wording. */
  customized?: boolean;
}

/**
 * UI variant of `displayValues` that retains the canonical field key after a
 * user's `rank.map` rewrites the visible field label. The public API keeps its
 * established `{ field, value, source }` shape and never exposes this marker.
 */
export function displayValuesForUI(
  rec: JournalRecord | undefined,
  fields: string[],
): UIJournalRankValue[] {
  const out: UIJournalRankValue[] = [];
  for (const sourceField of fields) {
    const value = displayValues(rec, [sourceField])[0];
    if (value) {
      const raw = rec?.values.find(
        (v) => v.field.toLowerCase() === sourceField.toLowerCase(),
      );
      out.push({
        ...value,
        sourceField,
        customized: value.field !== raw?.field || value.value !== raw?.value,
      });
    }
  }
  return out;
}
