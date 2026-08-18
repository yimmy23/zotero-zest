/**
 * Author formatting as a pipeline of pure steps:
 *
 *   resolveRoles → normalize → select → format → decorate
 *
 * Redone from better-authors' logic with three structural fixes:
 *   - no creator-type NUMBERS anywhere: the primary role comes from
 *     `Zotero.CreatorTypes.getPrimaryIDForType(itemTypeID)`, so a thesis shows
 *     its author and a film shows its director (the original hardcoded 8);
 *   - marks (†, *, bold "me") are produced as parts and rendered as spans, so
 *     they never end up inside the sort key;
 *   - the separator between two names is chosen from the SCRIPTS of those two
 *     names, so "王小明、李雷, Smith" comes out right instead of one global
 *     `join` string.
 *
 * Everything here is deterministic and Zotero-free except `resolveRoles`,
 * which is the only step that touches an item.
 */

export type NameScript =
  "han" | "kana" | "hangul" | "latin" | "cyrillic" | "other";

export interface NormalizedCreator {
  family: string;
  given: string;
  /** single-field creator (institution) — never reordered or initialised */
  single: boolean;
  script: NameScript;
  role: string;
}

export type SelectPolicy =
  | { kind: "all" }
  /** n given → the first n then "et al."; n absent → only the first author */
  | { kind: "first"; n?: number; etAl?: "append" | "omit" }
  | { kind: "first+last"; n: number }
  | { kind: "last" }
  | { kind: "advisor" };

export interface NameRules {
  order: "given-family" | "family-given" | "auto";
  given: "full" | "initials" | "none";
  /** "J." vs "J" */
  initialsDot: boolean;
}

export interface Marks {
  /** highlight the last author (often the corresponding one) */
  last?: string;
  /** highlight the first author */
  first?: string;
  /** names to render as "me" */
  self?: string[];
}

export interface AuthorPart {
  text: string;
  /** css suffix: "self" | "last" | "first" | "mark" | "" */
  kind?: "self" | "last" | "first" | "mark";
}

export interface FormattedAuthors {
  parts: AuthorPart[];
  /** what the column sorts by — no marks, no punctuation, folded case */
  sortKey: string;
  /** total number of creators before selection */
  total: number;
}

const HAN = /\p{Script=Han}/u;
const KANA = /\p{Script=Hiragana}|\p{Script=Katakana}/u;
const HANGUL = /\p{Script=Hangul}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

export function scriptOf(text: string): NameScript {
  if (!text) return "other";
  if (HAN.test(text)) return "han";
  if (KANA.test(text)) return "kana";
  if (HANGUL.test(text)) return "hangul";
  if (CYRILLIC.test(text)) return "cyrillic";
  if (LATIN.test(text)) return "latin";
  return "other";
}

const CJK = new Set<NameScript>(["han", "kana", "hangul"]);

/** separator between two adjacent names, decided by both their scripts */
export function separatorFor(a: NameScript, b: NameScript): string {
  return CJK.has(a) && CJK.has(b) ? "、" : ", ";
}

/* ------------------------------------------------------------------ */
/* 1. roles                                                            */
/* ------------------------------------------------------------------ */

export interface RoleOptions {
  /** which creators take part: the primary role, or every creator */
  include: "primary" | "primary+fallback" | "all";
}

/**
 * The creators that count for this item, in item order. The primary type is
 * asked of Zotero per item type; editor/contributor act as a fallback so an
 * edited volume is not blank (Zotero's own Creator column does the same).
 */
export function resolveRoles(
  item: Zotero.Item,
  options: RoleOptions = { include: "primary+fallback" },
): NormalizedCreator[] {
  let creators: any[];
  try {
    if (!(item instanceof Zotero.Item) || !item.isRegularItem()) return [];
    creators = item.getCreators() || [];
  } catch {
    return [];
  }
  if (!creators.length) return [];

  let primaryID: number | undefined;
  try {
    primaryID = Zotero.CreatorTypes.getPrimaryIDForType(
      item.itemTypeID,
    ) as number;
  } catch {
    primaryID = undefined;
  }
  const nameOf = (id: number): string => {
    try {
      return String(Zotero.CreatorTypes.getName(id) || "");
    } catch {
      return "";
    }
  };

  const all = creators.map((c) => normalizeCreator(c, nameOf(c.creatorTypeID)));
  if (options.include === "all") return all;

  const primary = all.filter(
    (c, i) =>
      primaryID !== undefined && creators[i].creatorTypeID === primaryID,
  );
  if (primary.length) return primary;
  if (options.include === "primary") return [];

  for (const role of ["editor", "director", "contributor", "inventor"]) {
    const hit = all.filter((c) => c.role === role);
    if (hit.length) return hit;
  }
  return all;
}

