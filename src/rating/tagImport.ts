import { setRating, getRating, RATING_KEYS } from "../columns/rating";
import { getExtraLine } from "../utils/extra";
import { parseStarRatingTag } from "./starTags";
import { setTimeout } from "../utils/timers";

export type RatingImportStatus =
  | "ready"
  | "no-tag"
  | "conflict"
  | "existing"
  | "nonregular"
  | "readonly"
  | "deleted"
  | "duplicate"
  | "unavailable"
  | "changed"
  | "failed"
  | "imported";

export interface RatingImportRow {
  item: Zotero.Item;
  id: string;
  title: string;
  existingRating: number;
  tagCandidates: string[];
  candidateRating?: number;
  status: RatingImportStatus;
  /** Exact values captured for optimistic concurrency protection at confirm. */
  snapshot: {
    tags: string[];
    extra: string;
    editable: boolean;
    deleted: boolean;
  };
}

export interface RatingImportPreview {
  rows: RatingImportRow[];
  total: number;
  eligible: number;
  skipped: number;
}

export interface RatingImportCommitResult {
  imported: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  rows: RatingImportRow[];
}

export interface RatingImportCommitOptions {
  /** Checked before every write; a closed dialog must stop the batch. */
  isCancelled?: () => boolean;
  /** Yield after this many sequential saves so a large selection stays responsive. */
  yieldEvery?: number;
  onProgress?: (result: RatingImportCommitResult) => void;
}

const inFlight = new WeakSet<RatingImportPreview>();

function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function tagsOf(item: Zotero.Item): string[] | undefined {
  const tags = safely(() => item.getTags());
  if (!Array.isArray(tags)) return undefined;
  const values: string[] = [];
  for (const entry of tags) {
    const tag = typeof entry === "string" ? entry : entry?.tag;
    if (typeof tag !== "string") return undefined;
    values.push(tag);
  }
  return values;
}

function extraOf(item: Zotero.Item): string | undefined {
  const value = safely(() => item.getField("extra"));
  return typeof value === "string" ? value : undefined;
}

function deletedOf(item: Zotero.Item): boolean {
  return (
    safely(() => item.deleted === true) === true ||
    safely(() => (item as any).isDeleted?.() === true) === true
  );
}

function editableOf(item: Zotero.Item): boolean {
  return safely(() => item.isEditable()) === true;
}

function regularOf(item: Zotero.Item): boolean {
  return safely(() => item.isRegularItem()) === true;
}

function titleOf(item: Zotero.Item): string {
  const title = safely(() => item.getField("title"));
  return typeof title === "string" && title ? title : "—";
}

function stableID(item: Zotero.Item, fallback: number): string {
  const libraryID = safely(() => item.libraryID);
  const key = safely(() => item.key);
  if (
    (typeof libraryID === "number" || typeof libraryID === "string") &&
    Number.isFinite(Number(libraryID)) &&
    Number(libraryID) > 0 &&
    typeof key === "string" &&
    key
  )
    return `library:${libraryID}/${key}`;
  const id = safely(() => item.id);
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    return `item:${id}`;
  return `unidentified:${fallback}`;
}

function inspect(item: Zotero.Item, id: string): RatingImportRow {
  const tags = tagsOf(item);
  const extra = extraOf(item);
  const deleted = deletedOf(item);
  const editable = editableOf(item);
  const snapshot = { tags: tags || [], extra: extra || "", editable, deleted };
  const base: RatingImportRow = {
    item,
    id,
    title: titleOf(item),
    existingRating: 0,
    tagCandidates: [],
    status: "unavailable",
    snapshot,
  };
  if (deleted) return { ...base, status: "deleted" };
  if (!regularOf(item)) return { ...base, status: "nonregular" };
  if (!editable) return { ...base, status: "readonly" };
  if (!tags || extra === undefined) return base;
  // The presence of any supported Extra line owns the field, even when its
  // value is malformed or duplicated. Do not infer permission from getRating.
  const line = getExtraLine(item, RATING_KEYS);
  const existingRating = getRating(item);
  if (line) return { ...base, existingRating, status: "existing" };
  const parsed = tags
    .map((tag) => ({ tag, rating: parseStarRatingTag(tag) }))
    .filter((entry): entry is { tag: string; rating: number } =>
      Number.isInteger(entry.rating),
    );
  const ratings = new Set(parsed.map((entry) => entry.rating));
  const tagCandidates = parsed.map((entry) => entry.tag);
  if (!ratings.size) return { ...base, tagCandidates, status: "no-tag" };
  if (ratings.size !== 1) return { ...base, tagCandidates, status: "conflict" };
  return {
    ...base,
    tagCandidates,
    candidateRating: [...ratings][0],
    status: "ready",
  };
}

