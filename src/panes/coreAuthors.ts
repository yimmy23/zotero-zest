import { nameTokens, type CachedAuthorship } from "../graph/authorIdentity";

interface CreatorName {
  family: string;
  given: string;
}

export interface CoreAuthor {
  index: number;
  first: boolean;
  corresponding: boolean;
  /** Positional fallback only; never a corresponding-author claim. */
  last: boolean;
  row?: CachedAuthorship;
}

export interface CoreInstitution {
  name: string;
  id?: string;
  core: boolean;
  first: boolean;
  corresponding: boolean;
  last: boolean;
  /** Selected authors with a verified name-to-authorship match. */
  authors: string[];
}

const tokens = (value: string) => nameTokens(value.replace(/[,，]/g, " "));
const joined = (value: string[]) => value.join("");

/** Require every supplied given-name token to agree, not just the first one. */
function sameGiven(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (joined(a) === joined(b)) return true;
  // A source may omit middle names. Every token both names actually supply
  // must agree; the caller still rejects more than one compatible person.
  const shared = Math.min(a.length, b.length);
  return a
    .slice(0, shared)
    .every(
      (token, i) =>
        token === b[i] ||
        (token.length === 1 && b[i].startsWith(token)) ||
        (b[i].length === 1 && token.startsWith(b[i])),
    );
}

/** Exact full names win. No surname-only or author-position fallback is safe here. */
function matchStrength(creator: CreatorName, row: CachedAuthorship): number {
  const family = tokens(creator.family);
  const given = tokens(creator.given);
  const display = tokens(row.n);
  if (!family.length || !display.length) return 0;
  const full = joined(display);
  if (
    full === joined([...given, ...family]) ||
    full === joined([...family, ...given])
  ) {
    // An exact initials-only spelling is not stronger evidence than another
    // compatible full name in this same author list.
    return given.length && given.every((token) => token.length === 1) ? 1 : 2;
  }
  if (!given.length) return 0;
  const surname = joined(family);
  for (let length = 1; length < display.length; length++) {
    if (
      (joined(display.slice(0, length)) === surname &&
        sameGiven(given, display.slice(length))) ||
      (joined(display.slice(-length)) === surname &&
        sameGiven(given, display.slice(0, -length)))
    ) {
      return 1;
    }
  }
  return 0;
}

