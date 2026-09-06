import { readingStore } from "../reading/store";
import { config } from "../../package.json";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * Annotation density per regular item — what the "Annotations" column paints
 * and what the item-pane locator cards count.
 *
 * Computing it means walking every attachment's annotations, so it is done
 * lazily off the render path: the column asks for a cached summary, and a
 * miss schedules a background pass that recomputes a batch and then refreshes
 * exactly those rows. The Notifier invalidates on annotation changes.
 */

export interface AnnotSummary {
  /** number of annotations across all attachments */
  count: number;
  /** characters of highlighted text + comments (the original's "density") */
  chars: number;
  /** annotations per page bucket, 0-based, length = BUCKETS */
  histogram: number[];
  /** annotation count per colour, most used first */
  colors: Array<{ color: string; count: number }>;
  /** highest page index seen (0-based), -1 when unknown */
  maxPage: number;
}

export const EMPTY_SUMMARY: AnnotSummary = {
  count: 0,
  chars: 0,
  histogram: [],
  colors: [],
  maxPage: -1,
};

const BUCKETS = 40;

const summaries = new Map<number, AnnotSummary>();
/**
 * annotation id → the regular item it belongs to. Zotero's `delete` event only
 * carries `{libraryID, key}` and the annotation is already unloaded by then, so
 * the mapping has to be remembered while the annotation still exists.
 */
const annotOwner = new Map<number, number>();
const attachmentOwner = new Map<number, number>();
const pageSpans = new Map<string, { itemID: number; pages: number }>();
const queue = new Set<number>();
let queueTimer: number | undefined;
let notifierID: string | undefined;
let onReady: ((ids: number[]) => void) | undefined;
let unsubscribeReading: (() => void) | undefined;
let generation = 0;
let draining = false;

/** synchronous cache read — safe inside dataProvider/renderCell */
export function getSummary(itemID: number): AnnotSummary | undefined {
  return summaries.get(itemID);
}

/** ask for a summary; returns the cached one and schedules a pass on a miss */
export function requestSummary(item: Zotero.Item): AnnotSummary | undefined {
  const hit = summaries.get(item.id);
  if (hit) return hit;
  enqueue(item.id);
  return undefined;
}

function enqueue(itemID: number) {
  queue.add(itemID);
  if (queueTimer !== undefined || draining) return;
  queueTimer = setTimeout(() => {
    queueTimer = undefined;
    void drain();
  }, 250);
}

async function drain() {
  const run = generation;
  draining = true;
  const ids = [...queue];
  queue.clear();
  const done: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (run !== generation) return;
    try {
      const item = Zotero.Items.get(ids[i]) as Zotero.Item | false;
      if (item && (item as any).isRegularItem?.()) {
        summaries.set(ids[i], computeSummary(item as Zotero.Item));
        done.push(ids[i]);
      } else {
        summaries.set(ids[i], EMPTY_SUMMARY);
      }
    } catch (e) {
      summaries.set(ids[i], EMPTY_SUMMARY);
      ztoolkit.log("[annots] summary failed", e);
    }
    // yield every 25 items so a big sort does not block the UI thread
    if (i % 25 === 24) await Zotero.Promise.delay(0);
  }
  if (run !== generation) return;
  draining = false;
  if (done.length) onReady?.(done);
  if (queue.size) enqueue(queue.values().next().value!);
}

/** page count the reader reported for this item, 0 when never opened */
function pagesOfItem(item: Zotero.Item): number {
  try {
    return readingStore.getForItem(item)?.pages || 0;
  } catch {
    return 0;
  }
}

/** synchronous computation for ONE item (all its PDF/EPUB attachments) */
export function computeSummary(item: Zotero.Item): AnnotSummary {
  const owner = item.id;
  let count = 0;
  let chars = 0;
  let maxPage = -1;
  const perColor = new Map<string, number>();
  const pages: number[] = [];
  let attIDs: number[];
  try {
    attIDs = item.getAttachments();
  } catch {
    attIDs = [];
  }
  for (const attID of attIDs) {
    let anns: Zotero.Item[];
    try {
      const att = Zotero.Items.get(attID) as Zotero.Item;
      if (!att || typeof (att as any).getAnnotations !== "function") continue;
      attachmentOwner.set(attID, owner);
      anns = (att as any).getAnnotations() as Zotero.Item[];
    } catch {
      continue;
    }
    for (const a of anns) {
      try {
        if ((a as any).deleted) continue;
        annotOwner.set(a.id, owner);
        count++;
        chars +=
          (((a as any).annotationText as string) || "").length +
          (((a as any).annotationComment as string) || "").length;
        const color = ((a as any).annotationColor as string) || "";
        if (color) perColor.set(color, (perColor.get(color) || 0) + 1);
        const page = pageIndexOf(a);
        if (page >= 0) {
          pages.push(page);
          if (page > maxPage) maxPage = page;
        }
      } catch {
        // one broken annotation must not lose the rest
      }
    }
  }
  const histogram = new Array<number>(BUCKETS).fill(0);
  const known = pagesOfItem(item);
  pageSpans.set(`${item.libraryID}/${item.key}`, {
    itemID: item.id,
    pages: known,
  });
  if (pages.length && maxPage >= 0) {
    // scale to the DOCUMENT, not to the last annotated page: six highlights in
    // the first ten pages of a 400-page book otherwise fill the whole bar and
    // read as "annotated throughout". The reading tracker already records the
    // real page count per attachment; fall back to the last annotated page for
    // EPUBs and snapshots, which have no page count.
    const span = Math.max(maxPage + 1, known);
    for (const page of pages) {
      const b = Math.min(BUCKETS - 1, Math.floor((page / span) * BUCKETS));
      histogram[b] += 1;
    }
  }
  const colors = [...perColor.entries()]
    .map(([color, n]) => ({ color, count: n }))
    .sort((a, b) => b.count - a.count);
  return { count, chars, histogram, colors, maxPage };
}

