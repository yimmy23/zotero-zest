import { config } from "../package.json";
import { version } from "../package.json";
import {
  readingStore,
  pagesSeen,
  formatDuration,
  type ItemReading,
} from "./reading/store";
import { effectiveStatus } from "./reading/status";
import { getRating } from "./columns/rating";
import { citationOf } from "./cite/index";
import { getJournalRecord, displayValues } from "./rank/index";
import { displayFields } from "./rank/rank";
import { numberOf } from "./rank/types";
import { getSummary, computeSummary } from "./annots/density";
import { textTagsOf } from "./columns/textTags";
import { getPref } from "./utils/prefs";

/**
 * `Zotero.Zest.api` — the read-only surface other tools call.
 *
 * It exists for the places that run user-written JavaScript against a Zotero
 * item and have no way to reach a plugin's internals: Better Notes templates,
 * Actions & Tags scripts, Tools ▸ Run JavaScript.
 *
 * Three rules hold everywhere below, because a template is a hostile caller —
 * it interpolates whatever comes back straight into a note, and a throw from
 * one field aborts the whole template:
 *
 *   1. Nothing throws. A missing record, a deleted item, a child item passed
 *      where a regular one was meant — all answer with an empty value.
 *   2. Everything is interpolation-safe: strings, finite numbers, plain
 *      objects and arrays. No Maps, no class instances, no internal types.
 *   3. Nothing writes. This is a reporting surface; changing a rating or a
 *      read status stays with the UI, where the user can see it happen.
 *
 * Items may be passed as a `Zotero.Item` or as a numeric id, and an attachment
 * or note resolves to its parent — a template's `item` is often the PDF.
 */

/* ------------------------------------------------------------------ */
/* plumbing                                                            */
/* ------------------------------------------------------------------ */

type ItemLike = Zotero.Item | number | null | undefined;

/** the regular item behind whatever the caller had at hand */
function resolve(input: ItemLike): Zotero.Item | null {
  try {
    let item: any = input;
    if (typeof item === "number") item = Zotero.Items.get(item);
    if (!(item instanceof Zotero.Item)) return null;
    if (!item.isRegularItem() && typeof item.topLevelItem === "object") {
      item = item.topLevelItem;
    }
    return item instanceof Zotero.Item ? item : null;
  } catch {
    return null;
  }
}

/** every exported function is wrapped in this: a template must never see a throw */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    ztoolkit.log("[api] call failed", e);
    return fallback;
  }
}

function reading(input: ItemLike): ItemReading | undefined {
  const item = resolve(input);
  return item ? readingStore.getForItem(item) : undefined;
}

