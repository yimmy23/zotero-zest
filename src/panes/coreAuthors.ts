import {
  matchAuthorships,
  type AuthorshipCreator as CreatorName,
  type CachedAuthorship,
} from "../graph/authorIdentity";

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
  const matches = matchAuthorships(creators, available);
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
