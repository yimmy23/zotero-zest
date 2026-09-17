/**
 * Journal-name normalisation — fallback identity when an ISSN is absent.
 *
 * Case, whitespace and full-width punctuation may vary without changing a
 * title. Abbreviations and parenthetical locations cannot safely be discarded:
 * they need a matching identifier or an authoritative title list.
 */

import {
  JOURNAL_ALIAS_CATALOG,
  JOURNAL_ALIAS_AMBIGUITIES,
} from "./journalAliases.generated";

const FULLWIDTH = /[！-～]/g;

/** Bump when lookup rules change; old misses may be retried without losing hits. */
export const JOURNAL_LOOKUP_VERSION = 2;

/**
 * Verified title aliases, not a rule for removing arbitrary acronym subtitles.
 */
const JOURNAL_TITLES = [
  // NLM: https://www.ncbi.nlm.nih.gov/nlmcatalog/8605732
  // Publisher title and both ISSNs: https://link.springer.com/journal/262
  // The preceding "Cancer immunology and immunotherapy" is NOT an alias.
  {
    name: "Cancer Immunology, Immunotherapy",
    aliases: ["Cancer Immunology, Immunotherapy : CII"],
    issns: ["0340-7004", "1432-0851"],
  },
  // NLM title/abbreviation: https://www.ncbi.nlm.nih.gov/nlmcatalog/101141257
  // Publisher title/ISSNs: https://www.jstage.jst.go.jp/browse/jslrt/_pubinfo/-char/en
  // Keep the bare acronym JCEH unexpanded to avoid ambiguous short titles.
  {
    name: "Journal of Clinical and Experimental Hematopathology",
    aliases: [
      "Journal of clinical and experimental hematopathology : JCEH",
      "J Clin Exp Hematop",
    ],
    issns: ["1346-4280", "1880-9952"],
  },
];

interface JournalCatalogEntry {
  name: string;
  aliases: string[];
  issns: string[];
}

