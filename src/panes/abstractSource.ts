import { http, type HttpResult } from "../core/http";
import { cache } from "../core/storage";
import { getExtraLine } from "../utils/extra";
import { normalizeAbstractText } from "./abstractText";

/** Identifier-only, user-triggered lookups. Never writes a Zotero item. */
export interface AbstractRecord {
  text: string;
  source: "Europe PMC" | "PubMed" | "Crossref";
  url: string;
  fetchedAt: number;
  doi?: string;
  pmid?: string;
}

interface Identity {
  key: string;
  doi: string;
  pmid: string;
}

export interface AbstractResult {
  kind:
    | "ok"
    | "missing"
    | "no-id"
    | "throttled"
    | "unreachable"
    | "error"
    | "cancelled";
  record?: AbstractRecord;
}

const NS = "abstracts";
const POSITIVE_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 6 * 60 * 60 * 1000;
const MAX_TEXT = 40_000;
cache.configure(NS, 500);

let generation = 0;
const pending = new Map<
  string,
  { consumers: Set<() => boolean>; promise: Promise<AbstractResult> }
>();
let pubmedQueue = Promise.resolve();
let nextPubmedStart = 0;

function doiOf(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const doi = raw
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
    .toLowerCase();
  return doi.length <= 300 && /^10\.\d{4,9}\/[^\s"<>]+$/.test(doi) ? doi : "";
}

function pmidOf(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^[1-9]\d{0,11}$/.test(value) ? value : "";
}

function field(item: Zotero.Item, name: string): string {
  try {
    return String(item.getField(name as any) || "");
  } catch {
    return "";
  }
}

export function abstractIdentity(item: Zotero.Item): Identity | null {
  const doi = doiOf(field(item, "DOI"));
  // Read the legacy PMID line locally; no other Extra content leaves Zotero.
  const pmid =
    pmidOf(field(item, "PMID")) || pmidOf(getExtraLine(item, ["PMID"])?.value);
  return doi || pmid ? { key: `v1:${doi}|${pmid}`, doi, pmid } : null;
}

function recordText(raw: unknown, plainText = false): string | undefined {
  if (typeof raw !== "string" || raw.length > MAX_TEXT * 2) return undefined;
  // A cache hit or DOM textContent has already crossed the markup boundary.
  // Parsing it again would delete literal comparisons/tags or decode entities twice.
  const text = plainText ? raw.trim() : normalizeAbstractText(raw);
  return text.length >= 60 && text.length <= MAX_TEXT ? text : undefined;
}

function sanitizeRecord(raw: unknown): AbstractRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as AbstractRecord;
  const text = recordText(r.text, true);
  if (
    !text ||
    !Number.isFinite(r.fetchedAt) ||
    r.fetchedAt <= 0 ||
    r.fetchedAt > Date.now() + 60_000 ||
    typeof r.url !== "string"
  )
    return null;
  const doi = doiOf(r.doi);
  const pmid = pmidOf(r.pmid);
  const europeURL = r.url.match(
    /^https:\/\/europepmc\.org\/article\/([A-Z]+)\/([A-Za-z0-9_-]+)$/,
  );
  const validURL =
    (r.source === "Europe PMC" &&
      europeURL &&
      (europeURL[1] === "MED" ? !!pmid && europeURL[2] === pmid : !pmid)) ||
    (r.source === "PubMed" &&
      !!pmid &&
      r.url === `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`) ||
    (r.source === "Crossref" &&
      !!doi &&
      !pmid &&
      r.url === `https://doi.org/${encodeURIComponent(doi)}`);
  if (!validURL) return null;
  return {
    text,
    source: r.source,
    url: r.url,
    fetchedAt: r.fetchedAt,
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
  };
}

function cached(identity: Identity): AbstractRecord | undefined {
  const record = cache.get(
    NS,
    identity.key,
    sanitizeRecord,
    POSITIVE_TTL,
  )?.data;
  if (
    !record ||
    (identity.doi && record.doi !== identity.doi) ||
    (identity.pmid && record.pmid !== identity.pmid)
  )
    return undefined;
  return record;
}

export function cachedAbstract(item: Zotero.Item): AbstractRecord | undefined {
  const identity = abstractIdentity(item);
  return identity ? cached(identity) : undefined;
}

function failure(result: HttpResult): AbstractResult | undefined {
  if (result.kind === "ok") return undefined;
  return { kind: result.kind === "not-found" ? "missing" : result.kind };
}

async function request(
  url: string,
  valid: () => boolean,
  responseType: "json" | "text" = "json",
): Promise<HttpResult> {
  try {
    return await http.requestResult("GET", url, {
      responseType,
      shouldContinue: valid,
      timeout: 12_000,
      retries: 0,
      // This module owns cache lifetime; cancelled/invalid bodies never persist.
      noCache: true,
    });
  } catch {
    return {
      kind: valid() ? "unreachable" : "cancelled",
      value: null,
      status: 0,
    };
  }
}