/** epoch seconds → YYYY-MM-DD, "" when never */
function isoDay(epochSeconds: number): string {
  if (!(epochSeconds > 0)) return "";
  const d = new Date(epochSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** filled mark → its hollow twin, for text output that has no styling */
const HOLLOW: Record<string, string> = {
  "★": "☆",
  "♥": "♡",
  "●": "○",
  "◆": "◇",
  "■": "□",
};

/* ------------------------------------------------------------------ */
/* the surface                                                         */
/* ------------------------------------------------------------------ */

export const api = {
  version,
  addonRef: config.addonRef,

  /* ---- reading ---- */

  /** total time spent in the reader, in seconds (0 when never opened) */
  readingSeconds: (item: ItemLike): number =>
    safe(() => Math.round(reading(item)?.total ?? 0), 0),

  /** the same figure the Reading column shows: "45 min", "1.5 h" */
  readingTime: (item: ItemLike): string =>
    safe(() => formatDuration(reading(item)?.total ?? 0), ""),

  /** pages that got more than `minSeconds` of attention */
  pagesRead: (item: ItemLike, minSeconds = 5): number =>
    safe(() => {
      const rec = reading(item);
      return rec ? pagesSeen(rec, minSeconds) : 0;
    }, 0),

  /** pages in the attachment the page map came from (0 when unknown) */
  pagesTotal: (item: ItemLike): number =>
    safe(() => reading(item)?.pages ?? 0, 0),

  /** pagesRead / pagesTotal as a whole percent, 0 when either is unknown */
  readingProgress: (item: ItemLike, minSeconds = 5): number =>
    safe(() => {
      const rec = reading(item);
      if (!rec?.pages) return 0;
      return Math.round((pagesSeen(rec, minSeconds) / rec.pages) * 100);
    }, 0),

  /** YYYY-MM-DD of the first reading session, "" when never read */
  firstRead: (item: ItemLike): string =>
    safe(() => isoDay(reading(item)?.firstRead ?? 0), ""),

  /**
   * YYYY-MM-DD of the most recent reading session. Zotero 10 keeps its own
   * synced last-read stamp on the attachments (`getItemLastRead`, set when a
   * file is opened or a page turned on any device); the later of the two wins,
   * so a paper read on another machine is not reported as untouched here.
   */
  lastRead: (item: ItemLike): string =>
    safe(() => {
      const it = resolve(item);
      const own = reading(it)?.lastRead ?? 0;
      let native: number;
      try {
        native = Number((it as any)?.getItemLastRead?.() ?? 0) || 0;
      } catch {
        native = 0;
      }
      return isoDay(Math.max(own, native));
    }, ""),

  /** { "2026-08-21": 930, … } — seconds per calendar day */
  readingByDay: (item: ItemLike): Record<string, number> =>
    safe(() => Object.fromEntries(reading(item)?.days ?? []), {}),

  /** { 0: 120, 1: 45, … } — seconds per 0-based page of the main attachment */
  readingByPage: (item: ItemLike): Record<number, number> =>
    safe(() => {
      const out: Record<number, number> = {};
      for (const [page, seconds] of reading(item)?.page ?? []) {
        if (page >= 0) out[page] = Math.round(seconds);
      }
      return out;
    }, {}),

  /* ---- status and rating ---- */

  /**
   * The status the Status column shows: "New" | "To Read" | "In Progress" |
   * "Read" | "Not Reading" | "" — the one the user set, or, when none is set,
   * the one read from the reading record (see readStatusSource).
   */
  readStatus: (item: ItemLike): string =>
    safe(() => {
      const it = resolve(item);
      return it ? effectiveStatus(it).status : "";
    }, ""),

  /** "manual" (set by the user, in Extra) | "auto" (read from the reading
   *  record / Zotero's last-read stamp) | "none" */
  readStatusSource: (item: ItemLike): string =>
    safe(() => {
      const it = resolve(item);
      return it ? effectiveStatus(it).source : "none";
    }, "none"),

  /** 0–5 */
  rating: (item: ItemLike): number =>
    safe(() => {
      const it = resolve(item);
      return it ? getRating(it) : 0;
    }, 0),

  /**
   * The rating drawn with the user's own marks, e.g. "★★★☆☆".
   *
   * The column can afford `rating.mark` and `rating.option` being the same
   * glyph — CSS tells the filled ones apart. A note has no CSS, so an empty
   * mark that matches the filled one would render five identical symbols for
   * every rating. When they collide we substitute the hollow counterpart.
   */
  ratingStars: (item: ItemLike): string =>
    safe(() => {
      const it = resolve(item);
      const n = it ? getRating(it) : 0;
      const mark = (getPref("rating.mark") as string) || "★";
      let empty = (getPref("rating.option") as string) || "";
      if (!empty || empty === mark) empty = HOLLOW[mark] ?? "☆";
      return mark.repeat(n) + empty.repeat(Math.max(0, 5 - n));
    }, ""),

  /* ---- citations ---- */

  /** citation count recorded in Extra, 0 when none has been fetched */
  citations: (item: ItemLike): number =>
    safe(() => {
      const it = resolve(item);
      return it ? (citationOf(it)?.count ?? 0) : 0;
    }, 0),

  /** { count, source, date } — source is "Crossref" / "OpenAlex" / … */
  citationInfo: (
    item: ItemLike,
  ): { count: number; source: string; date: string } | null =>
    safe(() => {
      const it = resolve(item);
      const info = it ? citationOf(it) : undefined;
      if (!info) return null;
      return {
        count: info.count,
        source: info.source ?? "",
        date: info.date ?? "",
      };
    }, null),

  /* ---- journal ---- */

  /**
   * The badges the journal columns show, in the order the user configured
   * (`rank.fields`): [{ field: "中科院分区", value: "1区", source: "easyscholar" }].
   * Falls back to everything on the record when nothing matches.
   */
  journalRanks: (
    item: ItemLike,
  ): Array<{ field: string; value: string; source: string }> =>
    safe(() => {
      const it = resolve(item);
      const rec = it ? getJournalRecord(it) : undefined;
      if (!rec) return [];
      const shown = displayValues(rec, displayFields());
      const list = shown.length ? shown : rec.values;
      return list.map((v) => ({
        field: v.field,
        value: v.value,
        source: String(v.source),
      }));
    }, []),

  /** the same badges as one string, e.g. "1区 · Q1" */
  journalRank: (item: ItemLike, separator = " · "): string =>
    safe(
      () =>
        api
          .journalRanks(item)
          .map((v) => v.value)
          .join(separator),
      "",
    ),

  /** impact factor for the field the user picked, null when unknown */
  impactFactor: (item: ItemLike): number | null =>
    safe(() => {
      const it = resolve(item);
      const rec = it ? getJournalRecord(it) : undefined;
      if (!rec) return null;
      const field = String(getPref("if.field") || "sciif");
      const n = numberOf(rec, [field, "sciif", "sciif5", "oa2yr"]);
      return n === undefined ? null : n;
    }, null),

  /** the journal name the record was matched on ("" when unmatched) */
  journalName: (item: ItemLike): string =>
    safe(() => {
      const it = resolve(item);
      return it ? (getJournalRecord(it)?.name ?? "") : "";
    }, ""),

  /* ---- annotations ---- */

  /** annotations across every attachment */
  annotationCount: (item: ItemLike): number =>
    safe(() => summary(item).count, 0),

  /** characters of highlighted text plus comments */
  annotationChars: (item: ItemLike): number =>
    safe(() => summary(item).chars, 0),

  /** [{ color: "#ffd400", count: 12 }, …], most used first */
  annotationColors: (item: ItemLike): Array<{ color: string; count: number }> =>
    safe(() => summary(item).colors.map((c) => ({ ...c })), []),

  /* ---- tags ---- */

  /** the tags the badge column shows: [{ tag: "#Method/Cohort", text: "Cohort", color }] */
  textTags: (
    item: ItemLike,
  ): Array<{ tag: string; text: string; color: string }> =>
    safe(() => {
      const it = resolve(item);
      return it ? textTagsOf(it).map((t) => ({ ...t })) : [];
    }, []),
};

/** cached when the watcher has already been here, computed on demand otherwise */
function summary(item: ItemLike) {
  const it = resolve(item);
  if (!it) return { count: 0, chars: 0, colors: [] as any[] };
  return getSummary(it.id) ?? computeSummary(it);
}

export type ZestApi = typeof api;
