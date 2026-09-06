import {
  http,
  politeParam,
  type HttpResult,
  type RequestOptions,
} from "../core/http";
import { cache } from "../core/storage";
import {
  OA_AUTHORS_NS,
  authorshipsKey,
  compactAuthorships,
} from "../graph/authorIdentity";
import { getSecret } from "../core/secrets";

/**
 * Citation-count sources, cheapest and most reliable first:
 *
 *   Crossref        DOI only, no key, polite pool          `is-referenced-by-count`
 *   OpenAlex        DOI singleton (0 credits), no key      `cited_by_count`
 *   Semantic Scholar DOI/PMID, optional key                `citationCount`
 *
 * Google Scholar is deliberately absent: scraping it gets the user's IP
 * throttled or CAPTCHA-walled, and every plugin that does it has open issues
 * about exactly that. If it is ever added it must be opt-in and rate-limited.
 */

export type CiteSource = "Crossref" | "OpenAlex" | "Semantic Scholar";

export interface CiteResult {
  count: number;
  source: CiteSource;
}

export type CiteFailure = (result: HttpResult) => void;

async function requestBody(
  url: string,
  options: RequestOptions,
  onFailure?: CiteFailure,
) {
  const result = await http.requestResult("GET", url, options);
  if (result.kind !== "ok" && result.kind !== "not-found") onFailure?.(result);
  return result.kind === "ok" ? result.value : null;
}

export function cleanDOI(item: Zotero.Item): string {
  try {
    const raw = String(item.getField("DOI") || "").trim();
    const doi = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : "";
  } catch {
    return "";
  }
}

/** PMID is a real field since Zotero 10 (schema 40); older items carry it in Extra */
function pmidOf(item: Zotero.Item): string {
  try {
    const field = String(item.getField("PMID") || "").trim();
    if (/^\d+$/.test(field)) return field;
  } catch {
    // item type without the field
  }
  try {
    const extra = String(item.getField("extra") || "");
    const m = extra.match(/^PMID:\s*(\d+)/im);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

export async function fetchCrossref(
  item: Zotero.Item,
  force = false,
  onFailure?: CiteFailure,
): Promise<CiteResult | null> {
  const doi = cleanDOI(item);
  if (!doi) return null;
  // NB: the /works/{doi} route rejects `select` with a 400 — only the search
  // route supports it, so ask for the whole record
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${politeParam("?")}`;
  const res = await requestBody(
    url,
    {
      responseType: "json",
      noCache: force,
    },
    onFailure,
  );
  const n = res?.message?.["is-referenced-by-count"];
  return typeof n === "number" ? { count: n, source: "Crossref" } : null;
}

export async function fetchOpenAlexCitations(
  item: Zotero.Item,
  force = false,
  onFailure?: CiteFailure,
): Promise<CiteResult | null> {
  const doi = cleanDOI(item);
  if (!doi) return null;
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=cited_by_count,authorships${politeParam("&")}`;
  const res = await requestBody(
    url,
    {
      responseType: "json",
      noCache: force,
    },
    onFailure,
  );
  // free ride for the author graph: same request, remember who wrote it
  const rows = compactAuthorships(res?.authorships);
  if (rows) cache.set(OA_AUTHORS_NS, authorshipsKey(item), rows);
  const n = res?.cited_by_count;
  return typeof n === "number" ? { count: n, source: "OpenAlex" } : null;
}

export async function fetchSemanticScholar(
  item: Zotero.Item,
  force = false,
  onFailure?: CiteFailure,
): Promise<CiteResult | null> {
  const doi = cleanDOI(item);
  const pmid = pmidOf(item);
  const id = doi ? `DOI:${doi}` : pmid ? `PMID:${pmid}` : "";
  if (!id) return null;
  const key = await getSecret("semanticscholar");
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=citationCount`;
  const res = await requestBody(
    url,
    {
      responseType: "json",
      headers: key ? { "x-api-key": key } : undefined,
      // the key goes in a header, not the URL, but the request must still stay
      // out of the shared URL cache when it is personalised
      secret: !!key,
      displayURL: key ? `${url} (with key)` : undefined,
      noCache: force,
    },
    onFailure,
  );
  const n = res?.citationCount;
  return typeof n === "number"
    ? { count: n, source: "Semantic Scholar" }
    : null;
}

/** identifiers a source can work with — used to skip hopeless lookups */
export function hasIdentifier(item: Zotero.Item): boolean {
  return !!(cleanDOI(item) || pmidOf(item));
}