async function europePMC(
  identity: Identity,
  valid: () => boolean,
): Promise<AbstractResult & { pmid?: string }> {
  const query = identity.doi
    ? `DOI:"${identity.doi}"`
    : `EXT_ID:${identity.pmid} AND SRC:MED`;
  const response = await request(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=10`,
    valid,
  );
  const failed = failure(response);
  if (failed) return failed;
  const body = response.value;
  const rows = body?.resultList?.result;
  if (
    !Array.isArray(rows) ||
    !Number.isInteger(body.hitCount) ||
    body.hitCount < rows.length
  )
    return { kind: "error" };
  if (!body.hitCount && !rows.length) return { kind: "missing" };
  const matches = rows.filter(
    (row: any) =>
      row &&
      typeof row.source === "string" &&
      /^[A-Z]+$/.test(row.source) &&
      typeof row.id === "string" &&
      /^[A-Za-z0-9_-]+$/.test(row.id) &&
      (row.source !== "MED" || !!pmidOf(row.id)) &&
      (!identity.doi || doiOf(row.doi) === identity.doi) &&
      (!identity.pmid || (row.source === "MED" && row.id === identity.pmid)),
  );
  if (!matches.length) return { kind: "error" };
  matches.sort(
    (a, b) => Number(b.source === "MED") - Number(a.source === "MED"),
  );
  let pmid: string | undefined;
  for (const row of matches) {
    const rowPMID = row.source === "MED" ? pmidOf(row.id) : "";
    if (rowPMID && !pmid) pmid = rowPMID;
    const text = recordText(row.abstractText);
    if (!text) continue;
    return {
      kind: "ok",
      record: {
        text,
        source: "Europe PMC",
        url: `https://europepmc.org/article/${row.source}/${row.id}`,
        fetchedAt: Date.now(),
        ...(identity.doi ? { doi: identity.doi } : {}),
        ...(rowPMID ? { pmid: rowPMID } : {}),
      },
    };
  }
  // Short/malformed content is not proof that the article has no abstract.
  const malformed = matches.some(
    (row) => row.abstractText != null && row.abstractText !== "",
  );
  return { kind: malformed ? "error" : "missing", pmid };
}

function parsePubmed(
  xml: unknown,
  identity: Identity,
  pmid: string,
): AbstractResult {
  if (typeof xml !== "string" || xml.length > 2_000_000)
    return { kind: "error" };
  // EFetch normally sends an external DTD. Remove that inert declaration,
  // reject internal subsets/entities, and never ask the parser to resolve it.
  const safe = xml.replace(
    /<!DOCTYPE\s+PubmedArticleSet\s+PUBLIC\s+"[^"[\]]*"\s+"https?:\/\/dtd\.nlm\.nih\.gov\/ncbi\/pubmed\/out\/pubmed_\d+\.dtd"\s*>/i,
    "",
  );
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(safe)) return { kind: "error" };
  try {
    const Parser = (Zotero.getMainWindow() as any).DOMParser;
    const doc = new Parser().parseFromString(
      safe,
      "application/xml",
    ) as Document;
    if (doc.querySelector("parsererror")) return { kind: "error" };
    const articles = Array.from(
      doc.querySelectorAll("PubmedArticle"),
    ) as Element[];
    const article = articles.find(
      (node) =>
        node.querySelector("MedlineCitation > PMID")?.textContent === pmid,
    );
    if (!article) return { kind: "error" };
    const doiNodes = Array.from(
      article.querySelectorAll(
        'PubmedData > ArticleIdList > ArticleId[IdType="doi"], MedlineCitation > Article > ELocationID[EIdType="doi"]',
      ),
    ) as Element[];
    if (
      identity.doi &&
      !doiNodes.some((node) => doiOf(node.textContent) === identity.doi)
    )
      return { kind: "error" };
    const sections = Array.from(
      article.querySelectorAll(
        "MedlineCitation > Article > Abstract > AbstractText",
      ),
    ) as Element[];
    if (!sections.length) return { kind: "missing" };
    const text = recordText(
      sections
        .map((node) => {
          const label =
            node.getAttribute("Label") || node.getAttribute("NlmCategory");
          return `${label && label !== "UNASSIGNED" ? `${label}:\n` : ""}${node.textContent || ""}`;
        })
        .join("\n\n"),
      true,
    );
    if (!text) return { kind: "error" };
    return {
      kind: "ok",
      record: {
        text,
        source: "PubMed",
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        fetchedAt: Date.now(),
        pmid,
        ...(identity.doi ? { doi: identity.doi } : {}),
      },
    };
  } catch {
    return { kind: "error" };
  }
}