/** 0-based page index from an annotation's position JSON, -1 when unavailable */
export function pageIndexOf(annotation: Zotero.Item): number {
  try {
    const raw = (annotation as any).annotationPosition as string | undefined;
    if (!raw) return -1;
    const pos = typeof raw === "string" ? JSON.parse(raw) : raw;
    const idx = pos?.pageIndex;
    return typeof idx === "number" && idx >= 0 ? idx : -1;
  } catch {
    return -1;
  }
}

/**
 * Watch annotation changes. Zotero reports them as `item` events whose ids are
 * ANNOTATION items; we map annotation → parent attachment → parent regular
 * item and invalidate that one.
 */
export function startAnnotationWatch(refresh: (ids: number[]) => void) {
  onReady = refresh;
  if (notifierID) return;
  unsubscribeReading = readingStore.onChange((keys) => {
    const changed: number[] = [];
    for (const key of keys) {
      const previous = pageSpans.get(key);
      if (!previous) continue;
      const pages = readingStore.items.get(key)?.pages || 0;
      if (pages === previous.pages) continue;
      previous.pages = pages;
      summaries.delete(previous.itemID);
      changed.push(previous.itemID);
    }
    // Seconds change on every tick; only a new document span needs a redraw.
    if (changed.length) onReady?.(changed);
  });
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string, ids: any[]) => {
        // Restoring from Trash refreshes the library, not its individual
        // attachment items. This infrequent event only invalidates known rows.
        if (type === "trash" && event === "refresh") {
          const libraries = new Set(ids.map(Number));
          const changed = new Set<number>();
          for (const [key, span] of pageSpans) {
            const libraryID = Number(key.slice(0, key.indexOf("/")));
            if (!libraries.size || libraries.has(libraryID)) {
              summaries.delete(span.itemID);
              changed.add(span.itemID);
            }
          }
          if (changed.size) onReady?.([...changed]);
          return;
        }
        if (type !== "item") return;
        if (!["add", "modify", "delete", "trash"].includes(event)) return;
        const parents = new Set<number>();
        for (const rawID of ids) {
          const id = Number(rawID);
          try {
            const it = Zotero.Items.get(id) as Zotero.Item | false;
            if (it && (it as any).isAnnotation?.()) {
              const previous = annotOwner.get(id);
              if (previous) parents.add(previous);
              const parent = parentRegularItemID(it as Zotero.Item);
              if (parent) {
                parents.add(parent);
                annotOwner.set(id, parent);
              }
              continue;
            }
            const oldParent = attachmentOwner.get(id);
            if (it && (it as any).isAttachment?.()) {
              const parent = it.parentItemID || id;
              if (event !== "modify" || parent !== oldParent) {
                if (oldParent) parents.add(oldParent);
                parents.add(parent);
              }
              attachmentOwner.set(id, parent);
              continue;
            }
            if (oldParent) {
              parents.add(oldParent);
              attachmentOwner.delete(id);
            }
            // a deleted annotation is already unloaded and Zotero's payload
            // only has {libraryID, key} — use the owner we remembered while
            // the annotation still existed
            const owner = annotOwner.get(id);
            if (owner) {
              parents.add(owner);
              annotOwner.delete(id);
            }
            if (event === "delete") summaries.delete(id);
          } catch {
            // ignore individual ids
          }
        }
        if (!parents.size) return;
        const list = [...parents];
        for (const id of list) summaries.delete(id);
        refresh(list);
      },
    },
    ["item", "trash"],
    `${config.addonRef}-annots`,
    60,
  );
}

export function stopAnnotationWatch() {
  generation++;
  draining = false;
  unsubscribeReading?.();
  unsubscribeReading = undefined;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = undefined;
  }
  queue.clear();
  summaries.clear();
  annotOwner.clear();
  attachmentOwner.clear();
  pageSpans.clear();
  onReady = undefined;
  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch {
      // ignore
    }
    notifierID = undefined;
  }
}

function parentRegularItemID(annotation: Zotero.Item): number | undefined {
  try {
    const attID = (annotation as any).parentItemID as number | undefined;
    if (!attID) return undefined;
    const att = Zotero.Items.get(attID) as Zotero.Item;
    const pid = (att as any)?.parentItemID as number | undefined;
    return pid || attID;
  } catch {
    return undefined;
  }
}
