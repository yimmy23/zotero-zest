import { http, politeEmail } from "../../core/http";
import { normalizeISSN } from "../normalize";
import type { RankValue } from "../types";

/**
 * OpenAlex — the keyless fallback. Since February 2026 OpenAlex bills by
 * credits, and the cost differs enormously per endpoint:
 *
 *   /sources/issn:XXXX-XXXX   singleton  0 credits
 *   /works/doi:10.xxxx/yyy    singleton  0 credits
 *   /sources?filter=ids...    list       1 credit  (up to 50 ISSNs in one OR)
 *   /sources?search=...       search     10 credits
 *
 * A keyless client only gets 1000 credits a day, so Zest only ever uses the
 * free singleton lookups: ISSN first, DOI second. It NEVER searches by journal
 * name — that would burn the daily budget in a hundred rows.
 *
 * What OpenAlex gives is a citation average, not an impact factor; it is
 * surfaced under its own field name (`oa2yr`) and labelled as such.
 */

const BASE = "https://api.openalex.org";

interface OaSource {
  id?: string;
  display_name?: string;
  issn_l?: string;
  issn?: string[];
  summary_stats?: {
    "2yr_mean_citedness"?: number;
    h_index?: number;
    i10_index?: number;
  };
  works_count?: number;
}

function valuesFrom(src: OaSource): RankValue[] {
  const out: RankValue[] = [];
  const two = src.summary_stats?.["2yr_mean_citedness"];
  if (typeof two === "number" && Number.isFinite(two)) {
    out.push({ field: "oa2yr", value: two.toFixed(2), source: "openalex" });
  }
  const h = src.summary_stats?.h_index;
  if (typeof h === "number" && Number.isFinite(h)) {
    out.push({ field: "oahindex", value: String(h), source: "openalex" });
  }
  return out;
}

/** free singleton lookup by ISSN; validates that the answer is that journal */
export async function fetchOpenAlexByISSN(
  issn: string,
): Promise<{ values: RankValue[]; name?: string; issnL?: string } | null> {
  const clean = normalizeISSN(issn);
  if (!clean) return null;
  const url = `${BASE}/sources/issn:${clean}?mailto=${encodeURIComponent(politeEmail())}`;
  const src = await http.request<OaSource>("GET", url, {
    responseType: "json",
  });
  if (!src || typeof src !== "object") return null;
  // a wrong ISSN still answers 200 with a junk record — check it is ours
  const known = new Set(
    [src.issn_l, ...(src.issn || [])].map((i) => normalizeISSN(i || "")),
  );
  if (!known.has(clean)) return null;
  return { values: valuesFrom(src), name: src.display_name, issnL: src.issn_l };
}

/** free singleton lookup by DOI → the work's host source (journal) */
export async function fetchOpenAlexByDOI(
  doi: string,
): Promise<{ values: RankValue[]; name?: string; issn?: string } | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!/^10\.\d{4,9}\//.test(clean)) return null;
  const url = `${BASE}/works/doi:${encodeURIComponent(clean)}?mailto=${encodeURIComponent(politeEmail())}&select=id,primary_location`;
  const work = await http.request<any>("GET", url, { responseType: "json" });
  const src: OaSource | undefined = work?.primary_location?.source;
  if (!src) return null;
  const issn = src.issn_l || src.issn?.[0];
  // the work endpoint returns a trimmed source without summary_stats, so
  // follow up with the (also free) source singleton when we have an ISSN
  if (issn) {
    const full = await fetchOpenAlexByISSN(issn);
    if (full) return { ...full, issn: normalizeISSN(issn) };
  }
  return { values: valuesFrom(src), name: src.display_name, issn };
}
