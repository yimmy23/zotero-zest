import { http, politeParam } from "../core/http";
import { cache } from "../core/storage";
import { cleanDOI } from "../cite/sources";
import { OA_AUTHORS_NS, compactAuthorships } from "./authorIdentity";

/**
 * Top-up for the per-item OpenAlex authorship cache the author graph keys
 * on. The citations pipeline saves authorships whenever its source chain
 * reaches OpenAlex; this fetches them for the scope items it never reached.
 * Bounded per call, misses backed off for six hours, and the loop stops
 * after repeated errors instead of hammering a dead network.
 */

const MISS_NS = "oaAuthorsMiss";
const MISS_TTL = 6 * 60 * 60 * 1000;
const MAX_PER_CALL = 30;
const MAX_ERRORS = 3;

/** fill missing authorships for these items; true if anything new arrived */
export async function ensureAuthorships(
  items: Zotero.Item[],
): Promise<boolean> {
  let changed = false;
  let budget = MAX_PER_CALL;
  let errors = 0;
  for (const item of items) {
    if (budget <= 0 || errors >= MAX_ERRORS) break;
    let doi: string;
    try {
      doi = cleanDOI(item);
    } catch {
      continue;
    }
    if (!doi) continue;
    const key = `${item.libraryID}/${item.key}`;
    if (cache.ageOf(OA_AUTHORS_NS, key) !== undefined) continue;
    const miss = cache.ageOf(MISS_NS, key);
    if (miss !== undefined && miss < MISS_TTL) continue;
    budget--;
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=authorships${politeParam("&")}`;
    let res: any;
    try {
      res = await http.request<any>("GET", url, { responseType: "json" });
    } catch (e) {
      ztoolkit.log("[graph] authorship fetch failed", e);
      errors++;
      cache.set(MISS_NS, key, 1);
      continue;
    }
    const rows = compactAuthorships(res?.authorships);
    if (rows) {
      cache.set(OA_AUTHORS_NS, key, rows);
      changed = true;
    } else {
      cache.set(MISS_NS, key, 1);
    }
  }
  return changed;
}
