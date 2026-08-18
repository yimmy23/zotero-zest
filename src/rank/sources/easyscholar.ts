import { http } from "../../core/http";
import { getSecret } from "../../core/secrets";
import type { RankValue } from "../types";

/**
 * easyScholar (https://www.easyscholar.cc) — the only source for the Chinese
 * ranking systems (中科院分区, CSSCI, 北大核心 …). Needs a free key.
 *
 * Two things make it awkward and are handled here, not by Zotero's HTTP layer:
 *   - every answer is HTTP 200; failures live in the JSON `code`
 *     (40002 bad key, 40005 missing key, 40006 rate limited), so Zotero's
 *     built-in 429 retry never sees the throttling;
 *   - the key travels in the query string, so the request bypasses
 *     `Zotero.HTTP` (which logs every URL and only redacts `key=`), is never
 *     cached by URL, and only ever appears in our logs redacted.
 */

const ENDPOINT = "https://www.easyscholar.cc/open/getPublicationRank";

export interface EsResult {
  values: RankValue[];
  /** set when the service refused: "key" | "rate" | "network" */
  error?: "key" | "rate" | "network";
}

/** back-off state shared by all lookups: set when the API says "too fast" */
let blockedUntil = 0;
let consecutiveRateLimits = 0;

export function easyScholarBlocked(): boolean {
  return Date.now() < blockedUntil;
}

export function easyScholarBackoffMs(): number {
  return Math.max(0, blockedUntil - Date.now());
}

export async function fetchEasyScholar(
  publicationName: string,
  /** a user-triggered refresh ignores the back-off and any cached answer */
  force = false,
): Promise<EsResult> {
  if (!publicationName) return { values: [] };
  if (!force && easyScholarBlocked()) return { values: [], error: "rate" };
  if (force) {
    blockedUntil = 0;
    consecutiveRateLimits = 0;
  }
  // the block has expired without a new 40006 → start the back-off ladder over
  if (blockedUntil && Date.now() >= blockedUntil) {
    blockedUntil = 0;
    consecutiveRateLimits = 0;
  }
  const key = await getSecret("easyscholar");
  if (!key) return { values: [], error: "key" };

  const url = `${ENDPOINT}?secretKey=${encodeURIComponent(key)}&publicationName=${encodeURIComponent(publicationName)}`;
  const res = await http.request<any>("GET", url, {
    responseType: "json",
    // the key travels in the query string: send it outside Zotero's HTTP
    // layer (which logs URLs), log a redacted URL ourselves, and never cache
    // by URL — a business error comes back as HTTP 200 and would otherwise be
    // remembered as a valid answer for a week. Successful answers are cached
    // at the journal-record level instead.
    secret: true,
    noCache: true,
    displayURL: `${ENDPOINT}?secretKey=***&publicationName=${encodeURIComponent(publicationName)}`,
    retries: 0,
  });
  if (!res) return { values: [], error: "network" };

  const code = Number(res.code);
  if (code === 40006) {
    consecutiveRateLimits++;
    blockedUntil =
      Date.now() + Math.min(15, 2 ** consecutiveRateLimits) * 60000;
    return { values: [], error: "rate" };
  }
  if (code === 40002 || code === 40005) return { values: [], error: "key" };
  if (code !== 200) return { values: [], error: "network" };
  consecutiveRateLimits = 0;

  const values: RankValue[] = [];
  const official = res.data?.officialRank?.all;
  if (official && typeof official === "object") {
    for (const [field, value] of Object.entries<any>(official)) {
      if (value === null || value === undefined || value === "") continue;
      values.push({ field, value: String(value), source: "easyscholar" });
    }
  }
  // custom datasets: `${uuid}&&&${1..5}` decoded through rankInfo
  const custom = res.data?.customRank;
  if (custom?.rank && Array.isArray(custom.rank)) {
    const info = new Map<string, any>();
    for (const r of custom.rankInfo || []) info.set(r.uuid, r);
    for (const entry of custom.rank) {
      const [uuid, levelRaw] = String(entry).split("&&&");
      const meta = info.get(uuid);
      const level = Number(levelRaw);
      if (!meta || !Number.isFinite(level)) continue;
      const label =
        meta[
          [
            "oneRankText",
            "twoRankText",
            "threeRankText",
            "fourRankText",
            "fiveRankText",
          ][level - 1]
        ] || String(level);
      values.push({
        field: String(meta.abbName || uuid),
        value: String(label),
        rank: Math.min(5, Math.max(1, level)),
        source: "easyscholar",
      });
    }
  }
  return { values };
}
