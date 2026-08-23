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

type Preset = "all" | "first" | "last" | "first-last" | "first3" | "advisor";

const cache = new Map<
  number,
  { version: number; mod: string; value: FormattedAuthors }
>();
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
      // the first N names, the gap marker, then the last author
      return { kind: "first+last", n };
    case "first3":
      return { kind: "first", n, etAl: "append" };
    case "advisor":
      return { kind: "advisor" };
    default:
      return { kind: "first", n, etAl: "append" };
  }
}

/** the user's own "et al." text, else Zotero's localized one */
export function etAlText(): string {
  const own = String(getPref("authors.etAl") || "").trim();
  if (own) return own;
  try {
    return Zotero.getString("general.etAl") || "et al.";
  } catch {
    return "et al.";
  }
}

/** separator between names: the user's own, or per-script automatic */
function separatorPref(): string | undefined {
  const raw = String(getPref("authors.separator") ?? "");
  return raw === "" ? undefined : raw;
}

/** marker where names were left out ("…" unless the user set one) */
function omittedPref(): string {
  const raw = String(getPref("authors.omitted") ?? "");
  return raw === "" ? "…" : raw;
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
  const rules = nameRules();
  return {
    policy: policyFor(preset),
    rules,
    marks: marks(),
    roles: { include: "primary+fallback" },
    etAlText: etAlText(),
    separator: separatorPref(),
    omittedText: omittedPref(),
  };
}

/**
 * The Zest item-pane section lists EVERY author on one line with the user's
 * own name rules and marks — Zotero's Info box shows creators one row at a
 * time (first five, then "N more"), which the maintainer found not enough to
 * scan. Same rules and marks as the Authors column, so the two agree.
 */
export function panelAuthorOptions(): FormatOptions {
  return {
    policy: { kind: "all" },
    rules: nameRules(),
    marks: marks(),
    roles: { include: "primary+fallback" },
    etAlText: etAlText(),
    separator: separatorPref(),
    omittedText: omittedPref(),
  };
}

/** cheap per-item stamp: any save (including a synced one) moves it */
function modStamp(item: Zotero.Item): string {
  try {
    return String(item.dateModified || "") + ":" + String(item.version ?? 0);
  } catch {
    return "";
  }
}

function compute(item: Zotero.Item, preset: Preset): FormattedAuthors {
  const key = item.id * 8 + PRESET_INDEX[preset];
  const mod = modStamp(item);
  const hit = cache.get(key);
  // version = the formatting prefs changed; mod = this item's creators may have
  if (hit && hit.version === version && hit.mod === mod) return hit.value;
  let value: FormattedAuthors;
  try {
    value = formatAuthors(item, optionsFor(preset));
  } catch (e) {
    ztoolkit.log("[authors] format failed", e);
    value = { parts: [], sortKey: "", total: 0 };
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { version, mod, value });
  return value;
}

const PRESET_INDEX: Record<Preset, number> = {
  all: 1,
  first: 2,
  last: 3,
  "first-last": 4,
  first3: 5,
  advisor: 6,
};

/**
 * `preset` is a function, not a value: the column spec is built once, at
 * registration, but the Authors column's preset is a preference the user can
 * change at any time — capturing it here meant the setting did nothing until
 * Zotero restarted.
 */
function authorColumn(
  key: string,
  labelID: "column-authors" | "column-first-author" | "column-last-author",
  presetOf: () => Preset,
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
      return compute(item, presetOf()).sortKey;
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, key);
      if (!data) return cell;
      const item = rowItem(doc, index);
      const result = item ? compute(item, presetOf()) : undefined;
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

function configuredPreset(): Preset {
  // "creator-like" (a copy of Zotero's own Creator column) was retired: a
  // stored value of it, or anything unknown, reads as the first-N preset
  const preset = String(getPref("authors.preset") || "first3") as Preset;
  return PRESET_INDEX[preset] === undefined ? "first3" : preset;
}

export function authorsColumn(): ColumnSpec {
  return authorColumn(
    "authors",
    "column-authors",
    configuredPreset,
    "column.authors.enable",
    160,
  );
}

export function firstAuthorColumn(): ColumnSpec {
  return authorColumn(
    "firstauthor",
    "column-first-author",
    () => "first",
    "column.firstAuthor.enable",
    120,
  );
}

export function lastAuthorColumn(): ColumnSpec {
  return authorColumn(
    "lastauthor",
    "column-last-author",
    () => "last",
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
  const indicator = read("indicator-for-lastauthor");
  if (indicator !== undefined) {
    const mark = String(indicator || "").trim();
    Zotero.Prefs.set(`${config.prefsPrefix}.authors.markLast`, !!mark, true);
    if (mark)
      Zotero.Prefs.set(`${config.prefsPrefix}.authors.lastMark`, mark, true);
    applied.push("markLast");
  }
  const sep = read("sep-inter-author");
  if (sep !== undefined) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.separator`,
      String(sep),
      true,
    );
    applied.push("separator");
  }
  const omitted = read("sep-omitted-authors");
  if (omitted !== undefined) {
    Zotero.Prefs.set(
      `${config.prefsPrefix}.authors.omitted`,
      String(omitted),
      true,
    );
    applied.push("omitted");
  }
  // within-name separators and a mark BEFORE the name have no Zest equivalent
  for (const unsupported of [
    "sep-intra-author",
    "sep-intra-author-cjk",
    "indicator-position",
  ]) {
    if (read(unsupported) !== undefined) skipped.push(unsupported);
  }
  bumpAuthorsVersion();
  return { applied, skipped };
}