export function normalizeCreator(raw: any, role: string): NormalizedCreator {
  const single =
    raw?.fieldMode === 1 ||
    (!raw?.firstName && !!raw?.lastName && raw?.fieldMode);
  const family = String(raw?.lastName ?? "").trim();
  const given = String(raw?.firstName ?? "").trim();
  return {
    family,
    given,
    single: !!single,
    script: scriptOf(family || given),
    role: role || "author",
  };
}

/** the thesis advisor, if the item has one (first contributor) */
export function advisorOf(item: Zotero.Item): NormalizedCreator | undefined {
  const all = resolveRoles(item, { include: "all" });
  return all.find((c) => c.role === "contributor" || c.role === "advisor");
}

/* ------------------------------------------------------------------ */
/* 2. select                                                           */
/* ------------------------------------------------------------------ */

export interface Selection {
  shown: NormalizedCreator[];
  /** true when names were left out between the first group and the last */
  omitted: boolean;
  /** true when the tail was cut with "et al." */
  etAl: boolean;
}

export function select(
  list: NormalizedCreator[],
  policy: SelectPolicy,
): Selection {
  const n = list.length;
  if (!n) return { shown: [], omitted: false, etAl: false };
  switch (policy.kind) {
    case "first": {
      // `{kind:"first"}` means "just the first author"; `{kind:"first", n}`
      // means "the first n, then et al." — the presence of n decides
      const withN = policy as { n?: number; etAl?: "append" | "omit" };
      if (typeof withN.n !== "number") {
        return { shown: [list[0]], omitted: n > 1, etAl: false };
      }
      const k = Math.max(1, withN.n);
      if (n <= k) return { shown: list, omitted: false, etAl: false };
      return {
        shown: list.slice(0, k),
        omitted: withN.etAl === "omit",
        etAl: withN.etAl !== "omit",
      };
    }
    case "last":
      return { shown: [list[n - 1]], omitted: n > 1, etAl: false };
    case "advisor":
      return { shown: [], omitted: false, etAl: false };
    case "all":
      return { shown: list, omitted: false, etAl: false };
    case "first+last": {
      const k = Math.max(1, policy.n);
      if (n <= k + 1) return { shown: list, omitted: false, etAl: false };
      return {
        shown: [...list.slice(0, k), list[n - 1]],
        omitted: true,
        etAl: false,
      };
    }
    default:
      return { shown: list, omitted: false, etAl: false };
  }
}

/* ------------------------------------------------------------------ */
/* 3. format one name                                                  */
/* ------------------------------------------------------------------ */

export function formatName(c: NormalizedCreator, rules: NameRules): string {
  if (c.single) return c.family || c.given;
  // each half decides for itself: "李 Ming" and "Wang 小明" are both real, and
  // reading the whole name off the family name alone mangles them (no space,
  // or Han characters initialised to "小.")
  const famCJK = CJK.has(scriptOf(c.family));
  const givCJK = CJK.has(scriptOf(c.given));
  const order =
    rules.order === "auto"
      ? famCJK
        ? "family-given"
        : "given-family"
      : rules.order;
  let given = c.given;
  if (rules.given === "none") given = "";
  else if (rules.given === "initials" && given && !givCJK) {
    given = given
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + (rules.initialsDot ? "." : ""))
      .join(" ");
  }
  if (!given) return c.family;
  if (!c.family) return given;
  const gap = famCJK && givCJK ? "" : " ";
  return order === "family-given"
    ? `${c.family}${gap}${given}`
    : `${given}${gap}${c.family}`;
}

/* ------------------------------------------------------------------ */
/* 4. decorate + assemble                                              */
/* ------------------------------------------------------------------ */

const DIACRITICS = /[̀-ͯ]/g;