function matchedRows(
  creators: CreatorName[],
  rows: CachedAuthorship[],
): Array<CachedAuthorship | undefined> {
  const scores = creators.map((creator) =>
    rows.map((row) => matchStrength(creator, row)),
  );
  // One provider author may belong to only one local creator. This also rejects
  // ambiguous initials and duplicate local names before assigning a role.
  const owners = rows.map((_, index) => {
    const best = Math.max(0, ...scores.map((score) => score[index]));
    const candidates = scores.flatMap((score, creator) =>
      best > 0 && score[index] === best ? [creator] : [],
    );
    return candidates.length === 1 ? candidates[0] : -1;
  });
  return scores.map((score, creator) => {
    const best = Math.max(
      0,
      ...score.map((strength, row) => (owners[row] === creator ? strength : 0)),
    );
    const candidates = rows.filter(
      (_, row) => best > 0 && owners[row] === creator && score[row] === best,
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  });
}

function rowInstitutions(row: CachedAuthorship) {
  return row.af?.length ? row.af : row.a ? [{ n: row.a }] : [];
}

/** Evidence-backed roles, with a clearly separate positional last-author fallback. */
export function selectCoreAuthors(
  creators: CreatorName[],
  rows: CachedAuthorship[] | null,
): {
  authors: CoreAuthor[];
  visibleAuthorIndices: Set<number>;
  institutions: CoreInstitution[];
  needsDetails: boolean;
} {
  const available = rows || [];
  const matches = matchedRows(creators, available);
  const explicitFirst = matches.flatMap((row, index) =>
    row?.p === "first" ? [index] : [],
  );
  const firstIndex = explicitFirst.length === 1 ? explicitFirst[0] : 0;
  const hasCorresponding = matches.some((row) => row?.c === true);
  const authors = creators.map((_, index): CoreAuthor => {
    const row = matches[index];
    return {
      index,
      first: index === firstIndex,
      corresponding: row?.c === true,
      last:
        !hasCorresponding &&
        creators.length > 1 &&
        index === creators.length - 1,
      ...(row ? { row } : {}),
    };
  });
  const visibleAuthorIndices = new Set(
    authors
      .filter((author) => author.first || author.corresponding || author.last)
      .map((a) => a.index),
  );
  const selectedAuthors = authors.filter(
    (author) =>
      (author.first || author.corresponding || author.last) && author.row,
  );
  const selectedByRow = new Map(
    selectedAuthors.map((author) => [author.row!, author]),
  );
  const primaryRows = selectedAuthors.map((author) => author.row!);
  const coreRows = new Set(primaryRows);
  const institutions: CoreInstitution[] = [];
  const byID = new Map<string, CoreInstitution>();
  const byName = new Map<string, CoreInstitution>();
  const institutionAuthors = new Map<CoreInstitution, Set<string>>();
  for (const row of [
    ...primaryRows,
    ...available.filter((r) => !coreRows.has(r)),
  ]) {
    const selected = selectedByRow.get(row);
    for (const institution of rowInstitutions(row)) {
      const name = institution.n.trim();
      if (!name) continue;
      const key = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
      const id = institution.i?.trim();
      const prior = (id && byID.get(id)) || byName.get(key);
      if (prior) {
        prior.core ||= coreRows.has(row);
        prior.first ||= !!selected?.first;
        prior.corresponding ||= !!selected?.corresponding;
        prior.last ||= !!selected?.last;
        if (selected && !prior.authors.includes(row.n))
          prior.authors.push(row.n);
        institutionAuthors.get(prior)!.add(row.i);
        if (id) {
          prior.id ||= id;
          byID.set(id, prior);
        }
        byName.set(key, prior);
        continue;
      }
      const entry: CoreInstitution = {
        name,
        ...(id ? { id } : {}),
        core: coreRows.has(row),
        first: !!selected?.first,
        corresponding: !!selected?.corresponding,
        last: !!selected?.last,
        authors: selected ? [row.n] : [],
      };
      institutions.push(entry);
      institutionAuthors.set(entry, new Set([row.i]));
      byName.set(key, entry);
      if (id) byID.set(id, entry);
    }
  }
  // Multi-centre sources sometimes attach the same consortium institutions to
  // many authors. Within the selected-author union only, prefer the more
  // author-specific affiliations; ties retain the source's first-author order.
  const coreInstitutions = institutions
    .filter((institution) => institution.core)
    .sort(
      (a, b) =>
        institutionAuthors.get(a)!.size - institutionAuthors.get(b)!.size,
    );
  const otherInstitutions = institutions.filter(
    (institution) => !institution.core,
  );
  // Three previews keep a narrow sidebar compact; everything else remains
  // expandable. This is a display limit, not an institution-importance claim.
  const preview = new Set<CoreInstitution>();
  for (const role of [
    "first",
    hasCorresponding ? "corresponding" : "last",
  ] as const) {
    const representative = coreInstitutions.find(
      (institution) => institution[role],
    );
    if (representative) preview.add(representative);
  }
  for (const institution of coreInstitutions) {
    if (preview.size < 3) preview.add(institution);
  }
  coreInstitutions.forEach(
    (institution) => (institution.core = preview.has(institution)),
  );
  if (!coreInstitutions.length) {
    // With no verified affiliation mapping, preserve the two-institution
    // preview. The UI calls these institutions, never assigns author roles.
    otherInstitutions
      .slice(0, 2)
      .forEach((institution) => (institution.core = true));
  }
  return {
    authors,
    visibleAuthorIndices,
    institutions: [...coreInstitutions, ...otherInstitutions],
    needsDetails: !available.length || available.some((row) => row.v !== 2),
  };
}