// Ignore presentation punctuation, but retain every word, article and subtitle.
function titleKey(raw: string): string {
  return toHalfWidth(raw)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Build once: column rendering must never scan the full journal catalogue. */
function buildJournalCatalog() {
  const byCanonical = new Map<string, JournalCatalogEntry[]>();
  for (const row of [
    ...JOURNAL_TITLES,
    ...JOURNAL_ALIAS_CATALOG.map(([name, aliases, issns]) => ({
      name,
      aliases,
      issns,
    })),
  ]) {
    const key = titleKey(row.name);
    const entries = byCanonical.get(key) || [];
    const same = entries.find((entry) =>
      entry.issns.some((id) => row.issns.includes(id)),
    );
    if (same) {
      same.aliases = [...new Set([...same.aliases, row.name, ...row.aliases])];
      same.issns = [...new Set([...same.issns, ...row.issns])];
    } else {
      entries.push({
        name: row.name,
        aliases: [...row.aliases],
        issns: [...row.issns],
      });
      byCanonical.set(key, entries);
    }
  }
  const byTitle = new Map<string, JournalCatalogEntry | null>();
  const candidates = new Map<string, Set<JournalCatalogEntry>>();
  for (const entries of byCanonical.values()) {
    for (const entry of entries) {
      for (const title of [entry.name, ...entry.aliases]) {
        const key = titleKey(title);
        const entries = candidates.get(key) || new Set<JournalCatalogEntry>();
        entries.add(entry);
        candidates.set(key, entries);
        if (!byTitle.has(key)) byTitle.set(key, entry);
        else if (byTitle.get(key) !== entry) byTitle.set(key, null);
      }
    }
  }
  for (const title of JOURNAL_ALIAS_AMBIGUITIES)
    byTitle.set(titleKey(title), null);
  return { byTitle, candidates };
}

const JOURNAL_CATALOG = buildJournalCatalog();

/** undefined is unknown; null explicitly marks an ambiguous catalogue title. */
export function journalCatalogIdentity(
  raw: string,
  abbreviation = "",
  issns: readonly string[] = [],
) {
  const key = titleKey(raw);
  const identity = JOURNAL_CATALOG.byTitle.get(key);
  if (identity === null && abbreviation) {
    const specific = JOURNAL_CATALOG.byTitle.get(titleKey(abbreviation));
    // An abbreviation may disambiguate an already-known bare title only when
    // its authoritative canonical title agrees exactly apart from typography.
    if (specific && titleKey(specific.name) === key) return specific;
  }
  if (identity === null && issns.length) {
    const matches = [...(JOURNAL_CATALOG.candidates.get(key) || [])].filter(
      (entry) => issns.every((id) => entry.issns.includes(id)),
    );
    if (matches.length === 1) return matches[0];
  }
  return identity;
}

/** full-width ASCII → half-width, plus the CJK comma/colon we see most */
export function toHalfWidth(s: string): string {
  return s
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(/[，、]/g, ",")
    .replace(/[：]/g, ":");
}

/**
 * The conservative title sent to journal metadata services.
 *
 * Some Zotero translators append an organisation description to the actual
 * journal title, for example "European Journal ...: Official Journal of ...".
 * easyScholar indexes the title before that suffix.  Only remove this explicit
 * bibliographic boilerplate: text after a generic colon can be an essential
 * part of a journal title ("CA: A Cancer Journal for Clinicians").
 */
export function journalLookupName(raw: string | undefined | null): string {
  if (!raw) return "";
  const name = String(raw).trim();
  const searchable = toHalfWidth(name).replace(/\s+/g, " ");
  const stripped = searchable.replace(
    /\s*:\s*(?:(?:an?|the)\s+)?official\s+(?:journal|publication|organ)\s+of\b[\s\S]*\S\s*$/iu,
    "",
  );
  const catalog = journalCatalogIdentity(stripped);
  // Keep a precise title when the provider's shorter canonical title is
  // ambiguous (e.g. Medicine (Baltimore) -> MEDICINE). Its verified ISSNs still
  // resolve local rows without discarding the words that distinguish it.
  if (catalog && journalCatalogIdentity(catalog.name) !== null)
    return catalog.name;
  // Keep every unmatched title byte-for-byte (apart from outer whitespace).
  // This helper must not silently reinterpret a real subtitle.
  if (stripped === searchable) return name;
  return stripped.trim();
}

export function normalizeJournal(raw: string | undefined | null): string {
  return normalizeTitle(journalLookupName(raw));
}

/** Previous cache keys are read-only aliases; never rewrite a user's file. */
export function legacyJournalNameKey(raw: string): string {
  return normalizeTitle(raw);
}

function normalizeTitle(raw: string | undefined | null): string {
  if (!raw) return "";
  let s = toHalfWidth(raw).trim();
  // A location or edition in parentheses can distinguish separate journals.
  // Keep its words in identity keys; punctuation itself is normalised below.
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/^(the|a|an)\s+/, "");
  s = s.replace(/[^a-z0-9一-鿿]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** 1234-5678 / 12345678 → "1234-5678"; anything else → "" */
export function normalizeISSN(raw: string | undefined | null): string {
  if (!raw) return "";
  const m = toHalfWidth(String(raw))
    .trim()
    .match(/^(\d{4})\s*[-‐‑–—]?\s*(\d{3}[\dX])$/i);
  return m ? `${m[1]}-${m[2].toUpperCase()}` : "";
}

/** every ISSN found in a free-text field ("1234-5678, 8765-4321") */
export function allISSNs(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const m of toHalfWidth(String(raw)).matchAll(
    /(?<![\dX])\d{4}\s*[-‐‑–—]?\s*\d{3}[\dxX](?![\dX])/gi,
  )) {
    const issn = normalizeISSN(m[0]);
    if (issn && !out.includes(issn)) out.push(issn);
  }
  return out;
}

/**
 * Fields that name a JOURNAL-like venue — the only ones a ranking source can
 * meaningfully answer for. Deliberately excludes university / publisher /
 * institution: a thesis whose "venue" is its university would otherwise be
 * looked up as if it were a journal (and burn an API call doing it).
 */
const RANKABLE_VENUE_FIELDS = [
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
];

/** the venue as shown in the Venue column: broader, display only */
const DISPLAY_VENUE_FIELDS = [
  ...RANKABLE_VENUE_FIELDS,
  "repository",
  "bookTitle",
  "encyclopediaTitle",
  "dictionaryTitle",
  "websiteTitle",
  "blogTitle",
  "forumTitle",
  "programTitle",
  "university",
  "institution",
  "publisher",
];

/** the journal name a rank lookup may use ("" when the item has no journal) */
export function rankableVenueOf(item: Zotero.Item): string {
  return fieldOf(item, RANKABLE_VENUE_FIELDS);
}

/** the journal / venue of an item, trying the fields Zotero actually fills */
export function venueOf(item: Zotero.Item): string {
  return fieldOf(item, DISPLAY_VENUE_FIELDS);
}

function fieldOf(item: Zotero.Item, fields: string[]): string {
  for (const f of fields) {
    let v: string;
    try {
      v = (item.getField(f as any) as string) || "";
    } catch {
      v = "";
    }
    if (v) return v;
  }
  return "";
}
