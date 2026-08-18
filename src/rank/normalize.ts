/**
 * Journal-name normalisation — the cache key for every rank source.
 *
 * Bibliographic data is messy: "The Lancet Oncology", "Lancet Oncol.",
 * "LANCET ONCOLOGY", "Journal of Clinical Oncology (JCO)" and the same names
 * with full-width punctuation pasted from Chinese PDFs must all hit one entry.
 * The rules below are deliberately conservative — they only remove noise, they
 * never expand abbreviations (that would need a title list and would silently
 * mis-attribute ranks).
 */

const FULLWIDTH = /[！-～]/g;

/** full-width ASCII → half-width, plus the CJK comma/colon we see most */
export function toHalfWidth(s: string): string {
  return s
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(/[，、]/g, ",")
    .replace(/[：]/g, ":");
}

/** strip a trailing parenthetical: "Nature Medicine (London)" → "Nature Medicine" */
export function stripTrailingParenthetical(s: string): string {
  return s.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/u, "").trim();
}

export function normalizeJournal(raw: string | undefined | null): string {
  if (!raw) return "";
  let s = toHalfWidth(String(raw)).trim();
  s = stripTrailingParenthetical(s);
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
  const m = String(raw)
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
  if (m.length !== 8) return "";
  return `${m.slice(0, 4)}-${m.slice(4)}`;
}

/** every ISSN found in a free-text field ("1234-5678, 8765-4321") */
export function allISSNs(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const m of String(raw).matchAll(/\d{4}\s*-?\s*\d{3}[\dxX]/g)) {
    const issn = normalizeISSN(m[0]);
    if (issn && !out.includes(issn)) out.push(issn);
  }
  return out;
}

/** the journal / venue of an item, trying the fields Zotero actually fills */
export function venueOf(item: Zotero.Item): string {
  const fields = [
    "publicationTitle",
    "proceedingsTitle",
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
    "repository",
  ];
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