async function pubmed(
  identity: Identity,
  pmid: string,
  valid: () => boolean,
): Promise<AbstractResult> {
  // E-utilities allows only three starts/second without a key. Serialize this
  // feature's calls as well as spacing them, including concurrent windows.
  const previous = pubmedQueue;
  let release!: () => void;
  pubmedQueue = new Promise<void>((resolve) => (release = resolve));
  await previous;
  try {
    if (!valid()) return { kind: "cancelled" };
    const wait = nextPubmedStart - Date.now();
    if (wait > 0) await Zotero.Promise.delay(wait);
    if (!valid()) return { kind: "cancelled" };
    nextPubmedStart = Date.now() + 400;
    const response = await request(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&tool=zotero-zest`,
      valid,
      "text",
    );
    return failure(response) || parsePubmed(response.value, identity, pmid);
  } finally {
    release();
  }
}

async function crossref(
  identity: Identity,
  valid: () => boolean,
): Promise<AbstractResult> {
  const response = await request(
    `https://api.crossref.org/works/${encodeURIComponent(identity.doi)}`,
    valid,
  );
  const failed = failure(response);
  if (failed) return failed;
  const row = response.value?.message;
  if (!row || doiOf(row.DOI) !== identity.doi) return { kind: "error" };
  if (row.abstract == null || row.abstract === "") return { kind: "missing" };
  const text = recordText(row.abstract);
  if (!text) return { kind: "error" };
  return {
    kind: "ok",
    record: {
      text,
      source: "Crossref",
      url: `https://doi.org/${encodeURIComponent(identity.doi)}`,
      fetchedAt: Date.now(),
      doi: identity.doi,
    },
  };
}

async function resolveAbstract(
  identity: Identity,
  valid: () => boolean,
): Promise<AbstractResult> {
  if (!valid()) return { kind: "cancelled" };
  const results: AbstractResult[] = [];
  const first = await europePMC(identity, valid);
  results.push(first);
  let result: AbstractResult = first;
  const pmid = identity.pmid || first.pmid;
  if (result.kind !== "ok" && valid() && pmid) {
    result = await pubmed(identity, pmid, valid);
    results.push(result);
  }
  // Crossref has no PMID to verify. When an item supplies both identifiers,
  // never let this fallback mask a DOI/PMID conflict rejected by the sources above.
  if (result.kind !== "ok" && valid() && identity.doi && !identity.pmid) {
    result = await crossref(identity, valid);
    results.push(result);
  }
  if (!valid()) return { kind: "cancelled" };
  if (result.kind === "ok" && result.record) {
    cache.set(NS, identity.key, result.record);
    return result;
  }
  // A temporary source failure must never become a six-hour negative cache.
  for (const kind of [
    "throttled",
    "unreachable",
    "error",
    "cancelled",
  ] as const) {
    if (results.some((r) => r.kind === kind)) return { kind };
  }
  cache.set(NS, identity.key, { missing: true });
  return { kind: "missing" };
}

export async function fetchAbstract(
  item: Zotero.Item,
  options: { shouldContinue?: () => boolean } = {},
): Promise<AbstractResult> {
  const identity = abstractIdentity(item);
  if (!identity) return { kind: "no-id" };
  const epoch = generation;
  const valid = () => {
    try {
      return (
        epoch === generation &&
        options.shouldContinue?.() !== false &&
        abstractIdentity(item)?.key === identity.key
      );
    } catch {
      return false;
    }
  };
  if (!valid()) return { kind: "cancelled" };
  const record = cached(identity);
  if (record) return { kind: "ok", record };
  if (
    cache.get(
      NS,
      identity.key,
      (raw) => (raw && (raw as any).missing === true ? true : null),
      MISS_TTL,
    )
  )
    return { kind: "missing" };
  let job = pending.get(identity.key);
  if (!job || ![...job.consumers].some((consumer) => consumer())) {
    const consumers = new Set([valid]);
    const wanted = () => [...consumers].some((consumer) => consumer());
    job = {
      consumers,
      promise: Promise.resolve().then(() => resolveAbstract(identity, wanted)),
    };
    pending.set(identity.key, job);
  } else job.consumers.add(valid);
  try {
    const result = await job.promise;
    if (!valid()) return { kind: "cancelled" };
    return result.record ? { ...result, record: { ...result.record } } : result;
  } catch {
    return { kind: valid() ? "error" : "cancelled" };
  } finally {
    job.consumers.delete(valid);
    if (!job.consumers.size && pending.get(identity.key) === job)
      pending.delete(identity.key);
  }
}

/** Invalidate this generation without disabling a later reopened sidebar. */
export function stopAbstractFetches(): void {
  generation++;
  pending.clear();
}