export function foldName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * "Is this me?" — matched on whole name parts, never as a substring: a
 * substring test makes "Li" match "Alice" and quietly bolds the wrong author.
 * Accepted forms: the family name alone, "family given", "given family", and
 * "family g" (initial).
 */
function isSelf(c: NormalizedCreator, self: string[] | undefined): boolean {
  if (!self?.length) return false;
  const family = foldName(c.family);
  const given = foldName(c.given);
  if (!family && !given) return false;
  const initial = given ? given[0] : "";
  const forms = new Set(
    [
      family,
      given && `${family} ${given}`,
      given && `${given} ${family}`,
      initial && `${family} ${initial}`,
      initial && `${initial} ${family}`,
    ].filter(Boolean) as string[],
  );
  return self.some((raw) => {
    const s = foldName(raw);
    return !!s && forms.has(s);
  });
}

export interface FormatOptions {
  policy: SelectPolicy;
  rules: NameRules;
  marks?: Marks;
  roles?: RoleOptions;
  /** localized "et al." (falls back to the Latin abbreviation) */
  etAlText?: string;
  /** what to put where names were dropped */
  omittedText?: string;
}

/**
 * "First author only" and "Last author only" deliberately show one name, so a
 * trailing "…" there reads as truncation rather than as a choice; the real
 * count is in the cell tooltip. Only a policy that asked for a capped list
 * ({kind:"first", n, etAl:"omit"}) gets the marker — "first+last" places its
 * own marker inline, between the two names.
 */
function wantsOmittedMarker(policy: SelectPolicy): boolean {
  return policy.kind === "first" && typeof policy.n === "number";
}

export function formatAuthors(
  item: Zotero.Item,
  options: FormatOptions,
): FormattedAuthors {
  const all = resolveRoles(item, options.roles);
  if (options.policy.kind === "advisor") {
    // the advisor is a contributor, so the count has to come from the full
    // creator list, not from the primary-role list `all` holds
    const every = resolveRoles(item, { include: "all" });
    const advisor = every.find(
      (c) => c.role === "contributor" || c.role === "advisor",
    );
    const text = advisor ? formatName(advisor, options.rules) : "";
    return {
      parts: text ? [{ text }] : [],
      sortKey: foldName(text),
      total: every.length,
    };
  }
  if (!all.length) return { parts: [], sortKey: "", total: 0 };

  const { shown, omitted, etAl } = select(all, options.policy);
  const parts: AuthorPart[] = [];
  const sortPieces: string[] = [];
  const lastIndex = all.length - 1;
  const omittedText = options.omittedText ?? "…";

  shown.forEach((c, i) => {
    if (i > 0) {
      const prev = shown[i - 1];
      // "first + last" hides the middle: show the gap, not a plain comma
      const gapHere =
        omitted &&
        options.policy.kind === "first+last" &&
        i === shown.length - 1;
      parts.push({
        text: gapHere
          ? `${separatorFor(prev.script, c.script)}${omittedText}${separatorFor(prev.script, c.script)}`
          : separatorFor(prev.script, c.script),
      });
    }
    const text = formatName(c, options.rules);
    const originalIndex = all.indexOf(c);
    let kind: AuthorPart["kind"];
    if (isSelf(c, options.marks?.self)) kind = "self";
    else if (
      options.marks?.last &&
      originalIndex === lastIndex &&
      all.length > 1
    )
      kind = "last";
    else if (options.marks?.first && originalIndex === 0 && all.length > 1)
      kind = "first";
    parts.push({ text, kind });
    // the mark itself is a separate part, so it stays out of the sort key
    if (kind === "last" && options.marks?.last) {
      parts.push({ text: options.marks.last, kind: "mark" });
    } else if (kind === "first" && options.marks?.first) {
      parts.push({ text: options.marks.first, kind: "mark" });
    }
    sortPieces.push(foldName(`${c.family} ${c.given}`));
  });

  if (etAl) {
    const last = shown[shown.length - 1];
    parts.push({
      text: `${separatorFor(last?.script ?? "latin", "latin")}${options.etAlText ?? "et al."}`,
    });
  } else if (omitted && wantsOmittedMarker(options.policy)) {
    parts.push({ text: ` ${omittedText}` });
  }

  return {
    parts,
    sortKey: sortPieces.join(" | "),
    total: all.length,
  };
}
