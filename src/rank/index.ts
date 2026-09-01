import { cache } from "../core/storage";
import { getPref, getNumPref } from "../utils/prefs";
import { setTimeout, clearTimeout } from "../utils/timers";
import {
  normalizeJournal,
  normalizeISSN,
  allISSNs,
  rankableVenueOf,
} from "./normalize";
import { inferRank } from "./rank";
import { parseRewriteRules, applyRewrite } from "./map";
import type { JournalRecord, RankValue } from "./types";
import { datasetsLoaded, lookupDataset } from "./sources/localDataset";
import { fetchEasyScholar, easyScholarBlocked } from "./sources/easyscholar";
import {
  fetchOpenAlexByISSN,
  fetchOpenAlexByDOI,
  fetchOpenAlexByName,
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
 * Everything is cached in zest-cache.json under the normalised name, so a
 * library with 400 papers in 60 journals does 60 lookups, not 400 — and none
 * at all on the next launch. Column dataProviders only ever read the memory
 * cache; a miss queues a background fetch and repaints those rows when it
 * lands.
 */

const NS = "rank";
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

export function startRankService(refresh: (itemIDs: number[]) => void) {
  onReady = refresh;
  cache.configure(NS, 4000);
}

export function stopRankService() {
  onReady = undefined;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = undefined;
  }
  queue.clear();
}

function ttlMs(): number {
  return Math.max(1, getNumPref("rank.ttlDays", 30)) * 24 * 3600 * 1000;
}

function sanitizeRecord(raw: unknown): JournalRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if (typeof r.key !== "string" || !r.key) return null;
  const values: RankValue[] = [];
  if (Array.isArray(r.values)) {
    for (const v of r.values.slice(0, 80)) {
      if (!v || typeof v.field !== "string" || typeof v.value !== "string")
        continue;
      if (v.field.length > 60 || v.value.length > 120) continue;
      values.push({
        field: v.field,
        value: v.value,
        rank: typeof v.rank === "number" ? v.rank : undefined,
        source: ["dataset", "easyscholar", "openalex"].includes(v.source)
          ? v.source
          : "dataset",
      });
    }
  }
  return {
    key: r.key,
    name: typeof r.name === "string" ? r.name : r.key,
    issn: typeof r.issn === "string" ? r.issn : undefined,
    values,
    updated: Number(r.updated) || 0,
    misses: Array.isArray(r.misses) ? r.misses.slice(0, 4) : undefined,
    partial: r.partial === true ? true : undefined,
  };
}

/** identity of an item's journal, computed synchronously from its fields */
export function journalKeyOf(item: Zotero.Item): {
  key: string;
  name: string;
  issn: string;
  doi: string;
} {
  let name = "";
  let issn = "";
  let doi = "";
  try {
    name = rankableVenueOf(item);
    issn = normalizeISSN((item.getField("ISSN") as string) || "");
    if (!issn) {
      const more = allISSNs((item.getField("ISSN") as string) || "");
      issn = more[0] || "";
    }
    doi = String(item.getField("DOI") || "").trim();
  } catch {
    // unloaded item
  }
  return { key: normalizeJournal(name), name, issn, doi };
}

/** synchronous cache read — safe in dataProvider/renderCell */
export function getJournalRecord(item: Zotero.Item): JournalRecord | undefined {
  const { key, issn } = journalKeyOf(item);
  if (!key && !issn) return undefined;
  const hit =
    (key && cache.get<JournalRecord>(NS, key, sanitizeRecord, ttlMs())) ||
    (issn &&
      cache.get<JournalRecord>(NS, `issn:${issn}`, sanitizeRecord, ttlMs()));
  return hit ? hit.data : undefined;
}

/**
 * Ask for a record. Returns the cached one when present; otherwise queues a
 * background lookup (unless auto-fetch is off or we looked recently and found
 * nothing).
 */
