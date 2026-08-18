import { getPref, getNumPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import {
  formatAuthors,
  type FormatOptions,
  type NameRules,
  type SelectPolicy,
  type FormattedAuthors,
} from "../authors/pipeline";
import { makeCell, rowItem, type ColumnSpec } from "./registry";

/**
 * Three author columns — Authors, First Author, Last Author — all fed by the
 * same pipeline (src/authors/pipeline.ts) with a different selection policy.
 *
 * Zotero's own Creator column is left alone: these are additional columns, so
 * a user who prefers the native one just does not enable ours.
 *
 * The formatted result is memoised per item and per settings version;
 * `dataProvider` returns the sort key (marks excluded) and `renderCell` paints
 * the parts, so a "†" on the last author never changes the sort order.
 */

type Preset =
  | "creator-like"
  | "all"
  | "first"
  | "last"
  | "first-last"
  | "first3"
  | "advisor";

const cache = new Map<number, { version: number; value: FormattedAuthors }>();
let version = 0;

export function bumpAuthorsVersion() {
  version++;
  cache.clear();
}

function nameRules(): NameRules {
  const order = String(getPref("authors.order") || "auto");
  const given = String(getPref("authors.given") || "full");
  return {
    order:
      order === "given-family" || order === "family-given" ? order : "auto",
    given: given === "initials" || given === "none" ? given : "full",
    initialsDot: getPref("authors.initialsDot") !== false,
  };
}

function policyFor(preset: Preset): SelectPolicy {
  const n = Math.max(1, getNumPref("authors.count", 3));
  switch (preset) {
    case "all":
      return { kind: "all" };
    case "first":
      return { kind: "first" };
    case "last":
      return { kind: "last" };
    case "first-last":
      return { kind: "first+last", n: 1 };
    case "first3":
      return { kind: "first", n, etAl: "append" };
    case "advisor":
      return { kind: "advisor" };
    default:
      // Zotero's own rule: one name, two names joined, otherwise "A et al."
      return { kind: "first", n: 2, etAl: "append" };
  }
}

function etAlText(): string {
  try {
    return Zotero.getString("general.etAl") || "et al.";
  } catch {
    return "et al.";
  }
}

function marks() {
  const self = String(getPref("authors.selfNames") || "")
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    last: getPref("authors.markLast")
      ? String(getPref("authors.lastMark") || "†")
      : undefined,
    self: self.length ? self : undefined,
  };
}

function optionsFor(preset: Preset): FormatOptions {
  return {
    policy: policyFor(preset),
    rules: nameRules(),
    marks: marks(),
    roles: { include: "primary+fallback" },
    etAlText: etAlText(),
  };
}

function compute(item: Zotero.Item, preset: Preset): FormattedAuthors {
  const key = item.id * 8 + PRESET_INDEX[preset];
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit.value;
  let value: FormattedAuthors;
  try {
    value = formatAuthors(item, optionsFor(preset));
  } catch (e) {
    ztoolkit.log("[authors] format failed", e);
    value = { parts: [], sortKey: "", total: 0 };
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { version, value });
  return value;
}

const PRESET_INDEX: Record<Preset, number> = {
  "creator-like": 0,
  all: 1,
  first: 2,
  last: 3,
  "first-last": 4,
  first3: 5,
  advisor: 6,
};

function authorColumn(
  key: string,
  labelID: "column-authors" | "column-first-author" | "column-last-author",
  preset: Preset,
  enablePref: string,
  width: number,
): ColumnSpec {
  return {
    key,
    label: getString(labelID),
    width,
    enabledPref: `extensions.zotero.${config.addonRef}.${enablePref}`,
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      return compute(item, preset).sortKey;
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, key);
      if (!data) return cell;
      const item = rowItem(doc, index);
      const result = item ? compute(item, preset) : undefined;
      if (!result?.parts.length) return cell;
      for (const part of result.parts) {
        if (!part.kind) {
          textSpan.appendChild(doc.createTextNode(part.text));
          continue;
        }
        const span = doc.createElement("span");
        span.className = `zest-author-${part.kind}`;
        span.textContent = part.text;
        textSpan.appendChild(span);
      }
      cell.title = getString("authors-cell-tip", {
        args: { count: result.total },
      });
      return cell;
    },
  };
}

export function authorsColumn(): ColumnSpec {
  const preset = String(getPref("authors.preset") || "creator-like") as Preset;
  return authorColumn(
    "authors",
    "column-authors",
    PRESET_INDEX[preset] === undefined ? "creator-like" : preset,
    "column.authors.enable",
    160,
  );
}

export function firstAuthorColumn(): ColumnSpec {
  return authorColumn(
    "firstauthor",
    "column-first-author",
    "first",
    "column.firstAuthor.enable",
    120,
  );
}

export function lastAuthorColumn(): ColumnSpec {
  return authorColumn(
    "lastauthor",
    "column-last-author",
    "last",
    "column.lastAuthor.enable",
    120,
  );
}

/**
 * Import a better-authors configuration. Its eleven entangled prefs map onto
 * our preset + name rules; anything we cannot express is reported rather than
 * guessed.
 */
export function importBetterAuthors(): {
  applied: string[];
  skipped: string[];
} {
  const applied: string[] = [];
  const skipped: string[] = [];
  const read = (name: string) => {
    try {
      return Zotero.Prefs.get(`extensions.zotero.betterauthors.${name}`, true);
    } catch {
      return undefined;
    }
  };
  const first = read("include-firstauthors-in-list");
  const last = read("include-lastauthor-in-list");
  const n = Number(read("first_n_authors"));
  if (first !== undefined || last !== undefined) {
    if (last && first) {
      Zotero.Prefs.set(
        `${config.prefsPrefix}.authors.preset`,
        "first-last",
        true,
      );
    } else if (last) {
      Zotero.Prefs.set(`${config.prefsPrefix}.authors.preset`, "last", true);
    } else {
      Zotero.Prefs.set(`${config.prefsPrefix}.authors.preset`, "first3", true);
    }
    applied.push("preset");
  }
  if (Number.isFinite(n) && n > 0) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.count`,
      Math.round(n),
      true,
    );
    applied.push("count");
  }
  const nameStyle = String(read("namestyle") ?? "");
  if (nameStyle) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.order`,
      /family|last/i.test(nameStyle) ? "family-given" : "given-family",
      true,
    );
    applied.push("order");
  }
  const firstNameStyle = String(read("firstnamestyle") ?? "");
  if (firstNameStyle) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.given`,
      /initial/i.test(firstNameStyle)
        ? "initials"
        : /none|hide/i.test(firstNameStyle)
          ? "none"
          : "full",
      true,
    );
    applied.push("given");
  }
  const indicator = read("indicator-lastauthor");
  if (indicator !== undefined) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.markLast`,
      !!indicator,
      true,
    );
    applied.push("markLast");
  }
  for (const unsupported of ["sep-author", "sep-name", "show-role"]) {
    if (read(unsupported) !== undefined) skipped.push(unsupported);
  }
  bumpAuthorsVersion();
  return { applied, skipped };
}
