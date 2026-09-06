import { cache } from "../core/storage";

/**
 * Author identity for the graph's author mode: decides which creator
 * occurrences are the same person BEFORE the bipartite graph is built.
 * The old key was surname + first initial, which fused every "Wang, L*"
 * in a Chinese-heavy library into one node.
 *
 * Layer 1 — local name clustering, within one (normalised) surname:
 *   - full given names cluster when they agree ("Xiao-Ming" = "Xiaoming",
 *     "John" joins "John Robert") and stay apart when they differ
 *     ("Lei" vs "Li");
 *   - an initials-only form ("L.") attaches to the ONE compatible cluster
 *     and stands alone when ambiguous ("L." among Lei and Ling) — a wrong
 *     merge costs more than no merge;
 *   - diacritics are folded (Müller = Muller); romanisation variants
 *     (Mueller) are NOT guessed at — that is layer 2's job.
 *
 * Layer 2 — OpenAlex author IDs cached per item (saved by the citations
 * fetch when its chain reaches OpenAlex, topped up by ./authorFetch when
 * the author graph is built). A shared ID merges clusters regardless of
 * spelling and carries the institution into the node's tooltip.
 *
 * This module reads the cache only — no network.
 */

export interface AuthorCategory {
  id: string;
  label: string;
  /** institution (from OpenAlex) for the tooltip */
  hint?: string;
  /** who this is, for the author menu (filter / online search) */
  authorRef?: { family: string; given: string; oaId?: string };
}

/** how a surface names an author when asking the resolver about them */
export interface AuthorLookupRef {
  family: string;
  given: string;
  oaId?: string;
}

export interface AuthorResolver {
  /** categories of an item's creators; `indices` restricts to those slots */
  categoriesFor(item: Zotero.Item, indices?: number[]): AuthorCategory[];
  /** the cluster this name/id belongs to, or null when ambiguous */
  findCategory(ref: AuthorLookupRef): AuthorCategory | null;
  /** itemIDs of the cluster's members (ambiguous ref → compatible union) */
  memberItemIDs(ref: AuthorLookupRef): Set<number>;
}

/** compact per-item authorship rows cached under ns "oaAuthors" */
export interface CachedAuthorship {
  /** OpenAlex author id, e.g. "A5023888391" */
  i: string;
  /** display name, e.g. "Lei Wang" */
  n: string;
  /** first institution (or raw affiliation string) */
  a?: string;
  /** Detailed authorship schema; present even when roles are unknown. */
  v?: 2;
  p?: "first" | "middle" | "last";
  /** Only a provider's explicit boolean is accepted; last is not corresponding. */
  c?: boolean;
  /** Complete, bounded institution names, in the provider's order. */
  af?: Array<{ i?: string; n: string }>;
  /** DOI used for this lookup, so edits cannot reuse another paper's roles. */
  d?: string;
}

export const OA_AUTHORS_NS = "oaAuthors";

export function authorshipsKey(item: Zotero.Item): string {
  return `${item.libraryID}/${item.key}`;
}

const MAX_AUTHORS = 100;
const MAX_INSTITUTIONS = 40;

function doiKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const doi = value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi.toLowerCase() : "";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function institutions(raw: unknown): NonNullable<CachedAuthorship["af"]> {
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<CachedAuthorship["af"]> = [];
  const seen = new Set<string>();
  for (const value of raw.slice(0, MAX_INSTITUTIONS)) {
    const n = text(value?.n, 2000);
    const i = text(value?.i, 100).split("/").pop();
    const key = i || n.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (!n || seen.has(key)) continue;
    seen.add(key);
    out.push(i ? { i, n } : { n });
  }
  return out;
}

/** Preserve role evidence and full institutions while keeping old graph hints. */
export function compactAuthorships(
  raw: unknown,
  doi?: string,
): CachedAuthorship[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CachedAuthorship[] = [];
  const d = doiKey(doi);
  for (const a of raw.slice(0, MAX_AUTHORS)) {
    const id = text(a?.author?.id, 100).split("/").pop();
    const n = text(a?.author?.display_name, 500);
    if (!id || !n) continue;
    let af = institutions(
      Array.isArray(a?.institutions)
        ? a.institutions.slice(0, MAX_INSTITUTIONS).map((inst: any) => ({
            i: inst?.id,
            n: inst?.display_name,
          }))
        : [],
    );
    if (!af.length && Array.isArray(a?.raw_affiliation_strings)) {
      af = institutions(
        a.raw_affiliation_strings
          .slice(0, MAX_INSTITUTIONS)
          .map((n: unknown) => ({ n })),
      );
    }
    const row: CachedAuthorship = { i: id, n, v: 2 };
    if (af.length) {
      row.af = af;
      row.a = af[0].n.slice(0, 120).trim();
    }
    if (["first", "middle", "last"].includes(a?.author_position)) {
      row.p = a.author_position;
    }
    if (typeof a?.is_corresponding === "boolean") row.c = a.is_corresponding;
    if (d) row.d = d;
    out.push(row);
  }
  return out.length ? out : null;
}