export function requestJournalRecord(
  item: Zotero.Item,
): JournalRecord | undefined {
  const hit = getJournalRecord(item);
  if (!getPref("rank.autoFetch")) return hit;
  const { key, issn } = journalKeyOf(item);
  if (!key && !issn) return hit;
  const cacheKey = key || `issn:${issn}`;
  const age = cache.ageOf(NS, cacheKey);
  if (hit) {
    // a record built while one source was throttled or offline is shown as
    // it is, and re-asked once the back-off is over — not after 30 days
    if (hit.partial && age !== undefined && age > FAILURE_TTL) {
      const failedAt = failures.get(cacheKey);
      if (failedAt === undefined || Date.now() - failedAt >= FAILURE_TTL) {
        refreshPartial.add(cacheKey);
        enqueue(cacheKey, item.id);
      }
    }
    return hit;
  }
  const failedAt = failures.get(cacheKey);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL) {
    return undefined; // the last attempt could not reach anything
  }
  if (age !== undefined && age < MISS_TTL) return undefined; // asked recently
  enqueue(cacheKey, item.id);
  return undefined;
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
  try {
    // a local dataset is the highest-priority source and loads asynchronously
    // at startup; fetching before it lands would cache "no Chinese ranking"
    // for 30 days on journals the user's own file answers
    await datasetsLoaded();
    while (queue.size) {
      const [cacheKey, itemIDs] = queue.entries().next().value as [
        string,
        Set<number>,
      ];
      queue.delete(cacheKey);
      const first = Zotero.Items.get([...itemIDs][0]) as Zotero.Item | false;
      if (!first) continue;
      try {
        const again = refreshPartial.delete(cacheKey);
        const rec = await lookupJournal(first, again);
        if (rec) onReady?.([...itemIDs]);
      } catch (e) {
        ztoolkit.log("[rank] lookup failed", e);
      }
      // be gentle with the APIs: one journal at a time, small gap
      await Zotero.Promise.delay(250);
    }
  } finally {
    fetching = false;
  }
}

/** the whole chain for one item's journal */
export async function lookupJournal(
  item: Zotero.Item,
  force = false,
): Promise<JournalRecord | null> {
  const { key, name, issn, doi } = journalKeyOf(item);
  if (!key && !issn && !doi) return null;
  const cacheKey = key || `issn:${issn}`;
  if (!force) {
    const hit = cache.get<JournalRecord>(NS, cacheKey, sanitizeRecord, ttlMs());
    if (hit) return hit.data;
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
      values.push({ ...v, rank: v.rank ?? inferRank(v.field, v.value) });
    }
  };

  // 1. the user's own dataset always wins
  push(lookupDataset(key, issn));

  // 2. easyScholar (needs a key; the only source for the Chinese systems)
  if (getPref("rank.useEasyScholar") && name) {
    if (easyScholarBlocked()) {
      // we did not even ask: the record must not be cached for 30 days as
      // "this journal has no Chinese ranking"
      misses.push("easyscholar");
      unreachable = true;
    } else {
      const es = await fetchEasyScholar(name, force);
      if (es.values.length) push(es.values);
      else if (es.error) {
        misses.push("easyscholar");
        if (es.error === "network" || es.error === "rate") unreachable = true;
      }
    }
  }

  // 3. OpenAlex, but only through the free singleton endpoints
  let resolvedISSN = issn;
  if (getPref("rank.useOpenAlex")) {
    let oa: { values: RankValue[]; name?: string; issn?: string } | null = null;
    if (issn) oa = await fetchOpenAlexByISSN(issn);
    if (!oa && doi) {
      const byDoi = await fetchOpenAlexByDOI(doi);
      if (byDoi) {
        oa = byDoi;
        resolvedISSN = byDoi.issn || resolvedISSN;
      }
    }
    if (!oa && name) {
      // last resort, still free: exact-name autocomplete → ISSN → singleton
      const byName = await fetchOpenAlexByName(name);
      if (byName) {
        oa = byName;
        resolvedISSN = byName.issn || resolvedISSN;
      }
    }
    if (oa?.values.length) push(oa.values);
    else {
      misses.push("openalex");
      // a keyless OpenAlex miss can equally mean "offline"; only treat it as a
      // real miss when something else already answered
      if (!values.length) unreachable = true;
    }
  }

  const rec: JournalRecord = {
    key: cacheKey,
    name,
    issn: resolvedISSN || undefined,
    values,
    updated: Date.now(),
    misses: misses.length ? misses : undefined,
    // something answered while another source (easyScholar throttled, offline)
    // could not be asked: cache what we have, flagged, so it is re-asked after
    // the back-off instead of standing for 30 days as "no Chinese ranking"
    partial: values.length && unreachable ? true : undefined,
  };
  if (!values.length && unreachable) {
    // remember the failure in memory only: nothing is written to the cache, so
    // the next launch (or the next ten minutes) tries again
    failures.set(cacheKey, Date.now());
    return rec;
  }
  if (rec.partial) failures.set(cacheKey, Date.now());
  else failures.delete(cacheKey);
  cache.set(NS, cacheKey, rec);
  if (resolvedISSN && cacheKey !== `issn:${resolvedISSN}`) {
    cache.set(NS, `issn:${resolvedISSN}`, rec);
  }
  return rec;
}

/** force a refresh for one item (cell context menu) */
export async function refreshJournal(item: Zotero.Item) {
  const rec = await lookupJournal(item, true);
  onReady?.([item.id]);
  return rec;
}

/** true when easyScholar has told us to stop — batch callers should give up */
export function rankSourceThrottled(): boolean {
  return easyScholarBlocked();
}

export function clearRankCache() {
  cache.clear(NS);
  failures.clear();
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
    if (value) out.push({ ...value, sourceField });
  }
  return out;
}
