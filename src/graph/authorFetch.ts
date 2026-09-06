import { http, politeParam, type HttpResult } from "../core/http";
import { cache } from "../core/storage";
import { getPref } from "../utils/prefs";
import { cleanDOI } from "../cite/sources";
import {
  OA_AUTHORS_NS,
  compactAuthorships,
  cachedAuthorships,
  authorshipsKey,
} from "./authorIdentity";

/**
 * Top-up for the per-item OpenAlex authorship cache the author graph keys
 * on. The citations pipeline saves authorships whenever its source chain
 * reaches OpenAlex; this fetches them for the scope items it never reached.
 * Bounded per call, misses backed off for six hours, and the loop stops
 * after repeated errors instead of hammering a dead network.
 */

const MISS_NS = "oaAuthorsMiss";
const DETAILS_RETRY_NS = "oaAuthorsDetailsRetry";
const MISS_TTL = 6 * 60 * 60 * 1000;
const DETAILS_RETRY_TTL = 30 * 1000;
const MAX_PER_CALL = 30;
const MAX_ERRORS = 3;

export interface AuthorshipFetchOptions {
  /** Background rendering must explicitly opt into network access. */
  automatic?: boolean;
  /** The item panel needs roles and full institutions, not only graph identities. */
  details?: boolean;
  /** The caller's pane/item is still current. */
  shouldContinue?: () => boolean;
}

let stopped = false;
const pending = new Map<
  string,
  {
    consumers: Set<() => boolean>;
    promise: Promise<HttpResult>;
  }
>();

/** Invalidate queued and late responses from this plugin copy on teardown. */
export function stopAuthorshipFetches() {
  stopped = true;
}

function wanted(options: AuthorshipFetchOptions): boolean {
  try {
    return (
      !stopped &&
      (!options.automatic || getPref("info.affiliations.autoFetch") === true) &&
      options.shouldContinue?.() !== false
    );
  } catch {
    return false;
  }
}

async function fetchAuthorships(
  doi: string,
  valid: () => boolean,
): Promise<HttpResult> {
  const key = doi.toLowerCase();
  let job = pending.get(key);
  if (!job) {
    const consumers = new Set([valid]);
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=authorships${politeParam("&")}`;
    const promise = http.requestResult("GET", url, {
      responseType: "json",
      shouldContinue: () => [...consumers].some((isValid) => isValid()),
    });
    job = { consumers, promise };
    pending.set(key, job);
  } else job.consumers.add(valid);
  try {
    return await job.promise;
  } finally {
    job.consumers.delete(valid);
    if (!job.consumers.size && pending.get(key) === job) pending.delete(key);
  }
}

/** fill missing authorships for these items; true if anything new arrived */
export async function ensureAuthorships(
  items: Zotero.Item[],
  options: AuthorshipFetchOptions = {},
): Promise<boolean> {
  const valid = () => wanted(options);
  let changed = false;
  let budget = MAX_PER_CALL;
  let errors = 0;
  for (const item of items) {
    if (!valid() || budget <= 0 || errors >= MAX_ERRORS) break;
    let doi: string;
    try {
      doi = cleanDOI(item);
    } catch {
      continue;
    }
    if (!doi) continue;
    const key = authorshipsKey(item);
    const existing = cachedAuthorships(item);
    const upgrading = !!existing && options.details === true;
    if (existing && (!options.details || existing.every((r) => r.v === 2))) {
      continue;
    }
    const retryKey = `${key}/${doi.toLowerCase()}`;
    const miss = cache.ageOf(MISS_NS, retryKey);
    if (miss !== undefined && miss < MISS_TTL) continue;
    const retry = cache.ageOf(DETAILS_RETRY_NS, retryKey);
    if (retry !== undefined && retry < DETAILS_RETRY_TTL) continue;
    // A DOI can change while transport is pending, independently of panel selection.
    const itemValid = () => {
      try {
        return valid() && cleanDOI(item).toLowerCase() === doi.toLowerCase();
      } catch {
        return false;
      }
    };
    const backOffUpgrade = () => {
      if (upgrading && itemValid()) cache.set(DETAILS_RETRY_NS, retryKey, 1);
    };
    budget--;
    let result: HttpResult;
    try {
      result = await fetchAuthorships(doi, itemValid);
    } catch (e) {
      ztoolkit.log("[graph] authorship fetch failed", e);
      backOffUpgrade();
      errors++;
      continue;
    }
    if (!valid() || result.kind === "cancelled") break;
    if (!itemValid()) continue;
    if (result.kind === "throttled" || result.kind === "unreachable") {
      backOffUpgrade();
      break;
    }
    if (result.kind !== "ok" && result.kind !== "not-found") {
      backOffUpgrade();
      errors++;
      continue;
    }
    const rows = compactAuthorships(result.value?.authorships, doi);
    if (rows) {
      cache.set(OA_AUTHORS_NS, key, rows);
      cache.remove(MISS_NS, retryKey);
      cache.remove(DETAILS_RETRY_NS, retryKey);
      changed = true;
      errors = 0;
    } else if (
      result.kind === "not-found" ||
      Array.isArray(result.value?.authorships)
    ) {
      cache.set(MISS_NS, retryKey, 1);
    } else {
      backOffUpgrade();
      errors++;
    }
  }
  return changed;
}