function sanitizeRows(raw: unknown): CachedAuthorship[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CachedAuthorship[] = [];
  for (const r of raw.slice(0, MAX_AUTHORS)) {
    if (!r || typeof r !== "object") continue;
    const i = text(r.i, 100);
    const n = text(r.n, 500);
    if (!i || !n) continue;
    const row: CachedAuthorship = { i, n };
    const a = text(r.a, 2000);
    if (a) row.a = a;
    if (r.v === 2) {
      row.v = 2;
      if (["first", "middle", "last"].includes(r.p)) row.p = r.p;
      if (typeof r.c === "boolean") row.c = r.c;
      const af = institutions(r.af);
      if (af.length) row.af = af;
      const d = doiKey(r.d);
      if (d) row.d = d;
    }
    out.push(row);
  }
  return out.length ? out : null;
}

export function cachedAuthorships(
  item: Zotero.Item,
): CachedAuthorship[] | null {
  const hit = cache.get(OA_AUTHORS_NS, authorshipsKey(item), sanitizeRows);
  if (!hit) return null;
  if (hit.data.some((row) => row.d)) {
    let doi = "";
    try {
      doi = doiKey(item.getField("DOI"));
    } catch {
      // An absent/removed DOI cannot validate a detailed record's identity.
    }
    if (hit.data.some((row) => row.d && row.d !== doi)) return null;
  }
  return hit.data;
}

// --------------------------------------------------------- normalisation

const stripDiacritics = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function nameTokens(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .split(/[\s\-.·']+/)
    .filter(Boolean);
}

const joined = (tokens: string[]) => tokens.join("");

const isInitials = (tokens: string[]) =>
  tokens.length > 0 && tokens.every((t) => t.length === 1);

/** token pair: equal words, or a single letter matching the word's initial */
function tokenCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * Two given-name forms may be the same person: hyphen/space variants are
 * equal when joined, otherwise tokens must agree pairwise over the shorter
 * form (extra middle names are free). "lei" vs "li" fails; "j r" passes
 * against "john robert"; "xiao ming" equals "xiaoming".
 */
export function givensCompatible(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (joined(a) === joined(b)) return true;
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    if (!tokenCompatible(a[k], b[k])) return false;
  }
  return true;
}

// ------------------------------------------------------------- clustering

interface Occ {
  key: string; // `${lib}/${itemKey}#${creatorIndex}`
  last: string; // surname as entered
  first: string; // given name as entered
  tokens: string[]; // normalised given tokens
  oaId?: string;
  inst?: string;
}

interface Cluster {
  oaId?: string;
  /** representative given tokens — the longest full form seen */
  rep: string[];
  occs: Occ[];
  inst?: string;
}

interface Form {
  tokens: string[];
  occs: Occ[];
}

/** every letter of `short` appears in `long` in order (Mueller ⊃ Muller) */
function subsequenceOf(short: string, long: string): boolean {
  if (short.length < 3 || long.length < short.length) return false;
  let j = 0;
  for (let i = 0; i < long.length && j < short.length; i++) {
    if (long[i] === short[j]) j++;
  }
  return j === short.length;
}

function surnameInRow(surKey: string, row: CachedAuthorship): boolean {
  const t = nameTokens(row.n);
  return (
    t.includes(surKey) ||
    joined(t).endsWith(surKey) ||
    joined(t).startsWith(surKey) ||
    // romanisation variants: ue↔u, oe↔o, folded diacritics — one spelling
    // is a letter-subsequence of the other
    t.some((x) => subsequenceOf(x, surKey) || subsequenceOf(surKey, x))
  );
}

/**
 * Creator ↔ cached OpenAlex authorship. Name-based first; when that finds
 * nothing and the creator list lines up 1:1 with the authorship list, the
 * POSITION decides (OpenAlex keeps author order), still guarded by a loose
 * surname check so a mismatched list cannot bind the wrong person.
 * Only an unambiguous match counts.
 */
function matchAuthorship(
  last: string,
  first: string,
  rows: CachedAuthorship[],
  idx: number,
  total: number,
): CachedAuthorship | null {
  const surKey = joined(nameTokens(last));
  if (!surKey) return null;
  let candidates = rows.filter((r) => surnameInRow(surKey, r));
  if (candidates.length > 1 && first) {
    const g0 = nameTokens(first)[0];
    if (g0) {
      const refined = candidates.filter((r) =>
        nameTokens(r.n)
          .filter((x) => x !== surKey)
          .some((x) => tokenCompatible(g0, x)),
      );
      if (refined.length) candidates = refined;
    }
  }
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length && rows.length === total && rows[idx]) {
    return rows[idx];
  }
  return null;
}