/** Build a read-only, deduplicated snapshot from exactly the caller's selection. */
export function collectRatingImportPreview(
  items: Zotero.Item[],
): RatingImportPreview {
  const seen = new Set<string>();
  const rows: RatingImportRow[] = [];
  for (const [index, item] of items.entries()) {
    const id = stableID(item, index);
    const row = inspect(item, id);
    if (!id.startsWith("unidentified:") && seen.has(id)) {
      rows.push({ ...row, status: "duplicate" });
      continue;
    }
    if (!id.startsWith("unidentified:")) seen.add(id);
    rows.push(row);
  }
  const eligible = rows.filter((row) => row.status === "ready").length;
  return {
    rows,
    total: rows.length,
    eligible,
    skipped: rows.length - eligible,
  };
}

function unchanged(row: RatingImportRow): boolean {
  const current = inspect(row.item, row.id);
  return (
    current.status === "ready" &&
    current.candidateRating === row.candidateRating &&
    current.snapshot.editable === row.snapshot.editable &&
    current.snapshot.deleted === row.snapshot.deleted &&
    current.snapshot.extra === row.snapshot.extra &&
    current.snapshot.tags.length === row.snapshot.tags.length &&
    current.snapshot.tags.every(
      (tag, index) => tag === row.snapshot.tags[index],
    )
  );
}

function tally(
  rows: RatingImportRow[],
  cancelled: boolean,
): RatingImportCommitResult {
  return {
    imported: rows.filter((row) => row.status === "imported").length,
    skipped: rows.filter(
      (row) =>
        row.status !== "ready" &&
        row.status !== "failed" &&
        row.status !== "imported",
    ).length,
    failed: rows.filter((row) => row.status === "failed").length,
    cancelled,
    rows,
  };
}

/**
 * Confirm the preview. It never rescans a library: each candidate is re-read
 * immediately before its sequential write and stale rows are skipped.
 */
export async function commitRatingImport(
  preview: RatingImportPreview,
  options: RatingImportCommitOptions = {},
): Promise<RatingImportCommitResult> {
  if (inFlight.has(preview)) return tally(preview.rows, true);
  inFlight.add(preview);
  let imported = 0;
  let skipped = preview.rows.filter((row) => row.status !== "ready").length;
  let failed = 0;
  let cancelled = false;
  const every = Math.max(1, options.yieldEvery || 20);
  const result = () => ({
    imported,
    skipped,
    failed,
    cancelled,
    rows: preview.rows,
  });
  try {
    let processed = 0;
    for (const row of preview.rows) {
      if (processed++ && (processed - 1) % every === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (addon.data.alive === false || options.isCancelled?.()) {
        cancelled = true;
        break;
      }
      if (row.status !== "ready") continue;
      if (!unchanged(row)) {
        row.status = "changed";
        skipped++;
        options.onProgress?.(result());
        continue;
      }
      try {
        await setRating(row.item, row.candidateRating!);
        // A completed candidate is not eligible for a second confirmation.
        row.candidateRating = undefined;
        row.status = "imported";
        imported++;
      } catch (error) {
        row.status = "failed";
        failed++;
        ztoolkit.log("[rating import] save failed", error);
      }
      options.onProgress?.(result());
    }
  } finally {
    inFlight.delete(preview);
  }
  return result();
}