function newCluster(f: Form): Cluster {
  return { rep: f.tokens, occs: [...f.occs] };
}

function attach(c: Cluster, f: Form) {
  c.occs.push(...f.occs);
}

function clusterSurnameGroup(occs: Occ[]): Cluster[] {
  // identified occurrences group by OpenAlex id, whatever the spelling
  const byOa = new Map<string, Cluster>();
  const nameOccs: Occ[] = [];
  for (const o of occs) {
    if (!o.oaId) {
      nameOccs.push(o);
      continue;
    }
    let c = byOa.get(o.oaId);
    if (!c) {
      c = { oaId: o.oaId, rep: [], occs: [] };
      byOa.set(o.oaId, c);
    }
    c.occs.push(o);
    if (!c.inst && o.inst) c.inst = o.inst;
    const fuller =
      o.tokens.length &&
      !isInitials(o.tokens) &&
      joined(o.tokens).length > joined(c.rep).length;
    if (!c.rep.length || fuller) c.rep = o.tokens;
  }

  // the rest cluster by name: one Form per distinct normalised given name
  const formMap = new Map<string, Form>();
  for (const o of nameOccs) {
    const k = joined(o.tokens);
    let f = formMap.get(k);
    if (!f) {
      f = { tokens: o.tokens, occs: [] };
      formMap.set(k, f);
    }
    f.occs.push(o);
  }
  const anchors: Form[] = [];
  const abbrevs: Form[] = [];
  const empties: Form[] = [];
  for (const f of formMap.values()) {
    if (!f.tokens.length) empties.push(f);
    else if (isInitials(f.tokens)) abbrevs.push(f);
    else anchors.push(f);
  }

  // full forms first, longest first, so the representative stays the
  // richest spelling and shorter forms attach to it
  anchors.sort(
    (a, b) =>
      b.tokens.length - a.tokens.length ||
      joined(b.tokens).length - joined(a.tokens).length ||
      (joined(a.tokens) < joined(b.tokens) ? -1 : 1),
  );
  const nameClusters: Cluster[] = [];
  for (const f of anchors) {
    const hits = nameClusters.filter((c) => givensCompatible(f.tokens, c.rep));
    if (hits.length === 1) attach(hits[0], f);
    else nameClusters.push(newCluster(f));
  }

  // initials attach only when exactly one cluster fits
  for (const f of abbrevs) {
    const pool = [...byOa.values(), ...nameClusters];
    const hits = pool.filter(
      (c) => c.rep.length > 0 && givensCompatible(f.tokens, c.rep),
    );
    if (hits.length === 1) attach(hits[0], f);
    else nameClusters.push(newCluster(f));
  }
  for (const f of empties) nameClusters.push(newCluster(f));

  // a pure name cluster joins the ONE identified cluster it is compatible
  // with, so items without cached data still land on the right person
  const oaList = [...byOa.values()];
  const kept: Cluster[] = [];
  for (const c of nameClusters) {
    const hits =
      c.rep.length && oaList.length
        ? oaList.filter(
            (oc) => oc.rep.length && givensCompatible(c.rep, oc.rep),
          )
        : [];
    if (hits.length === 1) {
      hits[0].occs.push(...c.occs);
      const fuller =
        !isInitials(c.rep) && joined(c.rep).length > joined(hits[0].rep).length;
      if (fuller) hits[0].rep = c.rep;
    } else {
      kept.push(c);
    }
  }
  return [...oaList, ...kept];
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

function categoryFor(
  c: Cluster,
  surRaw: string,
  surKey: string,
): AuthorCategory {
  // display given name: the longest raw full form seen in this cluster
  let bestFirst = "";
  let bestIsFull = false;
  for (const o of c.occs) {
    const raw = o.first.trim();
    if (!raw) continue;
    const rawIsFull = !isInitials(nameTokens(raw));
    if (
      !bestFirst ||
      (rawIsFull && !bestIsFull) ||
      (rawIsFull === bestIsFull && raw.length > bestFirst.length)
    ) {
      bestFirst = raw;
      bestIsFull = rawIsFull;
    }
  }
  let label: string;
  if (!bestFirst) label = surRaw;
  else if (!bestIsFull) label = `${surRaw} ${bestFirst[0].toUpperCase()}.`;
  else if (CJK_RE.test(surRaw + bestFirst)) label = `${surRaw}${bestFirst}`;
  else label = `${surRaw} ${bestFirst}`;
  const id = c.oaId ? `a:oa:${c.oaId}` : `a:${surKey}|${joined(c.rep)}`;
  const out: AuthorCategory = {
    id,
    label,
    authorRef: { family: surRaw, given: bestFirst, oaId: c.oaId },
  };
  if (c.inst) out.hint = c.inst;
  return out;
}

/** the cached OpenAlex identity of one creator of one item, if any */
export function findCachedAuthor(
  item: Zotero.Item,
  family: string,
  given: string,
): CachedAuthorship | null {
  const rows = cachedAuthorships(item);
  if (!rows) return null;
  // -1/-1 disables the positional fallback: without a creator index the
  // name has to speak for itself
  return matchAuthorship(family, given, rows, -1, -1);
}

// ---------------------------------------------------------------- resolver

type Groups = Map<string, { surRaw: string; occs: Occ[] }>;

/** phase 1 of the resolver: one item's creators into surname groups */
function collectOccurrences(item: Zotero.Item, groups: Groups): void {
  {
    let creators: ReturnType<Zotero.Item["getCreators"]>;
    try {
      creators = item.getCreators();
    } catch {
      return;
    }
    if (!creators?.length) return;
    const rows = cachedAuthorships(item);
    creators.forEach((cr, idx) => {
      const last = (cr.lastName || "").trim();
      if (!last) return;
      const first = (cr.firstName || "").trim();
      const surKey = joined(nameTokens(last)) || last;
      const occ: Occ = {
        key: `${item.libraryID}/${item.key}#${idx}`,
        last,
        first,
        tokens: nameTokens(first),
      };
      if (rows) {
        const m = matchAuthorship(last, first, rows, idx, creators.length);
        if (m) {
          occ.oaId = m.i;
          occ.inst = m.a;
        }
      }
      let g = groups.get(surKey);
      if (!g) {
        g = { surRaw: last, occs: [] };
        groups.set(surKey, g);
      }
      g.occs.push(occ);
    });
  }
}

/** phase 2: cluster every group and wire the lookups */
function finishResolver(groups: Groups): AuthorResolver {
  const occCat = new Map<string, AuthorCategory>();
  const groupIndex = new Map<
    string,
    Array<{ cat: AuthorCategory; cluster: Cluster }>
  >();
  const membersByCat = new Map<string, Set<string>>();
  for (const [surKey, g] of groups) {
    const entries: Array<{ cat: AuthorCategory; cluster: Cluster }> = [];
    for (const cluster of clusterSurnameGroup(g.occs)) {
      const cat = categoryFor(cluster, g.surRaw, surKey);
      entries.push({ cat, cluster });
      let mem = membersByCat.get(cat.id);
      if (!mem) {
        mem = new Set();
        membersByCat.set(cat.id, mem);
      }
      for (const o of cluster.occs) {
        occCat.set(o.key, cat);
        mem.add(o.key.split("#")[0]);
      }
    }
    groupIndex.set(surKey, entries);
  }

  const findCategory = (ref: AuthorLookupRef): AuthorCategory | null => {
    const surKey = joined(nameTokens(ref.family)) || ref.family;
    const group = groupIndex.get(surKey);
    if (!group) return null;
    if (ref.oaId) {
      const hit = group.find((e) => e.cat.id === `a:oa:${ref.oaId}`);
      if (hit) return hit.cat;
    }
    const tokens = nameTokens(ref.given);
    if (!tokens.length) {
      // bare surname (single-field CJK names): the no-given cluster
      const bare = group.find((e) => !e.cluster.rep.length);
      if (bare) return bare.cat;
      return group.length === 1 ? group[0].cat : null;
    }
    const exact = group.find((e) => joined(e.cluster.rep) === joined(tokens));
    if (exact) return exact.cat;
    const compat = group.filter(
      (e) => e.cluster.rep.length && givensCompatible(tokens, e.cluster.rep),
    );
    return compat.length === 1 ? compat[0].cat : null;
  };

  const itemIDsOf = (keys: Iterable<string>): Set<number> => {
    const out = new Set<number>();
    for (const k of keys) {
      const [lib, key] = k.split("/");
      try {
        const it = Zotero.Items.getByLibraryAndKey(Number(lib), key);
        if (it) out.add((it as Zotero.Item).id);
      } catch {
        // gone since the resolver was built
      }
    }
    return out;
  };

  const memberItemIDs = (ref: AuthorLookupRef): Set<number> => {
    const tokens = nameTokens(ref.given);
    // a full name (or an id) names ONE person — their cluster and no more.
    // An initials-only name ("Wang L.") is inherently ambiguous, so the
    // honest answer is the superset: every compatible cluster of that
    // surname, for the reader to eyeball.
    if (!isInitials(tokens)) {
      const cat = findCategory(ref);
      if (cat) return itemIDsOf(membersByCat.get(cat.id) || []);
    }
    const surKey = joined(nameTokens(ref.family)) || ref.family;
    const group = groupIndex.get(surKey) || [];
    const keys = new Set<string>();
    for (const e of group) {
      const fits = !tokens.length
        ? true
        : e.cluster.rep.length > 0 && givensCompatible(tokens, e.cluster.rep);
      if (!fits) continue;
      for (const k of membersByCat.get(e.cat.id) || []) keys.add(k);
    }
    return itemIDsOf(keys);
  };

  return {
    findCategory,
    memberItemIDs,
    categoriesFor(item: Zotero.Item, indices?: number[]): AuthorCategory[] {
      const out: AuthorCategory[] = [];
      const seen = new Set<string>();
      let creators: ReturnType<Zotero.Item["getCreators"]>;
      try {
        creators = item.getCreators();
      } catch {
        return out;
      }
      const wanted = indices ? new Set(indices) : null;
      creators.forEach((_cr, idx) => {
        if (wanted && !wanted.has(idx)) return;
        const cat = occCat.get(`${item.libraryID}/${item.key}#${idx}`);
        if (cat && !seen.has(cat.id)) {
          seen.add(cat.id);
          out.push(cat);
        }
      });
      return out;
    },
  };
}

export function buildAuthorResolver(items: Zotero.Item[]): AuthorResolver {
  const groups: Groups = new Map();
  for (const item of items) collectOccurrences(item, groups);
  return finishResolver(groups);
}

/**
 * Chunked variant for library-wide scans (the author filter): identical
 * result, but the creator sweep yields to the event loop between chunks so
 * a 50k-item library does not freeze the UI for the whole pass.
 */
export async function buildAuthorResolverAsync(
  items: Zotero.Item[],
  chunkSize = 800,
): Promise<AuthorResolver> {
  const groups: Groups = new Map();
  let n = 0;
  for (const item of items) {
    collectOccurrences(item, groups);
    if (++n % chunkSize === 0) await Zotero.Promise.delay(0);
  }
  return finishResolver(groups);
}

/**
 * Creator slots of the first and the last author (biomed convention: the
 * last slot is the corresponding author's — Zotero has no explicit
 * corresponding-author field). Primary-role creators only, falling back to
 * the whole list for item types without one.
 */
export function firstLastIndices(item: Zotero.Item): number[] {
  let creators: ReturnType<Zotero.Item["getCreators"]>;
  try {
    creators = item.getCreators();
  } catch {
    return [];
  }
  if (!creators?.length) return [];
  let primary = -1;
  try {
    primary = (Zotero.CreatorTypes as any).getPrimaryIDForType(item.itemTypeID);
  } catch {
    primary = -1;
  }
  let idxs = creators
    .map((c, i) => ({ c, i }))
    .filter((e) => primary < 0 || (e.c as any).creatorTypeID === primary)
    .map((e) => e.i);
  if (!idxs.length) idxs = creators.map((_c, i) => i);
  const first = idxs[0];
  const last = idxs[idxs.length - 1];
  return first === last ? [first] : [first, last];
}
